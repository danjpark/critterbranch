import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../params.ts";
import { GENE_RANGES, type Genome } from "./genome.ts";
import { combatSuccessProbability, derivePhenotype, movementEfficiency, type Phenotype } from "./phenotype.ts";

function genome(overrides: Partial<Genome> = {}): Genome {
  return {
    carnivory: 0,
    speed: 1,
    senseRadius: 5,
    wanderPersistence: 0.5,
    size: 1,
    reproThreshold: 0.6,
    offspringInvestment: 0.2,
    nursingDuration: 0,
    mutationRate: 0.05,
    aquaticAdaptation: 0,
    ...overrides,
  };
}

function phenotype(overrides: Partial<Phenotype> = {}): Phenotype {
  return {
    speed: 1,
    size: 1,
    senseRadius: 5,
    carnivory: 0,
    attackPower: 1,
    evasionPower: 1,
    aquaticAdaptation: 0,
    energyCapacity: 20,
    metabolicCost: 0.1,
    morphology: { bodyScale: 1, limbLength: 0.5, jawSize: 0.5, earSize: 0.5, tailForm: 0, finProminence: 0, fangProminence: 0 },
    ...overrides,
  };
}

describe("derivePhenotype", () => {
  it("is a pure pass-through of speed and size", () => {
    const p = derivePhenotype(genome({ speed: 1.5, size: 0.8 }), DEFAULT_PARAMS);
    expect(p.speed).toBe(1.5);
    expect(p.size).toBe(0.8);
  });

  // SPEC.md Addendum 15 — senseRadius/carnivory promoted from direct genome reads in
  // creature.ts/predation.ts to phenotype pass-throughs, same treatment as speed/size.
  it("is a pure pass-through of senseRadius and carnivory", () => {
    const p = derivePhenotype(genome({ senseRadius: 12, carnivory: 0.6 }), DEFAULT_PARAMS);
    expect(p.senseRadius).toBe(12);
    expect(p.carnivory).toBe(0.6);
  });

  // SPEC.md Addendum 15 — relocated from creature.ts's standalone energyCapacity(genome, params).
  it("energyCapacity scales linearly with size", () => {
    const small = derivePhenotype(genome({ size: 1 }), DEFAULT_PARAMS).energyCapacity;
    const large = derivePhenotype(genome({ size: 2 }), DEFAULT_PARAMS).energyCapacity;
    expect(large).toBeCloseTo(small * 2);
  });

  // SPEC.md Addendum 15 — relocated from creature.ts's standalone metabolicCost(genome, params).
  describe("metabolicCost", () => {
    it("is strictly positive for every gene combination in range — no trait is free", () => {
      const cheapest = genome({ size: GENE_RANGES.size[0], speed: GENE_RANGES.speed[0], senseRadius: GENE_RANGES.senseRadius[0] });
      expect(derivePhenotype(cheapest, DEFAULT_PARAMS).metabolicCost).toBeGreaterThan(0);
    });

    it("grows quadratically with speed", () => {
      const params = DEFAULT_PARAMS;
      const slow = derivePhenotype(genome({ speed: 1, size: 1, senseRadius: 0 }), params).metabolicCost;
      const fast = derivePhenotype(genome({ speed: 2, size: 1, senseRadius: 0 }), params).metabolicCost;
      // moveCost*speed^2 term should roughly quadruple, not double, when speed doubles.
      const slowMoveCost = slow - params.baseCost * 1;
      const fastMoveCost = fast - params.baseCost * 1;
      expect(fastMoveCost / slowMoveCost).toBeCloseTo(4, 1);
    });
  });

  // SPEC.md Addendum 11 (Milestone 5): attackPower/evasionPower moved here from predation.ts's
  // standalone effectiveAttackPower/effectiveEvasionPower functions, same values, one seam.
  // evasionPower stays a pure pass-through of speed; attackPower no longer is (see below) — SPEC.md
  // Addendum 14 made it also scale with carnivory, so a carnivory=0 genome is the byte-identical
  // baseline (attackPower = size * carnivoryAttackMultiplierMin) rather than pure size.
  it("derives evasionPower from speed, and attackPower from size scaled by carnivoryAttackMultiplierMin at carnivory=0", () => {
    const p = derivePhenotype(genome({ speed: 2.3, size: 1.7, carnivory: 0 }), DEFAULT_PARAMS);
    expect(p.attackPower).toBeCloseTo(1.7 * DEFAULT_PARAMS.carnivoryAttackMultiplierMin);
    expect(p.evasionPower).toBe(2.3);
  });

  // SPEC.md Addendum 14 — the actual carnivory-fix mechanism: a real specialist genuinely
  // outfights a barely-qualifying opportunist of the same size, not just a size/speed contest.
  it("attackPower increases with carnivory, from carnivoryAttackMultiplierMin up to carnivoryAttackMultiplierMax", () => {
    const none = derivePhenotype(genome({ size: 1, carnivory: 0 }), DEFAULT_PARAMS);
    const half = derivePhenotype(genome({ size: 1, carnivory: 0.5 }), DEFAULT_PARAMS);
    const full = derivePhenotype(genome({ size: 1, carnivory: 1 }), DEFAULT_PARAMS);
    expect(none.attackPower).toBeCloseTo(DEFAULT_PARAMS.carnivoryAttackMultiplierMin);
    expect(full.attackPower).toBeCloseTo(DEFAULT_PARAMS.carnivoryAttackMultiplierMax);
    expect(half.attackPower).toBeGreaterThan(none.attackPower);
    expect(half.attackPower).toBeLessThan(full.attackPower);
  });

  // SPEC.md Addendum 12 (Milestone 6).
  it("passes aquaticAdaptation through unchanged", () => {
    expect(derivePhenotype(genome({ aquaticAdaptation: 0.73 }), DEFAULT_PARAMS).aquaticAdaptation).toBe(0.73);
  });

  // SPEC.md Addendum 17 — deriveMorphology's own unit tests live in morphology.test.ts; this just
  // confirms derivePhenotype actually wires it up rather than leaving morphology stale/default.
  it("computes morphology from the same genome, not a placeholder", () => {
    const p = derivePhenotype(genome({ speed: 3.0, carnivory: 1 }), DEFAULT_PARAMS);
    expect(p.morphology.limbLength).toBeGreaterThan(0.9);
    expect(p.morphology.jawSize).toBeCloseTo(1.0);
  });
});

describe("movementEfficiency", () => {
  it("scales linearly with phenotype speed on flat land at sea level", () => {
    const env = { elevation: 0, seaLevel: 0 };
    expect(movementEfficiency(phenotype({ speed: 2 }), env, DEFAULT_PARAMS)).toBeCloseTo(2);
    expect(movementEfficiency(phenotype({ speed: 1 }), env, DEFAULT_PARAMS)).toBeCloseTo(1);
  });

  it("a land specialist (aquaticAdaptation=0) is unaffected — byte-identical to the pre-M6 flat passabilitySteepness formula", () => {
    const p = phenotype({ speed: 1, aquaticAdaptation: 0 });
    const env = { elevation: 0.1, seaLevel: 0 };
    const expected = 1 * Math.max(0, 1 - DEFAULT_PARAMS.passabilitySteepness * 0.1);
    expect(movementEfficiency(p, env, DEFAULT_PARAMS)).toBeCloseTo(expected);
  });

  it("is zero on terrain steep enough to fully block a land specialist", () => {
    const p = phenotype({ speed: 5, aquaticAdaptation: 0 });
    // passability = 1 - passabilitySteepness * relative; needs relative >= 1/passabilitySteepness to floor at 0.
    const blockingElevation = 2 / DEFAULT_PARAMS.passabilitySteepness;
    expect(movementEfficiency(p, { elevation: blockingElevation, seaLevel: 0 }, DEFAULT_PARAMS)).toBe(0);
  });

  // SPEC.md Addendum 12 (Milestone 6) — the actual trade-off this milestone exists to create.
  it("a water specialist moves meaningfully worse on land than a land specialist does", () => {
    const env = { elevation: 0.15, seaLevel: 0 };
    const landSpecialist = movementEfficiency(phenotype({ aquaticAdaptation: 0 }), env, DEFAULT_PARAMS);
    const waterSpecialist = movementEfficiency(phenotype({ aquaticAdaptation: 1 }), env, DEFAULT_PARAMS);
    expect(waterSpecialist).toBeLessThan(landSpecialist);
  });

  it("a water specialist moves meaningfully better in deep water than a land specialist does", () => {
    const env = { elevation: -0.15, seaLevel: 0 }; // depth 0.15
    const landSpecialist = movementEfficiency(phenotype({ aquaticAdaptation: 0 }), env, DEFAULT_PARAMS);
    const waterSpecialist = movementEfficiency(phenotype({ aquaticAdaptation: 1 }), env, DEFAULT_PARAMS);
    expect(waterSpecialist).toBeGreaterThan(landSpecialist);
  });

  it("a full water specialist retains real mobility even at depth that fully blocks a land specialist", () => {
    const env = { elevation: -0.2, seaLevel: 0 }; // depth 0.2, well past where land specialists hit 0
    const landSpecialist = movementEfficiency(phenotype({ aquaticAdaptation: 0 }), env, DEFAULT_PARAMS);
    const waterSpecialist = movementEfficiency(phenotype({ aquaticAdaptation: 1 }), env, DEFAULT_PARAMS);
    expect(landSpecialist).toBe(0);
    expect(waterSpecialist).toBeGreaterThan(0.5);
  });

  it("interpolates smoothly for a partial specialist, not a hard gate", () => {
    const env = { elevation: -0.1, seaLevel: 0 };
    const none = movementEfficiency(phenotype({ aquaticAdaptation: 0 }), env, DEFAULT_PARAMS);
    const half = movementEfficiency(phenotype({ aquaticAdaptation: 0.5 }), env, DEFAULT_PARAMS);
    const full = movementEfficiency(phenotype({ aquaticAdaptation: 1 }), env, DEFAULT_PARAMS);
    expect(half).toBeGreaterThan(none);
    expect(full).toBeGreaterThan(half);
  });
});

describe("combatSuccessProbability", () => {
  it("gives an even matchup a 50% success probability", () => {
    expect(combatSuccessProbability(phenotype({ attackPower: 1 }), phenotype({ evasionPower: 1 }))).toBeCloseTo(0.5);
  });

  it("favors the attacker as attackPower grows relative to evasionPower", () => {
    const weak = combatSuccessProbability(phenotype({ attackPower: 1 }), phenotype({ evasionPower: 3 }));
    const strong = combatSuccessProbability(phenotype({ attackPower: 3 }), phenotype({ evasionPower: 1 }));
    expect(strong).toBeGreaterThan(weak);
  });

  it("stays within (0, 1) for any positive attack/evasion power", () => {
    const prob = combatSuccessProbability(phenotype({ attackPower: 100 }), phenotype({ evasionPower: 0.01 }));
    expect(prob).toBeGreaterThan(0);
    expect(prob).toBeLessThan(1);
  });
});
