// ============================================================
//  PetForm Pro — Anthropic API Proxy
//  Deploy to Vercel as a Serverless Function: /api/ai-proxy
//  Keeps your ANTHROPIC_API_KEY secret on the server
// ============================================================
//
//  Setup:
//  1. Get an API key from https://console.anthropic.com/
//  2. In Vercel dashboard → Settings → Environment Variables, add:
//       ANTHROPIC_API_KEY = sk-ant-xxxxxxxxxxxxxxxxxxxx
//  3. Optionally restrict by user (add Supabase auth check below)
// ============================================================

export default async function handler(req, res) {
  // --- CORS for your own domain only ---
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // --- Validate API key is configured ---
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set in Vercel environment variables');
    return res.status(500).json({ error: 'Server not configured. Please set ANTHROPIC_API_KEY in Vercel.' });
  }

  // --- Optional: rate limit per IP (basic) ---
  // For production, use Upstash Redis or similar. This is in-memory only.
  // Skipped here for simplicity — add as needed.

  // --- Optional: require authenticated user ---
  // Uncomment to restrict AI to logged-in Supabase users:
  /*
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — please log in' });
  }
  const token = authHeader.replace('Bearer ', '');
  // Verify with Supabase: const { data: user } = await supabase.auth.getUser(token);
  // if (!user) return res.status(401).json({ error: 'Invalid session' });
  */

  try {
    const body = req.body;
    if (!body || !body.messages) {
      return res.status(400).json({ error: 'Invalid request: missing messages' });
    }

    // Limit max_tokens to prevent runaway costs
    const safeBody = {
      ...body,
      max_tokens: Math.min(body.max_tokens || 1200, 2000),
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(safeBody),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(response.status).json({
        error: data.error?.message || 'AI service error',
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('AI proxy error:', error);
    return res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
}
