// ============================================================
//  PetForm Pro — Stripe Billing Portal
//  Deploy to Vercel as: /api/stripe-portal
// ============================================================
//
//  Lets users manage their own subscription:
//  - Update payment method
//  - View invoices
//  - Cancel subscription
//  - Switch plan (monthly ↔ yearly)
//
//  Setup: enable the Customer Portal in Stripe Dashboard:
//  Settings → Billing → Customer portal → Activate
// ============================================================

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId, returnUrl } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    // Look up the user's Stripe customer ID
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id, email')
      .eq('id', userId)
      .single();

    if (!profile || !profile.stripe_customer_id) {
      return res.status(404).json({ error: 'No Stripe customer found for this user. They may not have subscribed yet.' });
    }

    // Create a portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: returnUrl || req.headers.origin,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Stripe portal error:', error);
    return res.status(500).json({ error: error.message });
  }
}
