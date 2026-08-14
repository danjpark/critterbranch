import { clamp01, lerp } from "../sim/util.ts";
import { elevationBand, type ElevationBand } from "../sim/terrain.ts";

// Re-exported for this module's own existing callers (worldView.ts, terrainPalette.test.ts) —
// the actual definition moved to sim/terrain.ts (SPEC.md Addendum 15), since it's pure domain
// classification game/observability needs too, not a rendering concern.
export { elevationBand, type ElevationBand };

const MOUNTAIN_THRESHOLD = 0.7;

/** Ink-on-parchment base tones per band — warm and desaturated so creature/food colors (which use
 * the full hue wheel) stay the visually "loud" layer; terrain is background, never competes with
 * creature hue (same intent the previous grayscale relief had, just restyled). */
const BAND_BASE_COLOR: Record<ElevationBand, [number, number, number]> = {
  water: [0.42, 0.52, 0.56],
  lowland: [0.86, 0.79, 0.62],
  hill: [0.7, 0.58, 0.4],
  mountain: [0.45, 0.36, 0.28],
};

/** A lighter "snow-cap" tone the mountain band blends toward as elevation approaches the map's
 * peak, so that band isn't visually flat — a simple within-band continuous highlight rather than
 * true local-maxima detection, which would need a neighbor scan for not much extra payoff here. */
const PEAK_HIGHLIGHT_COLOR: [number, number, number] = [0.82, 0.8, 0.78];

export const CONTOUR_LINE_COLOR = "rgba(59, 46, 31, 0.55)";

/**
 * The fill color for one terrain cell: a discrete elevation band (the map-editor-style "zones"),
 * plus fertility/passability still subtly modulating shade within that band so information a
 * band alone would hide isn't lost — a barrier stamp only ever touches passability (never
 * elevation), so without this a hand-drawn barrier would be invisible on the map. Water darkens
 * with depth via the same passability signal (deep water has near-zero passability), so a strait
 * reads visibly shallower than open ocean without a separate depth lookup.
 */
export function terrainCellColor(elevation: number, seaLevel: number, fertility: number, passability: number, terrainRoughness: number): string {
  const roughness = Math.max(terrainRoughness, 1e-6);
  const band = elevationBand(elevation, seaLevel, roughness);

  let [r, g, b] = BAND_BASE_COLOR[band];
  if (band === "mountain") {
    const norm = clamp01((elevation - seaLevel) / roughness);
    const peakiness = clamp01((norm - MOUNTAIN_THRESHOLD) / (1 - MOUNTAIN_THRESHOLD));
    r = lerp(r, PEAK_HIGHLIGHT_COLOR[0], peakiness * 0.5);
    g = lerp(g, PEAK_HIGHLIGHT_COLOR[1], peakiness * 0.5);
    b = lerp(b, PEAK_HIGHLIGHT_COLOR[2], peakiness * 0.5);
  }

  if (band === "water") {
    // Same fertility tint land gets (SPEC.md Addendum 10) — shallow water with real food gets a
    // faint green cast, so "this coastline has something worth eating" is legible without a
    // separate visual language. Deep water (fertility always 0) is untouched by this term.
    const tint = fertility * 0.06;
    const darken = (1 - passability) * 0.5;
    r = clamp01(r - tint * 0.5 - darken * 0.35);
    g = clamp01(g + tint * 0.3 - darken * 0.3);
    b = clamp01(b - tint * 0.3 - darken * 0.2);
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  }

  const tint = fertility * 0.06;
  const darken = (1 - passability) * 0.3;
  r = clamp01(r - tint * 0.5 - darken * 0.35);
  g = clamp01(g + tint * 0.3 - darken * 0.3);
  b = clamp01(b - tint * 0.3 - darken * 0.25);

  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}
