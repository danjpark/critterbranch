import type { Params } from "../params.ts";
import type { RNG } from "./rng.ts";
import type { TerrainGrid } from "./terrain.ts";
import { clamp, lerp, torDist, wrap } from "./util.ts";
import type { World } from "./world.ts";

/**
 * A single fruit tree — sapling until `maturedTick` is set, then a fruit-producing entity whose
 * cell's fruit (in World.fruit) it regrows each tick, subject to crowdedness-scaled death. See
 * SPEC.md Addendum 6: this replaces the old two-food-type (R/B) grid entirely — one persistent,
 * spatial food source instead of a static per-cell capacity field.
 */
export interface FruitTree {
  id: number;
  x: number;
  y: number;
  plantedTick: number;
  /** null until this sapling matures into a fruit-producing tree. */
  maturedTick: number | null;
  /** This tree's own fruit ceiling (fertility-unadjusted) — rich, poor, or whatever a caller
   * chose. Fixed at planting time, not derived from a flat params field, so the rich/poor
   * bimodality initTrees sets up at generation time actually survives past the first regrowth
   * tick instead of every tree converging on one shared ceiling. */
  capacity: number;
}

export interface TreeState {
  nextId: number;
  trees: FruitTree[];
}

export function cellIndexAt(x: number, y: number, params: Params, world: World): number {
  const gx = wrap(Math.floor(x / params.gridCellSize), world.cols);
  const gy = wrap(Math.floor(y / params.gridCellSize), world.rows);
  return gy * world.cols + gx;
}

function isWater(x: number, y: number, params: Params, terrain: TerrainGrid, world: World): boolean {
  return terrain.elevation[cellIndexAt(x, y, params, world)] < terrain.seaLevel;
}

/** 0 on land, positive depth below sea level in water — same elevation-space units as seaLevel. */
function waterDepthAt(x: number, y: number, params: Params, terrain: TerrainGrid, world: World): number {
  const idx = cellIndexAt(x, y, params, world);
  return Math.max(0, terrain.seaLevel - terrain.elevation[idx]);
}

/** True only past shallowWaterMaxDepth — land and shallow water both read false (SPEC.md
 * Addendum 10: shallow water is a real, if modest, niche now, not a rejection case). */
function isDeepWater(x: number, y: number, params: Params, terrain: TerrainGrid, world: World): boolean {
  return waterDepthAt(x, y, params, terrain, world) > params.shallowWaterMaxDepth;
}

function isShallowWater(x: number, y: number, params: Params, terrain: TerrainGrid, world: World): boolean {
  const depth = waterDepthAt(x, y, params, terrain, world);
  return depth > 0 && depth <= params.shallowWaterMaxDepth;
}

/** The reduced capacity a "poor" tree gets, per patchBimodality — shared by initTrees (founding
 * poor trees) and trySeedSapling (wild-grown saplings, always poor — see its own doc comment). */
function poorTreeCapacity(params: Params): number {
  return lerp(params.treeFruitCapacity, params.treeFruitCapacity * 0.15, params.patchBimodality);
}

/** Seeds the initial mature trees and fills their starting fruit — the tree-based replacement for
 * the old generateWorld's food-patch placement. Trees start already mature (immediately playable,
 * same "start full at capacity" intent the old world had) rather than as saplings.
 *
 * Rich trees are placed independently, uniformly at random (widely separated by construction —
 * few of them across the whole map). Poor trees are placed in explicit small clusters (see
 * Params.richTreeCount's doc comment for why point-source trees need real clustering, not just
 * higher count, to recreate the old patch geometry's "dense field to sweep").
 *
 * patchBimodality is a per-tree MIXING PROBABILITY, not a continuously-scaled radius: each poor
 * tree is independently placed tightly around its cluster center with probability
 * patchBimodality, or via a fresh independent uniform draw (statistically identical to how rich
 * trees are placed) with probability (1 - patchBimodality). A first attempt scaled the cluster
 * radius up toward worldWidth instead — that doesn't actually converge to uniform placement no
 * matter how large the radius gets, because sampling a uniform *distance* with a uniform angle is
 * inherently radially peaked at the center (equal distance increments cover less area near the
 * center), not uniform over the disk. That residual clumpiness was a real false-positive bug: the
 * neutral-control test started detecting phantom speciation at patchBimodality=0. The mixing-
 * probability approach collapses exactly at 0 (100% of poor trees use the same draw rich trees
 * do) with no asymptotic hand-waving required. */
export function initTrees(rng: RNG, params: Params, terrain: TerrainGrid, world: World): TreeState {
  const trees: FruitTree[] = [];
  let nextId = 0;

  function plantAt(x: number, y: number, capacity: number): void {
    const wx = wrap(x, params.worldWidth);
    const wy = wrap(y, params.worldHeight);
    trees.push({ id: nextId++, x: wx, y: wy, plantedTick: 0, maturedTick: 0, capacity });
    const idx = cellIndexAt(wx, wy, params, world);
    world.fruit[idx] = capacity * terrain.fertility[idx];
  }

  function uniformPoint(): [number, number] {
    return [rng.nextRange(0, params.worldWidth), rng.nextRange(0, params.worldHeight)];
  }

  // Rejection-samples for a land cell (trees don't grow in the sea — SPEC.md Addendum 9), giving
  // up after enough attempts rather than looping forever on a pathological near-total-ocean world.
  function uniformLandPoint(): [number, number] {
    let candidate: [number, number] = uniformPoint();
    for (let attempt = 0; attempt < 50 && isWater(candidate[0], candidate[1], params, terrain, world); attempt++) {
      candidate = uniformPoint();
    }
    return candidate;
  }

  // Shallow water is typically a thin band near shore — a much smaller target than land's ~82%
  // default share — so this gets far more attempts than uniformLandPoint before giving up. Returns
  // null (caller just skips that tree) rather than falling back onto land/deep water, since a
  // shallow-water tree planted somewhere that isn't shallow water would misrepresent the pool.
  function uniformShallowWaterPoint(): [number, number] | null {
    for (let attempt = 0; attempt < 500; attempt++) {
      const candidate = uniformPoint();
      if (isShallowWater(candidate[0], candidate[1], params, terrain, world)) return candidate;
    }
    return null;
  }

  for (let i = 0; i < params.richTreeCount; i++) {
    const [x, y] = uniformLandPoint();
    plantAt(x, y, params.treeFruitCapacity);
  }

  const poorCapacity = poorTreeCapacity(params);
  const perCluster = Math.ceil(params.poorTreeCount / params.poorClusterCount);
  let planted = 0;
  for (let c = 0; c < params.poorClusterCount && planted < params.poorTreeCount; c++) {
    const [cx, cy] = uniformLandPoint();
    for (let i = 0; i < perCluster && planted < params.poorTreeCount; i++, planted++) {
      if (rng.next() < params.patchBimodality) {
        // Falls back to the cluster center itself (guaranteed land, uniformLandPoint already
        // checked it) if 10 tries all land in water — a coastline-adjacent cluster shouldn't be
        // able to loop forever or silently plant underwater.
        let px = cx;
        let py = cy;
        for (let attempt = 0; attempt < 10; attempt++) {
          const angle = rng.nextRange(0, Math.PI * 2);
          // sqrt(uniform) * radius, not a bare uniform draw, for genuinely uniform-over-the-disk
          // placement within the cluster — the same radial-peaking bug this whole function's doc
          // comment describes, just at the "clustered" end instead of the "collapse" end.
          const dist = params.poorClusterRadius * Math.sqrt(rng.next());
          const candX = cx + Math.cos(angle) * dist;
          const candY = cy + Math.sin(angle) * dist;
          if (!isWater(candX, candY, params, terrain, world)) {
            px = candX;
            py = candY;
            break;
          }
        }
        plantAt(px, py, poorCapacity);
      } else {
        const [x, y] = uniformLandPoint();
        plantAt(x, y, poorCapacity);
      }
    }
  }

  // Shallow-water trees (SPEC.md Addendum 10, Milestone 4): a dedicated pool, land placement above
  // is untouched. Uses treeFruitCapacity like a rich tree — shallowWaterFertilityCeiling alone (a
  // deliberately low value) is what keeps their realized yield modest, the same way "poor" land
  // trees are just rich trees regrowing toward a lower fertility-adjusted ceiling.
  for (let i = 0; i < params.shallowWaterTreeCount; i++) {
    const point = uniformShallowWaterPoint();
    if (point === null) break; // not enough shallow water on this map to place more — stop, don't force it
    plantAt(point[0], point[1], params.treeFruitCapacity);
  }

  return { nextId, trees };
}

export function cloneTreeState(treeState: TreeState): TreeState {
  return { nextId: treeState.nextId, trees: treeState.trees.map((t) => ({ ...t })) };
}

/**
 * Attempts to plant a new sapling near (x, y) — called from creature.ts's eat step when a
 * creature eats fruit there. Seed dispersal via feeding, per Dan's own description of the
 * mechanic. Inherits the capacity of whichever tree currently owns (x, y)'s cell (an oak's
 * offspring is also an oak) rather than always starting poor — a hard-coded "always poor" was
 * tried first and empirically broke the foraging axis entirely: it planted poor-capacity
 * saplings right next to rich founder trees every time one got eaten from, diluting the "few
 * widely-separated rich sources" geometry into uniform mediocrity within a few thousand ticks,
 * long before any test's horizon even finished. Falls back to poor capacity only if no tree
 * happens to own that exact cell (defensive — shouldn't normally happen since nonzero fruit
 * implies a tree planted it there).
 *
 * Hard-capped at maxTreeCount: without a cap, sapling creation trivially outpaces death (a
 * population of a few hundred creatures each rolling saplingChance on every bite very quickly
 * outnumbers baseDeathChancePerCheck's attrition by an order of magnitude), so an uncapped tree
 * population grows without bound — first tanking performance (stepTrees is O(trees) every tick),
 * then blowing well past what World.fruit's cell grid can even usefully hold (found the hard way:
 * a 5,000-tick determinism test that used to run in seconds started timing out at 60s+).
 */
export function trySeedSapling(treeState: TreeState, x: number, y: number, rng: RNG, params: Params, terrain: TerrainGrid, tick: number, world: World): void {
  if (treeState.trees.length >= params.maxTreeCount) return;
  if (rng.next() >= params.saplingChance) return;
  const angle = rng.nextRange(0, Math.PI * 2);
  const dist = rng.nextRange(0, params.saplingSpreadRadius);
  const sx = wrap(x + Math.cos(angle) * dist, params.worldWidth);
  const sy = wrap(y + Math.sin(angle) * dist, params.worldHeight);
  // Trees don't grow in deep water (SPEC.md Addendum 9) but do in shallow water (Addendum 10) — a
  // fruit that drifts into deep water just fails to seed, no resampling; saplingChance is already
  // probabilistic per bite. Capacity is still inherited from whichever tree owns the source cell
  // below, same rule as always — a shallow-water sapling from a land tree's fruit just carries its
  // parent's (land) capacity in, no special-casing needed.
  if (isDeepWater(sx, sy, params, terrain, world)) return;

  const sourceIdx = cellIndexAt(x, y, params, world);
  const sourceTree = treeState.trees.find((t) => cellIndexAt(t.x, t.y, params, world) === sourceIdx);
  const capacity = sourceTree ? sourceTree.capacity : poorTreeCapacity(params);

  treeState.trees.push({ id: treeState.nextId++, x: sx, y: sy, plantedTick: tick, maturedTick: null, capacity });
}

/** Buckets trees by grid cell so a crowding neighbor count only scans nearby buckets instead of
 * every other tree — same radius-window approach creature.ts's senseFood already uses for food,
 * just bucketed by tree position instead of scanning a dense array. */
function bucketTrees(trees: FruitTree[], params: Params, world: World): Map<number, FruitTree[]> {
  const buckets = new Map<number, FruitTree[]>();
  for (const tree of trees) {
    const idx = cellIndexAt(tree.x, tree.y, params, world);
    const bucket = buckets.get(idx);
    if (bucket) bucket.push(tree);
    else buckets.set(idx, [tree]);
  }
  return buckets;
}

function countNeighborsWithinRadius(tree: FruitTree, buckets: Map<number, FruitTree[]>, params: Params, world: World): number {
  const worldWidth = world.cols * params.gridCellSize;
  const worldHeight = world.rows * params.gridCellSize;
  const cellSize = params.gridCellSize;
  const cx = Math.floor(tree.x / cellSize);
  const cy = Math.floor(tree.y / cellSize);
  const radiusCells = Math.ceil(params.crowdingRadius / cellSize);

  let count = 0;
  for (let dy = -radiusCells; dy <= radiusCells; dy++) {
    const gy = wrap(cy + dy, world.rows);
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      const gx = wrap(cx + dx, world.cols);
      const bucket = buckets.get(gy * world.cols + gx);
      if (!bucket) continue;
      for (const other of bucket) {
        if (other.id === tree.id) continue;
        if (torDist(tree.x, tree.y, other.x, other.y, worldWidth, worldHeight) <= params.crowdingRadius) count++;
      }
    }
  }
  return count;
}

/** Advances every tree by one tick in place: maturity progression, fruit regrowth into World.fruit
 * for mature trees (toward EACH TREE'S OWN capacity, not a shared flat ceiling), and (only on
 * treeCrowdingCheckIntervalTicks-multiple ticks) crowdedness-scaled death. Mutates
 * treeState.trees and world.fruit in place. */
export function stepTrees(treeState: TreeState, world: World, terrain: TerrainGrid, rng: RNG, params: Params, tick: number): void {
  const cyclical = clamp(1 + params.regrowthCycleAmplitude * Math.sin((2 * Math.PI * tick) / params.regrowthCyclePeriod), 0, 2);
  const checkCrowding = tick % params.treeCrowdingCheckIntervalTicks === 0;
  const buckets = checkCrowding ? bucketTrees(treeState.trees, params, world) : null;

  const survivors: FruitTree[] = [];
  for (const tree of treeState.trees) {
    if (tree.maturedTick === null && tick - tree.plantedTick >= params.treeMaturityTicks) {
      tree.maturedTick = tick;
    }

    const idx = cellIndexAt(tree.x, tree.y, params, world);

    if (tree.maturedTick !== null) {
      const ceiling = tree.capacity * terrain.fertility[idx];
      const rate = params.treeFruitRegrowthRate * cyclical * world.regrowthModifier[idx];
      world.fruit[idx] = Math.min(ceiling, world.fruit[idx] + rate * ceiling);

      if (checkCrowding) {
        const neighbors = countNeighborsWithinRadius(tree, buckets!, params, world);
        const deathChance = params.baseDeathChancePerCheck * (1 + params.crowdingDeathMultiplier * neighbors);
        if (rng.next() < deathChance) continue; // dies — not carried into survivors
      }
    }

    survivors.push(tree);
  }
  treeState.trees = survivors;
}
