import { createCreature, energyCapacity } from "./creature.ts";
import { type Genome, randomGenome } from "./genome.ts";
import type { RNG } from "./rng.ts";
import type { EvolutionState } from "./sim.ts";
import { clamp, clamp01, lerp, torDelta, wrap } from "./util.ts";
import type { Params } from "../params.ts";

export interface RaiseLowerTerrainParams {
  x: number;
  y: number;
  radius: number;
  strength: number;
}

export interface BarrierStampParams {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  targetPassability: number;
  /** 0 = instant. >0 = passability ramps linearly from its current value to targetPassability over this many ticks. */
  formationTicks: number;
}

export interface DropFoodParams {
  x: number;
  y: number;
  radius: number;
  foodType: 0 | 1;
  density: number;
}

export interface DroughtBloomParams {
  x: number;
  y: number;
  radius: number;
  /** <1 for drought, >1 for bloom. Multiplies the region's regrowth rate for durationTicks. */
  multiplier: number;
  durationTicks: number;
}

export interface MeteorParams {
  x: number;
  y: number;
  radius: number;
  craterRecoveryTicks: number;
}

export interface SeedFoundersParams {
  x: number;
  y: number;
  spreadRadius: number;
  count: number;
  genome: Genome | "random";
}

export type Intervention =
  | { tick: number; tool: "raiseTerrain"; params: RaiseLowerTerrainParams }
  | { tick: number; tool: "lowerTerrain"; params: RaiseLowerTerrainParams }
  | { tick: number; tool: "barrierStamp"; params: BarrierStampParams }
  | { tick: number; tool: "dropFood"; params: DropFoodParams }
  | { tick: number; tool: "drought"; params: DroughtBloomParams }
  | { tick: number; tool: "bloom"; params: DroughtBloomParams }
  | { tick: number; tool: "meteor"; params: MeteorParams }
  | { tick: number; tool: "seedFounders"; params: SeedFoundersParams };

/** A smooth per-cell ramp from one terrain field value to another, processed once per tick. */
export interface FieldTransition {
  field: "passability" | "fertility";
  cellIndices: number[];
  fromValues: number[];
  toValues: number[];
  startTick: number;
  durationTicks: number;
}

/** A flat regrowth-rate multiplier over a region, active until endTick. */
export interface RegrowthOverride {
  cellIndices: number[];
  multiplier: number;
  startTick: number;
  endTick: number;
}

function cellsWithinRadius(
  cols: number,
  rows: number,
  gridCellSize: number,
  worldX: number,
  worldY: number,
  worldRadius: number,
): { indices: number[]; distances: number[] } {
  const gx = worldX / gridCellSize;
  const gy = worldY / gridCellSize;
  const gridRadius = Math.max(worldRadius / gridCellSize, 0.5);
  const reach = Math.ceil(gridRadius);
  const baseX = Math.floor(gx);
  const baseY = Math.floor(gy);

  const indices: number[] = [];
  const distances: number[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const cellX = wrap(baseX + dx, cols);
      const cellY = wrap(baseY + dy, rows);
      const cdx = torDelta(cellX + 0.5, gx, cols);
      const cdy = torDelta(cellY + 0.5, gy, rows);
      const dist = Math.sqrt(cdx * cdx + cdy * cdy);
      if (dist <= gridRadius) {
        indices.push(cellY * cols + cellX);
        distances.push(dist);
      }
    }
  }
  return { indices, distances };
}

function gaussianFalloff(dist: number, gridRadius: number): number {
  const sigma = Math.max(gridRadius, 0.5);
  return Math.exp(-(dist * dist) / (2 * sigma * sigma));
}

function applyRaiseLowerTerrain(state: EvolutionState, params: Params, p: RaiseLowerTerrainParams, sign: 1 | -1): void {
  const { indices, distances } = cellsWithinRadius(state.terrain.cols, state.terrain.rows, params.gridCellSize, p.x, p.y, p.radius);
  const gridRadius = p.radius / params.gridCellSize;

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const falloff = gaussianFalloff(distances[i], gridRadius);
    const newElevation = clamp(state.terrain.elevation[idx] + sign * p.strength * falloff, 0, 3);
    state.terrain.elevation[idx] = newElevation;
    state.terrain.passability[idx] = clamp01(1 - params.passabilitySteepness * newElevation);
    state.terrain.fertility[idx] = clamp01(1 - params.fertilitySteepness * newElevation);
  }
}

function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-9) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSq, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function applyBarrierStamp(state: EvolutionState, params: Params, p: BarrierStampParams, currentTick: number): void {
  const halfWidth = p.width / 2;
  const cellIndices: number[] = [];
  const fromValues: number[] = [];

  for (let gy = 0; gy < state.terrain.rows; gy++) {
    for (let gx = 0; gx < state.terrain.cols; gx++) {
      const worldX = (gx + 0.5) * params.gridCellSize;
      const worldY = (gy + 0.5) * params.gridCellSize;
      if (pointToSegmentDistance(worldX, worldY, p.x1, p.y1, p.x2, p.y2) > halfWidth) continue;
      const idx = gy * state.terrain.cols + gx;
      cellIndices.push(idx);
      fromValues.push(state.terrain.passability[idx]);
    }
  }

  if (p.formationTicks <= 0) {
    for (const idx of cellIndices) state.terrain.passability[idx] = p.targetPassability;
    return;
  }

  state.activeTransitions.push({
    field: "passability",
    cellIndices,
    fromValues,
    toValues: cellIndices.map(() => p.targetPassability),
    startTick: currentTick,
    durationTicks: p.formationTicks,
  });
}

function applyDropFood(state: EvolutionState, params: Params, p: DropFoodParams): void {
  const { indices, distances } = cellsWithinRadius(state.world.cols, state.world.rows, params.gridCellSize, p.x, p.y, p.radius);
  const gridRadius = p.radius / params.gridCellSize;
  const capacityArr = p.foodType === 0 ? state.world.capacityR : state.world.capacityB;
  const currentArr = p.foodType === 0 ? state.world.r : state.world.b;

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const added = p.density * gaussianFalloff(distances[i], gridRadius);
    capacityArr[idx] += added;
    currentArr[idx] = Math.min(capacityArr[idx], currentArr[idx] + added);
  }
}

function applyDroughtBloom(state: EvolutionState, params: Params, p: DroughtBloomParams, currentTick: number): void {
  const { indices } = cellsWithinRadius(state.world.cols, state.world.rows, params.gridCellSize, p.x, p.y, p.radius);
  state.activeRegrowthOverrides.push({
    cellIndices: indices,
    multiplier: p.multiplier,
    startTick: currentTick,
    endTick: currentTick + p.durationTicks,
  });
}

function applyMeteor(state: EvolutionState, params: Params, p: MeteorParams, currentTick: number): void {
  state.creatures = state.creatures.filter((c) => {
    const dx = torDelta(c.x, p.x, params.worldWidth);
    const dy = torDelta(c.y, p.y, params.worldHeight);
    return Math.sqrt(dx * dx + dy * dy) > p.radius;
  });

  const { indices, distances } = cellsWithinRadius(state.terrain.cols, state.terrain.rows, params.gridCellSize, p.x, p.y, p.radius);
  const gridRadius = p.radius / params.gridCellSize;
  const fromValues: number[] = [];

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const falloff = gaussianFalloff(distances[i], gridRadius);
    // Elevation drop is a permanent scar (the crater); fertility is zeroed immediately and
    // recovers back toward whatever the post-crater elevation implies, over craterRecoveryTicks.
    state.terrain.elevation[idx] = clamp(state.terrain.elevation[idx] - 0.5 * falloff, 0, 3);
    fromValues.push(0);
    state.terrain.fertility[idx] = 0;
  }

  if (indices.length === 0) return;

  if (p.craterRecoveryTicks <= 0) {
    for (const idx of indices) {
      state.terrain.fertility[idx] = clamp01(1 - params.fertilitySteepness * state.terrain.elevation[idx]);
    }
    return;
  }

  state.activeTransitions.push({
    field: "fertility",
    cellIndices: indices,
    fromValues,
    toValues: indices.map((idx) => clamp01(1 - params.fertilitySteepness * state.terrain.elevation[idx])),
    startTick: currentTick,
    durationTicks: p.craterRecoveryTicks,
  });
}

function applySeedFounders(state: EvolutionState, params: Params, rng: RNG, p: SeedFoundersParams, currentTick: number): void {
  for (let i = 0; i < p.count; i++) {
    const genome = p.genome === "random" ? randomGenome(rng) : { ...p.genome };
    const x = wrap(p.x + rng.nextRange(-p.spreadRadius, p.spreadRadius), params.worldWidth);
    const y = wrap(p.y + rng.nextRange(-p.spreadRadius, p.spreadRadius), params.worldHeight);
    state.creatures.push(
      createCreature({
        id: state.nextId++,
        parentId: null,
        // Seeded founders start their own lineage marker just like the original founders (0);
        // Phase 4's taxonomy assigns real lineage identity from genome clustering, not this field.
        lineageId: 0,
        genome,
        x,
        y,
        energy: energyCapacity(genome, params) * 0.5,
        birthTick: currentTick,
        rng,
      }),
    );
  }
}

/** Applies one intervention's immediate effect, mutating state. Ongoing effects (ramps, overrides) register into state's active-effect lists, processed each tick by processActiveEffects. */
export function applyIntervention(state: EvolutionState, rng: RNG, params: Params, intervention: Intervention): void {
  switch (intervention.tool) {
    case "raiseTerrain":
      applyRaiseLowerTerrain(state, params, intervention.params, 1);
      return;
    case "lowerTerrain":
      applyRaiseLowerTerrain(state, params, intervention.params, -1);
      return;
    case "barrierStamp":
      applyBarrierStamp(state, params, intervention.params, intervention.tick);
      return;
    case "dropFood":
      applyDropFood(state, params, intervention.params);
      return;
    case "drought":
    case "bloom":
      applyDroughtBloom(state, params, intervention.params, intervention.tick);
      return;
    case "meteor":
      applyMeteor(state, params, intervention.params, intervention.tick);
      return;
    case "seedFounders":
      applySeedFounders(state, params, rng, intervention.params, intervention.tick);
      return;
  }
}

/** Advances all active field transitions (barrier formation, crater recovery) by one tick. */
export function processActiveTransitions(state: EvolutionState, currentTick: number): void {
  if (state.activeTransitions.length === 0) return;

  state.activeTransitions = state.activeTransitions.filter((transition) => {
    const progress = clamp01((currentTick - transition.startTick) / transition.durationTicks);
    const targetArray = transition.field === "passability" ? state.terrain.passability : state.terrain.fertility;
    for (let i = 0; i < transition.cellIndices.length; i++) {
      targetArray[transition.cellIndices[i]] = lerp(transition.fromValues[i], transition.toValues[i], progress);
    }
    return progress < 1;
  });
}

/** Recomputes world.regrowthModifier from whichever drought/bloom overrides are still active. */
export function processRegrowthOverrides(state: EvolutionState, currentTick: number): void {
  state.activeRegrowthOverrides = state.activeRegrowthOverrides.filter((o) => currentTick < o.endTick);
  state.world.regrowthModifier.fill(1);
  for (const override of state.activeRegrowthOverrides) {
    for (const idx of override.cellIndices) {
      state.world.regrowthModifier[idx] = override.multiplier;
    }
  }
}
