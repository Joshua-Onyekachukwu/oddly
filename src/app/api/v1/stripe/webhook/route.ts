import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { stripe, handleWebhook } from "@/lib/stripe/server";
import type Stripe from "stripe";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

// Use Database generic so Supabase knows all table columns
type SupabaseAdmin = SupabaseClient<Database>;

/**
 * POST /api/v1/stripe/webhook
 *
 * Handles Stripe webhook events for subscription lifecycle.
 * Configure this URL in Stripe Dashboard → Webhooks.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = await handleWebhook(body, signature);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutComplete(supabase, session);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(supabase, subscription);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(supabase, subscription);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentSucceeded(supabase, invoice);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(supabase, invoice);
        break;
      }

      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}

/**
 * Determine plan tier from a Stripe price ID
 */
function getTierFromPrice(priceId: string): "premium" | "elite" | null {
  if (priceId === process.env.STRIPE_PREMIUM_PRICE_ID) return "premium";
  if (priceId === process.env.STRIPE_ELITE_PRICE_ID) return "elite";
  return null;
}

/**
 * Get the current_period_end from a subscription as a unix timestamp.
 * Handles both Stripe API versions where this may be a property or nested.
 */
function getPeriodEnd(subscription: Stripe.Subscription): number {
  // In newer Stripe types, current_period_end is on the subscription directly
  const sub = subscription as unknown as { current_period_end?: number; items?: { data?: Array<{ current_period_end?: number }> } };
  if (sub.current_period_end) return sub.current_period_end;
  if (sub.items?.data?.[0]?.current_period_end) return sub.items.data[0].current_period_end!;
  return Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // fallback: 30 days
}

/**
 * Checkout completed — activate the subscription
 */
async function handleCheckoutComplete(
  supabase: SupabaseAdmin,
  session: Stripe.Checkout.Session
) {
  const userId = session.metadata?.supabase_user_id;
  if (!userId) {
    console.error("No supabase_user_id in checkout session metadata");
    return;
  }

  if (session.subscription) {
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription as string
    );

    const priceId = subscription.items.data[0]?.price.id || "";
    const tier = getTierFromPrice(priceId);

    if (tier) {
      const expiresAt = new Date(getPeriodEnd(subscription) * 1000).toISOString();

      await supabase
        .from("profiles")
        .update({
          subscription_tier: tier,
          subscription_expires_at: expiresAt,
          stripe_customer_id: session.customer as string,
        })
        .eq("id", userId);

      await supabase.from("admin_activity_log").insert({
        action: "subscription_activated",
        target_type: "user",
        target_id: userId,
        details: JSON.stringify({
          tier,
          stripe_subscription_id: subscription.id,
          price_id: priceId,
        }),
      });

      await supabase.from("notifications").insert({
        user_id: userId,
        type: "announcement",
        title: `${tier === "elite" ? "Elite" : "Premium"} Activated! 🎉`,
        body: `Welcome to ODDLY ${tier === "elite" ? "Elite" : "Premium"}. You now have access to all ${tier} features.`,
        data: JSON.stringify({ tier }),
      });

      console.log(`Subscription activated for user ${userId}: ${tier}`);
    }
  }
}

/**
 * Subscription updated — sync tier and expiry
 */
async function handleSubscriptionUpdated(
  supabase: SupabaseAdmin,
  subscription: Stripe.Subscription
) {
  const userId = subscription.metadata?.supabase_user_id;
  if (!userId) return;

  const priceId = subscription.items.data[0]?.price.id || "";
  const tier = getTierFromPrice(priceId);
  const status = subscription.status;

  let effectiveTier: "free" | "premium" | "elite" = "free";
  if (tier && status === "active") {
    effectiveTier = tier;
  }

  const expiresAt = new Date(getPeriodEnd(subscription) * 1000).toISOString();

  await supabase
    .from("profiles")
    .update({
      subscription_tier: effectiveTier,
      subscription_expires_at: effectiveTier === "free" ? null : expiresAt,
    })
    .eq("id", userId);

  console.log(`Subscription updated for user ${userId}: ${effectiveTier} (${status})`);
}

/**
 * Subscription deleted — downgrade to free
 */
async function handleSubscriptionDeleted(
  supabase: SupabaseAdmin,
  subscription: Stripe.Subscription
) {
  const userId = subscription.metadata?.supabase_user_id;
  if (!userId) return;

  await supabase
    .from("profiles")
    .update({
      subscription_tier: "free",
      subscription_expires_at: null,
    })
    .eq("id", userId);

  await supabase.from("notifications").insert({
    user_id: userId,
    type: "announcement",
    title: "Subscription Ended",
    body: "Your subscription has ended. You've been moved to the Free plan. Upgrade anytime to regain access to premium features.",
    data: JSON.stringify({ tier: "free" }),
  });

  console.log(`Subscription deleted for user ${userId} — downgraded to free`);
}

/**
 * Payment succeeded — extend expiry
 */
async function handlePaymentSucceeded(
  supabase: SupabaseAdmin,
  invoice: Stripe.Invoice
) {
  // Invoice may or may not have subscription depending on API version
  const invoiceObj = invoice as unknown as { subscription?: string | { id: string } | null };
  const subscriptionId = typeof invoiceObj.subscription === "string"
    ? invoiceObj.subscription
    : invoiceObj.subscription?.id;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = subscription.metadata?.supabase_user_id;
  if (!userId) return;

  const priceId = subscription.items.data[0]?.price.id || "";
  const tier = getTierFromPrice(priceId);
  const expiresAt = new Date(getPeriodEnd(subscription) * 1000).toISOString();

  if (tier) {
    await supabase
      .from("profiles")
      .update({
        subscription_tier: tier,
        subscription_expires_at: expiresAt,
      })
      .eq("id", userId);

    console.log(`Payment succeeded for user ${userId} — ${tier} extended to ${expiresAt}`);
  }
}

/**
 * Payment failed — notify user
 */
async function handlePaymentFailed(
  supabase: SupabaseAdmin,
  invoice: Stripe.Invoice
) {
  const invoiceObj = invoice as unknown as { subscription?: string | { id: string } | null };
  const subscriptionId = typeof invoiceObj.subscription === "string"
    ? invoiceObj.subscription
    : invoiceObj.subscription?.id;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = subscription.metadata?.supabase_user_id;
  if (!userId) return;

  await supabase.from("notifications").insert({
    user_id: userId,
    type: "model_alert",
    title: "Payment Failed ⚠️",
    body: "Your latest payment failed. Please update your payment method to keep your subscription active.",
    data: JSON.stringify({
      invoice_id: invoice.id,
      amount: invoice.amount_due,
    }),
  });

  console.log(`Payment failed for user ${userId} — invoice ${invoice.id}`);
}
