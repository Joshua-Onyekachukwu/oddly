import {
  normalizeEntityKey,
  buildFavouriteRow,
  FAVOURITE_ENTITY_TYPES,
} from "./favourites";
import {
  favouriteCreateSchema,
  favouriteDeleteSchema,
  favouriteQuerySchema,
} from "@/lib/api/validation";

// ─── normalizeEntityKey ──────────────────────────────────────────────

describe("normalizeEntityKey", () => {
  it("lowercases and trims team/league ids", () => {
    expect(normalizeEntityKey("team", "  3F2504E0-4F89-11D3-9A0C-0305E82C3301  ")).toBe(
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
    );
  });

  it("normalizes player names: lowercase, collapse whitespace, trim", () => {
    expect(normalizeEntityKey("player", "  Mohamed   Salah ")).toBe("mohamed salah");
  });

  it("treats different casings of the same player as identical", () => {
    expect(normalizeEntityKey("player", "Erling Haaland")).toBe(
      normalizeEntityKey("player", "erling  haaland")
    );
  });

  it("does not collapse internal whitespace for team ids", () => {
    // UUIDs never contain spaces; whitespace inside would be preserved for
    // non-player types — but trimming still applies.
    expect(normalizeEntityKey("league", " ABC-123 ")).toBe("abc-123");
  });
});

// ─── buildFavouriteRow ───────────────────────────────────────────────

describe("buildFavouriteRow", () => {
  it("builds a team row keyed by lowercased id", () => {
    const row = buildFavouriteRow({
      entity_type: "team",
      entity_id: "  A1B2C3D4-0000-0000-0000-000000000000 ",
      entity_name: "Arsenal",
    });
    expect(row.entity_id).toBe("A1B2C3D4-0000-0000-0000-000000000000");
    expect(row.entity_key).toBe("a1b2c3d4-0000-0000-0000-000000000000");
    expect(row.entity_name).toBe("Arsenal");
  });

  it("defaults entity_name to null", () => {
    const row = buildFavouriteRow({ entity_type: "league", entity_id: "L1" });
    expect(row.entity_name).toBeNull();
  });

  it("supports player entities", () => {
    const row = buildFavouriteRow({
      entity_type: "player",
      entity_id: "Bukayo Saka",
      entity_name: "Bukayo Saka",
    });
    expect(row.entity_key).toBe("bukayo saka");
  });
});

// ─── FAVOURITE_ENTITY_TYPES ───────────────────────────────────────────

describe("FAVOURITE_ENTITY_TYPES", () => {
  it("contains exactly team, league, player", () => {
    expect([...FAVOURITE_ENTITY_TYPES].sort()).toEqual(["league", "player", "team"]);
  });
});

// ─── API validation schemas ───────────────────────────────────────────

describe("favouriteCreateSchema", () => {
  it("accepts a valid team favourite", () => {
    const res = favouriteCreateSchema.safeParse({
      entity_type: "team",
      entity_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      entity_name: "Arsenal",
    });
    expect(res.success).toBe(true);
  });

  it("accepts a player favourite (name as entity_id)", () => {
    const res = favouriteCreateSchema.safeParse({
      entity_type: "player",
      entity_id: "Bukayo Saka",
    });
    expect(res.success).toBe(true);
  });

  it("rejects an invalid entity_type", () => {
    const res = favouriteCreateSchema.safeParse({
      entity_type: "match",
      entity_id: "abc",
    });
    expect(res.success).toBe(false);
  });

  it("rejects empty entity_id", () => {
    const res = favouriteCreateSchema.safeParse({
      entity_type: "team",
      entity_id: "   ",
    });
    expect(res.success).toBe(false);
  });

  it("rejects missing entity_type", () => {
    const res = favouriteCreateSchema.safeParse({ entity_id: "abc" });
    expect(res.success).toBe(false);
  });

  it("rejects oversized entity_id", () => {
    const res = favouriteCreateSchema.safeParse({
      entity_type: "team",
      entity_id: "x".repeat(201),
    });
    expect(res.success).toBe(false);
  });
});

describe("favouriteQuerySchema / favouriteDeleteSchema", () => {
  it("query schema allows empty params (list all)", () => {
    const res = favouriteQuerySchema.safeParse({});
    expect(res.success).toBe(true);
  });

  it("query schema allows entity_type filter", () => {
    const res = favouriteQuerySchema.safeParse({ entity_type: "league" });
    expect(res.success).toBe(true);
  });

  it("delete schema requires both entity_type and entity_id", () => {
    expect(favouriteDeleteSchema.safeParse({ entity_type: "team" }).success).toBe(false);
    expect(favouriteDeleteSchema.safeParse({ entity_id: "abc" }).success).toBe(false);
    expect(
      favouriteDeleteSchema.safeParse({ entity_type: "team", entity_id: "abc" }).success
    ).toBe(true);
  });
});
