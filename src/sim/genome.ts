import type { RNG } from "./rng.ts";
import { clamp } from "./util.ts";

export interface Genome {
  dietPref: number;
  speed: number;
  senseRadius: number;
  wanderPersistence: number;
  size: number;
  reproThreshold: number;
  offspringInvestment: number;
  mutationRate: number;
}

export const GENE_KEYS = [
  "dietPref",
  "speed",
  "senseRadius",
  "wanderPersistence",
  "size",
  "reproThreshold",
  "offspringInvestment",
  "mutationRate",
] as const satisfies readonly (keyof Genome)[];

export const GENE_RANGES: Record<keyof Genome, [number, number]> = {
  dietPref: [0, 1],
  speed: [0.2, 3.0],
  senseRadius: [0, 20],
  wanderPersistence: [0, 1],
  size: [0.5, 2.0],
  reproThreshold: [0.4, 0.95],
  offspringInvestment: [0, 1],
  mutationRate: [0.001, 0.2],
};

export function randomGenome(rng: RNG): Genome {
  const genome = {} as Genome;
  for (const key of GENE_KEYS) {
    const [min, max] = GENE_RANGES[key];
    genome[key] = rng.nextRange(min, max);
  }
  return genome;
}

/** Produces a mutated copy of a parent genome; sigma is scaled by the parent's own mutationRate gene. */
export function mutate(genome: Genome, rng: RNG): Genome {
  const child = { ...genome };
  const sigmaScale = genome.mutationRate;
  for (const key of GENE_KEYS) {
    const [min, max] = GENE_RANGES[key];
    const range = max - min;
    const delta = rng.gaussian() * sigmaScale * range;
    child[key] = clamp(genome[key] + delta, min, max);
  }
  return child;
}
