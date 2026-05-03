// ============================================================
//  PetForm Pro — Stripe Checkout
//  Deploy to Vercel as: /api/stripe-checkout
// ============================================================
//
//  Setup checklist:
//  1. Sign up at https://stripe.com → get your API keys
//  2. Create products in Stripe Dashboard → Products:
//     - "PetForm Pro Monthly"  — $14/month (recurring)
//     - "PetForm Pro+ Monthly" — $29/month (recurring)
//     Each product gives you a "Price ID" like price_1Abc...
//  3. Add these env vars to Vercel (Settings → Environment Variables):
//     STRIPE_SECRET_KEY            = sk_test_xxxxx (from Stripe API keys page)
//     STRIPE_PRICE_MONTHLY         = price_xxxxx (your Pro monthly price ID)
//     STRIPE_PRICE_PROPLUS_MONTHLY = price_xxxxx (your Pro+ monthly price ID)
//     STRIPE_WEBHOOK_SECRET        = whsec_xxxxx (set after Step 4 — see stripe-webhook.js)
//  4. Install stripe in your project: in package.json (or create one), add:
//     { "dependencies": { "stripe": "^14.0.0" } }
//     Then redeploy on Vercel — it auto-installs.
// ============================================================

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

// Helper: map Stripe price ID to plan tier
function priceIdToPlan(priceId) {
  if (priceId === process.env.STRIPE_PRICE_PROPLUS_MONTHLY) return 'proplus';
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return 'pro';
  return null;
}

// Helper: get Supabase admin client (only if env vars are set)
function getSupabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

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

    // Determine price ID based on selected plan (monthly only for simplicity)
    let priceId;
    if (plan === 'proplus') {
      priceId = process.env.STRIPE_PRICE_PROPLUS_MONTHLY;
    } else if (plan === 'monthly' || !plan) {
      priceId = process.env.STRIPE_PRICE_MONTHLY;
    } else {
      // Reject unknown plans — keeps API surface tight
      return res.status(400).json({
        error: 'invalid_plan',
        message: `Unknown plan: "${plan}". Supported plans: "monthly" (Pro), "proplus" (Pro+).`,
      });
    }

    if (!priceId) {
      return res.status(500).json({ error: `Price ID not configured for plan "${plan}". Please set the appropriate env var in Vercel.` });
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

    // ─── CHECK FOR EXISTING ACTIVE SUBSCRIPTION ───
    // If the user already has an active subscription, we should UPGRADE/CHANGE it
    // instead of creating a new checkout (which would fail or charge twice).
    const existingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });

    if (existingSubs.data.length > 0) {
      const existingSub = existingSubs.data[0];
      const currentPriceId = existingSub.items.data[0].price.id;
      const currentPlanTier = priceIdToPlan(currentPriceId);
      const targetPlanTier = priceIdToPlan(priceId);

      // ─── SYNC CHECK: Detect Supabase ↔ Stripe mismatch ───
      // If we have Supabase access, check what the user's profile says
      const supaAdmin = getSupabaseAdmin();
      let supabasePlan = null;
      if (supaAdmin && userId) {
        const { data: profile } = await supaAdmin
          .from('profiles')
          .select('plan')
          .eq('id', userId)
          .single();
        if (profile) supabasePlan = profile.plan;
      }

      // Mismatch detected: Stripe has active sub but Supabase says free or different
      // Auto-sync Supabase to match Stripe (the source of truth for billing)
      if (supabasePlan && currentPlanTier && supabasePlan !== currentPlanTier && supaAdmin) {
        console.warn(`Sync mismatch: Stripe=${currentPlanTier}, Supabase=${supabasePlan}. Auto-syncing.`);
        await supaAdmin
          .from('profiles')
          .update({
            plan: currentPlanTier,
            stripe_customer_id: customerId,
            stripe_subscription_id: existingSub.id,
            stripe_subscription_status: existingSub.status,
          })
          .eq('id', userId);

        // If they're trying to subscribe to what they already have (now synced), tell them clearly
        if (currentPriceId === priceId) {
          return res.status(400).json({
            error: 'synced_already_on_plan',
            message: `We've synced your account — you already have an active ${currentPlanTier === 'proplus' ? 'Pro+' : 'Pro'} subscription. Please refresh the page to see your correct plan. To change plans, choose a different one.`,
            synced_plan: currentPlanTier,
          });
        }
        // Otherwise, fall through to upgrade flow below (they want to actually change plans)
      }

      // If they're trying to subscribe to the EXACT same price they already have
      if (currentPriceId === priceId) {
        return res.status(400).json({
          error: 'already_on_plan',
          message: `You already have an active ${currentPlanTier === 'proplus' ? 'Pro+' : 'Pro'} subscription. To cancel or modify it, use the "Manage Subscription" option.`,
          current_plan: currentPlanTier,
        });
      }

      // ─── UPGRADE/CHANGE FLOW: Update the existing subscription ───
      // Stripe automatically prorates the difference.
      try {
        const updatedSub = await stripe.subscriptions.update(existingSub.id, {
          items: [{
            id: existingSub.items.data[0].id,
            price: priceId,
          }],
          proration_behavior: 'create_prorations',  // prorate the cost
          metadata: { userId, plan },  // Update metadata so webhook fires with correct plan
        });

        console.log(`✓ Subscription updated: ${existingSub.id} → ${plan} (${priceId})`);

        // Return a success URL so frontend redirects appropriately
        return res.status(200).json({
          url: `${req.headers.origin}/?upgrade=success&type=change`,
          subscription_updated: true,
          subscription_id: updatedSub.id,
          new_plan: plan,
        });
      } catch (upgradeErr) {
        console.error('Subscription update failed:', upgradeErr);
        return res.status(500).json({
          error: 'upgrade_failed',
          message: `Could not update subscription: ${upgradeErr.message}. Please try managing your subscription via the billing portal.`,
        });
      }
    }

    // ─── NEW SUBSCRIPTION FLOW: Create a fresh checkout session ───
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
