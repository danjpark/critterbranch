import type { RNG } from "./rng.ts";
import { clamp } from "./util.ts";

export interface Genome {
  speed: number;
  senseRadius: number;
  wanderPersistence: number;
  size: number;
  reproThreshold: number;
  offspringInvestment: number;
  /** Ticks a parent keeps actively feeding each child after birth, on top of the one-time birth
   * endowment offspringInvestment already controls — see sim/nursing.ts. 0 = no ongoing care,
   * matching every existing scenario/test's implicit assumption before this gene existed. */
  nursingDuration: number;
  mutationRate: number;
}

export const GENE_KEYS = [
  "speed",
  "senseRadius",
  "wanderPersistence",
  "size",
  "reproThreshold",
  "offspringInvestment",
  "nursingDuration",
  "mutationRate",
] as const satisfies readonly (keyof Genome)[];

export const GENE_RANGES: Record<keyof Genome, [number, number]> = {
  speed: [0.2, 3.0],
  senseRadius: [0, 20],
  wanderPersistence: [0, 1],
  size: [0.5, 2.0],
  reproThreshold: [0.4, 0.95],
  offspringInvestment: [0, 1],
  nursingDuration: [0, 600],
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

/** Weights used when combining per-gene distance into one scalar (genotype-color chroma, later taxonomy). */
export const GENE_WEIGHTS: Record<keyof Genome, number> = {
  speed: 1.0,
  senseRadius: 1.0,
  wanderPersistence: 0.6,
  size: 0.2,
  reproThreshold: 0.8,
  offspringInvestment: 1.0,
  // Deliberately low, matching mutationRate — adding a 9th gene to a metric calibrated around 8
  // dilutes every other gene's relative contribution (more weightSum in the denominator without a
  // proportional numerator signal until something actually selects on this gene), which broke the
  // barrier milestone and both axis-isolation tests at the previous 0.6 weight. Low weight keeps
  // nursingDuration real (it still counts toward divergence once something selects on it) without
  // re-diluting every threshold already tuned for the other eight genes.
  nursingDuration: 0.1,
  mutationRate: 0.1,
};

/** Weighted RMS distance between two genomes, each gene normalized by its own range. In [0, 1]. */
export function geneticDistance(a: Genome, b: Genome): number {
  let sumSq = 0;
  let weightSum = 0;
  for (const key of GENE_KEYS) {
    const [min, max] = GENE_RANGES[key];
    const range = max - min;
    const normDiff = (a[key] - b[key]) / range;
    const w = GENE_WEIGHTS[key];
    sumSq += w * normDiff * normDiff;
    weightSum += w;
  }
  return Math.sqrt(sumSq / weightSum);
}

/** Mean genome across a population — used as the founding-ancestor centroid for genotype chroma. */
export function genomeCentroid(genomes: Genome[]): Genome {
  const centroid = {} as Genome;
  for (const key of GENE_KEYS) {
    centroid[key] = genomes.reduce((sum, g) => sum + g[key], 0) / genomes.length;
  }
  return centroid;
}

/** One point in time for the trait time-series chart: population mean and std per gene. */
export interface TraitSample {
  tick: number;
  mean: Genome;
  std: Genome;
}

/** Caller's responsibility to only call this with a non-empty population — mean/std are undefined for zero creatures. */
export function sampleTraits(genomes: Genome[], tick: number): TraitSample {
  const mean = genomeCentroid(genomes);
  const std = {} as Genome;
  for (const key of GENE_KEYS) {
    const variance = genomes.reduce((sum, g) => sum + (g[key] - mean[key]) ** 2, 0) / genomes.length;
    std[key] = Math.sqrt(variance);
  }
  return { tick, mean, std };
}
