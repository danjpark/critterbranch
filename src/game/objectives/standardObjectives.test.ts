import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../../params.ts";
import type { Genome } from "../../sim/genome.ts";
import { createSimState } from "../../sim/sim.ts";
import type { PopulationSample, Species } from "../../sim/taxonomy.ts";
import { createGameState } from "../gameState.ts";
import type { GameEvaluationContext } from "./objective.ts";
import { createBiodiversityObjective, createDisasterRecoveryObjective, createGeographicSpeciationObjective } from "./standardObjectives.ts";

function genome(offspringInvestment: number): Genome {
  return {
    carnivory: 0,
    speed: 1,
    senseRadius: 5,
    wanderPersistence: 0.5,
    size: 1,
    reproThreshold: 0.6,
    offspringInvestment,
    nursingDuration: 0,
    mutationRate: 0.05,
  };
}

function species(overrides: Partial<Species> & Pick<Species, "id">): Species {
  return {
    parentId: null,
    originTick: 0,
    extinctTick: null,
    foundingCentroid: genome(0.5),
    centroid: genome(0.5),
    memberCount: 30,
    peakMemberCount: 30,
    mechanism: "founder-population",
    dominantDivergentGene: null,
    originEvidence: null,
    ...overrides,
  };
}

function context(): GameEvaluationContext {
  const sim = createSimState(1, DEFAULT_PARAMS);
  sim.state.observations.taxonomy.species.clear();
  return { sim, gameState: createGameState("sandbox") };
}

describe("createBiodiversityObjective", () => {
  it("completes once enough living species coexist", () => {
    const ctx = context();
    const obj = createBiodiversityObjective(3);
    for (const id of [1, 2]) ctx.sim.state.observations.taxonomy.species.set(id, species({ id }));
    expect(obj.evaluate(ctx).complete).toBe(false);

    ctx.sim.state.observations.taxonomy.species.set(3, species({ id: 3 }));
    expect(obj.evaluate(ctx).complete).toBe(true);
  });

  it("does not count extinct species", () => {
    const ctx = context();
    const obj = createBiodiversityObjective(1);
    ctx.sim.state.observations.taxonomy.species.set(1, species({ id: 1, extinctTick: 500 }));
    expect(obj.evaluate(ctx).complete).toBe(false);
  });
});

// createDietarySpecialistObjective/createDietaryGeneralistObjective tests lived here — removed
// along with the objectives themselves (SPEC.md Addendum 6, no diet trade-off axis left to test).

describe("createGeographicSpeciationObjective", () => {
  it("completes once an allopatric speciation event has occurred", () => {
    const ctx = context();
    const obj = createGeographicSpeciationObjective();
    expect(obj.evaluate(ctx).complete).toBe(false);

    ctx.sim.state.observations.taxonomyEvents.push({
      type: "speciation",
      event: {
        tick: 1000,
        speciesId: 1,
        parentId: 0,
        mechanism: "allopatric",
        dominantDivergentGene: "offspringInvestment",
        founderCount: 10,
        evidence: {
          geneticSeparation: 0.5,
          minimumBarrierPassability: 0.02,
          spatialSeparation: 100,
          founderCount: 10,
          divergenceDominanceRatio: 0.6,
          dominantDivergentGene: "offspringInvestment",
        },
      },
    });
    expect(obj.evaluate(ctx).complete).toBe(true);
  });

  it("does not complete for a sympatric split", () => {
    const ctx = context();
    const obj = createGeographicSpeciationObjective();
    ctx.sim.state.observations.taxonomyEvents.push({
      type: "speciation",
      event: {
        tick: 1000,
        speciesId: 1,
        parentId: 0,
        mechanism: "sympatric",
        dominantDivergentGene: "offspringInvestment",
        founderCount: 10,
        evidence: {
          geneticSeparation: 0.5,
          minimumBarrierPassability: 0.8,
          spatialSeparation: 5,
          founderCount: 10,
          divergenceDominanceRatio: 0.6,
          dominantDivergentGene: "offspringInvestment",
        },
      },
    });
    expect(obj.evaluate(ctx).complete).toBe(false);
  });
});

function sample(counts: Record<number, number>): PopulationSample {
  return { tick: 0, counts };
}

describe("createDisasterRecoveryObjective", () => {
  it("completes only after a qualifying decline from a peak followed by recovery", () => {
    const ctx = context();
    const obj = createDisasterRecoveryObjective(4, 0.4);

    ctx.sim.state.observations.populationHistory = [
      sample({ 1: 10, 2: 10, 3: 10, 4: 10, 5: 10 }), // peak: 5 living species
      sample({ 1: 10, 2: 10 }), // crash: 2 living species (60% loss, qualifies)
      sample({ 1: 10, 2: 10, 3: 10, 4: 10 }), // recovery: 4 living species
    ];

    expect(obj.evaluate(ctx).complete).toBe(true);
  });

  it("does not complete if the population never recovers", () => {
    const ctx = context();
    const obj = createDisasterRecoveryObjective(4, 0.4);
    ctx.sim.state.observations.populationHistory = [
      sample({ 1: 10, 2: 10, 3: 10, 4: 10, 5: 10 }),
      sample({ 1: 10, 2: 10 }),
    ];
    expect(obj.evaluate(ctx).complete).toBe(false);
  });

  it("does not complete if population stayed high (no qualifying decline)", () => {
    const ctx = context();
    const obj = createDisasterRecoveryObjective(4, 0.4);
    ctx.sim.state.observations.populationHistory = [
      sample({ 1: 10, 2: 10, 3: 10, 4: 10, 5: 10 }),
      sample({ 1: 10, 2: 10, 3: 10, 4: 10, 5: 12 }),
    ];
    expect(obj.evaluate(ctx).complete).toBe(false);
  });
});
