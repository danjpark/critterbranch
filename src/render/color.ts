import type { ColorOptions } from "../app/simRunner.ts";
import type { Creature } from "../sim/creature.ts";
import { GENE_RANGES, type Genome, geneticDistance } from "../sim/genome.ts";
import { clamp, clamp01, lerp } from "../sim/util.ts";

export type { ColorOptions };

function normalizeGene(gene: keyof Genome, value: number): number {
  const [min, max] = GENE_RANGES[gene];
  return (value - min) / (max - min);
}

/** Commuter (+) vs camper (-) position: high speed/persistence + low sense is a commuter. */
function foragingAxisPosition(genome: Genome): number {
  const nSpeed = normalizeGene("speed", genome.speed);
  const nSense = normalizeGene("senseRadius", genome.senseRadius);
  const nWander = normalizeGene("wanderPersistence", genome.wanderPersistence);
  return (nSpeed - nSense + nWander) / 2;
}

/** Cheap-and-many (0) vs expensive-and-few (1) life-history position — now also folding in
 * nursingDuration (ongoing parental care), the other half of the r/K trade-off alongside the
 * one-time birth investment offspringInvestment already captured. */
function lifeHistoryAxisPosition(genome: Genome): number {
  const nRepro = normalizeGene("reproThreshold", genome.reproThreshold);
  const nInvest = normalizeGene("offspringInvestment", genome.offspringInvestment);
  const nNursing = normalizeGene("nursingDuration", genome.nursingDuration);
  return (nRepro + nInvest + nNursing) / 3;
}

/**
 * Fill color for a creature: a pure function of its genome, per the spec's color-encoding rules.
 * Hue = diet x foraging-strategy angle. Chroma = divergence from the founding centroid.
 * Lightness = life-history position. Converted through OkLCh so equal gene distance reads as
 * (roughly) equal visual distance, unlike raw sRGB channels.
 */
export function genotypeColor(genome: Genome, foundingCentroid: Genome, options: ColorOptions): string {
  const dietAxis = normalizeGene("dietPref", genome.dietPref) * 2 - 1;
  const foragingAxis = foragingAxisPosition(genome);

  let hueRad = Math.atan2(foragingAxis, dietAxis);
  if (options.deuteranopiaSafe) {
    hueRad = restrictToBlueOrangeArc(hueRad);
  }

  const distance = geneticDistance(genome, foundingCentroid);
  const chroma = clamp(lerp(0.02, 0.2, distance / options.divergenceScale), 0.02, 0.2);

  const lightness = lerp(0.45, 0.75, lifeHistoryAxisPosition(genome));

  return okLchToCssRgb(lightness, chroma, hueRad);
}

const ORANGE_HUE_DEG = 50;
const BLUE_HUE_DEG = 250;

function restrictToBlueOrangeArc(hueRad: number): number {
  const t = (hueRad + Math.PI) / (2 * Math.PI); // [0, 1)
  const hueDeg = ORANGE_HUE_DEG + t * (BLUE_HUE_DEG - ORANGE_HUE_DEG);
  return (hueDeg * Math.PI) / 180;
}

/** OkLCh -> sRGB, following Björn Ottosson's reference OkLab matrices. */
function oklchToLinearSrgb(L: number, C: number, hueRad: number): [number, number, number] {
  const a = C * Math.cos(hueRad);
  const b = C * Math.sin(hueRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  return [r, g, bLin];
}

function gammaEncode(channel: number): number {
  const c = Math.max(0, channel);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function okLchToCssRgb(L: number, C: number, hueRad: number): string {
  const [rLin, gLin, bLin] = oklchToLinearSrgb(L, C, hueRad);
  const r = Math.round(clamp01(gammaEncode(rLin)) * 255);
  const g = Math.round(clamp01(gammaEncode(gLin)) * 255);
  const b = Math.round(clamp01(gammaEncode(bLin)) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export const FOOD_R_COLOR = "#d9503d";
export const FOOD_B_COLOR = "#3d7dd9";

// A creature's genome never changes after birth (mutation only produces a new genome for its
// children), and foundingCentroid is fixed for a SimState's lifetime — so its color is fixed
// too, aside from ColorOptions changing. Recomputing the full OkLCh matrix chain for every
// creature on every render frame is pure waste; cache by creature object identity (not id — ids
// are reused across a restart, but a restart also builds entirely new Creature objects) and only
// recompute when the options that actually affect the output change. Keyed by a WeakMap, so a
// dead creature's entry is reclaimed automatically once nothing else references it — same idiom
// as the terrain-layer cache in render/worldView.ts. Nothing outside this module needs to know
// this cache exists, let alone reset it.
const colorCache = new WeakMap<Creature, { optionsKey: string; color: string }>();

function colorOptionsKey(options: ColorOptions): string {
  return `${options.deuteranopiaSafe ? 1 : 0}:${options.divergenceScale}`;
}

export function cachedGenotypeColor(creature: Creature, foundingCentroid: Genome, options: ColorOptions): string {
  const optionsKey = colorOptionsKey(options);
  const cached = colorCache.get(creature);
  if (cached && cached.optionsKey === optionsKey) return cached.color;

  const color = genotypeColor(creature.genome, foundingCentroid, options);
  colorCache.set(creature, { optionsKey, color });
  return color;
}
