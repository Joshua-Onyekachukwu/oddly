import Stripe from "stripe";

let _stripe: Stripe | null = null;

/**
 * Server-side Stripe client (lazy-loaded)
 * Only throws when actually called, not at import time.
 */
export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set in environment variables. Stripe is not configured.");
  }
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      typescript: true,
    });
  }
  return _stripe;
}

/**
 * Get or create a Stripe customer for a Supabase user
 */
export async function getOrCreateCustomer(
  userId: string,
  email: string,
  name?: string
): Promise<string> {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check if customer already exists in profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .single();

  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id;
  }

  // Create new Stripe customer
  const customer = await getStripe().customers.create({
    email,
    name: name || email,
    metadata: {
      supabase_user_id: userId,
    },
  });

  // Save to profile
  await supabase
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", userId);

  return customer.id;
}

/**
 * Create a Stripe Checkout Session for a subscription
 */
export async function createCheckoutSession(params: {
  userId: string;
  email: string;
  name?: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<Stripe.Checkout.Session> {
  const customerId = await getOrCreateCustomer(
    params.userId,
    params.email,
    params.name
  );

  const session = await getStripe().checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: params.priceId,
        quantity: 1,
      },
    ],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      supabase_user_id: params.userId,
    },
    subscription_data: {
      metadata: {
        supabase_user_id: params.userId,
      },
    },
  });

  return session;
}

/**
 * Create a Stripe Billing Portal session for managing subscription
 */
export async function createPortalSession(
  customerId: string,
  returnUrl: string
): Promise<Stripe.BillingPortal.Session> {
  return getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

/**
 * Handle Stripe webhook event
 */
export async function handleWebhook(
  body: string | Buffer,
  signature: string
): Promise<Stripe.Event> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  }

  return getStripe().webhooks.constructEvent(body, signature, webhookSecret);
}
