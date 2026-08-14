import { describe, expect, it } from "vitest";
import type { CapabilityLabel } from "../observability/capabilityClassifier.ts";
import type { PopulationBaseline, SpeciesProfile, SpeciesProfileSet } from "../observability/speciesProfile.ts";
import { DISCOVERY_REGISTRY } from "./discoveryDefinition.ts";
import { createDiscoveryJournal, DISCOVERY_CONFIRMATION_ERAS, evaluateDiscoveries } from "./discoveryJournal.ts";

function profile(overrides: Partial<SpeciesProfile> = {}): SpeciesProfile {
  return {
    speciesId: 0,
    memberCount: 30,
    diet: { meatShare: 0.5, totalConsumed: 10 },
    habitat: { waterShare: 0, lowlandShare: 1, hillShare: 0, mountainShare: 0 },
    movement: { averageRealizedSpeed: 1 },
    reproduction: { birthsPerCapita: 0.1, deathsPerCapita: 0.1, averageLifespanAtDeath: null },
    survival: { volatility: 0, trend: "stable" },
    ...overrides,
  };
}

const neutralBaseline: PopulationBaseline = { averageRealizedSpeed: 1, averageBirthsPerCapita: 0.1 };

// meatShare 0.9 reliably clears capabilityClassifier's SPECIALIST_THRESHOLD (0.3 distance from 0.5)
// and its own memberCount (30) clears CONFIDENCE_SATURATION_MEMBER_COUNT — a clean "carnivore" fixture.
function carnivoreProfileSet(speciesId: number, overrides: Partial<SpeciesProfile> = {}): SpeciesProfileSet {
  return {
    profiles: new Map([[speciesId, profile({ speciesId, diet: { meatShare: 0.9, totalConsumed: 10 }, ...overrides })]]),
    baseline: neutralBaseline,
  };
}

describe("DISCOVERY_REGISTRY", () => {
  const EXPECTED_LABELS: CapabilityLabel[] = [
    "omnivore",
    "herbivore",
    "carnivore",
    "highland-adapted",
    "lowland-adapted",
    "aquatic-adapted",
    "fast-mover",
    "sedentary",
    "r-strategist",
    "k-strategist",
    "resilient",
    "fragile",
  ];

  it("has exactly one entry per CapabilityLabel, no duplicates, no extras", () => {
    const ids = DISCOVERY_REGISTRY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([...EXPECTED_LABELS].sort());
  });

  it("every entry has a non-empty displayName and hint", () => {
    for (const definition of DISCOVERY_REGISTRY) {
      expect(definition.displayName.length).toBeGreaterThan(0);
      expect(definition.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("evaluateDiscoveries", () => {
  it("does not confirm a capability held for only one era", () => {
    const journal = createDiscoveryJournal();
    const { newMatches } = evaluateDiscoveries(carnivoreProfileSet(1), journal, 1);
    expect(newMatches).toHaveLength(0);
  });

  it("confirms a capability held for DISCOVERY_CONFIRMATION_ERAS consecutive eras", () => {
    let journal = createDiscoveryJournal();
    let newMatches: ReturnType<typeof evaluateDiscoveries>["newMatches"] = [];
    for (let era = 1; era <= DISCOVERY_CONFIRMATION_ERAS; era++) {
      const result = evaluateDiscoveries(carnivoreProfileSet(1), journal, era);
      journal = result.journal;
      newMatches = result.newMatches;
    }
    expect(newMatches.map((m) => m.definitionId)).toContain("carnivore");
    const match = newMatches.find((m) => m.definitionId === "carnivore")!;
    expect(match.speciesId).toBe(1);
    expect(match.confirmedEra).toBe(DISCOVERY_CONFIRMATION_ERAS);
    expect(match.firstQualifiedEra).toBe(1);
  });

  it("resets the streak the moment a species stops holding the capability", () => {
    let journal = createDiscoveryJournal();
    ({ journal } = evaluateDiscoveries(carnivoreProfileSet(1), journal, 1));
    // Era 2: species reverts to a neutral, unclassified diet — streak should reset, not just pause.
    ({ journal } = evaluateDiscoveries(
      { profiles: new Map([[1, profile({ speciesId: 1, diet: { meatShare: 0.5, totalConsumed: 10 } })]]), baseline: neutralBaseline },
      journal,
      2,
    ));
    // Eras 3-4: carnivory resumes — needs a fresh two-era streak, not a continuation of era 1's.
    let newMatches: ReturnType<typeof evaluateDiscoveries>["newMatches"] = [];
    for (let era = 3; era <= 3 + DISCOVERY_CONFIRMATION_ERAS - 1; era++) {
      const result = evaluateDiscoveries(carnivoreProfileSet(1), journal, era);
      journal = result.journal;
      newMatches = result.newMatches;
    }
    expect(newMatches.map((m) => m.definitionId)).toContain("carnivore");
  });

  it("only records the first confirming species per definition, but tracks later ones without re-firing", () => {
    let journal = createDiscoveryJournal();
    for (let era = 1; era <= DISCOVERY_CONFIRMATION_ERAS; era++) {
      ({ journal } = evaluateDiscoveries(carnivoreProfileSet(1), journal, era));
    }
    const firstMatch = journal.matches.get("carnivore")!;
    expect(firstMatch.speciesId).toBe(1);

    // A second species independently qualifies later — should not overwrite or re-fire the match.
    let newMatches: ReturnType<typeof evaluateDiscoveries>["newMatches"] = [];
    for (let era = DISCOVERY_CONFIRMATION_ERAS + 1; era <= DISCOVERY_CONFIRMATION_ERAS * 2; era++) {
      const result = evaluateDiscoveries(carnivoreProfileSet(2), journal, era);
      journal = result.journal;
      newMatches = result.newMatches;
    }
    expect(newMatches.map((m) => m.definitionId)).not.toContain("carnivore");
    expect(journal.matches.get("carnivore")!.speciesId).toBe(1);
  });

  it("is deterministic — identical inputs produce identical output", () => {
    const journal = createDiscoveryJournal();
    const a = evaluateDiscoveries(carnivoreProfileSet(1), journal, 5);
    const b = evaluateDiscoveries(carnivoreProfileSet(1), journal, 5);
    expect(a.newMatches).toEqual(b.newMatches);
  });

  it("evaluates multiple species and multiple qualifying capabilities in one call", () => {
    const profiles: SpeciesProfileSet = {
      profiles: new Map([
        [1, profile({ speciesId: 1, diet: { meatShare: 0.9, totalConsumed: 10 }, habitat: { waterShare: 0, lowlandShare: 0.1, hillShare: 0.2, mountainShare: 0.7 } })],
        [2, profile({ speciesId: 2, diet: { meatShare: 0.1, totalConsumed: 10 } })],
      ]),
      baseline: neutralBaseline,
    };
    let journal = createDiscoveryJournal();
    let newMatches: ReturnType<typeof evaluateDiscoveries>["newMatches"] = [];
    for (let era = 1; era <= DISCOVERY_CONFIRMATION_ERAS; era++) {
      const result = evaluateDiscoveries(profiles, journal, era);
      journal = result.journal;
      newMatches = result.newMatches;
    }
    // Species also incidentally clear other axes' thresholds under the shared fixture defaults
    // (e.g. lowlandShare/volatility defaults), same as capabilityClassifier.test.ts's own base
    // fixture — this test only asserts the three axes it's actually exercising (diet x2, habitat).
    const ids = newMatches.map((m) => m.definitionId);
    expect(ids).toContain("carnivore");
    expect(ids).toContain("herbivore");
    expect(ids).toContain("highland-adapted");
  });
});
