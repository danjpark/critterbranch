import { createCreature } from "./creature.ts";
import { type Genome, randomGenome } from "./genome.ts";
import { derivePhenotype } from "./phenotype.ts";
import type { RNG } from "./rng.ts";
import type { EvolutionState } from "./sim.ts";
import { terrainDerivedFields } from "./terrain.ts";
import { cellIndexAt } from "./trees.ts";
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

export interface PlantTreeParams {
  x: number;
  y: number;
  radius: number;
  count: number;
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

/** Global, not location-scoped — sea level is a single scalar (see SPEC.md Addendum 9), so unlike
 * every other terrain tool this has no x/y/radius. */
export interface SeaLevelParams {
  strength: number;
}

export type Intervention =
  | { tick: number; tool: "raiseTerrain"; params: RaiseLowerTerrainParams }
  | { tick: number; tool: "lowerTerrain"; params: RaiseLowerTerrainParams }
  // Same params, sharper profile and a bigger vertical scale — see applyRaiseLowerTerrain's
  // `shape` argument. A separate tool rather than a modifier on the existing one because "gentle
  // hill" and "carve a wall" are different intents, not different amounts of the same intent.
  | { tick: number; tool: "raiseCliff"; params: RaiseLowerTerrainParams }
  | { tick: number; tool: "lowerCliff"; params: RaiseLowerTerrainParams }
  | { tick: number; tool: "barrierStamp"; params: BarrierStampParams }
  | { tick: number; tool: "plantTree"; params: PlantTreeParams }
  | { tick: number; tool: "drought"; params: DroughtBloomParams }
  | { tick: number; tool: "bloom"; params: DroughtBloomParams }
  | { tick: number; tool: "meteor"; params: MeteorParams }
  | { tick: number; tool: "seedFounders"; params: SeedFoundersParams }
  | { tick: number; tool: "raiseSeaLevel"; params: SeaLevelParams }
  | { tick: number; tool: "lowerSeaLevel"; params: SeaLevelParams };

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

/**
 * Every distinct grid cell within `worldRadius` of (worldX, worldY), with each cell's toroidal
 * distance from the centre.
 *
 * Each cell appears at most ONCE. A radius wider than half the world makes the wrapped scan reach
 * the same cell from both directions, and callers apply their effect per entry — so before the
 * dedupe below, raiseTerrain and meteor compounded their elevation delta on those cells, several
 * times over, from a single click. Reachable via an imported scenario (nothing validates a
 * RunConfig's worldWidth/gridCellSize against its brush radii) rather than the shipping brush
 * slider, whose 60-unit maximum stays well inside a default 200-unit world. The scan window is
 * also capped at one full turn of the torus so an absurd radius can't spin for a long time
 * rediscovering cells it already has.
 */
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
  const reachX = Math.min(Math.ceil(gridRadius), cols);
  const reachY = Math.min(Math.ceil(gridRadius), rows);
  const baseX = Math.floor(gx);
  const baseY = Math.floor(gy);

  const indices: number[] = [];
  const distances: number[] = [];
  const seen = new Set<number>();
  for (let dy = -reachY; dy <= reachY; dy++) {
    for (let dx = -reachX; dx <= reachX; dx++) {
      const cellX = wrap(baseX + dx, cols);
      const cellY = wrap(baseY + dy, rows);
      const idx = cellY * cols + cellX;
      if (seen.has(idx)) continue;
      const cdx = torDelta(cellX + 0.5, gx, cols);
      const cdy = torDelta(cellY + 0.5, gy, rows);
      const dist = Math.sqrt(cdx * cdx + cdy * cdy);
      if (dist <= gridRadius) {
        seen.add(idx);
        indices.push(idx);
        distances.push(dist);
      }
    }
  }
  return { indices, distances };
}

/**
 * Soft dome, tapering to essentially nothing by the brush's edge — a bump swelling under the
 * surface rather than a stamped block.
 *
 * sigma is a FRACTION of the radius. It used to be the radius itself, which put the falloff at
 * 61% of full strength at the very edge of the brush; since cells beyond the radius get nothing at
 * all, that 61% became a hard rim, and a brush stroke read as a cylinder with a flat top rather
 * than a hill. At radius/2.5 the edge is down to 4%, so the stroke blends into the terrain around
 * it and the discontinuity is invisible.
 */
const DOME_SIGMA_FRACTION = 2.5;

function domeFalloff(dist: number, gridRadius: number): number {
  const sigma = Math.max(gridRadius / DOME_SIGMA_FRACTION, 0.5);
  return Math.exp(-(dist * dist) / (2 * sigma * sigma));
}

/**
 * The old brush profile (sigma = the full radius), kept for meteor craters specifically. A crater
 * genuinely IS a broad, shallow-sided depression with a wide floor — the shape that read wrong as a
 * hand-placed hill reads right as an impact scar, and keeping it here means the meteor's behaviour
 * is unchanged by the brush rework (the extinction golden scenario depends on it).
 */
function craterFalloff(dist: number, gridRadius: number): number {
  const sigma = Math.max(gridRadius, 0.5);
  return Math.exp(-(dist * dist) / (2 * sigma * sigma));
}

/** Where a cliff's flat top ends and its edge begins, as a fraction of the brush radius. */
const CLIFF_PLATEAU_FRACTION = 0.65;

/**
 * Flat top, defined edge — a mesa. The deliberate counterpart to domeFalloff: sometimes you want a
 * wall or a plateau, and that was the only shape the old brush could make (by accident). The drop
 * uses smoothstep rather than a straight line so the rim still reads as carved rather than aliased
 * against the terrain grid.
 */
function cliffFalloff(dist: number, gridRadius: number): number {
  const plateau = gridRadius * CLIFF_PLATEAU_FRACTION;
  if (dist <= plateau) return 1;
  if (dist >= gridRadius) return 0;
  const t = (dist - plateau) / Math.max(gridRadius - plateau, 1e-6);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * How far one full-strength click moves elevation, as a multiple of terrainRoughness — the
 * parameter that sets how tall naturally generated terrain gets, so a brush stroke stays in
 * proportion to the world whatever that's tuned to. Same "scale the edit against the terrain's own
 * vertical scale" approach applySeaLevelChange already uses.
 *
 * Previously a click applied its raw strength directly: at the slider's maximum that was an
 * elevation change of 2.0 against a natural range of about 0.6 — one click moved the ground more
 * than three times the entire span between the map's lowest valley and highest peak. A dome is
 * deliberately gentle; a cliff is meant to be a real landform, so it gets considerably more.
 */
const DOME_STRENGTH_SCALE = 1.0;
const CLIFF_STRENGTH_SCALE = 3.0;

/** `shape` picks the profile a stroke carves: a soft dome that blends into its surroundings, or a
 * flat-topped cliff with a defined edge. Everything else about the two tools is identical. */
function applyRaiseLowerTerrain(state: EvolutionState, params: Params, p: RaiseLowerTerrainParams, sign: 1 | -1, shape: "dome" | "cliff"): void {
  const { indices, distances } = cellsWithinRadius(state.terrain.cols, state.terrain.rows, params.gridCellSize, p.x, p.y, p.radius);
  const gridRadius = p.radius / params.gridCellSize;
  const falloffOf = shape === "cliff" ? cliffFalloff : domeFalloff;
  const amplitude = p.strength * params.terrainRoughness * (shape === "cliff" ? CLIFF_STRENGTH_SCALE : DOME_STRENGTH_SCALE);

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const falloff = falloffOf(distances[i], gridRadius);
    // [-3, 3]: lowerTerrain must be able to carve new water below the old absolute-0 floor
    // (SPEC.md Addendum 9), not just flatten toward it.
    const newElevation = clamp(state.terrain.elevation[idx] + sign * amplitude * falloff, -3, 3);
    state.terrain.elevation[idx] = newElevation;
    const derived = terrainDerivedFields(newElevation, state.terrain.seaLevel, params);
    state.terrain.passability[idx] = derived.passability;
    state.terrain.fertility[idx] = derived.fertility;
  }
  state.terrain.revision++;
}

/** Raises/lowers the global waterline and recomputes passability/fertility for every cell — a
 * rare, deliberate player action (SPEC.md Addendum 9), not a per-tick cost. `strength` is the raw
 * UI brush value (same 0..~1 range every other terrain tool uses); scaled here against
 * terrainRoughness (elevation's own natural scale) so one click nudges the waterline noticeably
 * without flooding or draining the whole map in a single press. */
function applySeaLevelChange(state: EvolutionState, params: Params, p: SeaLevelParams, sign: 1 | -1): void {
  const delta = p.strength * params.terrainRoughness * 0.15;
  state.terrain.seaLevel = clamp(state.terrain.seaLevel + sign * delta, -3, 3);
  for (let i = 0; i < state.terrain.elevation.length; i++) {
    const derived = terrainDerivedFields(state.terrain.elevation[i], state.terrain.seaLevel, params);
    state.terrain.passability[i] = derived.passability;
    state.terrain.fertility[i] = derived.fertility;
  }
  state.terrain.revision++;
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
    state.terrain.revision++;
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

/** Plants `count` new, already-mature trees scattered within `radius` of (x, y) — the god-mode
 * replacement for the old two-food-type "drop food" brush (see SPEC.md Addendum 6). */
function applyPlantTree(state: EvolutionState, params: Params, rng: RNG, p: PlantTreeParams, currentTick: number): void {
  for (let i = 0; i < p.count; i++) {
    const angle = rng.nextRange(0, Math.PI * 2);
    const dist = rng.nextRange(0, p.radius);
    const x = wrap(p.x + Math.cos(angle) * dist, params.worldWidth);
    const y = wrap(p.y + Math.sin(angle) * dist, params.worldHeight);
    state.trees.trees.push({ id: state.trees.nextId++, x, y, plantedTick: currentTick, maturedTick: currentTick, capacity: params.treeFruitCapacity });
    const idx = cellIndexAt(x, y, params, state.world);
    // max, not assignment — same per-cell rule sim/trees.ts's stepTrees/initTrees use: a newly
    // planted tree can only ever raise a cell's fruit, never knock it back down.
    state.world.fruit[idx] = Math.max(state.world.fruit[idx], params.treeFruitCapacity * state.terrain.fertility[idx]);
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
    const falloff = craterFalloff(distances[i], gridRadius);
    // Elevation drop is a permanent scar (the crater); fertility is zeroed immediately and
    // recovers back toward whatever the post-crater elevation implies, over craterRecoveryTicks.
    state.terrain.elevation[idx] = clamp(state.terrain.elevation[idx] - 0.5 * falloff, -3, 3);
    fromValues.push(0);
    state.terrain.fertility[idx] = 0;
  }

  if (indices.length === 0) return;
  state.terrain.revision++;

  if (p.craterRecoveryTicks <= 0) {
    for (const idx of indices) {
      state.terrain.fertility[idx] = terrainDerivedFields(state.terrain.elevation[idx], state.terrain.seaLevel, params).fertility;
    }
    return;
  }

  state.activeTransitions.push({
    field: "fertility",
    cellIndices: indices,
    fromValues,
    toValues: indices.map((idx) => terrainDerivedFields(state.terrain.elevation[idx], state.terrain.seaLevel, params).fertility),
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
        energy: derivePhenotype(genome, params).energyCapacity * 0.5,
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
      applyRaiseLowerTerrain(state, params, intervention.params, 1, "dome");
      return;
    case "lowerTerrain":
      applyRaiseLowerTerrain(state, params, intervention.params, -1, "dome");
      return;
    case "raiseCliff":
      applyRaiseLowerTerrain(state, params, intervention.params, 1, "cliff");
      return;
    case "lowerCliff":
      applyRaiseLowerTerrain(state, params, intervention.params, -1, "cliff");
      return;
    case "barrierStamp":
      applyBarrierStamp(state, params, intervention.params, intervention.tick);
      return;
    case "plantTree":
      applyPlantTree(state, params, rng, intervention.params, intervention.tick);
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
    case "raiseSeaLevel":
      applySeaLevelChange(state, params, intervention.params, 1);
      return;
    case "lowerSeaLevel":
      applySeaLevelChange(state, params, intervention.params, -1);
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
  state.terrain.revision++;
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
