import type { Creature } from "../sim/creature.ts";
import type { SimState } from "../sim/sim.ts";
import type { TerrainGrid } from "../sim/terrain.ts";
import { clamp01, lerp, torDelta } from "../sim/util.ts";
import type { Params } from "../params.ts";
import { cachedGenotypeColor, type ColorOptions, FRUIT_COLOR } from "./color.ts";
import { CONTOUR_LINE_COLOR, elevationBand, type ElevationBand, terrainCellColor } from "./terrainPalette.ts";

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
  drawFruit(ctx, state, params, scaleX, scaleY);
  drawCreatures(ctx, state, options, scaleX, scaleY);
}

// Terrain is static for most of a SimState's lifetime, so redrawing all ~2,500 cells every frame
// is pure waste. Render it once per (terrain grid, canvas size, terrain revision) and blit the
// cached layer. Keyed by object identity via WeakMap, so a restart (which builds a new
// TerrainGrid) naturally misses the cache — no manual reset needed. Staleness from an in-place
// terrain edit (a god-mode brush stroke, an in-progress barrier ramp) is detected the same
// automatic way, by comparing revision numbers — see TerrainGrid.revision in sim/terrain.ts.
// Nothing outside this module needs to know a cache exists here at all, let alone invalidate it.
const terrainLayerCache = new WeakMap<TerrainGrid, { canvas: HTMLCanvasElement; width: number; height: number; revision: number }>();

function getTerrainLayer(
  terrain: TerrainGrid,
  params: Params,
  scaleX: number,
  scaleY: number,
  canvasWidth: number,
  canvasHeight: number,
): HTMLCanvasElement {
  const cached = terrainLayerCache.get(terrain);
  if (cached && cached.width === canvasWidth && cached.height === canvasHeight && cached.revision === terrain.revision) {
    return cached.canvas;
  }

  const layer = document.createElement("canvas");
  layer.width = canvasWidth;
  layer.height = canvasHeight;
  paintTerrain(layer.getContext("2d")!, terrain, params, scaleX, scaleY);
  terrainLayerCache.set(terrain, { canvas: layer, width: canvasWidth, height: canvasHeight, revision: terrain.revision });
  return layer;
}

/**
 * Ink-on-parchment terrain in discrete elevation bands (lowland/hill/mountain) with contour lines
 * at band boundaries — a map-editor-style readable relief rather than a smooth gradient. Terrain
 * still stays background, never competing with creature hue (see render/terrainPalette.ts); a
 * barrier stamp's passability change (independent of elevation) still darkens a cell so a
 * hand-drawn barrier remains visible regardless of band.
 */
function paintTerrain(ctx: CanvasRenderingContext2D, terrain: TerrainGrid, params: Params, scaleX: number, scaleY: number): void {
  const cellW = params.gridCellSize * scaleX;
  const cellH = params.gridCellSize * scaleY;
  const roughness = Math.max(params.terrainRoughness, 1e-6);

  const bands = new Array<ElevationBand>(terrain.cols * terrain.rows);
  for (let y = 0; y < terrain.rows; y++) {
    for (let x = 0; x < terrain.cols; x++) {
      const idx = y * terrain.cols + x;
      bands[idx] = elevationBand(terrain.elevation[idx], roughness);
      ctx.fillStyle = terrainCellColor(terrain.elevation[idx], terrain.fertility[idx], terrain.passability[idx], roughness);
      ctx.fillRect(x * cellW, y * cellH, cellW + 0.6, cellH + 0.6);
    }
  }

  paintElevationContours(ctx, terrain, bands, cellW, cellH);
}

/** Thin ink lines wherever two adjacent cells fall into different elevation bands — the visual
 * cue that reads as "contour lines" on a hand-drawn map. Skips the wraparound seam (last column
 * to first, last row to first) so the torus edge doesn't draw a distracting full-width line. */
function paintElevationContours(ctx: CanvasRenderingContext2D, terrain: TerrainGrid, bands: ElevationBand[], cellW: number, cellH: number): void {
  ctx.strokeStyle = CONTOUR_LINE_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let y = 0; y < terrain.rows; y++) {
    for (let x = 0; x < terrain.cols; x++) {
      const idx = y * terrain.cols + x;
      const band = bands[idx];

      if (x < terrain.cols - 1 && bands[idx + 1] !== band) {
        const lineX = (x + 1) * cellW;
        ctx.moveTo(lineX, y * cellH);
        ctx.lineTo(lineX, (y + 1) * cellH);
      }
      if (y < terrain.rows - 1 && bands[idx + terrain.cols] !== band) {
        const lineY = (y + 1) * cellH;
        ctx.moveTo(x * cellW, lineY);
        ctx.lineTo((x + 1) * cellW, lineY);
      }
    }
  }

  ctx.stroke();
}

/** Fruit keeps a fixed, distinct visual language: small squares in a fixed color, sized by true abundance. */
function drawFruit(ctx: CanvasRenderingContext2D, state: SimState, params: Params, scaleX: number, scaleY: number): void {
  const { world } = state.evolution;
  const cellW = params.gridCellSize * scaleX;
  const cellH = params.gridCellSize * scaleY;

  // Size against a tree's max possible fruit, not each cell's own capacity — see the old R/B
  // version of this function for why sizing locally (relative to a cell's own tiny capacity)
  // makes near-empty cells read as visually "full."
  const referenceCapacity = Math.max(params.treeFruitCapacity, 1e-6);
  const minVisibleAmount = referenceCapacity * 0.02;

  ctx.fillStyle = FRUIT_COLOR;
  for (let y = 0; y < world.rows; y++) {
    for (let x = 0; x < world.cols; x++) {
      const idx = y * world.cols + x;
      const amt = world.fruit[idx];
      if (amt < minVisibleAmount) continue;

      const frac = clamp01(amt / referenceCapacity);
      const size = lerp(cellW * 0.15, cellW * 0.7, frac);
      const cx = x * cellW + cellW / 2;
      const cy = y * cellH + cellH / 2;

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
