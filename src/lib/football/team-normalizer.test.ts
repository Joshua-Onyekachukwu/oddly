import { normalizeTeamName, buildNormalizedMap } from "@/lib/football/team-normalizer";

describe("normalizeTeamName", () => {
  it("normalizes common club name variants", () => {
    expect(normalizeTeamName("FC Barcelona")).toBe("barcelona");
    expect(normalizeTeamName("Real Madrid CF")).toBe("real madrid");
    expect(normalizeTeamName("Manchester United")).toBe("manchester united");
  });

  it("handles case and whitespace", () => {
    expect(normalizeTeamName("  ARSENAL  ")).toBe("arsenal");
    expect(normalizeTeamName("Bayern Munich")).toBe("bayern munich");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeTeamName("")).toBe("");
  });
});

describe("buildNormalizedMap", () => {
  it("maps normalized keys to original entries", () => {
    const raw = { "FC Barcelona": { id: 1 }, "Real Madrid CF": { id: 2 } };
    const map = buildNormalizedMap(raw);
    expect(map["barcelona"]).toEqual({ id: 1 });
    expect(map["real madrid"]).toEqual({ id: 2 });
    // Original keys remain accessible
    expect(map["FC Barcelona"]).toEqual({ id: 1 });
  });
});

// ─── Edge cases: provider variants, accents, collisions ────────────────

describe("normalizeTeamName — accents & diacritics", () => {
  it("strips accents from input before lookup", () => {
    // These aliases exist in UNACCENTED form, so accent-stripped input hits.
    expect(normalizeTeamName("Grêmio")).toBe("gremio");
    expect(normalizeTeamName("São Paulo")).toBe("sao paulo");
    expect(normalizeTeamName("Bayern Munich")).toBe("bayern munich");
  });

  it("accented spellings resolve through normalized alias keys", () => {
    // ALIASES keys are accent-normalized at module load, so accented
    // provider spellings hit the same canonical targets as ASCII ones.
    expect(normalizeTeamName("Bayern München")).toBe("bayern munich");
    expect(normalizeTeamName("1. FC Köln")).toBe("koln");
    expect(normalizeTeamName("Borussia Mönchengladbach")).toBe("monchengladbach");
    expect(normalizeTeamName("UD Almería")).toBe("almeria");
    expect(normalizeTeamName("Cádiz CF")).toBe("cadiz");
    expect(normalizeTeamName("Deportivo Alavés")).toBe("alaves");
    expect(normalizeTeamName("Club Atlético de Madrid")).toBe("atletico madrid");
    expect(normalizeTeamName("Real Betis Balompié")).toBe("real betis");
  });

  it("unaccented variants of those same clubs DO normalize correctly", () => {
    // The bug only bites when the provider sends the accented spelling;
    // ASCII spellings hit the unaccented keys.
    expect(normalizeTeamName("Athletic Club")).toBe("athletic bilbao");
    expect(normalizeTeamName("Almeria")).toBe("almeria");
    expect(normalizeTeamName("Cadiz")).toBe("cadiz");
    expect(normalizeTeamName("Atletico Madrid")).toBe("atletico madrid");
  });
});

describe("normalizeTeamName — provider naming variants", () => {
  it("maps common short forms used by odds/data providers", () => {
    expect(normalizeTeamName("Man Utd")).toBe("manchester united");
    expect(normalizeTeamName("Man City")).toBe("manchester city");
    expect(normalizeTeamName("Spurs")).toBe("tottenham");
    expect(normalizeTeamName("PSG")).toBe("paris saint-germain");
    expect(normalizeTeamName("Inter")).toBe("inter");
    expect(normalizeTeamName("Juve")).toBe("juventus");
    expect(normalizeTeamName("OM")).toBe("marseille");
    expect(normalizeTeamName("feyenoord rotterdam")).toBe("feyenoord");
    expect(normalizeTeamName("mineiro")).toBe("atletico mineiro");
    expect(normalizeTeamName("Internazionale")).toBe("inter");
  });

  it("normalizes case and surrounding whitespace before lookup", () => {
    expect(normalizeTeamName("  MAN CITY  ")).toBe("manchester city");
    expect(normalizeTeamName("Fc Barcelona")).toBe("barcelona");
    expect(normalizeTeamName("PSG ")).toBe("paris saint-germain");
  });

  it("does NOT strip generic club prefixes — passthrough stays prefixed", () => {
    // Unlike src/lib/sync/odds.ts normalizeTeamName (which strips FC/CF/SC…),
    // this normalizer only maps known aliases; unknown prefixed names keep
    // the prefix lowercased. Two providers naming the same unknown club
    // differently will NOT collide here.
    expect(normalizeTeamName("FC Nowhere United")).toBe("fc nowhere united");
    expect(normalizeTeamName("Nowhere United")).toBe("nowhere united");
    expect(normalizeTeamName("FC Nowhere United")).not.toBe(
      normalizeTeamName("Nowhere United")
    );
  });

  it("maps the odds API's 'Ath Madrid' abbreviation to Atletico", () => {
    expect(normalizeTeamName("Ath Madrid")).toBe("atletico madrid");
  });
});

describe("buildNormalizedMap — collisions", () => {
  it("later entries overwrite earlier ones on the same normalized key", () => {
    const map = buildNormalizedMap({
      "FC Barcelona": { id: 1 },
      "Barcelona": { id: 2 }, // same normalized key "barcelona"
    });
    // normalized key keeps the LAST write; original keys both remain
    expect(map["barcelona"]).toEqual({ id: 2 });
    expect(map["FC Barcelona"]).toEqual({ id: 1 });
    expect(map["Barcelona"]).toEqual({ id: 2 });
  });
});
