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
