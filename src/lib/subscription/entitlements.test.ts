import {
  ENTITLEMENTS_ENFORCED,
  PLAN_FEATURES,
  SubscriptionTier,
  featureGateResponse,
  hasFeature,
  normalizeTier,
  tierAtLeast,
} from "./entitlements";

// ─── normalizeTier ─────────────────────────────────────────────────────

describe("normalizeTier", () => {
  test("passes through valid tiers", () => {
    expect(normalizeTier("free")).toBe("free");
    expect(normalizeTier("premium")).toBe("premium");
    expect(normalizeTier("elite")).toBe("elite");
  });

  test("null / undefined / unknown values fall back to free", () => {
    expect(normalizeTier(null)).toBe("free");
    expect(normalizeTier(undefined)).toBe("free");
    expect(normalizeTier("")).toBe("free");
    expect(normalizeTier("gold")).toBe("free");
    expect(normalizeTier("admin")).toBe("free");
  });

  test("is case-insensitive — stray casing still resolves correctly", () => {
    expect(normalizeTier("Premium")).toBe("premium");
    expect(normalizeTier("ELITE")).toBe("elite");
  });
});

// ─── tierAtLeast ───────────────────────────────────────────────────────

describe("tierAtLeast", () => {
  test("rank ordering: free < premium < elite", () => {
    expect(tierAtLeast("elite", "premium")).toBe(true);
    expect(tierAtLeast("elite", "free")).toBe(true);
    expect(tierAtLeast("premium", "free")).toBe(true);
    expect(tierAtLeast("premium", "elite")).toBe(false);
    expect(tierAtLeast("free", "premium")).toBe(false);
    expect(tierAtLeast("free", "elite")).toBe(false);
  });

  test("a tier always satisfies itself", () => {
    const tiers: SubscriptionTier[] = ["free", "premium", "elite"];
    for (const t of tiers) {
      expect(tierAtLeast(t, t)).toBe(true);
    }
  });
});

// ─── hasFeature / enforcement flag ────────────────────────────────────

describe("hasFeature (ENTITLEMENTS_ENFORCED = false)", () => {
  test("flag is currently disabled — every feature open to every tier", () => {
    expect(ENTITLEMENTS_ENFORCED).toBe(false);
    const tiers = ["free", "premium", "elite", null, undefined, "garbage"];
    const features = [
      "predictions.basic",
      "accumulator",
      "ai.chat",
      "rollover",
      "api.access",
      "support.priority",
    ] as const;
    for (const tier of tiers) {
      for (const feature of features) {
        expect(hasFeature(tier, feature)).toBe(true);
      }
    }
  });

  test("featureGateResponse always allows while enforcement is off", () => {
    for (const tier of ["free", null, "elite"]) {
      const res = featureGateResponse(tier, "rollover");
      expect(res).toEqual({ allowed: true });
    }
  });

  // NOTE: the gated path (402 upgrade_required) is unreachable while
  // ENTITLEMENTS_ENFORCED === false because hasFeature short-circuits.
  // When the flag flips, the intended contract is:
  //   free  + rollover/api.access/ai.chat/support.priority → 402
  //   premium + rollover/api.access/ai.chat/support.priority → 402
  //   elite  + everything → allowed
  // These assertions encode FEATURE_MIN_TIER indirectly via PLAN_FEATURES
  // below so a future flip has a spec to check against.
});

// ─── PLAN_FEATURES consistency ─────────────────────────────────────────

describe("PLAN_FEATURES", () => {
  test("tier lists are nested: free ⊆ premium ⊆ elite", () => {
    const free = new Set(PLAN_FEATURES.free);
    const premium = new Set(PLAN_FEATURES.premium);
    const elite = new Set(PLAN_FEATURES.elite);

    for (const f of free) expect(premium.has(f)).toBe(true);
    for (const f of premium) expect(elite.has(f)).toBe(true);
  });

  test("premium adds paid features over free", () => {
    const free = new Set(PLAN_FEATURES.free);
    const added = PLAN_FEATURES.premium.filter((f) => !free.has(f));
    expect(added).toEqual(
      expect.arrayContaining(["accumulator", "analytics.advanced", "value_bets", "betting_agent"])
    );
    // premium must NOT claim elite-only features
    expect(PLAN_FEATURES.premium).not.toContain("ai.chat");
    expect(PLAN_FEATURES.premium).not.toContain("rollover");
    expect(PLAN_FEATURES.premium).not.toContain("api.access");
  });

  test("elite is a superset including elite-only features", () => {
    for (const f of ["ai.chat", "rollover", "api.access", "support.priority"] as const) {
      expect(PLAN_FEATURES.elite).toContain(f);
      expect(PLAN_FEATURES.premium).not.toContain(f);
      expect(PLAN_FEATURES.free).not.toContain(f);
    }
  });

  test("every tier includes the free baseline", () => {
    for (const t of ["free", "premium", "elite"] as const) {
      expect(PLAN_FEATURES[t]).toEqual(
        expect.arrayContaining(["predictions.basic", "analytics.basic", "notifications.basic"])
      );
    }
  });
});
