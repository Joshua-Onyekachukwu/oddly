import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * POST /api/v1/stripe/checkout
 *
 * Creates a Stripe Checkout Session for subscription.
 * Returns 503 if Stripe is not configured (paused feature).
 */
export async function POST(request: NextRequest) {
  // Check if Stripe is configured
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      {
        error: "Stripe is not configured yet",
        message: "Payment system is paused. Contact support for access.",
      },
      { status: 503 }
    );
  }

  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { priceId, tier } = body;

    if (!tier) {
      return NextResponse.json(
        { error: "Missing tier" },
        { status: 400 }
      );
    }

    // Normalize + validate the requested tier via entitlements
    const { normalizeTier } = await import("@/lib/subscription/entitlements");
    const { STRIPE_PLANS } = await import("@/lib/stripe/config");
    const normalizedTier = normalizeTier(tier);

    if (normalizedTier === "free") {
      return NextResponse.json(
        { error: "Invalid tier", message: "Tier must be 'premium' or 'elite'" },
        { status: 400 }
      );
    }

    // Fail gracefully when the plan's Stripe price ID isn't configured
    const expectedPriceId = STRIPE_PLANS[normalizedTier].priceId;
    if (!expectedPriceId) {
      return NextResponse.json(
        {
          error: "Plan not configured",
          message: `Stripe price ID for the ${normalizedTier} plan is not set.`,
        },
        { status: 503 }
      );
    }

    // Only allow checkout against the configured price for the tier.
    // priceId is optional — the server always uses the configured price;
    // a client-supplied priceId is accepted only as a consistency check.
    if (priceId && priceId !== expectedPriceId) {
      return NextResponse.json(
        { error: "Price does not match tier" },
        { status: 400 }
      );
    }

    // Block duplicate subscriptions: plan changes go through the Stripe
    // billing portal (POST /api/v1/stripe/portal), not a second checkout.
    const { data: existingSub } = await supabase
      .from("subscriptions")
      .select("tier, status")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing", "past_due"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingSub) {
      return NextResponse.json(
        {
          error: "already_subscribed",
          message:
            "You already have an active subscription. Use the billing portal to change plans.",
          tier: existingSub.tier,
          status: existingSub.status,
        },
        { status: 409 }
      );
    }

    // Lazy import so build doesn't fail without Stripe
    const stripe = await import("@/lib/stripe/server");
    const result = await stripe.createCheckoutSession({
      userId: user.id,
      email: user.email || "",
      priceId: expectedPriceId,
      tier: normalizedTier,
      successUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings?upgraded=${normalizedTier}`,
      cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/pricing`,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create checkout session" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, url: result.url });
  } catch (error) {
    console.error("POST /api/v1/stripe/checkout error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
