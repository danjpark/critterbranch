import type { Creature } from "../sim/creature.ts";
import type { SimState } from "../sim/sim.ts";
import type { TerrainGrid } from "../sim/terrain.ts";
import { clamp01, lerp, torDelta } from "../sim/util.ts";
import type { Params } from "../params.ts";
import { cachedGenotypeColor, type ColorOptions, FOOD_B_COLOR, FOOD_R_COLOR } from "./color.ts";

export interface RenderOptions {
  colorOptions: ColorOptions;
  selectedCreatureId: number | null;
  /** null = show every creature; otherwise only creatures whose species (lineageId) is in the
   * set are drawn — set by clicking a branch in the tree view ("show only this lineage"). */
  lineageFilter: Set<number> | null;
}

export function renderWorld(ctx: CanvasRenderingContext2D, state: SimState, params: Params, options: RenderOptions): void {
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  const scaleX = canvasWidth / params.worldWidth;
  const scaleY = canvasHeight / params.worldHeight;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.drawImage(getTerrainLayer(state.evolution.terrain, params, scaleX, scaleY, canvasWidth, canvasHeight), 0, 0);
  drawFood(ctx, state, params, scaleX, scaleY);
  drawCreatures(ctx, state, options, scaleX, scaleY);
}

// Terrain is static for a SimState's whole lifetime (until Phase 3 adds terrain-editing god-mode
// brushes), so redrawing all ~2,500 cells every frame is pure waste. Render it once per terrain
// grid + canvas size and blit the cached layer. Keyed by object identity via WeakMap, so a
// restart (which builds a new TerrainGrid) naturally misses the cache — no manual reset needed.
// If Phase 3 mutates a TerrainGrid in place, it must call invalidateTerrainCache(terrain) itself.
const terrainLayerCache = new WeakMap<TerrainGrid, { canvas: HTMLCanvasElement; width: number; height: number }>();

function getTerrainLayer(
  terrain: TerrainGrid,
  params: Params,
  scaleX: number,
  scaleY: number,
  canvasWidth: number,
  canvasHeight: number,
): HTMLCanvasElement {
  const cached = terrainLayerCache.get(terrain);
  if (cached && cached.width === canvasWidth && cached.height === canvasHeight) {
    return cached.canvas;
  }

  const layer = document.createElement("canvas");
  layer.width = canvasWidth;
  layer.height = canvasHeight;
  paintTerrain(layer.getContext("2d")!, terrain, params, scaleX, scaleY);
  terrainLayerCache.set(terrain, { canvas: layer, width: canvasWidth, height: canvasHeight });
  return layer;
}

export function invalidateTerrainCache(terrain: TerrainGrid): void {
  terrainLayerCache.delete(terrain);
}

/**
 * Grayscale shaded relief with at most a faint fertility tint — terrain is background, never
 * competes with creature hue. Low-passability cells also darken toward a rocky brown,
 * independent of elevation — a barrier stamp only ever touches passability (never elevation), so
 * without this a hand-drawn barrier would be completely invisible on the map.
 */
function paintTerrain(ctx: CanvasRenderingContext2D, terrain: TerrainGrid, params: Params, scaleX: number, scaleY: number): void {
  const cellW = params.gridCellSize * scaleX;
  const cellH = params.gridCellSize * scaleY;
  const roughness = Math.max(params.terrainRoughness, 1e-6);

  for (let y = 0; y < terrain.rows; y++) {
    for (let x = 0; x < terrain.cols; x++) {
      const idx = y * terrain.cols + x;
      const elevationNorm = clamp01(terrain.elevation[idx] / roughness);
      const fertility = terrain.fertility[idx];
      const blockedness = 1 - terrain.passability[idx];

      const base = lerp(0.32, 0.82, elevationNorm);
      const tint = fertility * 0.05;
      const darken = blockedness * 0.35;
      const r = clamp01(base - tint * 0.7 - darken * 0.1);
      const g = clamp01(base + tint - darken * 0.25);
      const b = clamp01(base - tint * 0.4 - darken * 0.3);

      ctx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
      ctx.fillRect(x * cellW, y * cellH, cellW + 0.6, cellH + 0.6);
    }
  }
}

/** Food keeps a fixed, distinct visual language: small squares in fixed R/B colors, sized by true abundance. */
function drawFood(ctx: CanvasRenderingContext2D, state: SimState, params: Params, scaleX: number, scaleY: number): void {
  const { world } = state.evolution;
  const cellW = params.gridCellSize * scaleX;
  const cellH = params.gridCellSize * scaleY;

  // Size against the richest a cell can ever be (a rich patch's peak), not against each cell's
  // own capacity. Sizing locally made a nearly-empty ambient cell (tiny capacity, but "full"
  // relative to itself) render identically to a brimming rich patch — food looked uniform
  // everywhere because every square was answering "how full is this spot" instead of "how much
  // food is actually here."
  const referenceCapacity = Math.max(params.richPatchCapacity, 1e-6);
  const minVisibleAmount = referenceCapacity * 0.02;

  for (let y = 0; y < world.rows; y++) {
    for (let x = 0; x < world.cols; x++) {
      const idx = y * world.cols + x;
      const rAmt = world.r[idx];
      const bAmt = world.b[idx];

      const dominantIsR = rAmt >= bAmt;
      const amt = dominantIsR ? rAmt : bAmt;
      if (amt < minVisibleAmount) continue;

      const frac = clamp01(amt / referenceCapacity);
      const size = lerp(cellW * 0.15, cellW * 0.7, frac);
      const cx = x * cellW + cellW / 2;
      const cy = y * cellH + cellH / 2;

      ctx.fillStyle = dominantIsR ? FOOD_R_COLOR : FOOD_B_COLOR;
      ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
    }
  }
}

function drawCreatures(ctx: CanvasRenderingContext2D, state: SimState, options: RenderOptions, scaleX: number, scaleY: number): void {
  const radius = Math.max(2, Math.min(scaleX, scaleY) * 1.1);

  for (const creature of state.evolution.creatures) {
    if (options.lineageFilter && !options.lineageFilter.has(creature.lineageId)) continue;

    const cx = creature.x * scaleX;
    const cy = creature.y * scaleY;
    const fill = cachedGenotypeColor(creature, state.evolution.foundingCentroid, options.colorOptions);

    // Thin dark outline underneath so light-lightness individuals don't vanish over pale ground.
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();

    if (options.selectedCreatureId === creature.id) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

/** Nearest creature to a canvas-space click, or null if nothing is close enough. */
export function findCreatureAt(
  state: SimState,
  params: Params,
  canvasX: number,
  canvasY: number,
  canvasWidth: number,
  canvasHeight: number,
): Creature | null {
  const scaleX = canvasWidth / params.worldWidth;
  const scaleY = canvasHeight / params.worldHeight;
  const worldX = canvasX / scaleX;
  const worldY = canvasY / scaleY;
  const pickRadius = 8 / Math.min(scaleX, scaleY);

  let closest: Creature | null = null;
  let closestDist = pickRadius;

  for (const creature of state.evolution.creatures) {
    const dx = torDelta(creature.x, worldX, params.worldWidth);
    const dy = torDelta(creature.y, worldY, params.worldHeight);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist) {
      closestDist = dist;
      closest = creature;
    }
  }

  return closest;
}
