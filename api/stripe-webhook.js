// ============================================================
//  PetForm Pro — Stripe Webhook
//  Deploy to Vercel as: /api/stripe-webhook
// ============================================================
//
//  This webhook listens for subscription events from Stripe and
//  updates the user's plan in Supabase accordingly.
//
//  Events handled:
//  - checkout.session.completed     → user just paid → upgrade to pro
//  - customer.subscription.updated  → subscription renewed/changed
//  - customer.subscription.deleted  → subscription cancelled → downgrade
//  - invoice.payment_failed         → payment failed → downgrade after grace
//
//  Setup:
//  1. Deploy this file to Vercel (it'll be at /api/stripe-webhook)
//  2. In Stripe Dashboard → Developers → Webhooks → "Add endpoint"
//  3. URL: https://yourdomain.com/api/stripe-webhook
//  4. Events to send: select all four events listed above
//  5. Copy the "Signing secret" (whsec_...) and set as STRIPE_WEBHOOK_SECRET in Vercel
//  6. Set SUPABASE_SERVICE_KEY in Vercel (from Supabase Settings → API → service_role key)
//     ⚠️ NEVER expose service_role key in browser code — it bypasses RLS
// ============================================================

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service role key — required to bypass RLS
);

// Vercel — disable body parsing so we can verify webhook signature
export const config = {
  api: { bodyParser: false },
};

// Helper to read raw body
async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId || session.subscription_data?.metadata?.userId;
        const planMeta = session.metadata?.plan || session.subscription_data?.metadata?.plan || 'monthly';
        // Map checkout plan name to actual plan tier
        let planTier = 'pro';
        if (planMeta === 'proplus' || planMeta === 'yearly_proplus') planTier = 'proplus';
        else if (planMeta === 'business') planTier = 'business';
        if (userId) {
          await supabase
            .from('profiles')
            .update({
              plan: planTier,
              stripe_customer_id: session.customer,
              stripe_subscription_id: session.subscription,
              upgraded_at: new Date().toISOString(),
            })
            .eq('id', userId);
          console.log(`✓ Upgraded user ${userId} to ${planTier}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        const isActive = sub.status === 'active' || sub.status === 'trialing';
        if (userId) {
          await supabase
            .from('profiles')
            .update({
              plan: isActive ? 'pro' : 'free',
              stripe_subscription_status: sub.status,
            })
            .eq('id', userId);
          console.log(`✓ Updated user ${userId} subscription status: ${sub.status}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata?.userId;
        if (userId) {
          await supabase
            .from('profiles')
            .update({
              plan: 'free',
              stripe_subscription_status: 'cancelled',
              cancelled_at: new Date().toISOString(),
            })
            .eq('id', userId);
          console.log(`✓ Cancelled subscription for user ${userId}`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        // Find user by customer ID
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();
        if (profile) {
          await supabase
            .from('profiles')
            .update({ stripe_subscription_status: 'past_due' })
            .eq('id', profile.id);
          // Optionally: send email reminding them to update payment
          console.log(`⚠ Payment failed for user ${profile.id}`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    return res.status(500).json({ error: error.message });
  }
}
