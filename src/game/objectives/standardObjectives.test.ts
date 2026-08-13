import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../../params.ts";
import { createCreature } from "../../sim/creature.ts";
import type { Genome } from "../../sim/genome.ts";
import { RNG } from "../../sim/rng.ts";
import { createSimState } from "../../sim/sim.ts";
import { recordDiet } from "../../sim/speciesBehaviorStats.ts";
import type { PopulationSample, Species } from "../../sim/taxonomy.ts";
import { createGameState } from "../gameState.ts";
import type { GameEvaluationContext } from "./objective.ts";
import {
  createApexPredatorObjective,
  createAquaticForagerObjective,
  createBiodiversityObjective,
  createDietaryGeneralistObjective,
  createDietarySpecialistObjective,
  createDisasterRecoveryObjective,
  createGeographicSpeciationObjective,
} from "./standardObjectives.ts";

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
  sim.state.evolution.creatures = [];
  return { sim, gameState: createGameState("sandbox") };
}

/** Seeds a living species with `memberCount` creatures and a decayed diet-share history —
 * mirrors what computeSpeciesProfiles actually reads (taxonomy.species + evolution.creatures
 * grouped by lineageId + speciesBehavior), not a genotype proxy. */
function seedSpeciesWithDiet(ctx: GameEvaluationContext, speciesId: number, memberCount: number, fruitAmount: number, meatAmount: number): void {
  ctx.sim.state.observations.taxonomy.species.set(speciesId, species({ id: speciesId, memberCount }));
  const rng = new RNG(1);
  for (let i = 0; i < memberCount; i++) {
    ctx.sim.state.evolution.creatures.push(
      createCreature({ id: speciesId * 1000 + i, parentId: null, lineageId: speciesId, genome: genome(0.5), x: 0, y: 0, energy: 10, birthTick: 0, rng }),
    );
  }
  if (fruitAmount > 0) recordDiet(ctx.sim.state.observations.speciesBehavior, speciesId, 0, fruitAmount);
  if (meatAmount > 0) recordDiet(ctx.sim.state.observations.speciesBehavior, speciesId, 1, meatAmount);
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

describe("createDietarySpecialistObjective", () => {
  it("completes when a sufficiently populous species has a skewed demonstrated diet", () => {
    const ctx = context();
    const obj = createDietarySpecialistObjective(20, 0.3);
    seedSpeciesWithDiet(ctx, 1, 25, 1, 9); // meatShare = 0.9
    expect(obj.evaluate(ctx).complete).toBe(true);
  });

  it("ignores a skewed species below the population threshold", () => {
    const ctx = context();
    const obj = createDietarySpecialistObjective(20, 0.3);
    seedSpeciesWithDiet(ctx, 1, 5, 0.5, 9.5); // well below minPopulation
    expect(obj.evaluate(ctx).complete).toBe(false);
  });

  it("does not complete for a balanced diet", () => {
    const ctx = context();
    const obj = createDietarySpecialistObjective(20, 0.3);
    seedSpeciesWithDiet(ctx, 1, 25, 5, 5); // meatShare = 0.5
    expect(obj.evaluate(ctx).complete).toBe(false);
  });

  it("ignores a species with no recorded diet evidence yet", () => {
    const ctx = context();
    const obj = createDietarySpecialistObjective(20, 0.3);
    ctx.sim.state.observations.taxonomy.species.set(1, species({ id: 1, memberCount: 25 }));
    expect(obj.evaluate(ctx).complete).toBe(false);
  });
});

describe("createDietaryGeneralistObjective", () => {
  it("completes when a sufficiently populous species has a balanced demonstrated diet", () => {
    const ctx = context();
    const obj = createDietaryGeneralistObjective(20, 0.15);
    seedSpeciesWithDiet(ctx, 1, 25, 5.2, 4.8); // meatShare = 0.48
    expect(obj.evaluate(ctx).complete).toBe(true);
  });

  it("does not complete for a skewed diet", () => {
    const ctx = context();
    const obj = createDietaryGeneralistObjective(20, 0.15);
    seedSpeciesWithDiet(ctx, 1, 25, 1, 9); // meatShare = 0.9
    expect(obj.evaluate(ctx).complete).toBe(false);
  });
});

describe("createApexPredatorObjective", () => {
  it("completes when a sufficiently populous species draws most of its diet from meat", () => {
    const ctx = context();
    const obj = createApexPredatorObjective(20, 0.7);
    seedSpeciesWithDiet(ctx, 1, 25, 1, 9); // meatShare = 0.9
    expect(obj.evaluate(ctx).complete).toBe(true);
  });

  it("does not complete below the meat-share threshold", () => {
    const ctx = context();
    const obj = createApexPredatorObjective(20, 0.7);
    seedSpeciesWithDiet(ctx, 1, 25, 5, 5); // meatShare = 0.5
    expect(obj.evaluate(ctx).complete).toBe(false);
  });

  it("does not complete below the population threshold even at 100% meat", () => {
    const ctx = context();
    const obj = createApexPredatorObjective(20, 0.7);
    seedSpeciesWithDiet(ctx, 1, 5, 0, 10); // meatShare = 1.0, but too few members
    expect(obj.evaluate(ctx).complete).toBe(false);
  });
});

/** Seeds a living species with `memberCount` creatures, `waterCount` of them placed on a cell
 * directly set below the terrain's own seaLevel, the rest on a cell set above it — mirrors what
 * computeSpeciesProfiles' habitatProfile actually reads (elevationBand per living member's current
 * cell), not a stand-in stat. SPEC.md Addendum 10 (Milestone 4: water as a real niche). */
function seedSpeciesWithWaterShare(ctx: GameEvaluationContext, speciesId: number, memberCount: number, waterCount: number): void {
  const terrain = ctx.sim.state.evolution.terrain;
  terrain.seaLevel = 0;
  terrain.elevation.fill(1); // land everywhere by default
  terrain.elevation[0] = -1; // cell 0 (grid 0,0): underwater

  ctx.sim.state.observations.taxonomy.species.set(speciesId, species({ id: speciesId, memberCount }));
  const rng = new RNG(1);
  const cellSize = DEFAULT_PARAMS.gridCellSize;
  for (let i = 0; i < memberCount; i++) {
    const inWater = i < waterCount;
    // Water members sit in cell 0 (grid 0,0); land members sit one cell over (grid 1,0) —
    // elevation there is still the default 1 (land) set above.
    const x = inWater ? cellSize * 0.5 : cellSize * 1.5;
    const y = cellSize * 0.5;
    ctx.sim.state.evolution.creatures.push(
      createCreature({ id: speciesId * 1000 + i, parentId: null, lineageId: speciesId, genome: genome(0.5), x, y, energy: 10, birthTick: 0, rng }),
    );
  }
}

describe("createAquaticForagerObjective", () => {
  it("completes when a sufficiently populous species spends a real share of its time in water", () => {
    const ctx = context();
    const obj = createAquaticForagerObjective(20, 0.3);
    seedSpeciesWithWaterShare(ctx, 1, 25, 10); // waterShare = 0.4
    expect(obj.evaluate(ctx).complete).toBe(true);
  });

  it("does not complete below the water-share threshold", () => {
    const ctx = context();
    const obj = createAquaticForagerObjective(20, 0.3);
    seedSpeciesWithWaterShare(ctx, 1, 25, 2); // waterShare = 0.08
    expect(obj.evaluate(ctx).complete).toBe(false);
  });

  it("does not complete below the population threshold even at 100% in water", () => {
    const ctx = context();
    const obj = createAquaticForagerObjective(20, 0.3);
    seedSpeciesWithWaterShare(ctx, 1, 5, 5); // waterShare = 1.0, but too few members
    expect(obj.evaluate(ctx).complete).toBe(false);
  });
});

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
