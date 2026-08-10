import { describe, expect, it } from "vitest";
import { GENE_KEYS, type Genome, mutate, randomGenome, sampleTraits } from "./genome.ts";
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

describe("sampleTraits", () => {
  function withDietPref(value: number): Genome {
    const rng = new RNG(1);
    return { ...randomGenome(rng), dietPref: value };
  }

  it("reports zero std when every individual shares the same value for a gene", () => {
    const genomes = [withDietPref(0.5), withDietPref(0.5), withDietPref(0.5)];
    const sample = sampleTraits(genomes, 100);
    expect(sample.tick).toBe(100);
    expect(sample.mean.dietPref).toBeCloseTo(0.5);
    expect(sample.std.dietPref).toBeCloseTo(0);
  });

  it("computes the population std, not the sample (n-1) std", () => {
    // Two clusters at 0.2 and 0.8: mean 0.5, population variance = mean((x-0.5)^2) = 0.09, std = 0.3.
    const genomes = [withDietPref(0.2), withDietPref(0.2), withDietPref(0.8), withDietPref(0.8)];
    const sample = sampleTraits(genomes, 0);
    expect(sample.mean.dietPref).toBeCloseTo(0.5);
    expect(sample.std.dietPref).toBeCloseTo(0.3);
  });
});
