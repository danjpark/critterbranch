import type { Params } from "../params.ts";
import type { Genome } from "./genome.ts";
import { deriveMorphology, type MorphologyProfile } from "./morphology.ts";
import { clamp01, lerp } from "./util.ts";
import { passabilityFromSteepness } from "./terrain.ts";

/**
 * The genotype -> phenotype seam (SPEC.md Addendum 9, grown in Addendum 11 / Milestone 5 to cover
 * combat, and in Addendum 12 / Milestone 6 to carry the first real derived trait). Every other
 * field is still a pure pass-through — `aquaticAdaptation` is the first phenotype value that
 * actually changes what a creature can DO (see `movementEfficiency` below), not just where a value
 * originates.
 */
export interface Phenotype {
  speed: number;
  size: number;
  /** Pure pass-throughs, same treatment as speed/size — promoted from direct genome reads in
   * creature.ts/predation.ts to close the last "one seam, one still ad hoc" gap (SPEC.md
   * Addendum 15). */
  senseRadius: number;
  carnivory: number;
  /** SPEC.md Addendum 7's seam, relocated here in Addendum 11 rather than living as its own
   * genome-reading function in predation.ts — same reasoning Dan originally asked for: swapping
   * this for a real dedicated gene later shouldn't require touching any call site. */
  attackPower: number;
  evasionPower: number;
  /** 0 = land specialist, 1 = water specialist — SPEC.md Addendum 12 (Milestone 6). */
  aquaticAdaptation: number;
  /** Formerly standalone genome-reading functions in creature.ts (energyCapacity/metabolicCost) —
   * relocated here since both depend on nothing but phenotype + params, same category as
   * attackPower, not movementEfficiency (SPEC.md Addendum 15). */
  energyCapacity: number;
  metabolicCost: number;
  /** Five body-proportion dimensions for a future renderer — no rendering consumer yet. See
   * sim/morphology.ts (SPEC.md Addendum 17). */
  morphology: MorphologyProfile;
}

/**
 * attackPower scales with carnivory (SPEC.md Addendum 14) — a real specialist genuinely outfights
 * a barely-qualifying opportunist of the same size, giving combat success an actual incentive
 * gradient it didn't have before (it used to be pure size vs. speed, carnivory-blind). evasionPower
 * stays a pure pass-through of speed — being hunted doesn't depend on your OWN carnivory.
 */
export function derivePhenotype(genome: Genome, params: Params): Phenotype {
  const attackMultiplier = lerp(params.carnivoryAttackMultiplierMin, params.carnivoryAttackMultiplierMax, genome.carnivory);
  const base = {
    speed: genome.speed,
    size: genome.size,
    senseRadius: genome.senseRadius,
    carnivory: genome.carnivory,
    attackPower: genome.size * attackMultiplier,
    evasionPower: genome.speed,
    aquaticAdaptation: genome.aquaticAdaptation,
    energyCapacity: params.baseEnergyCapacity * genome.size,
    metabolicCost: params.baseCost * genome.size + params.moveCost * genome.speed * genome.speed * genome.size + params.senseCost * genome.senseRadius,
  };
  return { ...base, morphology: deriveMorphology(base) };
}

/** Raw terrain facts a mover needs — not a precomputed passability, since Addendum 12 makes
 * passability itself depend on who's asking (see movementEfficiency below). */
export interface MovementEnvironment {
  elevation: number;
  seaLevel: number;
  /** The cell's RECORDED passability (terrain.passability). Normally exactly what elevation alone
   * implies, but a built barrier drives it to near zero without touching elevation — see
   * movementEfficiency for why that difference is the whole point. */
  recordedPassability: number;
}

/**
 * Replaces the inline `genome.speed * passability` multiplication that used to live in
 * creature.ts's move step. For a land specialist (aquaticAdaptation=0) this is byte-identical to
 * the flat, genotype-blind terrain.passability every creature used to share (SPEC.md Addendum 9) —
 * the land and water steepness constants interpolate toward the aquatic-specialist extremes only as
 * aquaticAdaptation grows, per the "specialist beats generalist at either extreme" shape Addendum 12
 * mirrors from the diet axis: harsher on land, gentler in water, real mobility through real depth at
 * aquaticAdaptation=1. `terrain.passability` itself (used by taxonomy/rendering/fertility) is
 * untouched — this is a separate, personalized computation only movement reads.
 */
export function movementEfficiency(phenotype: Phenotype, environment: MovementEnvironment, params: Params): number {
  const relative = environment.elevation - environment.seaLevel;
  const landSteepness = lerp(params.passabilitySteepness, params.aquaticLandPassabilitySteepness, phenotype.aquaticAdaptation);
  const waterSteepness = lerp(params.waterPassabilitySteepness, params.aquaticWaterPassabilitySteepness, phenotype.aquaticAdaptation);
  const effectivePassability = passabilityFromSteepness(relative, landSteepness, waterSteepness);

  // An ARTIFICIAL obstruction is whatever gap exists between the passability actually recorded for
  // this cell and what its elevation alone implies. A built barrier (sim/intervention.ts's
  // barrierStamp) writes terrain.passability directly and never touches elevation, so before this
  // ratio existed the barrier was invisible to movement — measured directly: creatures seeded west
  // of a fully "impassable" wall were on both sides of it within a few thousand ticks, because the
  // move step recomputed passability from elevation and never consulted the field the wall wrote.
  // The wall still shaped the taxonomy's allopatric CLASSIFICATION, which reads that field, so a
  // player got splits labelled "caused by your barrier" from a barrier that stopped nobody.
  //
  // Expressed as a ratio rather than a floor so it stays genotype-aware (Addendum 12): a wall
  // blocks a strong swimmer exactly as much as it blocks a land specialist, but deep water still
  // doesn't, because there the two values agree and the ratio is 1.
  const naturalPassability = passabilityFromSteepness(relative, params.passabilitySteepness, params.waterPassabilitySteepness);
  const obstruction = naturalPassability > 1e-6 ? clamp01(environment.recordedPassability / naturalPassability) : 1;

  return phenotype.speed * effectivePassability * obstruction;
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
