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
  /** Energy/tick a parent transfers to each child still within its nursingDuration window (see
   * sim/nursing.ts) — a fixed biological rate, not itself evolvable; nursingDuration is the
   * evolvable "how long" axis. Comparable in scale to the base metabolic costs below, so ongoing
   * care is a genuine ongoing cost to the parent, not a rounding error. */
  nursingRatePerTick: number;

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
  nursingRatePerTick: 0.004,

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

/**
 * Domain-grouped view of Params, for anything that presents or serializes params to something
 * outside the sim's own hot path — RunConfig (see sim/runConfig.ts) and the future Phase 7
 * parameter UI. Internal sim/render functions keep taking flat Params: they were all written
 * against individual fields, splitting every one of those call sites into "which subdomain does
 * this function need" would be a much larger, higher-risk mechanical rewrite for no behavioral
 * benefit (see groupParams/flattenParams below — the conversion is lossless either direction).
 * This is the boundary-layer grouping the plan calls for, without churning the sim's internals.
 */
export interface WorldParams {
  worldWidth: number;
  worldHeight: number;
  gridCellSize: number;
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
  regrowthCyclePeriod: number;
  regrowthCycleAmplitude: number;
}

export interface EvolutionParams {
  baseCost: number;
  moveCost: number;
  senseCost: number;
  baseEnergyCapacity: number;
  maxAge: number;
  maxGain: number;
  specializationExponent: number;
  intakeRate: number;
  foundingPopulationSize: number;
}

export interface ReproductionParams {
  offspringEnergyFractionMin: number;
  offspringEnergyFractionMax: number;
  maxOffspringCount: number;
  nursingRatePerTick: number;
}

export interface TerrainParams {
  terrainHillCount: number;
  terrainRoughness: number;
  passabilitySteepness: number;
  fertilitySteepness: number;
}

export interface TaxonomyParams {
  taxonomyIntervalTicks: number;
  speciationThreshold: number;
  minFounders: number;
  founderCountThreshold: number;
  allopatricPassabilityThreshold: number;
}

export interface ObservationParams {
  geneFlowWindowTicks: number;
  consumptionRetentionPerTick: number;
  consumptionDecayIntervalTicks: number;
}

export interface RenderParams {
  genotypeColorDivergenceScale: number;
}

export interface RunParams {
  world: WorldParams;
  evolution: EvolutionParams;
  reproduction: ReproductionParams;
  terrain: TerrainParams;
  taxonomy: TaxonomyParams;
  observation: ObservationParams;
  render: RenderParams;
}

export function groupParams(p: Params): RunParams {
  return {
    world: {
      worldWidth: p.worldWidth,
      worldHeight: p.worldHeight,
      gridCellSize: p.gridCellSize,
      foodMode: p.foodMode,
      patchBimodality: p.patchBimodality,
      richPatchCount: p.richPatchCount,
      poorPatchCount: p.poorPatchCount,
      richPatchRadius: p.richPatchRadius,
      poorPatchRadius: p.poorPatchRadius,
      richPatchCapacity: p.richPatchCapacity,
      poorPatchCapacity: p.poorPatchCapacity,
      baseCapacity: p.baseCapacity,
      ambientFoodFraction: p.ambientFoodFraction,
      regrowthRate: p.regrowthRate,
      regrowthCyclePeriod: p.regrowthCyclePeriod,
      regrowthCycleAmplitude: p.regrowthCycleAmplitude,
    },
    evolution: {
      baseCost: p.baseCost,
      moveCost: p.moveCost,
      senseCost: p.senseCost,
      baseEnergyCapacity: p.baseEnergyCapacity,
      maxAge: p.maxAge,
      maxGain: p.maxGain,
      specializationExponent: p.specializationExponent,
      intakeRate: p.intakeRate,
      foundingPopulationSize: p.foundingPopulationSize,
    },
    reproduction: {
      offspringEnergyFractionMin: p.offspringEnergyFractionMin,
      offspringEnergyFractionMax: p.offspringEnergyFractionMax,
      maxOffspringCount: p.maxOffspringCount,
      nursingRatePerTick: p.nursingRatePerTick,
    },
    terrain: {
      terrainHillCount: p.terrainHillCount,
      terrainRoughness: p.terrainRoughness,
      passabilitySteepness: p.passabilitySteepness,
      fertilitySteepness: p.fertilitySteepness,
    },
    taxonomy: {
      taxonomyIntervalTicks: p.taxonomyIntervalTicks,
      speciationThreshold: p.speciationThreshold,
      minFounders: p.minFounders,
      founderCountThreshold: p.founderCountThreshold,
      allopatricPassabilityThreshold: p.allopatricPassabilityThreshold,
    },
    observation: {
      geneFlowWindowTicks: p.geneFlowWindowTicks,
      consumptionRetentionPerTick: p.consumptionRetentionPerTick,
      consumptionDecayIntervalTicks: p.consumptionDecayIntervalTicks,
    },
    render: {
      genotypeColorDivergenceScale: p.genotypeColorDivergenceScale,
    },
  };
}

export function flattenParams(r: RunParams): Params {
  return {
    ...r.world,
    ...r.evolution,
    ...r.reproduction,
    ...r.terrain,
    ...r.taxonomy,
    ...r.observation,
    ...r.render,
  };
}

/** Merges a partial (possibly incomplete, possibly from an older build missing a since-added
 * field) grouped params object onto a complete set of defaults, one subdomain at a time — a
 * shallow `{...defaults, ...partial}` would replace an entire subgroup wholesale the moment the
 * input has *any* key in it, silently dropping every field in that subgroup the input didn't
 * happen to include. */
export function mergeRunParams(defaults: RunParams, partial: Partial<Record<keyof RunParams, unknown>>): RunParams {
  return {
    world: { ...defaults.world, ...(partial.world as Partial<WorldParams> | undefined) },
    evolution: { ...defaults.evolution, ...(partial.evolution as Partial<EvolutionParams> | undefined) },
    reproduction: { ...defaults.reproduction, ...(partial.reproduction as Partial<ReproductionParams> | undefined) },
    terrain: { ...defaults.terrain, ...(partial.terrain as Partial<TerrainParams> | undefined) },
    taxonomy: { ...defaults.taxonomy, ...(partial.taxonomy as Partial<TaxonomyParams> | undefined) },
    observation: { ...defaults.observation, ...(partial.observation as Partial<ObservationParams> | undefined) },
    render: { ...defaults.render, ...(partial.render as Partial<RenderParams> | undefined) },
  };
}

export const DEFAULT_RUN_PARAMS: RunParams = groupParams(DEFAULT_PARAMS);
