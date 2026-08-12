/** Per-cell fruit grid, parallel to the terrain grid. Fruit comes from trees (sim/trees.ts), which
 * own tree lifecycle and write into this array's cells each tick — this is the dense, O(1)-indexed
 * cache creature.ts's hot per-tick sense/eat loop reads, not the source of truth for tree state. */
export interface World {
  cols: number;
  rows: number;
  fruit: Float64Array;
  /** Per-cell regrowth multiplier, default 1. God-mode drought/bloom brushes scale this temporarily. */
  regrowthModifier: Float64Array;
}

/** An empty world grid — sim/trees.ts's initTrees() is what actually populates fruit, by seeding
 * the initial mature trees and writing their starting fruit into their cells. */
export function initWorld(cols: number, rows: number): World {
  return {
    cols,
    rows,
    fruit: new Float64Array(cols * rows),
    regrowthModifier: new Float64Array(cols * rows).fill(1),
  };
}
