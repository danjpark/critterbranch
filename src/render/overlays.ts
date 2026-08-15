import type { SimState } from "../sim/sim.ts";
import { clamp01 } from "../sim/util.ts";
import { type ColorOptions, genotypeColor } from "./color.ts";

const RGB_PATTERN = /rgb\((\d+), (\d+), (\d+)\)/;

function parseRgb(css: string): [number, number, number] {
  const match = RGB_PATTERN.exec(css);
  if (!match) return [1, 1, 1];
  return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
}

// A cell with a species' full-strength trace sitting there forever would swamp the map in a
// permanent haze — cap what one cell can ever show as "fully contested" so the overlay reads as
// *recent* activity, not a lifetime total. Tuned by eye against the default intake/patch params.
const REFERENCE_CELL_TOTAL = 4;
const MAX_STRENGTH = 0.75;
const MIN_VISIBLE_STRENGTH = 0.08;

/**
 * Per-cell competition tint: how hard a cell is being fed on, and by whom. Parallel arrays over
 * the SAME cols x rows grid `ConsumptionGrid` and the terrain mesh both use, so a consumer can
 * index straight into it with a cell index and needs no coordinate mapping of its own.
 */
export interface CompetitionTint {
  cols: number;
  rows: number;
  /** Blended species color per cell, normalized 0-1, packed as [r, g, b] triples. */
  rgb: Float32Array;
  /** 0 = untouched (leave the cell alone), up to MAX_STRENGTH = heavily fed on. */
  strength: Float32Array;
}

/**
 * Per grid cell, food consumed recently, colored by which species ate it — a contested cell blends
 * its contributors' colors. SPEC.md calls this "the one to build": it turns indirect resource
 * competition, which is otherwise invisible, into something on screen, and lets you watch two
 * lineages stop fighting once they've specialized apart.
 *
 * Pure data, no drawing. It used to paint rectangles straight onto a 2D canvas context, which the
 * World view stopped having when it became a Three.js scene (SPEC.md Addendum 21) — the overlay
 * was left disconnected rather than silently deleted. Returning per-cell values instead lets
 * render3d/terrainMesh.ts blend them into the terrain's own vertex colors, so the heatmap now
 * drapes over real elevation and orbits with the camera for free, rather than being a flat
 * rectangle grid pasted over the viewport.
 *
 * Returns null when nothing has been eaten yet, so callers can skip the work entirely.
 */
export function computeCompetitionTint(state: SimState, colorOptions: ColorOptions): CompetitionTint | null {
  const { consumptionGrid } = state.observations;
  if (consumptionGrid.bySpecies.size === 0) return null;

  const contributors: { cells: Float64Array; r: number; g: number; b: number }[] = [];
  for (const [speciesId, cells] of consumptionGrid.bySpecies) {
    const species = state.observations.taxonomy.species.get(speciesId);
    if (!species) continue;
    const [r, g, b] = parseRgb(genotypeColor(species.centroid, state.evolution.foundingCentroid, colorOptions));
    contributors.push({ cells, r, g, b });
  }
  if (contributors.length === 0) return null;

  const { cols, rows } = consumptionGrid;
  const cellCount = cols * rows;
  const rgb = new Float32Array(cellCount * 3);
  const strength = new Float32Array(cellCount);

  for (let idx = 0; idx < cellCount; idx++) {
    let total = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const contributor of contributors) {
      const amount = contributor.cells[idx];
      if (amount <= 0) continue;
      total += amount;
      r += contributor.r * amount;
      g += contributor.g * amount;
      b += contributor.b * amount;
    }
    if (total <= 0) continue;

    rgb[idx * 3] = r / total;
    rgb[idx * 3 + 1] = g / total;
    rgb[idx * 3 + 2] = b / total;
    strength[idx] = MIN_VISIBLE_STRENGTH + clamp01(total / REFERENCE_CELL_TOTAL) * (MAX_STRENGTH - MIN_VISIBLE_STRENGTH);
  }

  return { cols, rows, rgb, strength };
}
