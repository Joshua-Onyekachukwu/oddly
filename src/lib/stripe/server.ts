/**
 * Stripe Server Module
 *
 * This module is lazy-loaded so the build doesn't fail without Stripe keys.
 * When Stripe is activated, import from this file.
 */

import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

/**
 * Get or create Stripe instance.
 */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  if (!stripeInstance) {
    stripeInstance = new Stripe(key, {
      apiVersion: "2024-12-18.acacia" as any,
    });
  }

  return stripeInstance;
}

/**
 * Create a Stripe Checkout Session for subscription.
 */
export async function createCheckoutSession(params: {
  userId: string;
  email: string;
  priceId: string;
  tier: "premium" | "elite";
  successUrl: string;
  cancelUrl: string;
}): Promise<{ sessionId: string; url: string } | null> {
  try {
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      customer_email: params.email,
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
        tier: params.tier,
      },
    });

    return { sessionId: session.id, url: session.url! };
  } catch (error) {
    console.warn("Stripe checkout not available:", error);
    return null;
  }
}

/**
 * Create a Stripe Customer Portal session.
 */
export async function createPortalSession(
  customerId: string,
  returnUrl: string
): Promise<{ url: string }> {
  const stripe = getStripe();

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return { url: session.url };
}

/**
 * Handle Stripe Webhook event — verifies signature and returns event.
 */
export async function handleWebhook(
  body: string | Buffer,
  signature: string
): Promise<Stripe.Event> {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }

  return stripe.webhooks.constructEvent(body, signature, webhookSecret);
}

/**
 * Check if Stripe is configured.
 */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}
