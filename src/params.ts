/**
 * All tunable simulation constants live here. Every one of these is exposed in the UI
 * (Phase 7). Lives at the src root, not under ui/ or sim/ — both the pure sim core and the
 * render/ui layers depend on it, so it can't live inside either without inverting that
 * dependency.
 */

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

  // Axis 1 — diet (fruit vs. meat, see genome.ts's carnivory and sim/creature.ts's gainPerUnit).
  // Reinstated in SPEC.md Addendum 7 with the exact original specialization-curve math, just
  // fruit/meat labels instead of R/B.
  /** Shared gain ceiling both the fruit and meat curves reference — a pure specialist (carnivory
   * 0 or 1) eating its matching food type gets this much energy per unit/kill-fraction. */
  maxGain: number;
  /** Curve steepness: > 1 means a generalist (carnivory 0.5) does WORSE than the average of the
   * two specialists, which is what forces a population to actually split rather than sit at the
   * generalist optimum. */
  specializationExponent: number;
  intakeRate: number;
  /** How close (world units) a carnivory-leaning creature must end its move to a sensed prey
   * target to actually attempt an attack — see sim/predation.ts. */
  attackRange: number;
  /** Ticks a creature must wait after any attack attempt (hit or miss) before attempting
   * another. Without this, a predator that's caught up to prey gets a fresh roll every tick with
   * no cost for a miss, and even modest per-attempt odds compound to near-certain death within a
   * handful of ticks — a real population collapse this was tuned against, not a guess. */
  attackCooldownTicks: number;

  // Fruit trees (axis 2 — foraging strategy). The commuter-vs-camper trade-off needs bimodal food
  // geometry (SPEC.md: "a few large, rich, widely-separated patches and many small, poor, densely
  // scattered ones") — that geometry has nothing to do with the old R/B food-TYPE split it used to
  // share a home with, so it survives here even though the diet axis (Addendum 6) doesn't.
  //
  // First attempt placed both groups as independent uniform-random points, no explicit
  // clustering — that made patchBimodality=0 collapse cleanly, but empirically produced no
  // detectable foraging-axis pressure at all: a single point-source tree has no "footprint" the
  // way an old Gaussian patch did, so raw density alone (more poor trees than rich, same
  // placement distribution) wasn't enough of a geometric contrast for senseRadius/wanderPersistence
  // to pay off differently. Poor trees are now placed in explicit small clusters instead — a real
  // "dense local field to sweep" a camper can actually exploit. The cluster radius itself is what
  // interpolates with patchBimodality (tight cluster at 1, effectively map-wide/uncorrelated with
  // its cluster center at 0), which is what keeps the neutral-control collapse property: at
  // bimodality=0 a "cluster" is spread so wide it's statistically indistinguishable from
  // independent uniform placement.
  /** How many rich (high-capacity) trees the world starts with. */
  richTreeCount: number;
  /** How many poor (low-capacity) trees the world starts with, total across all clusters. */
  poorTreeCount: number;
  /** How many clusters poorTreeCount is split across. */
  poorClusterCount: number;
  /** How tight a cluster is at patchBimodality=1 — interpolated toward map-wide (uncorrelated) as
   * patchBimodality drops to 0. */
  poorClusterRadius: number;
  /** 0 = poor trees are just as capacious AND just as loosely placed as rich ones (axis
   * collapses); 1 = maximally different — same knob, same effect, as the old patchBimodality. */
  patchBimodality: number;
  /** Ticks a sapling takes to become a fruit-producing mature tree. */
  treeMaturityTicks: number;
  /** Max fruit a single rich tree's cell can hold — a poor tree's is this interpolated down by
   * patchBimodality (see initTrees). */
  treeFruitCapacity: number;
  /** Fraction of treeFruitCapacity a mature tree regrows per tick (same shape as the old uniform
   * regrowthRate, now applied per-tree instead of per-cell). */
  treeFruitRegrowthRate: number;
  /** Odds that eating a tree's fruit plants a new sapling nearby. */
  saplingChance: number;
  /** How far from the eaten tree a new sapling can land. */
  saplingSpreadRadius: number;
  /** Hard cap on total tree count — sapling creation stops once hit. Necessary because sapling
   * growth trivially outpaces crowding/base death at default rates (found via a real timeout: an
   * uncapped population blew stepTrees's O(trees)-per-tick cost past all reason within a few
   * thousand ticks) — this is the actual population-control backstop, crowding death is flavor
   * on top of it, not a substitute for it. */
  maxTreeCount: number;
  /** Radius used to count neighboring trees for crowdedness (self-thinning) death pressure. */
  crowdingRadius: number;
  /** A mature tree's death odds per crowding check with zero neighbors — natural turnover even in
   * sparse areas, not just a crowding penalty. */
  baseDeathChancePerCheck: number;
  /** Each neighboring tree within crowdingRadius multiplies death odds by (1 + this) — self-
   * thinning: a tree deep in a dense stand dies much faster than an isolated one. */
  crowdingDeathMultiplier: number;
  /** Crowding death is an O(neighbors) check per tree — batched onto this cadence (same pattern as
   * consumptionDecayIntervalTicks) rather than every tick for every tree. */
  treeCrowdingCheckIntervalTicks: number;

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
  /** Target fraction of a freshly generated map that ends up underwater — the actual per-map
   * seaLevel (an elevation-space value, lives on TerrainGrid as live, interveneable state once
   * generated) is chosen so THIS run hits it, rather than a fixed absolute elevation threshold
   * (found necessary empirically — see sim/terrain.ts's seaLevelForTargetWaterFraction and SPEC.md
   * Addendum 9). */
  seaLevelTargetWaterFraction: number;
  /** Passability falloff per unit of depth below sea level — deliberately much steeper than
   * passabilitySteepness so water reads as near-impassable by default (no creature can swim well
   * until Milestone 4). See SPEC.md Addendum 9. */
  waterPassabilitySteepness: number;

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
  /** A candidate split (see sim/taxonomy.ts's CandidateSplit) must be re-detected on this many
   * consecutive taxonomy passes before it becomes a real species — a single fluctuating pass
   * can't create a permanent species on its own. 1 = old one-pass-and-promote behavior. */
  speciationConfirmationPasses: number;
  /** A pending candidate that goes this many taxonomy passes without being re-detected is
   * dropped, rather than lingering forever waiting for a confirmation that may never come. */
  speciationCandidateTimeoutPasses: number;
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
  attackRange: 3,
  attackCooldownTicks: 20,

  // Initial values are a starting estimate, not yet play-tuned — expect these to move once trees
  // are actually watched growing/dying/spreading in a real run, the same way nursingRatePerTick
  // was tuned down from an initial 0.015 to 0.004 after observing its effect (SPEC.md Addendum 4).
  // Bumped well above a naive "same tree count as old patch count" guess: individual point-source
  // trees cover far less ground than the old Gaussian patches did (a patch's footprint spanned
  // dozens of cells; a tree occupies one), so matching the old system's spatial food coverage
  // needs many more of them — found empirically when the foraging-axis golden scenario stopped
  // producing any disruptive pressure at the original lower counts.
  richTreeCount: 4,
  poorTreeCount: 200,
  poorClusterCount: 25,
  poorClusterRadius: 4,
  patchBimodality: 1.0,
  treeMaturityTicks: 300,
  treeFruitCapacity: 3.0,
  treeFruitRegrowthRate: 0.05,
  saplingChance: 0.02,
  saplingSpreadRadius: 12,
  maxTreeCount: 350,
  crowdingRadius: 20,
  baseDeathChancePerCheck: 0.01,
  crowdingDeathMultiplier: 0.15,
  treeCrowdingCheckIntervalTicks: 20,

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
  seaLevelTargetWaterFraction: 0.18,
  waterPassabilitySteepness: 10.0,

  foundingPopulationSize: 100,

  genotypeColorDivergenceScale: 0.35,

  taxonomyIntervalTicks: 100,
  speciationThreshold: 0.28,
  minFounders: 5,
  founderCountThreshold: 12,
  allopatricPassabilityThreshold: 0.15,
  speciationConfirmationPasses: 2,
  speciationCandidateTimeoutPasses: 3,
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
  richTreeCount: number;
  poorTreeCount: number;
  poorClusterCount: number;
  poorClusterRadius: number;
  patchBimodality: number;
  treeMaturityTicks: number;
  treeFruitCapacity: number;
  treeFruitRegrowthRate: number;
  saplingChance: number;
  saplingSpreadRadius: number;
  maxTreeCount: number;
  crowdingRadius: number;
  baseDeathChancePerCheck: number;
  crowdingDeathMultiplier: number;
  treeCrowdingCheckIntervalTicks: number;
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
  attackRange: number;
  attackCooldownTicks: number;
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
  seaLevelTargetWaterFraction: number;
  waterPassabilitySteepness: number;
}

export interface TaxonomyParams {
  taxonomyIntervalTicks: number;
  speciationThreshold: number;
  minFounders: number;
  founderCountThreshold: number;
  allopatricPassabilityThreshold: number;
  speciationConfirmationPasses: number;
  speciationCandidateTimeoutPasses: number;
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
      richTreeCount: p.richTreeCount,
      poorTreeCount: p.poorTreeCount,
      poorClusterCount: p.poorClusterCount,
      poorClusterRadius: p.poorClusterRadius,
      patchBimodality: p.patchBimodality,
      treeMaturityTicks: p.treeMaturityTicks,
      treeFruitCapacity: p.treeFruitCapacity,
      treeFruitRegrowthRate: p.treeFruitRegrowthRate,
      saplingChance: p.saplingChance,
      saplingSpreadRadius: p.saplingSpreadRadius,
      maxTreeCount: p.maxTreeCount,
      crowdingRadius: p.crowdingRadius,
      baseDeathChancePerCheck: p.baseDeathChancePerCheck,
      crowdingDeathMultiplier: p.crowdingDeathMultiplier,
      treeCrowdingCheckIntervalTicks: p.treeCrowdingCheckIntervalTicks,
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
      attackRange: p.attackRange,
      attackCooldownTicks: p.attackCooldownTicks,
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
      seaLevelTargetWaterFraction: p.seaLevelTargetWaterFraction,
      waterPassabilitySteepness: p.waterPassabilitySteepness,
    },
    taxonomy: {
      taxonomyIntervalTicks: p.taxonomyIntervalTicks,
      speciationThreshold: p.speciationThreshold,
      minFounders: p.minFounders,
      founderCountThreshold: p.founderCountThreshold,
      allopatricPassabilityThreshold: p.allopatricPassabilityThreshold,
      speciationConfirmationPasses: p.speciationConfirmationPasses,
      speciationCandidateTimeoutPasses: p.speciationCandidateTimeoutPasses,
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
