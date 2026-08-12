import { describe, expect, it } from "vitest";
import { classifySpecies } from "./capabilityClassifier.ts";
import type { PopulationBaseline, SpeciesProfile } from "./speciesProfile.ts";

function profile(overrides: Partial<SpeciesProfile> = {}): SpeciesProfile {
  return {
    speciesId: 0,
    memberCount: 30,
    diet: { rShare: 0.5, totalConsumed: 10 },
    habitat: { lowlandShare: 1, hillShare: 0, mountainShare: 0 },
    movement: { averageRealizedSpeed: 1 },
    reproduction: { birthsPerCapita: 0.1, deathsPerCapita: 0.1, averageLifespanAtDeath: null },
    survival: { volatility: 0, trend: "stable" },
    ...overrides,
  };
}

const neutralBaseline: PopulationBaseline = { averageRealizedSpeed: 1, averageBirthsPerCapita: 0.1 };

function labelsOf(profile: SpeciesProfile, baseline = neutralBaseline) {
  return classifySpecies(profile, baseline).map((c) => c.label);
}

describe("classifySpecies — diet", () => {
  it("labels a near-balanced diet as generalist", () => {
    expect(labelsOf(profile({ diet: { rShare: 0.45, totalConsumed: 10 } }))).toContain("dietary-generalist");
  });

  it("labels a heavily R-skewed diet as specialist-r", () => {
    expect(labelsOf(profile({ diet: { rShare: 0.9, totalConsumed: 10 } }))).toContain("dietary-specialist-r");
  });

  it("labels a heavily B-skewed diet as specialist-b", () => {
    expect(labelsOf(profile({ diet: { rShare: 0.1, totalConsumed: 10 } }))).toContain("dietary-specialist-b");
  });

  it("assigns no diet label in the ambiguous middle zone", () => {
    const labels = labelsOf(profile({ diet: { rShare: 0.65, totalConsumed: 10 } }));
    expect(labels).not.toContain("dietary-generalist");
    expect(labels).not.toContain("dietary-specialist-r");
    expect(labels).not.toContain("dietary-specialist-b");
  });

  it("assigns no diet label when nothing has been consumed yet", () => {
    const labels = labelsOf(profile({ diet: { rShare: 0.5, totalConsumed: 0 } }));
    expect(labels).not.toContain("dietary-generalist");
  });
});

describe("classifySpecies — habitat", () => {
  it("labels a species mostly found on mountain terrain as highland-adapted", () => {
    expect(labelsOf(profile({ habitat: { lowlandShare: 0.1, hillShare: 0.2, mountainShare: 0.7 } }))).toContain("highland-adapted");
  });

  it("labels a species mostly found on lowland terrain as lowland-adapted", () => {
    expect(labelsOf(profile({ habitat: { lowlandShare: 0.9, hillShare: 0.1, mountainShare: 0 } }))).toContain("lowland-adapted");
  });
});

describe("classifySpecies — movement (relative to population baseline)", () => {
  it("labels a species moving well above the population average as fast-mover", () => {
    expect(labelsOf(profile({ movement: { averageRealizedSpeed: 2 } }))).toContain("fast-mover");
  });

  it("labels a species moving well below the population average as sedentary", () => {
    expect(labelsOf(profile({ movement: { averageRealizedSpeed: 0.3 } }))).toContain("sedentary");
  });

  it("assigns no movement label close to the population average", () => {
    const labels = labelsOf(profile({ movement: { averageRealizedSpeed: 1.05 } }));
    expect(labels).not.toContain("fast-mover");
    expect(labels).not.toContain("sedentary");
  });
});

describe("classifySpecies — reproduction (relative to population baseline)", () => {
  it("labels a species with a high birth rate relative to the population as r-strategist", () => {
    expect(labelsOf(profile({ reproduction: { birthsPerCapita: 0.2, deathsPerCapita: 0.1, averageLifespanAtDeath: null } }))).toContain("r-strategist");
  });

  it("labels a species with a low birth rate relative to the population as k-strategist", () => {
    expect(labelsOf(profile({ reproduction: { birthsPerCapita: 0.03, deathsPerCapita: 0.1, averageLifespanAtDeath: null } }))).toContain("k-strategist");
  });
});

describe("classifySpecies — survival", () => {
  it("labels a low-volatility, non-declining species as resilient", () => {
    expect(labelsOf(profile({ survival: { volatility: 0.05, trend: "stable" } }))).toContain("resilient");
  });

  it("labels a high-volatility species as fragile", () => {
    expect(labelsOf(profile({ survival: { volatility: 0.5, trend: "stable" } }))).toContain("fragile");
  });

  it("labels a declining species as fragile even with low volatility", () => {
    expect(labelsOf(profile({ survival: { volatility: 0.05, trend: "declining" } }))).toContain("fragile");
  });
});

describe("classifySpecies — confidence", () => {
  it("scales confidence down for a thinly-populated species", () => {
    const thin = classifySpecies(profile({ memberCount: 3, diet: { rShare: 0.5, totalConsumed: 10 } }), neutralBaseline);
    const wellSampled = classifySpecies(profile({ memberCount: 100, diet: { rShare: 0.5, totalConsumed: 10 } }), neutralBaseline);
    expect(thin[0].confidence).toBeLessThan(wellSampled[0].confidence);
    expect(wellSampled[0].confidence).toBe(1);
  });

  it("every emitted capability carries non-empty evidence", () => {
    const capabilities = classifySpecies(
      profile({
        diet: { rShare: 0.9, totalConsumed: 10 },
        habitat: { lowlandShare: 0, hillShare: 0, mountainShare: 0.8 },
        movement: { averageRealizedSpeed: 3 },
        reproduction: { birthsPerCapita: 0.3, deathsPerCapita: 0.1, averageLifespanAtDeath: 500 },
        survival: { volatility: 0.5, trend: "declining" },
      }),
      neutralBaseline,
    );
    expect(capabilities.length).toBeGreaterThan(0);
    for (const c of capabilities) expect(c.evidence.length).toBeGreaterThan(0);
  });
});
