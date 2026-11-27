import { STRIPE_PLANS } from "@/lib/stripe/config";
import {
  FEATURE_LABELS,
  FEATURE_ORDER,
  PLAN_META,
  PLAN_PRICE_NGN,
  featuresForTier,
  getPlans,
  isPaidTier,
  planIncludes,
} from "./plans";
import { PLAN_FEATURES } from "./entitlements";

describe("PLAN_PRICE_NGN", () => {
  test("matches STRIPE_PLANS prices (single source for billing)", () => {
    expect(PLAN_PRICE_NGN.premium).toBe(STRIPE_PLANS.premium.price);
    expect(PLAN_PRICE_NGN.elite).toBe(STRIPE_PLANS.elite.price);
  });
});

describe("PLAN_META", () => {
  test("getPlans returns free → premium → elite", () => {
    expect(getPlans().map((p) => p.tier)).toEqual(["free", "premium", "elite"]);
  });

  test("display prices match the configured NGN amounts", () => {
    expect(PLAN_META.premium.price).toBe("₦7,500");
    expect(PLAN_META.elite.price).toBe("₦20,000");
    expect(PLAN_META.free.price).toBe("₦0");
  });

  test("only paid tiers are flagged paid; premium is popular", () => {
    expect(isPaidTier("free")).toBe(false);
    expect(isPaidTier("premium")).toBe(true);
    expect(isPaidTier("elite")).toBe(true);
    expect(PLAN_META.premium.popular).toBe(true);
  });
});

describe("FEATURE_LABELS", () => {
  test("every feature in PLAN_FEATURES has a non-empty label", () => {
    for (const tier of ["free", "premium", "elite"] as const) {
      for (const key of PLAN_FEATURES[tier]) {
        expect(FEATURE_LABELS[key]).toBeTruthy();
        expect(typeof FEATURE_LABELS[key]).toBe("string");
      }
    }
  });

  test("FEATURE_ORDER covers every feature key exactly once", () => {
    const all = new Set(Object.values(PLAN_FEATURES).flat());
    expect(new Set(FEATURE_ORDER)).toEqual(all);
    expect(FEATURE_ORDER.length).toBe(all.size);
  });
});

describe("featuresForTier / planIncludes", () => {
  test("free gets only the free baseline", () => {
    const keys = featuresForTier("free").map((f) => f.key);
    expect(keys).toEqual(PLAN_FEATURES.free);
    expect(keys).not.toContain("rollover");
    expect(keys).not.toContain("accumulator");
  });

  test("premium includes paid mid-tier features but not elite-only ones", () => {
    expect(planIncludes("premium", "accumulator")).toBe(true);
    expect(planIncludes("premium", "value_bets")).toBe(true);
    expect(planIncludes("premium", "rollover")).toBe(false);
    expect(planIncludes("premium", "ai.chat")).toBe(false);
  });

  test("elite includes everything including rollover + priority", () => {
    for (const f of ["rollover", "api.access", "support.priority", "ai.chat"] as const) {
      expect(planIncludes("elite", f)).toBe(true);
    }
  });

  test("unknown/null tiers normalize to free", () => {
    expect(featuresForTier(null).map((f) => f.key)).toEqual(PLAN_FEATURES.free);
    expect(featuresForTier("garbage").map((f) => f.key)).toEqual(PLAN_FEATURES.free);
  });

  test("labels are attached to every returned feature", () => {
    for (const tier of ["free", "premium", "elite"] as const) {
      for (const f of featuresForTier(tier)) {
        expect(f.label).toBe(FEATURE_LABELS[f.key]);
      }
    }
  });
});
