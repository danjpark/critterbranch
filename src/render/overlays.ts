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
/** One species' presence on the heatmap: the colour its cells are tinted, and how much it has
 * eaten in total. */
export interface CompetitionContributor {
  speciesId: number;
  cells: Float64Array;
  /** The species' genotype colour as a CSS string — the same value the map tints with, so a legend
   * built from this can't drift from what's actually on screen. */
  css: string;
  r: number;
  g: number;
  b: number;
  /** Decayed food total across the whole grid — how much of the heatmap this species accounts for. */
  total: number;
}

/**
 * Which species are currently visible on the competition heatmap, in what colour, ranked by how
 * much of it they account for. The single owner of the species -> colour mapping for this overlay:
 * computeCompetitionTint blends with it, and the legend labels with it, so the two cannot disagree
 * about what colour a species is.
 */
export function competitionContributors(state: SimState, colorOptions: ColorOptions): CompetitionContributor[] {
  const { consumptionGrid } = state.observations;
  const contributors: CompetitionContributor[] = [];
  for (const [speciesId, cells] of consumptionGrid.bySpecies) {
    const species = state.observations.taxonomy.species.get(speciesId);
    if (!species) continue;
    const css = genotypeColor(species.centroid, state.evolution.foundingCentroid, colorOptions);
    const [r, g, b] = parseRgb(css);
    let total = 0;
    for (let i = 0; i < cells.length; i++) total += cells[i];
    if (total <= 0) continue;
    contributors.push({ speciesId, cells, css, r, g, b, total });
  }
  // Biggest eater first, ties by species id so the order is stable frame to frame rather than
  // reshuffling as decay nudges near-equal totals past each other.
  contributors.sort((a, b) => b.total - a.total || a.speciesId - b.speciesId);
  return contributors;
}

export function computeCompetitionTint(state: SimState, colorOptions: ColorOptions): CompetitionTint | null {
  const { consumptionGrid } = state.observations;
  if (consumptionGrid.bySpecies.size === 0) return null;

  const contributors = competitionContributors(state, colorOptions);
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
