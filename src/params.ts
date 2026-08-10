/**
 * All tunable simulation constants live here. Every one of these is exposed in the UI
 * (Phase 7). Lives at the src root, not under ui/ or sim/ — both the pure sim core and the
 * render/ui layers depend on it, so it can't live inside either without inverting that
 * dependency.
 */

export type FoodMode = "patchy" | "gradient";

export interface Params {
  // World geometry
  worldWidth: number;
  worldHeight: number;
  gridCellSize: number;

  // Metabolism (see genome.ts for the per-creature gene ranges these combine with)
  baseCost: number;
  moveCost: number;
  senseCost: number;
  baseEnergyCapacity: number;
  maxAge: number;

  // Axis 1 — diet
  maxGain: number;
  specializationExponent: number;
  intakeRate: number;

  // Food / terrain patches (axis 2 — foraging strategy)
  foodMode: FoodMode;
  patchBimodality: number;
  richPatchCount: number;
  poorPatchCount: number;
  richPatchRadius: number;
  poorPatchRadius: number;
  richPatchCapacity: number;
  poorPatchCapacity: number;
  baseCapacity: number;
  ambientFoodFraction: number;
  regrowthRate: number;

  // Axis 3 — life history / temporal food cycling
  regrowthCyclePeriod: number;
  regrowthCycleAmplitude: number;
  /** Each child's birth energy is (fraction of ITS OWN capacity), interpolated across this
   * range by the parent's offspringInvestment gene. The max must stay below the lowest
   * possible reproThreshold (0.4) so birth alone can never trigger an immediate re-split. */
  offspringEnergyFractionMin: number;
  offspringEnergyFractionMax: number;
  maxOffspringCount: number;

  // Terrain
  terrainHillCount: number;
  terrainRoughness: number;
  passabilitySteepness: number;
  fertilitySteepness: number;

  // Founding population (single-founder default; multi-founder config arrives with the UI phase)
  foundingPopulationSize: number;

  // Rendering — genotype-color chroma (see render/color.ts)
  genotypeColorDivergenceScale: number;

  // Taxonomy (see sim/taxonomy.ts) — species is a threshold you chose, not a fact; these are
  // meant to be live-adjustable, not tuned once and forgotten.
  /** How often (in ticks) each species is checked for a split or extinction. */
  taxonomyIntervalTicks: number;
  /** Weighted genetic distance (see genome.ts geneticDistance, range ~[0,1]) beyond which two
   * sub-clusters within a species count as diverged enough to split. */
  speciationThreshold: number;
  /** Minimum members a candidate sub-cluster needs on each side of a split for it to count —
   * below this, it's noise, not a real founding population. */
  minFounders: number;
  /** A split with fewer than this many founders on the smaller side, no single dominant gene,
   * and no spatial barrier is tagged as a founder-effect (drift) split rather than sympatric. */
  founderCountThreshold: number;
  /** Terrain passability below this, sampled along the line between two diverging clusters'
   * centroids, counts as "a barrier was between them" — i.e. allopatric. */
  allopatricPassabilityThreshold: number;
  /** World is split into two regions (x < worldWidth/2 vs x >= worldWidth/2) for the gene-flow
   * meter; migration events are bucketed into windows this many ticks wide. */
  geneFlowWindowTicks: number;

  /** Competition heatmap (see sim/consumption.ts, render/overlays.ts): fraction of each grid
   * cell's per-species consumption total retained per tick. An exponential-decay approximation
   * of "food consumed in the last N ticks" — half-life = ln(0.5) / ln(retention), ~46 ticks at
   * the default 0.985. */
  consumptionRetentionPerTick: number;
  /** Decay is an O(cells) pass per tracked species — too expensive to run every tick against a
   * population-sized simulation. Batched into one pass every this many ticks instead, using
   * retention^interval so the effective half-life is unchanged; recording (the cheap O(1)
   * per-feeding-event part) still happens every tick. */
  consumptionDecayIntervalTicks: number;
}

export const DEFAULT_PARAMS: Params = {
  worldWidth: 200,
  worldHeight: 200,
  gridCellSize: 4,

  baseCost: 0.01,
  moveCost: 0.01,
  senseCost: 0.002,
  baseEnergyCapacity: 20,
  maxAge: 2000,

  maxGain: 2,
  specializationExponent: 2,
  intakeRate: 0.5,

  foodMode: "patchy",
  patchBimodality: 1.0,
  richPatchCount: 4,
  poorPatchCount: 10,
  richPatchRadius: 3,
  poorPatchRadius: 1.5,
  richPatchCapacity: 1.2,
  poorPatchCapacity: 0.6,
  baseCapacity: 0.3,
  ambientFoodFraction: 0,
  regrowthRate: 0.05,

  regrowthCyclePeriod: 2000,
  regrowthCycleAmplitude: 0,
  offspringEnergyFractionMin: 0.08,
  offspringEnergyFractionMax: 0.32,
  maxOffspringCount: 4,

  terrainHillCount: 5,
  terrainRoughness: 0.3,
  passabilitySteepness: 1.5,
  fertilitySteepness: 0.6,

  foundingPopulationSize: 100,

  genotypeColorDivergenceScale: 0.35,

  taxonomyIntervalTicks: 100,
  speciationThreshold: 0.28,
  minFounders: 5,
  founderCountThreshold: 12,
  allopatricPassabilityThreshold: 0.15,
  geneFlowWindowTicks: 200,

  consumptionRetentionPerTick: 0.985,
  consumptionDecayIntervalTicks: 10,
};
