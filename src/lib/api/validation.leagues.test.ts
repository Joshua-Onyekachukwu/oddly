/**
 * Unit tests for the admin league update schemas added for the
 * /admin/leagues management surface (leagueAdminUpdateSchema +
 * leagueModelParamsSchema).
 */

import {
  leagueAdminUpdateSchema,
  leagueModelParamsSchema,
  validateBody,
} from "./validation";

describe("leagueModelParamsSchema", () => {
  it("accepts a single tunable param", () => {
    const res = validateBody(leagueModelParamsSchema, { home_advantage: 65 });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.home_advantage).toBe(65);
  });

  it("accepts multiple params within bounds", () => {
    const res = validateBody(leagueModelParamsSchema, {
      home_advantage: 70,
      goal_expectancy: 2.6,
      poisson_weight: 0.4,
      elo_weight: 0.3,
      regression_weight: 0.3,
    });
    expect(res.success).toBe(true);
  });

  it("rejects an empty object", () => {
    const res = validateBody(leagueModelParamsSchema, {});
    expect(res.success).toBe(false);
  });

  it("rejects out-of-range values", () => {
    expect(validateBody(leagueModelParamsSchema, { home_advantage: 9999 }).success).toBe(false);
    expect(validateBody(leagueModelParamsSchema, { goal_expectancy: -1 }).success).toBe(false);
    expect(validateBody(leagueModelParamsSchema, { poisson_weight: 11 }).success).toBe(false);
  });

  it("rejects non-numeric values", () => {
    expect(validateBody(leagueModelParamsSchema, { home_advantage: "high" }).success).toBe(false);
  });

  it("strips unknown keys via zod default behavior is NOT applied — unknown keys are stripped", () => {
    const res = validateBody(leagueModelParamsSchema, {
      home_advantage: 65,
      overall_accuracy: 99, // derived field — should be stripped, not stored
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).not.toHaveProperty("overall_accuracy");
    }
  });
});

describe("leagueAdminUpdateSchema", () => {
  it("accepts league field updates", () => {
    const res = validateBody(leagueAdminUpdateSchema, {
      is_active: false,
      priority: 3,
      country: "England",
    });
    expect(res.success).toBe(true);
  });

  it("accepts model_params nested update", () => {
    const res = validateBody(leagueAdminUpdateSchema, {
      model_params: { goal_expectancy: 2.8, draw_pct: 25 },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.model_params?.goal_expectancy).toBe(2.8);
    }
  });

  it("rejects an empty body", () => {
    expect(validateBody(leagueAdminUpdateSchema, {}).success).toBe(false);
  });

  it("rejects empty model_params", () => {
    const res = validateBody(leagueAdminUpdateSchema, { model_params: {} });
    expect(res.success).toBe(false);
  });

  it("rejects invalid priority", () => {
    expect(validateBody(leagueAdminUpdateSchema, { priority: -5 }).success).toBe(false);
    expect(validateBody(leagueAdminUpdateSchema, { priority: 1.5 }).success).toBe(false);
  });

  it("allows clearing country with null", () => {
    const res = validateBody(leagueAdminUpdateSchema, { country: null });
    expect(res.success).toBe(true);
  });
});

describe("leagueAdminUpdateSchema type export", () => {
  it("schema is a zod object usable with validateBody", () => {
    expect(leagueAdminUpdateSchema).toBeDefined();
  });
});
