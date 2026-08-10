import { describe, expect, it } from "vitest";
import { GENE_KEYS, mutate, randomGenome } from "./genome.ts";
import { RNG } from "./rng.ts";

describe("mutate", () => {
  it("produces no drift on the trait genes when mutationRate is 0", () => {
    // mutationRate itself is clamped to its declared range [0.001, 0.2] like any other gene
    // (0 is not a valid evolved value), but a 0 sigma-scale must leave every OTHER gene untouched.
    const rng = new RNG(99);
    const genome = { ...randomGenome(rng), mutationRate: 0 };
    const child = mutate(genome, rng);
    for (const key of GENE_KEYS) {
      if (key === "mutationRate") continue;
      expect(child[key]).toBe(genome[key]);
    }
    expect(child.mutationRate).toBe(0.001);
  });

  it("keeps every gene within its declared range", () => {
    const rng = new RNG(1234);
    let genome = randomGenome(rng);
    for (let i = 0; i < 500; i++) {
      genome = mutate({ ...genome, mutationRate: 0.2 }, rng);
    }
    expect(genome.dietPref).toBeGreaterThanOrEqual(0);
    expect(genome.dietPref).toBeLessThanOrEqual(1);
    expect(genome.speed).toBeGreaterThanOrEqual(0.2);
    expect(genome.speed).toBeLessThanOrEqual(3.0);
  });
});
