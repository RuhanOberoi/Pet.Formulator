// ============================================================
//  PetForm Pro — AI Proxy with Usage Limits
//  Deploy to Vercel as: /api/ai-proxy
// ============================================================
//
//  This proxy:
//  1. Verifies the user's auth token (must be signed in)
//  2. Checks the user's plan (free / pro / proplus / business)
//  3. Counts their AI usage this month
//  4. Enforces monthly + daily limits
//  5. Caps token usage per request to control costs
//  6. Logs usage to Supabase (so admin dashboard can show it)
//  7. Sends alert if a single user is using a lot
//
//  Required environment variables in Vercel:
//  - ANTHROPIC_API_KEY
//  - SUPABASE_URL
//  - SUPABASE_SERVICE_KEY  (NOT the anon key — this bypasses RLS)
//  - ADMIN_ALERT_EMAIL    (your email, for usage alerts) [optional]
//
//  Required Supabase table (run supabase-ai-usage-migration.sql):
//  - ai_usage  (tracks every AI call per user)
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service_role key - bypasses RLS
);

// Plan limits (monthly AI calls)
const PLAN_LIMITS = {
  free: 0,
  pro: 20,
  proplus: 100,
  business: 500,
};

// Daily limits (prevents single-day abuse)
const DAILY_LIMITS = {
  free: 0,
  pro: 8,        // ~40% of monthly cap per day
  proplus: 30,
  business: 100,
};

// Max tokens per request (caps your per-call cost at ~$0.05)
const MAX_TOKENS_LIMIT = 2000;

// Models we allow (prevent users from passing arbitrary models)
const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-5',
  'claude-opus-4-7',
  'claude-haiku-4-5',
]);

// Cost estimates (USD per 1M tokens)
const COST_PER_MTOK = {
  'claude-sonnet-4-5':    { input: 3,    output: 15 },
  'claude-opus-4-7':             { input: 15,   output: 75 },
  'claude-haiku-4-5':   { input: 0.80, output: 4 },
};

// Usage thresholds for admin alerts
const ALERT_THRESHOLD_DAILY = 10;      // alert if user uses 10+ in a day
const ALERT_THRESHOLD_MONTHLY = 80;    // alert if user uses 80+ in a month

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Validate environment
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI not configured: ANTHROPIC_API_KEY missing in Vercel env vars.' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'AI proxy not fully configured: Supabase env vars missing.' });
  }

  // -------- AUTHENTICATE THE USER --------
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return res.status(401).json({ error: 'You must be signed in to use AI features.' });
  }

  // Verify token with Supabase
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
  }

  // -------- CHECK USER'S PLAN --------
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, email, name, bonus_credits, bonus_credits_month')
    .eq('id', user.id)
    .single();

  const plan = (profile && profile.plan) || 'free';
  const baseLimit = PLAN_LIMITS[plan] || 0;
  const dailyLimit = DAILY_LIMITS[plan] || 0;

  // -------- BONUS CREDITS HANDLING --------
  // Bonus credits are valid only for the month they were granted.
  // Format: 'YYYY-MM' (e.g., '2026-05')
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let bonusCredits = 0;
  if (profile && profile.bonus_credits_month === currentMonthKey) {
    bonusCredits = profile.bonus_credits || 0;
  }
  // If bonus is from a previous month, it's expired (we don't auto-clear it here
  // to keep this read-only — admin dashboard can show it as expired)

  // Effective monthly limit = plan limit + active bonus credits
  const monthlyLimit = baseLimit + bonusCredits;

  if (monthlyLimit === 0) {
    return res.status(402).json({
      error: 'AI features require a paid Pro subscription.',
      message: 'Upgrade to Pro ($14/mo) for 20 AI calls/month, or Pro+ ($29/mo) for 100.',
    });
  }

  // -------- CHECK USAGE THIS MONTH --------
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const { count: monthlyUsage, error: usageErr } = await supabase
    .from('ai_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', monthStart.toISOString());

  if (usageErr) {
    console.error('Usage lookup failed:', usageErr);
    // Don't block the user — log and continue
  }

  if ((monthlyUsage || 0) >= monthlyLimit) {
    const bonusText = bonusCredits > 0 ? ` (incl. ${bonusCredits} bonus)` : '';
    return res.status(429).json({
      error: 'monthly_quota_exceeded',
      message: `You've used all ${monthlyLimit}${bonusText} of your AI calls this month on the ${plan.toUpperCase()} plan. ${plan === 'pro' ? 'Upgrade to Pro+ for 5x more.' : 'Your quota resets on the 1st of next month.'}`,
      usage: monthlyUsage,
      limit: monthlyLimit,
      base_limit: baseLimit,
      bonus_credits: bonusCredits,
      plan,
    });
  }

  // Check daily limit
  const { count: dailyUsage } = await supabase
    .from('ai_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', dayStart.toISOString());

  if ((dailyUsage || 0) >= dailyLimit) {
    return res.status(429).json({
      error: 'daily_quota_exceeded',
      message: `You've reached your daily AI limit of ${dailyLimit} calls on the ${plan.toUpperCase()} plan. This prevents abuse and protects everyone's experience. Try again tomorrow, or upgrade your plan for higher limits.`,
      dailyUsage,
      dailyLimit,
      plan,
    });
  }

  // -------- VALIDATE & SANITIZE THE REQUEST --------
  const body = req.body || {};
  const requestedModel = body.model || 'claude-sonnet-4-5';
  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : 'claude-sonnet-4-5';
  const maxTokens = Math.min(body.max_tokens || 1500, MAX_TOKENS_LIMIT);

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // -------- CALL ANTHROPIC --------
  let anthropicResponse;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCost = 0;

  try {
    const startTime = Date.now();
    anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: body.system || undefined,
        messages: body.messages,
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error('Anthropic API error:', errText);
      return res.status(anthropicResponse.status).json({ error: 'AI service error: ' + errText.substring(0, 200) });
    }

    const data = await anthropicResponse.json();
    inputTokens = data.usage?.input_tokens || 0;
    outputTokens = data.usage?.output_tokens || 0;

    // Calculate cost
    const costRates = COST_PER_MTOK[model] || COST_PER_MTOK['claude-sonnet-4-5'];
    estimatedCost = (inputTokens / 1_000_000) * costRates.input + (outputTokens / 1_000_000) * costRates.output;

    // -------- LOG USAGE TO SUPABASE --------
    try {
      await supabase.from('ai_usage').insert({
        user_id: user.id,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: estimatedCost,
        endpoint: body.system?.includes('Analyser') ? 'analyser' : 'builder',
        duration_ms: Date.now() - startTime,
      });
    } catch (logErr) {
      console.error('Usage log failed (non-fatal):', logErr);
    }

    // -------- ADMIN ALERTS for unusual usage --------
    const newDailyUsage = (dailyUsage || 0) + 1;
    const newMonthlyUsage = (monthlyUsage || 0) + 1;

    if (newDailyUsage === ALERT_THRESHOLD_DAILY || newMonthlyUsage === ALERT_THRESHOLD_MONTHLY) {
      // Log alert (could also send email via Resend/SendGrid here)
      console.warn(`⚠️ HIGH USAGE ALERT: User ${profile?.email || user.id} (${plan}) hit ${newDailyUsage} daily / ${newMonthlyUsage} monthly`);
      try {
        await supabase.from('admin_alerts').insert({
          user_id: user.id,
          alert_type: newDailyUsage === ALERT_THRESHOLD_DAILY ? 'high_daily_usage' : 'high_monthly_usage',
          message: `User ${profile?.email || user.id} (${plan}) reached ${newDailyUsage}/day, ${newMonthlyUsage}/month`,
          metadata: { plan, dailyUsage: newDailyUsage, monthlyUsage: newMonthlyUsage },
        });
      } catch (e) { /* ignore — table may not exist yet */ }
    }

    // Return the AI response
    return res.status(200).json(data);

  } catch (err) {
    console.error('AI proxy error:', err);
    return res.status(500).json({ error: 'AI proxy error: ' + err.message });
  }
}
