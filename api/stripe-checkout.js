// ============================================================
//  PetForm Pro — Stripe Checkout
//  Deploy to Vercel as: /api/stripe-checkout
// ============================================================
//
//  Setup checklist:
//  1. Sign up at https://stripe.com → get your API keys
//  2. Create products in Stripe Dashboard → Products:
//     - "PetForm Pro Monthly" — $14/month (recurring)
//     - "PetForm Pro Yearly"  — $140/year (recurring)
//     Each product gives you a "Price ID" like price_1Abc...
//  3. Add these env vars to Vercel (Settings → Environment Variables):
//     STRIPE_SECRET_KEY        = sk_test_xxxxx (from Stripe API keys page)
//     STRIPE_PRICE_MONTHLY     = price_xxxxx (your monthly price ID)
//     STRIPE_PRICE_YEARLY      = price_xxxxx (your yearly price ID)
//     STRIPE_WEBHOOK_SECRET    = whsec_xxxxx (set after Step 4 — see stripe-webhook.js)
//  4. Install stripe in your project: in package.json (or create one), add:
//     { "dependencies": { "stripe": "^14.0.0" } }
//     Then redeploy on Vercel — it auto-installs.
// ============================================================

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY in Vercel.' });
  }

  try {
    const { plan, email, userId, successUrl, cancelUrl } = req.body;

    if (!email || !userId) {
      return res.status(400).json({ error: 'Missing email or userId' });
    }

    // Determine price ID based on selected plan
    let priceId;
    if (plan === 'proplus') {
      priceId = process.env.STRIPE_PRICE_PROPLUS_MONTHLY;
    } else if (plan === 'yearly_proplus') {
      priceId = process.env.STRIPE_PRICE_PROPLUS_YEARLY;
    } else if (plan === 'yearly') {
      priceId = process.env.STRIPE_PRICE_YEARLY;
    } else {
      priceId = process.env.STRIPE_PRICE_MONTHLY;
    }

    if (!priceId) {
      return res.status(500).json({ error: `STRIPE_PRICE_${plan.toUpperCase()} not configured. Please set this env var in Vercel.` });
    }

    // Create or retrieve customer
    let customerId;
    const existingCustomers = await stripe.customers.list({ email, limit: 1 });
    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email,
        metadata: { userId },
      });
      customerId = customer.id;
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { userId, plan },
      },
      success_url: successUrl || `${req.headers.origin}/?upgrade=success`,
      cancel_url: cancelUrl || `${req.headers.origin}/?upgrade=cancelled`,
      allow_promotion_codes: true,  // lets users enter promo codes
      billing_address_collection: 'auto',
      metadata: { userId, plan },
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return res.status(500).json({ error: error.message });
  }
}
