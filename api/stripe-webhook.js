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
    // Helper: map plan metadata to actual plan tier
    const mapPlanToTier = (planMeta) => {
      if (planMeta === 'proplus' || planMeta === 'yearly_proplus') return 'proplus';
      if (planMeta === 'business' || planMeta === 'yearly_business') return 'business';
      // 'monthly', 'yearly', or anything else → pro
      return 'pro';
    };

    // Helper: find user by stripe_customer_id (fallback when metadata.userId missing)
    const findUserByCustomer = async (customerId) => {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .single();
      return data?.id;
    };

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId || session.subscription_data?.metadata?.userId;
        const planMeta = session.metadata?.plan || session.subscription_data?.metadata?.plan || 'monthly';
        const planTier = mapPlanToTier(planMeta);
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
          console.log(`✓ checkout.session.completed: Upgraded user ${userId} to ${planTier} (planMeta="${planMeta}")`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        let userId = sub.metadata?.userId;
        // Fallback: find user by customer ID if metadata is missing
        if (!userId) userId = await findUserByCustomer(sub.customer);

        const isActive = sub.status === 'active' || sub.status === 'trialing';

        if (userId) {
          // Determine plan tier from PRICE ID first (authoritative — never stale)
          // Only fall back to metadata if we can't match the price ID
          let planValue;
          if (!isActive) {
            planValue = 'free';
          } else {
            // PRIMARY: Match against current price IDs (authoritative source of truth)
            const priceId = sub.items?.data?.[0]?.price?.id;
            if (priceId === process.env.STRIPE_PRICE_PROPLUS_MONTHLY ||
                priceId === process.env.STRIPE_PRICE_PROPLUS_YEARLY) {
              planValue = 'proplus';
            } else if (priceId === process.env.STRIPE_PRICE_BUSINESS_MONTHLY ||
                       priceId === process.env.STRIPE_PRICE_BUSINESS_YEARLY) {
              planValue = 'business';
            } else if (priceId === process.env.STRIPE_PRICE_MONTHLY ||
                       priceId === process.env.STRIPE_PRICE_YEARLY) {
              planValue = 'pro';
            } else {
              // FALLBACK: price ID didn't match any known env var
              // Try metadata as last resort
              const planMeta = sub.metadata?.plan;
              if (planMeta) {
                planValue = mapPlanToTier(planMeta);
                console.warn(`⚠ Unknown price ID ${priceId}, falling back to metadata plan="${planMeta}" → ${planValue}`);
              } else {
                planValue = 'pro';
                console.warn(`⚠ Unknown price ID ${priceId} AND no metadata. Defaulting to 'pro'.`);
              }
            }
          }

          await supabase
            .from('profiles')
            .update({
              plan: planValue,
              stripe_subscription_status: sub.status,
            })
            .eq('id', userId);
          console.log(`✓ customer.subscription.updated: User ${userId} → plan=${planValue}, status=${sub.status}, priceId=${sub.items?.data?.[0]?.price?.id}`);
        } else {
          console.warn(`⚠ customer.subscription.updated: No user found for customer ${sub.customer}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        let userId = sub.metadata?.userId;
        if (!userId) userId = await findUserByCustomer(sub.customer);
        if (userId) {
          await supabase
            .from('profiles')
            .update({
              plan: 'free',
              stripe_subscription_status: 'cancelled',
              cancelled_at: new Date().toISOString(),
            })
            .eq('id', userId);
          console.log(`✓ customer.subscription.deleted: Cancelled subscription for user ${userId}`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const userId = await findUserByCustomer(customerId);
        if (userId) {
          await supabase
            .from('profiles')
            .update({ stripe_subscription_status: 'past_due' })
            .eq('id', userId);
          console.log(`⚠ invoice.payment_failed: Payment failed for user ${userId}`);
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
