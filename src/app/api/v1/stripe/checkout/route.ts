import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createCheckoutSession } from "@/lib/stripe/server";
import { getPriceId, STRIPE_PLANS, type PlanTier } from "@/lib/stripe/config";

/**
 * POST /api/v1/stripe/checkout
 *
 * Creates a Stripe Checkout Session for subscription upgrade.
 *
 * Body: { tier: "premium" | "elite" }
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate
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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { tier } = body as { tier: PlanTier };

    if (!tier || !STRIPE_PLANS[tier]) {
      return NextResponse.json({ error: "Invalid plan tier" }, { status: 400 });
    }

    // Check if already on this tier or higher
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("id", user.id)
      .single();

    if (profile?.subscription_tier === tier) {
      return NextResponse.json({ error: "Already on this plan" }, { status: 400 });
    }

    if (
      (profile?.subscription_tier === "elite") ||
      (profile?.subscription_tier === "premium" && tier === "premium")
    ) {
      return NextResponse.json({ error: "Cannot downgrade" }, { status: 400 });
    }

    const priceId = getPriceId(tier);
    const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const session = await createCheckoutSession({
      userId: user.id,
      email: user.email || "",
      name: user.user_metadata?.display_name,
      priceId,
      successUrl: `${origin}/settings?upgraded=${tier}`,
      cancelUrl: `${origin}/pricing`,
    });

    return NextResponse.json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("POST /api/v1/stripe/checkout error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
