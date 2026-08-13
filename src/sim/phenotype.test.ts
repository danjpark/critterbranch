import { describe, expect, it } from "vitest";
import type { Genome } from "./genome.ts";
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
    ...overrides,
  };
}

function phenotype(overrides: Partial<Phenotype> = {}): Phenotype {
  return { speed: 1, size: 1, attackPower: 1, evasionPower: 1, ...overrides };
}

describe("derivePhenotype", () => {
  it("is a pure pass-through of speed and size", () => {
    const p = derivePhenotype(genome({ speed: 1.5, size: 0.8 }));
    expect(p.speed).toBe(1.5);
    expect(p.size).toBe(0.8);
  });

  // SPEC.md Addendum 11 (Milestone 5): attackPower/evasionPower moved here from predation.ts's
  // standalone effectiveAttackPower/effectiveEvasionPower functions, same values, one seam.
  it("derives attackPower from size and evasionPower from speed", () => {
    const p = derivePhenotype(genome({ speed: 2.3, size: 1.7 }));
    expect(p.attackPower).toBe(1.7);
    expect(p.evasionPower).toBe(2.3);
  });
});

describe("movementEfficiency", () => {
  it("scales linearly with both phenotype speed and environment passability", () => {
    expect(movementEfficiency(phenotype({ speed: 2 }), { passability: 0.5 })).toBeCloseTo(1);
    expect(movementEfficiency(phenotype({ speed: 2 }), { passability: 1 })).toBeCloseTo(2);
  });

  it("is zero when passability is zero (impassable terrain), regardless of speed", () => {
    expect(movementEfficiency(phenotype({ speed: 5 }), { passability: 0 })).toBe(0);
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
