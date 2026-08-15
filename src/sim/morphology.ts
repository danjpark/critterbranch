import { GENE_RANGES } from "./genome.ts";
import { clamp01, lerp } from "./util.ts";

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
  /** 0 = no dorsal fin whatsoever, 1 = a prominent one. Driven by aquaticAdaptation, but through
   * an emergence ramp rather than a straight read (see `emergesAbove`): a mostly-terrestrial
   * lineage has literally no fin, not a permanent stub that merely grows. SPEC.md Addendum 25. */
  finProminence: number;
  /** 0 = no visible fangs, 1 = pronounced ones. Driven by carnivory, same emergence ramp. */
  fangProminence: number;
}

/**
 * The two EMERGENT dimensions (finProminence, fangProminence) exist to make evolution watchable:
 * the five proportional dimensions above always exist and merely change size, so a lineage
 * adapting to water just... gets a slightly longer tail. A feature that is genuinely absent and
 * then genuinely appears is what reads as "it grew something."
 *
 * Both thresholds are local constants, deliberately NOT wired to
 * params.carnivoryHuntingThreshold or anything else in Params. This module is params-free by
 * design (see MorphologySource's doc), and more importantly these describe BODY SHAPE, not
 * capability: a creature part-way to carnivory can reasonably show some dentition without being
 * able to hunt yet. Tying the two together would make a tuning change to a gameplay threshold
 * silently restyle every creature on screen.
 */
const FIN_EMERGENCE_THRESHOLD = 0.45;
const FANG_EMERGENCE_THRESHOLD = 0.35;

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

/** 0 at or below `threshold`, then ramping to 1 at value 1. The shape that makes a feature EMERGE:
 * exactly absent until the underlying investment is real, then growing continuously from nothing
 * rather than popping into existence at full size. */
function emergesAbove(value: number, threshold: number): number {
  if (value <= threshold) return 0;
  return clamp01((value - threshold) / (1 - threshold));
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
    finProminence: emergesAbove(phenotype.aquaticAdaptation, FIN_EMERGENCE_THRESHOLD),
    fangProminence: emergesAbove(phenotype.carnivory, FANG_EMERGENCE_THRESHOLD),
  };
}
