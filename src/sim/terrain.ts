import type { Params } from "../params.ts";
import type { RNG } from "./rng.ts";
import { clamp01, torDelta } from "./util.ts";

export type ElevationBand = "water" | "lowland" | "hill" | "mountain";

const HILL_THRESHOLD = 0.33;
const MOUNTAIN_THRESHOLD = 0.7;

/**
 * Which discrete elevation band a raw elevation value falls into. Land bands are normalized
 * against the run's own terrainRoughness (the parameter that actually controls how tall generated
 * terrain gets) — not the hard [-3,3] god-mode clamp — and measured relative to seaLevel, not
 * absolute 0, same as passability/fertility (SPEC.md Addendum 9): a hill barely above the waterline
 * reads as lowland, not a head start into "hill." That keeps the bands meaningful whether the map
 * is a gentle default hill-scape or a player has hand-raised a mountain far above what natural
 * generation produces: a hand-raised peak past terrainRoughness just clamps into "mountain" rather
 * than needing a fifth category.
 *
 * Lives in sim/, not render/, since it's pure domain classification (elevation/seaLevel/roughness
 * in, a band out — no color/canvas concern) that game/observability's habitat profile needs too
 * (SPEC.md Addendum 15) — render/terrainPalette.ts imports and re-exports this for its own callers
 * rather than owning the definition.
 */
export function elevationBand(elevation: number, seaLevel: number, terrainRoughness: number): ElevationBand {
  if (elevation < seaLevel) return "water";
  const norm = clamp01((elevation - seaLevel) / Math.max(terrainRoughness, 1e-6));
  if (norm <= HILL_THRESHOLD) return "lowland";
  if (norm <= MOUNTAIN_THRESHOLD) return "hill";
  return "mountain";
}

export interface TerrainGrid {
  cols: number;
  rows: number;
  elevation: Float64Array;
  passability: Float64Array;
  fertility: Float64Array;
  /** The live, interveneable waterline (SPEC.md Addendum 9) — chosen at generation time so this
   * map's own water coverage hits params.seaLevelTargetWaterFraction (see
   * seaLevelForTargetWaterFraction), then directly mutated in elevation-space from there by the
   * raiseSeaLevel/lowerSeaLevel god-tool, same params-vs-state split as FruitTree.capacity vs.
   * params.treeFruitCapacity (Addendum 6). Cells with elevation below this are water. */
  seaLevel: number;
  /** Bumped by intervention.ts whenever elevation/passability/fertility actually change (a
   * terrain brush stroke, a barrier ramp tick, a crater). Lets a renderer's own terrain-layer
   * cache detect staleness on its own by comparing revisions — no caller needs to know the
   * renderer has a cache to invalidate, let alone import into it to invalidate it. */
  revision: number;
}

/**
 * The low-level land/water passability shape, parameterized by steepness rather than reading
 * params directly — shared by the genotype-blind `terrainDerivedFields` below (taxonomy's barrier
 * detection, rendering, and fertility all need "how objectively difficult is this terrain," a
 * property of the terrain, not of whoever's asking) AND, since SPEC.md Addendum 12 (Milestone 6),
 * `sim/phenotype.ts`'s phenotype-aware movement, which calls this same shape with a creature's own
 * interpolated steepness constants instead of the flat defaults. `relative` is elevation minus sea
 * level: >= 0 is land (tapers with `landSteepness`), < 0 is water (tapers with `waterSteepness`
 * against depth).
 */
export function passabilityFromSteepness(relative: number, landSteepness: number, waterSteepness: number): number {
  if (relative >= 0) return clamp01(1 - landSteepness * relative);
  return clamp01(1 - waterSteepness * -relative);
}

/**
 * Passability/fertility as a function of elevation relative to sea level (SPEC.md Addendum 9).
 * Land tapers off the same way both fields always have, just measured from the waterline instead
 * of absolute elevation 0. Water gets a much steeper passability falloff (near-barrier by design —
 * no creature can swim well until a phenotype-aware caller says otherwise, see
 * `passabilityFromSteepness` above) — this function itself always uses the flat, genotype-blind
 * defaults; it's the one every other terrain consumer (taxonomy, rendering) should keep using.
 *
 * Fertility in water is NOT flat zero (Addendum 10, Milestone 4: "water as a real niche") — shallow
 * water (depth <= shallowWaterMaxDepth) tapers from a deliberately low shallowWaterFertilityCeiling
 * down to 0 at the shallow/deep boundary, giving shallow-water trees a modest but real yield; deep
 * water stays exactly as barren as M3 made it.
 */
export function terrainDerivedFields(elevation: number, seaLevel: number, params: Params): { passability: number; fertility: number } {
  const relative = elevation - seaLevel;
  const passability = passabilityFromSteepness(relative, params.passabilitySteepness, params.waterPassabilitySteepness);
  if (relative >= 0) {
    return { passability, fertility: clamp01(1 - params.fertilitySteepness * relative) };
  }
  const depth = -relative;
  if (depth > params.shallowWaterMaxDepth) {
    return { passability, fertility: 0 };
  }
  const shallowness = 1 - depth / Math.max(params.shallowWaterMaxDepth, 1e-9);
  return { passability, fertility: clamp01(params.shallowWaterFertilityCeiling * shallowness) };
}

/**
 * The elevation value below which exactly `targetFraction` of cells fall — i.e. the seaLevel that
 * makes THIS map's own water coverage hit the target, rather than a fixed absolute elevation
 * threshold. Needed because a small hill count (default 5) summed with random signed amplitude
 * produces wildly seed-dependent extremes — a fixed seaLevel measured directly against elevation
 * ranged from ~12% water on one seed to 100% (total ocean) on another in practice, since which
 * side (peaks or troughs) happens to be taller that run is pure luck of the draw. Percentile
 * selection sidesteps that entirely: whatever this map's actual distribution looks like, the
 * target fraction is exactly what ends up underwater. Found empirically (SPEC.md Addendum 9) —
 * see its "Implementation status" for the numbers.
 */
function seaLevelForTargetWaterFraction(elevation: Float64Array, targetFraction: number): number {
  const sorted = Float64Array.from(elevation).sort();
  const index = Math.min(Math.max(Math.round(targetFraction * (sorted.length - 1)), 0), sorted.length - 1);
  return sorted[index];
}

/**
 * How much of the map's own land sits above sea level, over the INTERIOR only — the region the
 * ocean border (below) doesn't touch. Sea level has to be chosen from these cells alone, or the
 * border's own deep water dominates the percentile and drags the waterline so low that the interior
 * ends up with no lakes or coastline at all.
 */
function interiorElevation(elevation: Float64Array, cols: number, rows: number, borderCells: number): Float64Array {
  if (borderCells <= 0) return elevation;
  const interior: number[] = [];
  for (let y = borderCells; y < rows - borderCells; y++) {
    for (let x = borderCells; x < cols - borderCells; x++) interior.push(elevation[y * cols + x]);
  }
  return interior.length > 0 ? Float64Array.from(interior) : elevation;
}

/** Smoothstep — a gentler blend than a straight ramp, so the coast reads as a shelving beach rather
 * than a step down into the sea. */
function smoothstep(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/**
 * Drowns the outer margin of the map in deep ocean, turning a toroidal world into an island
 * continent (SPEC.md Addendum 31).
 *
 * The map wraps in both axes, which meant a barrier drawn across it separated nothing: creatures
 * simply walked off one edge and back on the other. Measured directly — 120 creatures seeded west of
 * a fully impassable wall, and 75 of them were east of it within 2,000 ticks, having gone around
 * through the seam. Every "allopatric" split the player thought they had engineered was actually
 * drift.
 *
 * Making the border unreachable fixes that without touching the sim's spatial mathematics at all:
 * the wrap still exists, but no land creature can get to it, so a wall drawn coast to coast is a
 * real division. Deliberately NOT a hard rectangle — the underlying terrain noise survives inside
 * the blend, so the coastline comes out irregular, with bays and headlands, and the shallow band on
 * the way down is real habitat (SPEC.md Addendum 10) rather than a wall.
 *
 * Not absolute, on purpose: a strongly water-adapted lineage can eventually cross deep water (that
 * is exactly what Addendum 12's aquaticAdaptation is for), so isolation is strong but escapable —
 * which is a more interesting rule than an impassable edge.
 */
function carveOceanBorder(elevation: Float64Array, cols: number, rows: number, borderCells: number, oceanFloor: number): void {
  if (borderCells <= 0) return;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // Distance to the nearest edge, in cells; 0 at the very edge.
      const edgeDistance = Math.min(x, y, cols - 1 - x, rows - 1 - y);
      if (edgeDistance >= borderCells) continue;
      // 0 at the outermost cell, 1 where the border ends and natural terrain resumes. Blending
      // toward an absolute floor ELEVATION rather than subtracting a depth: sea level is itself a
      // signed elevation that is usually negative, so subtracting a "depth" from the terrain left
      // the rim above the waterline on exactly the maps where the waterline sat low — measured at
      // 0.254 passability on the outer ring, which creatures simply walked around.
      const landFraction = smoothstep(edgeDistance / borderCells);
      const idx = y * cols + x;
      elevation[idx] = elevation[idx] * landFraction + oceanFloor * (1 - landFraction);
    }
  }
}

/**
 * Generates elevation as a sum of random Gaussian hills and basins (signed amplitude — roughly
 * half raise the land, half carve troughs), normalized symmetrically around 0. seaLevel is then
 * chosen per-map via seaLevelForTargetWaterFraction so land/sea area is consistent across seeds
 * rather than left to chance (SPEC.md Addendum 9). Passability/fertility derive from elevation
 * relative to the terrain's own live seaLevel. Deterministic: driven entirely by the passed-in RNG.
 */
export function generateTerrain(rng: RNG, params: Params, cols: number, rows: number): TerrainGrid {
  const elevation = new Float64Array(cols * rows);

  for (let h = 0; h < params.terrainHillCount; h++) {
    const cx = rng.nextRange(0, cols);
    const cy = rng.nextRange(0, rows);
    const radius = rng.nextRange(cols * 0.08, cols * 0.25);
    const amp = rng.nextRange(0.3, 1.0) * (rng.next() < 0.5 ? 1 : -1);
    for (let y = 0; y < rows; y++) {
      const dy = torDelta(y, cy, rows);
      for (let x = 0; x < cols; x++) {
        const dx = torDelta(x, cx, cols);
        const d2 = dx * dx + dy * dy;
        elevation[y * cols + x] += amp * Math.exp(-d2 / (2 * radius * radius));
      }
    }
  }

  let maxAbsElevation = 0;
  for (let i = 0; i < elevation.length; i++) {
    maxAbsElevation = Math.max(maxAbsElevation, Math.abs(elevation[i]));
  }
  if (maxAbsElevation > 0) {
    for (let i = 0; i < elevation.length; i++) {
      elevation[i] = (elevation[i] / maxAbsElevation) * params.terrainRoughness;
    }
  }

  // Sea level first, from the interior only, THEN the border is carved — so the waterline is set by
  // the landmass the player actually lives on, and the ocean is unambiguously below it rather than
  // competing to define it.
  const borderCells = Math.round(Math.min(cols, rows) * params.oceanBorderFraction);
  const seaLevel = seaLevelForTargetWaterFraction(interiorElevation(elevation, cols, rows, borderCells), params.seaLevelTargetWaterFraction);
  carveOceanBorder(elevation, cols, rows, borderCells, seaLevel - params.oceanBorderDepth);

  const passability = new Float64Array(cols * rows);
  const fertility = new Float64Array(cols * rows);
  for (let i = 0; i < elevation.length; i++) {
    const derived = terrainDerivedFields(elevation[i], seaLevel, params);
    passability[i] = derived.passability;
    fertility[i] = derived.fertility;
  }

  return { cols, rows, elevation, passability, fertility, seaLevel, revision: 0 };
}
