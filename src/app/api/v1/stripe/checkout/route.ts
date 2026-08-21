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

    if (!priceId || !tier) {
      return NextResponse.json(
        { error: "Missing priceId or tier" },
        { status: 400 }
      );
    }

    // Lazy import so build doesn't fail without Stripe
    const stripe = await import("@/lib/stripe/server");
    const result = await stripe.createCheckoutSession({
      userId: user.id,
      email: user.email || "",
      priceId,
      tier,
      successUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings?upgraded=true`,
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
