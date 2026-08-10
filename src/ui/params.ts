/** All tunable simulation constants live here. The UI (later phases) exposes every one of these. */

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
  patchBimodality: 0.7,
  richPatchCount: 4,
  poorPatchCount: 30,
  richPatchRadius: 8,
  poorPatchRadius: 2,
  richPatchCapacity: 0.15,
  poorPatchCapacity: 0.03,
  baseCapacity: 0.04,
  ambientFoodFraction: 0.05,
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
};
