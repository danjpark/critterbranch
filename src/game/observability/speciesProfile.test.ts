import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../../params.ts";
import { createCreature } from "../../sim/creature.ts";
import { randomGenome, type Genome } from "../../sim/genome.ts";
import { RNG } from "../../sim/rng.ts";
import { createSimState, tick } from "../../sim/sim.ts";
import { recordBirth, recordDeath, recordDiet } from "../../sim/speciesBehaviorStats.ts";
import type { Species } from "../../sim/taxonomy.ts";
import { computeSpeciesProfiles, getSpeciesProfile } from "./speciesProfile.ts";

function testGenome(overrides: Partial<Genome> = {}): Genome {
  const rng = new RNG(1);
  return { ...randomGenome(rng), ...overrides };
}

function species(overrides: Partial<Species> & Pick<Species, "id">): Species {
  return {
    parentId: null,
    originTick: 0,
    extinctTick: null,
    foundingCentroid: testGenome(),
    centroid: testGenome(),
    memberCount: 1,
    peakMemberCount: 1,
    mechanism: "founder-population",
    dominantDivergentGene: null,
    originEvidence: null,
    ...overrides,
  };
}

function creatureAt(id: number, lineageId: number, x: number, y: number, distanceTraveled: number, age: number) {
  const rng = new RNG(id + 1);
  const c = createCreature({ id, parentId: null, lineageId, genome: testGenome(), x, y, energy: 10, birthTick: 0, rng });
  c.distanceTraveled = distanceTraveled;
  c.age = age;
  return c;
}

describe("computeSpeciesProfiles", () => {
  it("computes diet share from decayed behavior stats, not the carnivory gene", () => {
    const sim = createSimState(1, DEFAULT_PARAMS);
    sim.state.observations.taxonomy.species.clear();
    sim.state.observations.taxonomy.species.set(0, species({ id: 0, memberCount: 1 }));
    sim.state.evolution.creatures = [creatureAt(0, 0, 0, 0, 0, 10)];
    recordDiet(sim.state.observations.speciesBehavior, 0, 0, 3); // fruit
    recordDiet(sim.state.observations.speciesBehavior, 0, 1, 1); // meat

    const profile = getSpeciesProfile(computeSpeciesProfiles(sim), 0)!;
    expect(profile.diet.meatShare).toBeCloseTo(0.25);
    expect(profile.diet.totalConsumed).toBeCloseTo(4);
  });

  it("reports a neutral 0.5 diet share when no intake has been recorded", () => {
    const sim = createSimState(1, DEFAULT_PARAMS);
    sim.state.observations.taxonomy.species.clear();
    sim.state.observations.taxonomy.species.set(0, species({ id: 0, memberCount: 1 }));
    sim.state.evolution.creatures = [creatureAt(0, 0, 0, 0, 0, 10)];

    const profile = getSpeciesProfile(computeSpeciesProfiles(sim), 0)!;
    expect(profile.diet.meatShare).toBe(0.5);
    expect(profile.diet.totalConsumed).toBe(0);
  });

  it("computes realized speed as distanceTraveled/age, averaged across living members", () => {
    const sim = createSimState(1, DEFAULT_PARAMS);
    sim.state.observations.taxonomy.species.clear();
    sim.state.observations.taxonomy.species.set(0, species({ id: 0, memberCount: 2 }));
    sim.state.evolution.creatures = [
      creatureAt(0, 0, 0, 0, 100, 10), // speed 10
      creatureAt(1, 0, 0, 0, 20, 10), // speed 2
    ];

    const profile = getSpeciesProfile(computeSpeciesProfiles(sim), 0)!;
    expect(profile.movement.averageRealizedSpeed).toBeCloseTo(6);
  });

  it("classifies each living member's terrain cell into an elevation band", () => {
    const sim = createSimState(1, DEFAULT_PARAMS);
    const terrain = sim.state.evolution.terrain;
    terrain.elevation.fill(0); // norm 0 -> lowland everywhere
    terrain.seaLevel = 0; // keep elevation 0 as the baseline "lowland" reference, not whatever generateTerrain picked
    const mountainIdx = 5; // some arbitrary cell, made a mountain below
    terrain.elevation[mountainIdx] = DEFAULT_PARAMS.terrainRoughness * 0.9; // norm 0.9 > 0.7 -> mountain

    const cellSize = DEFAULT_PARAMS.gridCellSize;
    const mountainX = (mountainIdx % terrain.cols) * cellSize + 0.5;
    const mountainY = Math.floor(mountainIdx / terrain.cols) * cellSize + 0.5;

    sim.state.observations.taxonomy.species.clear();
    sim.state.observations.taxonomy.species.set(0, species({ id: 0, memberCount: 2 }));
    sim.state.evolution.creatures = [
      creatureAt(0, 0, mountainX, mountainY, 0, 10),
      creatureAt(1, 0, 0.5, 0.5, 0, 10), // cell (0,0), left at elevation 0 -> lowland
    ];

    const profile = getSpeciesProfile(computeSpeciesProfiles(sim), 0)!;
    expect(profile.habitat.mountainShare).toBeCloseTo(0.5);
    expect(profile.habitat.lowlandShare).toBeCloseTo(0.5);
  });

  it("computes reproduction rate and average lifespan-at-death from decayed accumulators", () => {
    const sim = createSimState(1, DEFAULT_PARAMS);
    sim.state.observations.taxonomy.species.clear();
    sim.state.observations.taxonomy.species.set(0, species({ id: 0, memberCount: 10 }));
    sim.state.evolution.creatures = [creatureAt(0, 0, 0, 0, 0, 10)];
    recordBirth(sim.state.observations.speciesBehavior, 0);
    recordBirth(sim.state.observations.speciesBehavior, 0);
    recordDeath(sim.state.observations.speciesBehavior, 0, 200);
    recordDeath(sim.state.observations.speciesBehavior, 0, 400);

    const profile = getSpeciesProfile(computeSpeciesProfiles(sim), 0)!;
    expect(profile.reproduction.birthsPerCapita).toBeCloseTo(0.2);
    expect(profile.reproduction.deathsPerCapita).toBeCloseTo(0.2);
    expect(profile.reproduction.averageLifespanAtDeath).toBeCloseTo(300);
  });

  it("reports null average lifespan when no deaths have been recorded yet", () => {
    const sim = createSimState(1, DEFAULT_PARAMS);
    sim.state.observations.taxonomy.species.clear();
    sim.state.observations.taxonomy.species.set(0, species({ id: 0, memberCount: 10 }));
    sim.state.evolution.creatures = [creatureAt(0, 0, 0, 0, 0, 10)];

    const profile = getSpeciesProfile(computeSpeciesProfiles(sim), 0)!;
    expect(profile.reproduction.averageLifespanAtDeath).toBeNull();
  });

  it("computes population volatility/trend from the recent populationHistory window, scoped to this species' own originTick", () => {
    const sim = createSimState(1, DEFAULT_PARAMS);
    sim.state.observations.taxonomy.species.clear();
    sim.state.observations.taxonomy.species.set(0, species({ id: 0, memberCount: 100, originTick: 0 }));
    sim.state.evolution.creatures = [creatureAt(0, 0, 0, 0, 0, 10)];
    sim.state.observations.populationHistory = [
      { tick: 0, counts: { 0: 50 } },
      { tick: 100, counts: { 0: 60 } },
      { tick: 200, counts: { 0: 100 } },
    ];

    const profile = getSpeciesProfile(computeSpeciesProfiles(sim), 0)!;
    expect(profile.survival.trend).toBe("growing");
    expect(profile.survival.volatility).toBeGreaterThan(0);
  });

  it("does not crash for a living species with zero currently-present members (stale between taxonomy passes)", () => {
    const sim = createSimState(1, DEFAULT_PARAMS);
    sim.state.observations.taxonomy.species.clear();
    sim.state.observations.taxonomy.species.set(0, species({ id: 0, memberCount: 5 }));
    sim.state.evolution.creatures = [];

    const profile = getSpeciesProfile(computeSpeciesProfiles(sim), 0)!;
    expect(profile.movement.averageRealizedSpeed).toBe(0);
    expect(profile.habitat.lowlandShare).toBe(0);
  });

  it("skips extinct species entirely", () => {
    const sim = createSimState(1, DEFAULT_PARAMS);
    sim.state.observations.taxonomy.species.clear();
    sim.state.observations.taxonomy.species.set(0, species({ id: 0, extinctTick: 50 }));

    expect(getSpeciesProfile(computeSpeciesProfiles(sim), 0)).toBeUndefined();
  });
});

describe("determinism", () => {
  it("produces identical SpeciesProfileSets for two runs of the same seed", () => {
    function run() {
      const sim = createSimState(11, DEFAULT_PARAMS);
      for (let i = 0; i < 300; i++) tick(sim.state, sim.rng, DEFAULT_PARAMS);
      return computeSpeciesProfiles(sim);
    }
    const a = run();
    const b = run();
    expect(JSON.stringify([...a.profiles.entries()])).toBe(JSON.stringify([...b.profiles.entries()]));
    expect(a.baseline).toEqual(b.baseline);
  });
});
