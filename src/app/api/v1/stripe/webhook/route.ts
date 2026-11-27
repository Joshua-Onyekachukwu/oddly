import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStripe, handleWebhook } from "@/lib/stripe/server";
import type Stripe from "stripe";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

// Use Database generic so Supabase knows all table columns
type SupabaseAdmin = SupabaseClient<Database>;

type SubscriptionStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "trialing"
  | "incomplete";
type SubscriptionTier = "free" | "premium" | "elite";

/**
 * POST /api/v1/stripe/webhook
 *
 * Handles Stripe webhook events for subscription lifecycle.
 * Configure this URL in Stripe Dashboard → Webhooks.
 *
 * Mirrors Stripe state into `subscriptions` and appends every handled
 * event to `subscription_events` (idempotent on stripe_event_id).
 * profiles.subscription_tier / subscription_expires_at remain the
 * denormalized cache the app reads.
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
        await handleCheckoutComplete(supabase, session, event);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(supabase, subscription, event);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(supabase, subscription, event);
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentSucceeded(supabase, invoice, event);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(supabase, invoice, event);
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
 * Get the current_period_start from a subscription as a unix timestamp.
 */
function getPeriodStart(subscription: Stripe.Subscription): number | null {
  const sub = subscription as unknown as { current_period_start?: number; items?: { data?: Array<{ current_period_start?: number }> } };
  if (sub.current_period_start) return sub.current_period_start;
  if (sub.items?.data?.[0]?.current_period_start) return sub.items.data[0].current_period_start!;
  return null;
}

/**
 * Map a Stripe subscription status onto the subscriptions.status enum.
 */
function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "incomplete":
      return "incomplete";
    case "incomplete_expired":
    case "unpaid":
    case "paused":
    case "canceled":
    default:
      return "canceled";
  }
}

/**
 * Resolve the app user for a Stripe subscription: prefer the metadata we
 * set at checkout, fall back to an existing subscriptions row.
 */
async function resolveUserId(
  supabase: SupabaseAdmin,
  subscription: Stripe.Subscription
): Promise<string | null> {
  const metaUserId = subscription.metadata?.supabase_user_id;
  if (metaUserId) return metaUserId;

  const { data } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();

  return data?.user_id ?? null;
}

/**
 * Upsert the subscriptions row for a Stripe subscription.
 * Returns the subscriptions.id (for the event ledger) or null on failure.
 */
async function upsertSubscriptionRow(
  supabase: SupabaseAdmin,
  params: {
    userId: string;
    stripeSubscriptionId: string;
    stripeCustomerId?: string | null;
    tier: SubscriptionTier;
    status: SubscriptionStatus;
    subscription: Stripe.Subscription;
  }
): Promise<string | null> {
  const periodStart = getPeriodStart(params.subscription);
  const periodEnd = getPeriodEnd(params.subscription);

  const { data, error } = await supabase
    .from("subscriptions")
    .upsert(
      {
        user_id: params.userId,
        stripe_customer_id: params.stripeCustomerId ?? null,
        stripe_subscription_id: params.stripeSubscriptionId,
        tier: params.tier,
        status: params.status,
        current_period_start: periodStart
          ? new Date(periodStart * 1000).toISOString()
          : null,
        current_period_end: new Date(periodEnd * 1000).toISOString(),
        cancel_at_period_end: params.subscription.cancel_at_period_end ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" }
    )
    .select("id")
    .single();

  if (error || !data) {
    console.error(
      `Failed to upsert subscription ${params.stripeSubscriptionId}:`,
      error?.message
    );
    return null;
  }

  return data.id;
}

/**
 * Append a Stripe event to the subscription_events ledger.
 * Idempotent: duplicate stripe_event_id (23505) is ignored.
 */
async function recordSubscriptionEvent(
  supabase: SupabaseAdmin,
  subscriptionId: string | null,
  event: Stripe.Event
) {
  if (!subscriptionId) return;

  const { error } = await supabase.from("subscription_events").insert({
    subscription_id: subscriptionId,
    stripe_event_id: event.id,
    type: event.type,
    payload: event.data.object as unknown as Json,
  });

  if (error && error.code !== "23505") {
    console.error(
      `Failed to record subscription event ${event.id}:`,
      error.message
    );
  }
}

/**
 * Checkout completed — activate the subscription
 */
async function handleCheckoutComplete(
  supabase: SupabaseAdmin,
  session: Stripe.Checkout.Session,
  event: Stripe.Event
) {
  const userId = session.metadata?.supabase_user_id;
  if (!userId) {
    console.error("No supabase_user_id in checkout session metadata");
    return;
  }

  if (session.subscription) {
    const stripeClient = getStripe();
    const subscription = await stripeClient.subscriptions.retrieve(
      session.subscription as string
    );

    const priceId = subscription.items.data[0]?.price.id || "";
    const tier = getTierFromPrice(priceId);

    // Mirror into subscriptions + ledger regardless of price mapping
    const subscriptionRowId = await upsertSubscriptionRow(supabase, {
      userId,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: (session.customer as string) ?? subscription.customer as string,
      tier: tier ?? "free",
      status: mapStripeStatus(subscription.status),
      subscription,
    });
    await recordSubscriptionEvent(supabase, subscriptionRowId, event);

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
 * Subscription created/updated — sync tier, expiry and subscriptions row
 */
async function handleSubscriptionUpdated(
  supabase: SupabaseAdmin,
  subscription: Stripe.Subscription,
  event: Stripe.Event
) {
  const userId = await resolveUserId(supabase, subscription);
  if (!userId) return;

  const priceId = subscription.items.data[0]?.price.id || "";
  const tier = getTierFromPrice(priceId);
  const status = subscription.status;

  let effectiveTier: "free" | "premium" | "elite" = "free";
  if (tier && status === "active") {
    effectiveTier = tier;
  }

  const expiresAt = new Date(getPeriodEnd(subscription) * 1000).toISOString();

  const subscriptionRowId = await upsertSubscriptionRow(supabase, {
    userId,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: subscription.customer as string,
    tier: tier ?? effectiveTier,
    status: mapStripeStatus(status),
    subscription,
  });
  await recordSubscriptionEvent(supabase, subscriptionRowId, event);

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
 * Subscription deleted — mark canceled in ledger, downgrade profile to free
 */
async function handleSubscriptionDeleted(
  supabase: SupabaseAdmin,
  subscription: Stripe.Subscription,
  event: Stripe.Event
) {
  const userId = await resolveUserId(supabase, subscription);
  if (!userId) return;

  const priceId = subscription.items.data[0]?.price.id || "";
  const tier = getTierFromPrice(priceId);

  const subscriptionRowId = await upsertSubscriptionRow(supabase, {
    userId,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: subscription.customer as string,
    tier: tier ?? "free",
    status: "canceled",
    subscription,
  });
  await recordSubscriptionEvent(supabase, subscriptionRowId, event);

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
  invoice: Stripe.Invoice,
  event: Stripe.Event
) {
  // Invoice may or may not have subscription depending on API version
  const invoiceObj = invoice as unknown as { subscription?: string | { id: string } | null };
  const subscriptionId = typeof invoiceObj.subscription === "string"
    ? invoiceObj.subscription
    : invoiceObj.subscription?.id;
  if (!subscriptionId) return;

  const stripeClient = getStripe();
  const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);
  const userId = await resolveUserId(supabase, subscription);
  if (!userId) return;

  const priceId = subscription.items.data[0]?.price.id || "";
  const tier = getTierFromPrice(priceId);
  const expiresAt = new Date(getPeriodEnd(subscription) * 1000).toISOString();

  const subscriptionRowId = await upsertSubscriptionRow(supabase, {
    userId,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: subscription.customer as string,
    tier: tier ?? "free",
    status: mapStripeStatus(subscription.status),
    subscription,
  });
  await recordSubscriptionEvent(supabase, subscriptionRowId, event);

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
 * Payment failed — mark past_due, notify user
 */
async function handlePaymentFailed(
  supabase: SupabaseAdmin,
  invoice: Stripe.Invoice,
  event: Stripe.Event
) {
  const invoiceObj = invoice as unknown as { subscription?: string | { id: string } | null };
  const subscriptionId = typeof invoiceObj.subscription === "string"
    ? invoiceObj.subscription
    : invoiceObj.subscription?.id;
  if (!subscriptionId) return;

  const stripeClient2 = getStripe();
  const subscription = await stripeClient2.subscriptions.retrieve(subscriptionId);
  const userId = await resolveUserId(supabase, subscription);
  if (!userId) return;

  const priceId = subscription.items.data[0]?.price.id || "";
  const tier = getTierFromPrice(priceId);

  const subscriptionRowId = await upsertSubscriptionRow(supabase, {
    userId,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: subscription.customer as string,
    tier: tier ?? "free",
    status: "past_due",
    subscription,
  });
  await recordSubscriptionEvent(supabase, subscriptionRowId, event);

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
