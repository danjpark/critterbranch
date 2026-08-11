import type { SimState } from "../sim/sim.ts";
import { clamp01 } from "../sim/util.ts";
import type { Params } from "../params.ts";
import { type ColorOptions, genotypeColor } from "./color.ts";

const RGB_PATTERN = /rgb\((\d+), (\d+), (\d+)\)/;

function parseRgb(css: string): [number, number, number] {
  const match = RGB_PATTERN.exec(css);
  if (!match) return [255, 255, 255];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// A cell with a species' full-strength trace sitting there forever would swamp the map in a
// permanent haze — cap what one cell can ever show as "fully contested" so the overlay reads as
// *recent* activity, not a lifetime total. Tuned by eye against the default intake/patch params.
const REFERENCE_CELL_TOTAL = 4;
const MAX_OPACITY = 0.75;
const MIN_VISIBLE_OPACITY = 0.08;

/**
 * Toggleable overlay on the world view: per grid cell, food consumed recently, colored by which
 * species ate it — a contested cell blends its contributors' colors. SPEC.md calls this "the one
 * to build": it turns indirect resource competition, which is otherwise invisible, into something
 * on screen, and lets you watch two lineages stop fighting once they've specialized apart.
 */
export function renderCompetitionHeatmap(ctx: CanvasRenderingContext2D, state: SimState, params: Params, colorOptions: ColorOptions): void {
  const { consumptionGrid } = state.observations;
  if (consumptionGrid.bySpecies.size === 0) return;

  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  const scaleX = canvasWidth / params.worldWidth;
  const scaleY = canvasHeight / params.worldHeight;
  const cellW = params.gridCellSize * scaleX;
  const cellH = params.gridCellSize * scaleY;

  const speciesEntries = Array.from(consumptionGrid.bySpecies.entries())
    .map(([speciesId, cells]) => {
      const species = state.observations.taxonomy.species.get(speciesId);
      if (!species) return null;
      const [r, g, b] = parseRgb(genotypeColor(species.centroid, state.evolution.foundingCentroid, colorOptions));
      return { cells, r, g, b };
    })
    .filter((e): e is { cells: Float64Array; r: number; g: number; b: number } => e !== null);

  if (speciesEntries.length === 0) return;

  const cols = consumptionGrid.cols;
  const rows = consumptionGrid.rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      let total = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (const entry of speciesEntries) {
        const amount = entry.cells[idx];
        if (amount <= 0) continue;
        total += amount;
        r += entry.r * amount;
        g += entry.g * amount;
        b += entry.b * amount;
      }
      if (total <= 0) continue;

      const opacity = MIN_VISIBLE_OPACITY + clamp01(total / REFERENCE_CELL_TOTAL) * (MAX_OPACITY - MIN_VISIBLE_OPACITY);
      ctx.fillStyle = `rgba(${Math.round(r / total)}, ${Math.round(g / total)}, ${Math.round(b / total)}, ${opacity})`;
      ctx.fillRect(x * cellW, y * cellH, cellW + 0.6, cellH + 0.6);
    }
  }
}
