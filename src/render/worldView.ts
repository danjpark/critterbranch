import type { Creature } from "../sim/creature.ts";
import { derivePhenotype } from "../sim/phenotype.ts";
import type { SimState } from "../sim/sim.ts";
import type { TerrainGrid } from "../sim/terrain.ts";
import { cellIndexAt } from "../sim/trees.ts";
import { clamp01, lerp, torDelta } from "../sim/util.ts";
import type { Params } from "../params.ts";
import { type CameraState, screenScale, screenToWorld, type WorldExtent, worldToScreen } from "./camera.ts";
import { cachedGenotypeColor, type ColorOptions } from "./color.ts";
import { drawCreatureGlyph } from "./creatureGlyph.ts";
import { CONTOUR_LINE_COLOR, elevationBand, type ElevationBand, terrainCellColor } from "./terrainPalette.ts";

export interface RenderOptions {
  colorOptions: ColorOptions;
  selectedCreatureId: number | null;
  /** null = show every creature; otherwise only creatures whose species (lineageId) is in the
   * set are drawn — set by clicking a branch in the tree view ("show only this lineage"). */
  lineageFilter: Set<number> | null;
  /** SPEC.md Addendum 18 — pan/zoom camera. Callers own the CameraState (one per canvas); this
   * module only reads it. */
  camera: CameraState;
}

function worldExtent(params: Params): WorldExtent {
  return { worldWidth: params.worldWidth, worldHeight: params.worldHeight };
}

export function renderWorld(ctx: CanvasRenderingContext2D, state: SimState, params: Params, options: RenderOptions): void {
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  const extent = worldExtent(params);

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  drawTerrainLayer(ctx, options.camera, extent, state.evolution.terrain, params);
  drawTrees(ctx, state, params, options.camera, extent);
  drawCreatures(ctx, state, params, options, extent);
}

// Terrain is static for most of a SimState's lifetime, so repainting all ~2,500 cells every frame
// is pure waste. Rendered once per (terrain grid, terrain revision) at a fixed NATIVE resolution
// independent of the viewport/camera — unlike the pre-Addendum-18 cache (keyed by canvas size too),
// this same cached bitmap now serves every zoom level, blitted+scaled by drawTerrainLayer below via
// the camera's own projection. Keyed by object identity via WeakMap, so a restart (new TerrainGrid)
// naturally misses the cache; staleness from an in-place edit is caught by comparing revisions.
// Known simplification, not hidden: TERRAIN_CACHE_CELL_PX is a fixed native resolution, so zooming
// in close to MAX_ZOOM shows some upscale blur on terrain (creatures/trees stay crisp — they draw
// fresh every frame in screen-space, only terrain is a raster cache). Revisit with a zoom-aware
// cache resolution if that blur turns out to matter in practice.
const TERRAIN_CACHE_CELL_PX = 32;
const terrainLayerCache = new WeakMap<TerrainGrid, { canvas: HTMLCanvasElement; revision: number }>();

function getTerrainLayer(terrain: TerrainGrid, params: Params): HTMLCanvasElement {
  const cached = terrainLayerCache.get(terrain);
  if (cached && cached.revision === terrain.revision) return cached.canvas;

  const layer = document.createElement("canvas");
  layer.width = terrain.cols * TERRAIN_CACHE_CELL_PX;
  layer.height = terrain.rows * TERRAIN_CACHE_CELL_PX;
  const nativeScale = TERRAIN_CACHE_CELL_PX / params.gridCellSize;
  paintTerrain(layer.getContext("2d")!, terrain, params, nativeScale, nativeScale);
  terrainLayerCache.set(terrain, { canvas: layer, revision: terrain.revision });
  return layer;
}

/** Blits the cached native-resolution terrain bitmap, positioned and scaled by the camera's own
 * projection — at the default camera (zoom=1, centered) this draws the cache stretched to exactly
 * fill the canvas, the same visual result the old fixed-fit renderer produced. */
function drawTerrainLayer(ctx: CanvasRenderingContext2D, camera: CameraState, extent: WorldExtent, terrain: TerrainGrid, params: Params): void {
  const layer = getTerrainLayer(terrain, params);
  const topLeft = worldToScreen(camera, extent, 0, 0);
  const bottomRight = worldToScreen(camera, extent, extent.worldWidth, extent.worldHeight);
  ctx.drawImage(layer, topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
}

/**
 * Ink-on-parchment terrain in discrete elevation bands (lowland/hill/mountain) with contour lines
 * at band boundaries — a map-editor-style readable relief rather than a smooth gradient. Terrain
 * still stays background, never competing with creature hue (see render/terrainPalette.ts); a
 * barrier stamp's passability change (independent of elevation) still darkens a cell so a
 * hand-drawn barrier remains visible regardless of band. `scaleX`/`scaleY` here are the NATIVE
 * cache's own pixels-per-world-unit (see getTerrainLayer), not the camera's — this function knows
 * nothing about the camera at all, matching how it never knew about canvas size before Addendum 18.
 */
function paintTerrain(ctx: CanvasRenderingContext2D, terrain: TerrainGrid, params: Params, scaleX: number, scaleY: number): void {
  const cellW = params.gridCellSize * scaleX;
  const cellH = params.gridCellSize * scaleY;
  const roughness = Math.max(params.terrainRoughness, 1e-6);

  const bands = new Array<ElevationBand>(terrain.cols * terrain.rows);
  for (let y = 0; y < terrain.rows; y++) {
    for (let x = 0; x < terrain.cols; x++) {
      const idx = y * terrain.cols + x;
      bands[idx] = elevationBand(terrain.elevation[idx], terrain.seaLevel, roughness);
      ctx.fillStyle = terrainCellColor(terrain.elevation[idx], terrain.seaLevel, terrain.fertility[idx], terrain.passability[idx], roughness);
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

const TRUNK_COLOR = "rgba(59, 46, 31, 0.8)"; // same ink-brown hue as CONTOUR_LINE_COLOR
const CANOPY_FULL_COLOR: [number, number, number] = [74, 157, 61]; // FRUIT_COLOR "#4a9d3d" as rgb
const CANOPY_DEPLETED_COLOR: [number, number, number] = [150, 142, 108]; // dull olive-parchment when stripped bare

// A just-planted sapling is still visible (the whole point of a minimum) but reads as a sprout, not
// a tree yet; a fully-grown RICH tree is the biggest a canopy ever gets, POOR_TREE_RADIUS_SCALE
// keeps a fully-grown poor tree meaningfully smaller than that, not just paler.
const MIN_CANOPY_RADIUS_FRAC = 0.09;
const MAX_CANOPY_RADIUS_FRAC = 0.4;
const POOR_TREE_RADIUS_SCALE = 0.6;

/** Cheap deterministic per-tree "randomness" for canopy blob placement — a hash of the tree's own
 * id and a salt, not RNG, so a tree's silhouette is stable frame to frame without storing anything
 * extra on FruitTree itself. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Procedural tree glyphs, one per living FruitTree entity (see sim/trees.ts) — replaces the old
 * flat per-cell fruit-square rendering now that trees are the actual food-bearing entity, not just
 * a derived grid. Canopy radius scales with the tree's age (tick - plantedTick) from a visible
 * minimum up to a full-grown size by params.treeMaturityTicks — the same tick a tree starts
 * producing fruit in the sim itself, so "looks grown up" and "is grown up" line up exactly. A
 * richer tree (higher capacity) grows a bigger canopy at full size than a poor one. Canopy color
 * blends from a pale, depleted tone toward a vivid green as the tree's OWN current fruit
 * (world.fruit at its cell, against its own capacity-and-fertility ceiling) fills back up — so one
 * glyph carries both "how developed is this tree" and "how much food is on it right now," instead
 * of two separate, potentially-overlapping visual layers. Positioned/scaled through the camera
 * (SPEC.md Addendum 18) instead of a flat canvas-fit scale.
 */
function drawTrees(ctx: CanvasRenderingContext2D, state: SimState, params: Params, camera: CameraState, extent: WorldExtent): void {
  const { world, terrain, trees, tick } = state.evolution;
  const cellSize = params.gridCellSize * screenScale(camera, extent);
  const minRadius = cellSize * MIN_CANOPY_RADIUS_FRAC;
  // Typical poor-tree capacity is ~15% of treeFruitCapacity (see sim/trees.ts's poorTreeCapacity);
  // a shallow-water or rich tree sits at 100%. Clamped so an even-poorer-than-usual capacity
  // (patchBimodality tuned harsher than default) still renders at a visible minimum, not zero.
  const poorCapacityFloor = params.treeFruitCapacity * 0.15;
  const richnessSpan = Math.max(params.treeFruitCapacity - poorCapacityFloor, 1e-6);

  for (const tree of trees.trees) {
    const idx = cellIndexAt(tree.x, tree.y, params, world);
    const ceiling = tree.capacity * terrain.fertility[idx];
    const fruitFrac = ceiling > 1e-6 ? clamp01(world.fruit[idx] / ceiling) : 0;

    // A tree already flagged mature (including every founding tree — see sim/trees.ts's initTrees,
    // which starts them mature and full of fruit on purpose, "immediately playable") renders at
    // full canopy size right away, regardless of literal age since planting. Only a genuine sapling
    // (maturedTick still null) animates up from the floor — and by the exact tick stepTrees flips
    // it to mature, this formula already equals 1.0 anyway, so there's no visible jump at the
    // handoff, just a continuous curve that happens to also be the ground truth for "is it mature."
    const growth = tree.maturedTick !== null ? 1 : clamp01((tick - tree.plantedTick) / Math.max(params.treeMaturityTicks, 1e-6));
    const richnessFrac = clamp01((tree.capacity - poorCapacityFloor) / richnessSpan);
    const grownRadius = cellSize * lerp(MAX_CANOPY_RADIUS_FRAC * POOR_TREE_RADIUS_SCALE, MAX_CANOPY_RADIUS_FRAC, richnessFrac);
    const canopyRadius = lerp(minRadius, grownRadius, growth);

    const base = worldToScreen(camera, extent, tree.x, tree.y);
    const trunkHeight = lerp(canopyRadius * 0.3, canopyRadius * 0.9, growth);
    const canopyCenterY = base.y - trunkHeight;

    ctx.strokeStyle = TRUNK_COLOR;
    ctx.lineWidth = Math.max(1, canopyRadius * 0.18);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(base.x, canopyCenterY);
    ctx.stroke();

    const [fr, fg, fb] = CANOPY_FULL_COLOR;
    const [dr, dg, db] = CANOPY_DEPLETED_COLOR;
    const r = Math.round(lerp(dr, fr, fruitFrac));
    const g = Math.round(lerp(dg, fg, fruitFrac));
    const b = Math.round(lerp(db, fb, fruitFrac));
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;

    // A small cluster of overlapping blobs, not one perfect circle — a rounder single dot would
    // read as fruit again rather than foliage; jittered offsets sketch an organic canopy outline
    // matching the map's hand-drawn style.
    const blobCount = 3;
    for (let i = 0; i < blobCount; i++) {
      const angle = pseudoRandom(tree.id * 7 + i) * Math.PI * 2;
      const offset = canopyRadius * 0.35 * pseudoRandom(tree.id * 13 + i);
      const blobX = base.x + Math.cos(angle) * offset;
      const blobY = canopyCenterY + Math.sin(angle) * offset * 0.6;
      const blobRadius = canopyRadius * lerp(0.55, 0.8, pseudoRandom(tree.id * 19 + i));

      ctx.beginPath();
      ctx.arc(blobX, blobY, blobRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const BASE_CREATURE_RADIUS_FRAC = 1.1;

/** Draws every living creature as a procedural mammal glyph (SPEC.md Addendum 18) instead of the
 * old flat colored circle — same genotype color, positioned/scaled through the camera. bodyScale
 * (Addendum 17) modulates the base radius so larger-genomed creatures visibly read as bigger. */
function drawCreatures(ctx: CanvasRenderingContext2D, state: SimState, params: Params, options: RenderOptions, extent: WorldExtent): void {
  const { camera } = options;
  const baseRadius = Math.max(2, screenScale(camera, extent) * BASE_CREATURE_RADIUS_FRAC);

  for (const creature of state.evolution.creatures) {
    if (options.lineageFilter && !options.lineageFilter.has(creature.lineageId)) continue;

    const screen = worldToScreen(camera, extent, creature.x, creature.y);
    const morphology = derivePhenotype(creature.genome, params).morphology;
    const radius = baseRadius * morphology.bodyScale;
    const fill = cachedGenotypeColor(creature, state.evolution.foundingCentroid, options.colorOptions);

    // Thin dark silhouette underneath so light-lightness individuals don't vanish over pale ground
    // — drawn as a slightly larger copy of the same glyph rather than a stroke, since the glyph's
    // outline isn't a simple circle anymore.
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawCreatureGlyph(ctx, screen.x, screen.y, radius * 1.12, creature.heading, morphology, "#000000", creature.id);
    ctx.restore();

    drawCreatureGlyph(ctx, screen.x, screen.y, radius, creature.heading, morphology, fill, creature.id);

    if (options.selectedCreatureId === creature.id) {
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

/** Nearest creature to a camera-projected screen-space click, or null if nothing is close enough. */
export function findCreatureAt(state: SimState, params: Params, camera: CameraState, screenX: number, screenY: number): Creature | null {
  const extent = worldExtent(params);
  const world = screenToWorld(camera, extent, screenX, screenY);
  const pickRadius = 8 / screenScale(camera, extent);

  let closest: Creature | null = null;
  let closestDist = pickRadius;

  for (const creature of state.evolution.creatures) {
    const dx = torDelta(creature.x, world.x, params.worldWidth);
    const dy = torDelta(creature.y, world.y, params.worldHeight);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < closestDist) {
      closestDist = dist;
      closest = creature;
    }
  }

  return closest;
}
