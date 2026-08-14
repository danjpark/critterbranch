import { describe, expect, it } from "vitest";
import { createCreature, gainPerUnit, isReadyToReproduce, reproduce } from "./creature.ts";
import { GENE_RANGES, randomGenome, type Genome } from "./genome.ts";
import { derivePhenotype } from "./phenotype.ts";
import { RNG } from "./rng.ts";
import { DEFAULT_PARAMS } from "../params.ts";

function testGenome(overrides: Partial<Genome> = {}): Genome {
  const rng = new RNG(1);
  return { ...randomGenome(rng), ...overrides };
}

// energyCapacity/metabolicCost are now Phenotype fields — see phenotype.test.ts (SPEC.md Addendum 15).

describe("gainPerUnit", () => {
  it("gives the maximum gain to a perfectly-matched specialist", () => {
    const params = DEFAULT_PARAMS;
    expect(gainPerUnit(0, 0, params)).toBeCloseTo(params.maxGain); // pure herbivore, fruit
    expect(gainPerUnit(1, 1, params)).toBeCloseTo(params.maxGain); // pure carnivore, meat
  });

  it("gives zero gain for the opposite food type", () => {
    const params = DEFAULT_PARAMS;
    expect(gainPerUnit(0, 1, params)).toBeCloseTo(0); // pure herbivore attempting meat
    expect(gainPerUnit(1, 0, params)).toBeCloseTo(0); // pure carnivore attempting fruit
  });

  it("penalizes a generalist below the average of the two specialists when specializationExponent > 1", () => {
    // This is the mechanism the whole diet axis depends on (see SPEC.md Axis 1 / Addendum 7) —
    // assert it directly rather than only observing it indirectly through population bimodality.
    const params = { ...DEFAULT_PARAMS, specializationExponent: 2 };
    const generalistGain = gainPerUnit(0.5, 0, params);
    const herbivoreGain = gainPerUnit(0, 0, params);
    const carnivoreGain = gainPerUnit(1, 1, params);
    expect(generalistGain).toBeLessThan((herbivoreGain + carnivoreGain) / 2);
  });
});

describe("isReadyToReproduce / reproduce", () => {
  it("is not ready below its reproThreshold fraction of capacity", () => {
    const genome = testGenome({ reproThreshold: 0.5, size: 1 });
    const params = DEFAULT_PARAMS;
    const capacity = derivePhenotype(genome, params).energyCapacity;
    const rng = new RNG(1);
    const creature = createCreature({
      id: 0,
      parentId: null,
      lineageId: 0,
      genome,
      x: 0,
      y: 0,
      energy: capacity * 0.49,
      birthTick: 0,
      rng,
    });
    expect(isReadyToReproduce(creature, params)).toBe(false);
  });

  it("is ready at or above its reproThreshold fraction of capacity", () => {
    const genome = testGenome({ reproThreshold: 0.5, size: 1 });
    const params = DEFAULT_PARAMS;
    const capacity = derivePhenotype(genome, params).energyCapacity;
    const rng = new RNG(1);
    const creature = createCreature({
      id: 0,
      parentId: null,
      lineageId: 0,
      genome,
      x: 0,
      y: 0,
      energy: capacity * 0.51,
      birthTick: 0,
      rng,
    });
    expect(isReadyToReproduce(creature, params)).toBe(true);
  });

  it("never gives a child enough starting energy to itself clear the minimum reproThreshold (0.4)", () => {
    // This is the exact invariant that failed during Phase 1: a windfall let offspring start
    // pre-loaded above threshold and cascade into runaway fission within a handful of ticks.
    const params = DEFAULT_PARAMS;
    const rng = new RNG(7);
    for (let trial = 0; trial < 200; trial++) {
      const genome = randomGenome(rng);
      const capacity = derivePhenotype(genome, params).energyCapacity;
      const parent = createCreature({
        id: trial,
        parentId: null,
        lineageId: 0,
        genome,
        x: 0,
        y: 0,
        energy: capacity * 10, // deliberately generous, simulating a windfall
        birthTick: 0,
        rng,
      });
      const children = reproduce(parent, rng, params, 0, () => trial + 1000);
      for (const child of children) {
        const childCapacity = derivePhenotype(child.genome, params).energyCapacity;
        const minPossibleThreshold = GENE_RANGES.reproThreshold[0];
        expect(child.energy).toBeLessThan(minPossibleThreshold * childCapacity);
      }
    }
  });

  it("never spends more energy on offspring than the parent actually has", () => {
    const params = DEFAULT_PARAMS;
    const rng = new RNG(3);
    const genome = randomGenome(rng);
    const parent = createCreature({
      id: 0,
      parentId: null,
      lineageId: 0,
      genome,
      x: 0,
      y: 0,
      energy: 0.001, // essentially nothing to spend
      birthTick: 0,
      rng,
    });
    reproduce(parent, rng, params, 0, () => 1);
    expect(parent.energy).toBeGreaterThanOrEqual(0);
  });

  it("produces more, cheaper offspring at low offspringInvestment and fewer, costlier ones at high investment", () => {
    const params = DEFAULT_PARAMS;
    const rngLow = new RNG(11);
    const lowInvestmentParent = createCreature({
      id: 0,
      parentId: null,
      lineageId: 0,
      genome: testGenome({ offspringInvestment: 0, size: 1 }),
      x: 0,
      y: 0,
      energy: 1000,
      birthTick: 0,
      rng: rngLow,
    });
    const rngHigh = new RNG(11);
    const highInvestmentParent = createCreature({
      id: 0,
      parentId: null,
      lineageId: 0,
      genome: testGenome({ offspringInvestment: 1, size: 1 }),
      x: 0,
      y: 0,
      energy: 1000,
      birthTick: 0,
      rng: rngHigh,
    });

    const cheapManyChildren = reproduce(lowInvestmentParent, rngLow, params, 0, (() => {
      let id = 0;
      return () => id++;
    })());
    const fewExpensiveChildren = reproduce(highInvestmentParent, rngHigh, params, 0, (() => {
      let id = 0;
      return () => id++;
    })());

    expect(cheapManyChildren.length).toBeGreaterThan(fewExpensiveChildren.length);
  });

  it("sets each child's nursingUntilTick from the parent's own nursingDuration gene", () => {
    const params = DEFAULT_PARAMS;
    const rng = new RNG(5);
    const parent = createCreature({
      id: 0,
      parentId: null,
      lineageId: 0,
      genome: testGenome({ nursingDuration: 250 }),
      x: 0,
      y: 0,
      energy: 1000,
      birthTick: 40,
      rng,
    });
    const children = reproduce(parent, rng, params, 40, () => 1);
    for (const child of children) {
      expect(child.nursingUntilTick).toBe(40 + 250);
      expect(child.parentId).toBe(0);
    }
  });
});
