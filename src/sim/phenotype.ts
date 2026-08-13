import type { Genome } from "./genome.ts";

/**
 * Minimal genotype -> phenotype seam (SPEC.md Addendum 9, Milestone 3). Deliberately a pure
 * pass-through today — the point is the named function boundary, not any derived cleverness yet.
 * M4/M5/M6 grow this (a swimEfficiency trait, then the real genotype -> phenotype -> performance ->
 * behavior pipeline) without touching movementEfficiency's or its callers' signatures again.
 */
export interface Phenotype {
  speed: number;
  size: number;
}

export function derivePhenotype(genome: Genome): Phenotype {
  return { speed: genome.speed, size: genome.size };
}

/** What a cell offers a mover, independent of who's moving through it. */
export interface MovementEnvironment {
  passability: number;
}

/**
 * Replaces the inline `genome.speed * passability` multiplication that used to live in
 * creature.ts's move step. Behaviorally identical for land movement today; the payoff is that
 * "how fast do I actually move here" is now one named function of phenotype and environment,
 * ready for a future phenotype trait (e.g. swimEfficiency) to multiply in specifically for water.
 */
export function movementEfficiency(phenotype: Phenotype, environment: MovementEnvironment): number {
  return phenotype.speed * environment.passability;
}
