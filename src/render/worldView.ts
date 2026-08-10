import type { Creature } from "../sim/creature.ts";
import type { SimState } from "../sim/sim.ts";
import { clamp01, lerp, torDelta } from "../sim/util.ts";
import type { Params } from "../ui/params.ts";
import { type ColorOptions, FOOD_B_COLOR, FOOD_R_COLOR, genotypeColor } from "./color.ts";

export interface RenderOptions {
  colorOptions: ColorOptions;
  selectedCreatureId: number | null;
}

export function renderWorld(ctx: CanvasRenderingContext2D, state: SimState, params: Params, options: RenderOptions): void {
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  const scaleX = canvasWidth / params.worldWidth;
  const scaleY = canvasHeight / params.worldHeight;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  drawTerrain(ctx, state, params, scaleX, scaleY);
  drawFood(ctx, state, params, scaleX, scaleY);
  drawCreatures(ctx, state, options, scaleX, scaleY);
}

/** Grayscale shaded relief with at most a faint fertility tint — terrain is background, never competes with creature hue. */
function drawTerrain(ctx: CanvasRenderingContext2D, state: SimState, params: Params, scaleX: number, scaleY: number): void {
  const { terrain } = state;
  const cellW = params.gridCellSize * scaleX;
  const cellH = params.gridCellSize * scaleY;
  const roughness = Math.max(params.terrainRoughness, 1e-6);

  for (let y = 0; y < terrain.rows; y++) {
    for (let x = 0; x < terrain.cols; x++) {
      const idx = y * terrain.cols + x;
      const elevationNorm = clamp01(terrain.elevation[idx] / roughness);
      const fertility = terrain.fertility[idx];

      const base = lerp(0.32, 0.82, elevationNorm);
      const tint = fertility * 0.05;
      const r = clamp01(base - tint * 0.7);
      const g = clamp01(base + tint);
      const b = clamp01(base - tint * 0.4);

      ctx.fillStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
      ctx.fillRect(x * cellW, y * cellH, cellW + 0.6, cellH + 0.6);
    }
  }
}

/** Food keeps a fixed, distinct visual language: small squares in fixed R/B colors, sized by fill fraction. */
function drawFood(ctx: CanvasRenderingContext2D, state: SimState, params: Params, scaleX: number, scaleY: number): void {
  const { world } = state;
  const cellW = params.gridCellSize * scaleX;
  const cellH = params.gridCellSize * scaleY;

  for (let y = 0; y < world.rows; y++) {
    for (let x = 0; x < world.cols; x++) {
      const idx = y * world.cols + x;
      const rAmt = world.r[idx];
      const bAmt = world.b[idx];
      if (rAmt < 1e-3 && bAmt < 1e-3) continue;

      const dominantIsR = rAmt >= bAmt;
      const amt = dominantIsR ? rAmt : bAmt;
      const capacity = dominantIsR ? world.capacityR[idx] : world.capacityB[idx];
      const frac = capacity > 0 ? clamp01(amt / capacity) : 0;
      if (frac < 0.02) continue;

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

  for (const creature of state.creatures) {
    const cx = creature.x * scaleX;
    const cy = creature.y * scaleY;
    const fill = genotypeColor(creature.genome, state.foundingCentroid, options.colorOptions);

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

  for (const creature of state.creatures) {
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
