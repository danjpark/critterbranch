import { GENE_RANGES } from "./genome.ts";
import { lerp } from "./util.ts";

/**
 * Five body-proportion dimensions, each derived from an existing phenotype/genome signal that
 * already has a real gameplay meaning — SPEC.md Addendum 17. No new genes, no rendering consumer
 * yet (that's Item 5). Nested on Phenotype itself (`phenotype.morphology`) rather than a parallel
 * seam, same "one entry point" pattern derivePhenotype already established.
 */
export interface MorphologyProfile {
  /** Overall silhouette scale everything else reads relative to. Pure pass-through of phenotype.size. */
  bodyScale: number;
  /** 0 = stocky/short-limbed, 1 = leggy/cursorial. Driven by speed. */
  limbLength: number;
  /** 0 = small/unobtrusive jaw, 1 = large/predatory jaw. Driven by carnivory. */
  jawSize: number;
  /** 0 = small ears, 1 = large ears. Driven by senseRadius. */
  earSize: number;
  /** 0 = short land tail, 1 = long/paddle-like aquatic tail. Driven by aquaticAdaptation. Closes
   * the gap Addendum 12 explicitly deferred: aquaticAdaptation had no visual encoding until now. */
  tailForm: number;
}

const MIN_LIMB_LENGTH = 0.2;
const MAX_LIMB_LENGTH = 1.0;
const MIN_JAW_SIZE = 0.15;
const MAX_JAW_SIZE = 1.0;
const MIN_EAR_SIZE = 0.2;
const MAX_EAR_SIZE = 1.0;

/** Normalizes a raw gene value into [0, 1] against its own GENE_RANGES entry — same "each gene
 * normalized by its own range" convention genome.ts's geneticDistance already uses. */
function normalized(value: number, range: readonly [number, number]): number {
  const [min, max] = range;
  return (value - min) / (max - min);
}

/** Takes only the five pass-through fields it actually reads, not the full Phenotype — lets
 * derivePhenotype (phenotype.ts) call this from the still-being-built base object before
 * `morphology` itself exists on it, without a cast. No params argument either: every constant
 * here is local (see the module doc comment), unlike derivePhenotype's attackPower which reads
 * params.carnivoryAttackMultiplierMin/Max. */
export interface MorphologySource {
  speed: number;
  size: number;
  carnivory: number;
  senseRadius: number;
  aquaticAdaptation: number;
}

export function deriveMorphology(phenotype: MorphologySource): MorphologyProfile {
  const speedT = normalized(phenotype.speed, GENE_RANGES.speed);
  const senseT = normalized(phenotype.senseRadius, GENE_RANGES.senseRadius);

  return {
    bodyScale: phenotype.size,
    limbLength: lerp(MIN_LIMB_LENGTH, MAX_LIMB_LENGTH, speedT),
    // carnivory and aquaticAdaptation are already normalized [0, 1] genes (see GENE_RANGES) — no
    // extra normalization step needed, unlike speed/senseRadius above.
    jawSize: lerp(MIN_JAW_SIZE, MAX_JAW_SIZE, phenotype.carnivory),
    earSize: lerp(MIN_EAR_SIZE, MAX_EAR_SIZE, senseT),
    tailForm: phenotype.aquaticAdaptation,
  };
}
