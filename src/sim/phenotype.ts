import type { Genome } from "./genome.ts";

/**
 * The genotype -> phenotype seam (SPEC.md Addendum 9, grown in Addendum 11 / Milestone 5 to cover
 * combat as well as movement). Deliberately a pure pass-through today — genotype maps to phenotype
 * deterministically and 1:1, no environmental/developmental modifiers yet. The point of this
 * milestone is that EVERY "how good am I at X" computation reads through here now, not that any of
 * them compute anything new — M6 is where a real derived trait (e.g. swimEfficiency) actually
 * changes that.
 */
export interface Phenotype {
  speed: number;
  size: number;
  /** SPEC.md Addendum 7's seam, relocated here in Addendum 11 rather than living as its own
   * genome-reading function in predation.ts — same reasoning Dan originally asked for: swapping
   * this for a real dedicated gene later shouldn't require touching any call site. */
  attackPower: number;
  evasionPower: number;
}

export function derivePhenotype(genome: Genome): Phenotype {
  return { speed: genome.speed, size: genome.size, attackPower: genome.size, evasionPower: genome.speed };
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

/**
 * Standard contest-success function: the attacker's odds of a successful hit against the
 * defender's evasion, in [0, 1). Bounded away from exactly 1 whenever evasionPower > 0 (every
 * gene's range keeps size/speed strictly positive, so this never actually reaches 1 in practice).
 * Extracted from sim/predation.ts's resolvePredation (SPEC.md Addendum 11) — same pattern as
 * movementEfficiency: a pure function of phenotype, the actual dice roll stays at the behavior
 * layer in the caller.
 */
export function combatSuccessProbability(attacker: Phenotype, defender: Phenotype): number {
  return attacker.attackPower / (attacker.attackPower + defender.evasionPower);
}
