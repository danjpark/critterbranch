import { describe, expect, it } from "vitest";
import type { Genome } from "./genome.ts";
import { derivePhenotype, movementEfficiency } from "./phenotype.ts";

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

describe("derivePhenotype", () => {
  it("is a pure pass-through of speed and size", () => {
    expect(derivePhenotype(genome({ speed: 1.5, size: 0.8 }))).toEqual({ speed: 1.5, size: 0.8 });
  });
});

describe("movementEfficiency", () => {
  it("scales linearly with both phenotype speed and environment passability", () => {
    expect(movementEfficiency({ speed: 2, size: 1 }, { passability: 0.5 })).toBeCloseTo(1);
    expect(movementEfficiency({ speed: 2, size: 1 }, { passability: 1 })).toBeCloseTo(2);
  });

  it("is zero when passability is zero (impassable terrain), regardless of speed", () => {
    expect(movementEfficiency({ speed: 5, size: 1 }, { passability: 0 })).toBe(0);
  });
});
