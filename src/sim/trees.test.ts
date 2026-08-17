import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../params.ts";
import { RNG } from "./rng.ts";
import { generateTerrain } from "./terrain.ts";
import { cellIndexAt, initTrees, stepTrees, trySeedSapling, type TreeState } from "./trees.ts";
import { initWorld } from "./world.ts";

function setup(paramOverrides: Partial<typeof DEFAULT_PARAMS> = {}, cols = 20, rows = 20) {
  const params = { ...DEFAULT_PARAMS, ...paramOverrides };
  const terrain = generateTerrain(new RNG(1), params, cols, rows);
  const world = initWorld(cols, rows);
  const trees = initTrees(new RNG(1), params, terrain, world);
  return { params, terrain, world, trees };
}

describe("initTrees", () => {
  it("seeds richTreeCount + poorTreeCount already-mature trees, each with fruit filled to its own fertility-adjusted ceiling", () => {
    const { params, terrain, world, trees } = setup({ richTreeCount: 5, poorTreeCount: 10, patchBimodality: 1, shallowWaterTreeCount: 0 });
    expect(trees.trees.length).toBe(15);
    for (const tree of trees.trees) {
      expect(tree.maturedTick).toBe(0);
      const idx = cellIndexAt(tree.x, tree.y, params, world);
      // Each tree's fruit is either the rich ceiling or the (lower, patchBimodality-scaled) poor
      // ceiling — not necessarily the rich one, so check it's one of the two valid values.
      const richCeiling = params.treeFruitCapacity * terrain.fertility[idx];
      const poorCeiling = params.treeFruitCapacity * 0.15 * terrain.fertility[idx];
      const matchesEither = Math.abs(world.fruit[idx] - richCeiling) < 1e-6 || Math.abs(world.fruit[idx] - poorCeiling) < 1e-6;
      expect(matchesEither).toBe(true);
    }
  });

  it("collapses rich/poor into an identical capacity when patchBimodality is 0", () => {
    const { params, terrain, world, trees } = setup({ richTreeCount: 5, poorTreeCount: 10, patchBimodality: 0 });
    for (const tree of trees.trees) {
      const idx = cellIndexAt(tree.x, tree.y, params, world);
      expect(world.fruit[idx]).toBeCloseTo(params.treeFruitCapacity * terrain.fertility[idx]);
    }
  });

  it("never plants a land (rich/poor) tree underwater", () => {
    // shallowWaterTreeCount: 0 isolates the land-only placement pass this test is actually about —
    // land trees planting in shallow water would be the wrong kind of failure to catch here, see
    // the shallow-water-specific test below for that pool's own bound.
    const { terrain, world, trees } = setup({ richTreeCount: 10, poorTreeCount: 40, shallowWaterTreeCount: 0, seaLevelTargetWaterFraction: 0.3 });
    for (const tree of trees.trees) {
      const idx = cellIndexAt(tree.x, tree.y, DEFAULT_PARAMS, world);
      expect(terrain.elevation[idx]).toBeGreaterThanOrEqual(terrain.seaLevel);
    }
  });

  // SPEC.md Addendum 10 (Milestone 4: water as a real niche).
  it("plants shallowWaterTreeCount trees, all within shallowWaterMaxDepth and none on dry land", () => {
    const { params, terrain, world, trees } = setup({ richTreeCount: 0, poorTreeCount: 0, shallowWaterTreeCount: 15, seaLevelTargetWaterFraction: 0.3 });
    expect(trees.trees.length).toBe(15);
    for (const tree of trees.trees) {
      const idx = cellIndexAt(tree.x, tree.y, params, world);
      const depth = terrain.seaLevel - terrain.elevation[idx];
      expect(depth).toBeGreaterThan(0); // actually underwater, not land
      expect(depth).toBeLessThanOrEqual(params.shallowWaterMaxDepth + 1e-9);
    }
  });
});

describe("stepTrees — maturity", () => {
  it("matures a sapling after treeMaturityTicks", () => {
    const { params, terrain, world } = setup({ richTreeCount: 0, poorTreeCount: 0, treeMaturityTicks: 50 });
    const rng = new RNG(2);
    const treeState: TreeState = { nextId: 1, trees: [{ id: 0, x: 10, y: 10, plantedTick: 0, maturedTick: null, capacity: params.treeFruitCapacity }] };

    stepTrees(treeState, world, terrain, rng, params, 49);
    expect(treeState.trees.find((t) => t.id === 0)!.maturedTick).toBeNull();

    stepTrees(treeState, world, terrain, rng, params, 50);
    expect(treeState.trees.find((t) => t.id === 0)!.maturedTick).toBe(50);
  });

  it("does not regrow fruit for a still-immature sapling", () => {
    // Every tree source has to be off, not just the two named ones: the assertion is that THIS cell
    // holds no fruit, so any other tree initTrees happens to drop in it invalidates the test rather
    // than failing it honestly. (It did exactly that once the world grew — a shallow-water tree
    // landed in the same cell and the test reported the sapling had grown fruit.)
    const { params, terrain, world } = setup({
      richTreeCount: 0,
      poorTreeCount: 0,
      poorClusterCount: 0,
      shallowWaterTreeCount: 0,
      treeMaturityTicks: 100,
    });
    const rng = new RNG(2);
    const treeState: TreeState = { nextId: 1, trees: [{ id: 0, x: 10, y: 10, plantedTick: 0, maturedTick: null, capacity: params.treeFruitCapacity }] };
    stepTrees(treeState, world, terrain, rng, params, 1);
    const idx = cellIndexAt(10, 10, params, world);
    expect(world.fruit[idx]).toBe(0);
  });
});

describe("stepTrees — fruit regrowth", () => {
  it("never regrows past the fertility-adjusted ceiling", () => {
    const { params, terrain, world, trees } = setup({ richTreeCount: 5, poorTreeCount: 0 });
    const rng = new RNG(3);
    for (let t = 0; t < 5000; t++) stepTrees(trees, world, terrain, rng, params, t);
    for (const tree of trees.trees) {
      const idx = cellIndexAt(tree.x, tree.y, params, world);
      expect(world.fruit[idx]).toBeLessThanOrEqual(params.treeFruitCapacity * terrain.fertility[idx] + 1e-9);
    }
  });

  it("increases fruit from empty when treeFruitRegrowthRate is positive", () => {
    const { params, terrain, world, trees } = setup({ richTreeCount: 5, poorTreeCount: 0 });
    world.fruit.fill(0);
    const rng = new RNG(3);
    stepTrees(trees, world, terrain, rng, params, 0);
    expect(Array.from(world.fruit).some((v) => v > 0)).toBe(true);
  });

  it("oscillates with the regrowth cycle instead of only ever growing", () => {
    const { params, terrain, world, trees } = setup({
      richTreeCount: 5,
      poorTreeCount: 0,
      regrowthCycleAmplitude: 1,
      regrowthCyclePeriod: 100,
      treeFruitRegrowthRate: 1,
      treeCrowdingCheckIntervalTicks: 1_000_000, // isolate regrowth from crowding death for this test
    });
    world.fruit.fill(0);
    const rng = new RNG(3);
    // sin(2*pi*tick/period) = -1 at tick = period * 3/4, where the cyclical term clamps to 0.
    stepTrees(trees, world, terrain, rng, params, 75);
    expect(Array.from(world.fruit).every((v) => v === 0)).toBe(true);
  });

  it("respects a regrowthModifier override (drought halts regrowth)", () => {
    const { params, terrain, world, trees } = setup({ richTreeCount: 5, poorTreeCount: 0 });
    world.fruit.fill(0);
    world.regrowthModifier.fill(0);
    const rng = new RNG(3);
    stepTrees(trees, world, terrain, rng, params, 0);
    expect(Array.from(world.fruit).every((v) => v === 0)).toBe(true);
  });

  // Regression: regrowth used to be written once per tree, each write a Math.min against that
  // tree's OWN ceiling, so the last tree in array order decided the cell — and a poor tree sharing
  // a rich tree's cell clamped the cell's fruit DOWN to poor levels.
  describe("when several trees share one cell", () => {
    function twoTreesInOneCell(order: "richFirst" | "poorFirst") {
      const params = { ...DEFAULT_PARAMS, richTreeCount: 0, poorTreeCount: 0, shallowWaterTreeCount: 0, treeCrowdingCheckIntervalTicks: 1_000_000 };
      const cols = 20;
      const rows = 20;
      const terrain = generateTerrain(new RNG(1), params, cols, rows);
      terrain.fertility.fill(1);
      const world = initWorld(cols, rows);
      const rich = { id: 0, x: 10, y: 10, plantedTick: 0, maturedTick: 0, capacity: params.treeFruitCapacity };
      const poor = { id: 1, x: 11, y: 11, plantedTick: 0, maturedTick: 0, capacity: params.treeFruitCapacity * 0.15 };
      const trees: TreeState = { nextId: 2, trees: order === "richFirst" ? [rich, poor] : [poor, rich] };
      // Both land in the same cell at the default gridCellSize of 4.
      expect(cellIndexAt(rich.x, rich.y, params, world)).toBe(cellIndexAt(poor.x, poor.y, params, world));
      return { params, terrain, world, trees, cellIndex: cellIndexAt(rich.x, rich.y, params, world) };
    }

    it("regrows toward the best ceiling standing in the cell, not the last tree's", () => {
      const { params, terrain, world, trees, cellIndex } = twoTreesInOneCell("richFirst");
      const rng = new RNG(3);
      for (let t = 0; t < 500; t++) stepTrees(trees, world, terrain, rng, params, t);
      expect(world.fruit[cellIndex]).toBeCloseTo(params.treeFruitCapacity, 6);
    });

    it("gives the same result regardless of the order the trees sit in the array", () => {
      const richFirst = twoTreesInOneCell("richFirst");
      const poorFirst = twoTreesInOneCell("poorFirst");
      for (let t = 0; t < 500; t++) {
        stepTrees(richFirst.trees, richFirst.world, richFirst.terrain, new RNG(3), richFirst.params, t);
        stepTrees(poorFirst.trees, poorFirst.world, poorFirst.terrain, new RNG(3), poorFirst.params, t);
      }
      expect(poorFirst.world.fruit[poorFirst.cellIndex]).toBeCloseTo(richFirst.world.fruit[richFirst.cellIndex], 9);
    });

    it("a poor tree maturing on a stocked rich cell never knocks that cell's fruit down", () => {
      const { params, terrain, world, trees, cellIndex } = twoTreesInOneCell("richFirst");
      const rng = new RNG(3);
      for (let t = 0; t < 500; t++) stepTrees(trees, world, terrain, rng, params, t);
      const stocked = world.fruit[cellIndex];

      trees.trees.push({ id: 2, x: 9, y: 9, plantedTick: 500, maturedTick: 500, capacity: params.treeFruitCapacity * 0.15 });
      stepTrees(trees, world, terrain, rng, params, 500);
      expect(world.fruit[cellIndex]).toBeGreaterThanOrEqual(stocked - 1e-9);
    });
  });
});

describe("stepTrees — crowdedness death", () => {
  it("kills mature trees more often when densely packed than when isolated", () => {
    const params = {
      ...DEFAULT_PARAMS,
      richTreeCount: 0,
      poorTreeCount: 0,
      crowdingRadius: 10,
      baseDeathChancePerCheck: 0.02,
      crowdingDeathMultiplier: 2,
      treeCrowdingCheckIntervalTicks: 1,
    };
    const terrain = generateTerrain(new RNG(1), params, 40, 40);
    const denseWorld = initWorld(40, 40);
    const sparseWorld = initWorld(40, 40);

    // A tight cluster of 20 trees in one corner (dense) vs. 20 trees spread far apart (isolated).
    const dense: TreeState = {
      nextId: 100,
      trees: Array.from({ length: 20 }, (_, i) => ({ id: i, x: 5 + (i % 5), y: 5 + Math.floor(i / 5), plantedTick: 0, maturedTick: 0, capacity: params.treeFruitCapacity })),
    };
    const sparse: TreeState = {
      nextId: 100,
      trees: Array.from({ length: 20 }, (_, i) => ({ id: i, x: (i * 37) % 160, y: (i * 53) % 160, plantedTick: 0, maturedTick: 0, capacity: params.treeFruitCapacity })),
    };

    const rngDense = new RNG(42);
    const rngSparse = new RNG(42);
    for (let t = 1; t <= 200; t++) {
      stepTrees(dense, denseWorld, terrain, rngDense, params, t);
      stepTrees(sparse, sparseWorld, terrain, rngSparse, params, t);
    }

    expect(dense.trees.length).toBeLessThan(sparse.trees.length);
  });
});

describe("trySeedSapling", () => {
  // seaLevelTargetWaterFraction: 0 -> seaLevel sits at the map's own minimum elevation, so nothing
  // is strictly below it — an all-land terrain, keeping these tests focused on sapling mechanics
  // rather than incidentally depending on where water happened to land.
  function noWaterTerrain(params: typeof DEFAULT_PARAMS, cols: number, rows: number) {
    return generateTerrain(new RNG(1), { ...params, seaLevelTargetWaterFraction: 0 }, cols, rows);
  }

  it("always plants when saplingChance is 1, within saplingSpreadRadius", () => {
    const params = { ...DEFAULT_PARAMS, saplingChance: 1, saplingSpreadRadius: 5 };
    const treeState: TreeState = { nextId: 0, trees: [] };
    const world = initWorld(20, 20);
    const terrain = noWaterTerrain(params, 20, 20);
    const rng = new RNG(9);
    trySeedSapling(treeState, 50, 50, rng, params, terrain, 123, world);

    expect(treeState.trees.length).toBe(1);
    const sapling = treeState.trees[0];
    expect(sapling.maturedTick).toBeNull();
    expect(sapling.plantedTick).toBe(123);
    const dx = sapling.x - 50;
    const dy = sapling.y - 50;
    expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThanOrEqual(params.saplingSpreadRadius + 1e-9);
  });

  it("inherits the capacity of whichever tree owns the eaten cell", () => {
    const params = { ...DEFAULT_PARAMS, saplingChance: 1, saplingSpreadRadius: 5 };
    const world = initWorld(20, 20);
    const terrain = noWaterTerrain(params, 20, 20);
    const treeState: TreeState = { nextId: 1, trees: [{ id: 0, x: 50, y: 50, plantedTick: 0, maturedTick: 0, capacity: 1.5 }] };
    const rng = new RNG(9);
    trySeedSapling(treeState, 50, 50, rng, params, terrain, 0, world);

    const sapling = treeState.trees.find((t) => t.id !== 0)!;
    expect(sapling.capacity).toBe(1.5);
  });

  it("falls back to poor capacity when no tree owns the eaten cell", () => {
    const params = { ...DEFAULT_PARAMS, saplingChance: 1, saplingSpreadRadius: 5, patchBimodality: 1 };
    const world = initWorld(20, 20);
    const terrain = noWaterTerrain(params, 20, 20);
    const treeState: TreeState = { nextId: 0, trees: [] };
    const rng = new RNG(9);
    trySeedSapling(treeState, 50, 50, rng, params, terrain, 0, world);

    expect(treeState.trees[0].capacity).toBeCloseTo(params.treeFruitCapacity * 0.15);
  });

  it("never plants when saplingChance is 0", () => {
    const params = { ...DEFAULT_PARAMS, saplingChance: 0 };
    const treeState: TreeState = { nextId: 0, trees: [] };
    const world = initWorld(20, 20);
    const terrain = noWaterTerrain(params, 20, 20);
    const rng = new RNG(9);
    for (let i = 0; i < 50; i++) trySeedSapling(treeState, 50, 50, rng, params, terrain, 0, world);
    expect(treeState.trees.length).toBe(0);
  });

  it("does not plant when the candidate cell is deep underwater", () => {
    const params = { ...DEFAULT_PARAMS, saplingChance: 1, saplingSpreadRadius: 5 };
    const world = initWorld(20, 20);
    const terrain = generateTerrain(new RNG(1), { ...params, seaLevelTargetWaterFraction: 1 }, 20, 20); // everything is water
    const treeState: TreeState = { nextId: 0, trees: [] };
    const rng = new RNG(9);
    trySeedSapling(treeState, 50, 50, rng, params, terrain, 0, world);

    expect(treeState.trees.length).toBe(0);
  });

  // SPEC.md Addendum 10 (Milestone 4: water as a real niche).
  it("does plant when the candidate cell is shallow water, not just land", () => {
    const params = { ...DEFAULT_PARAMS, saplingChance: 1, saplingSpreadRadius: 5 };
    const cols = 20;
    const rows = 20;
    const world = initWorld(cols, rows);
    // Flat terrain, entirely at depth = shallowWaterMaxDepth / 2 below sea level — every candidate
    // cell within saplingSpreadRadius is guaranteed shallow water, none of it deep.
    const terrain = {
      cols,
      rows,
      elevation: new Float64Array(cols * rows).fill(0),
      passability: new Float64Array(cols * rows).fill(1),
      fertility: new Float64Array(cols * rows).fill(0.2),
      seaLevel: params.shallowWaterMaxDepth / 2,
      revision: 0,
    };
    const treeState: TreeState = { nextId: 0, trees: [] };
    const rng = new RNG(9);
    trySeedSapling(treeState, 50, 50, rng, params, terrain, 42, world);

    expect(treeState.trees.length).toBe(1);
    expect(treeState.trees[0].plantedTick).toBe(42);
  });
});
