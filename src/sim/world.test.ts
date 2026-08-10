import { describe, expect, it } from "vitest";
import { generateWorld, regrowFood } from "./world.ts";
import { generateTerrain } from "./terrain.ts";
import { RNG } from "./rng.ts";
import { DEFAULT_PARAMS } from "../params.ts";

describe("generateWorld", () => {
  it("starts every cell full (r/b equal to their capacity)", () => {
    const terrain = generateTerrain(new RNG(1), DEFAULT_PARAMS, 20, 20);
    const world = generateWorld(new RNG(1), DEFAULT_PARAMS, terrain);
    for (let i = 0; i < world.r.length; i++) {
      expect(world.r[i]).toBeCloseTo(world.capacityR[i]);
      expect(world.b[i]).toBeCloseTo(world.capacityB[i]);
    }
  });

  it("never produces negative capacity", () => {
    const terrain = generateTerrain(new RNG(1), DEFAULT_PARAMS, 20, 20);
    const world = generateWorld(new RNG(1), DEFAULT_PARAMS, terrain);
    for (let i = 0; i < world.capacityR.length; i++) {
      expect(world.capacityR[i]).toBeGreaterThanOrEqual(0);
      expect(world.capacityB[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it("gradient mode biases R toward x=0 and B toward x=cols", () => {
    // terrainRoughness: 0 keeps fertility uniform so terrain noise can't confound the comparison.
    const params = { ...DEFAULT_PARAMS, foodMode: "gradient" as const, terrainRoughness: 0 };
    const terrain = generateTerrain(new RNG(1), params, 20, 20);
    const world = generateWorld(new RNG(1), params, terrain);
    // Compare a left-edge column to a right-edge column, summed over R capacity.
    let leftR = 0;
    let rightR = 0;
    for (let y = 0; y < world.rows; y++) {
      leftR += world.capacityR[y * world.cols + 0];
      rightR += world.capacityR[y * world.cols + (world.cols - 1)];
    }
    expect(leftR).toBeGreaterThan(rightR);
  });
});

describe("regrowFood", () => {
  it("never regrows past capacity", () => {
    const terrain = generateTerrain(new RNG(1), DEFAULT_PARAMS, 20, 20);
    const world = generateWorld(new RNG(1), DEFAULT_PARAMS, terrain);
    // Deplete everything, then regrow for a long time.
    world.r.fill(0);
    world.b.fill(0);
    for (let t = 0; t < 10_000; t++) regrowFood(world, t, DEFAULT_PARAMS);
    for (let i = 0; i < world.r.length; i++) {
      expect(world.r[i]).toBeLessThanOrEqual(world.capacityR[i] + 1e-9);
      expect(world.b[i]).toBeLessThanOrEqual(world.capacityB[i] + 1e-9);
    }
  });

  it("increases food level from empty when regrowthRate is positive", () => {
    const terrain = generateTerrain(new RNG(1), DEFAULT_PARAMS, 20, 20);
    const world = generateWorld(new RNG(1), DEFAULT_PARAMS, terrain);
    world.r.fill(0);
    world.b.fill(0);
    regrowFood(world, 0, DEFAULT_PARAMS);
    const anyGrowth = Array.from(world.r).some((v) => v > 0) || Array.from(world.b).some((v) => v > 0);
    expect(anyGrowth).toBe(true);
  });

  it("oscillates with the regrowth cycle instead of only ever growing", () => {
    // At amplitude 1, the cyclical term hits 0 at a quarter-period offset from its peak —
    // regrowth should stop (not reverse; food never gets removed by regrowth itself).
    const params = { ...DEFAULT_PARAMS, regrowthCycleAmplitude: 1, regrowthCyclePeriod: 100, regrowthRate: 1 };
    const terrain = generateTerrain(new RNG(1), params, 10, 10);
    const world = generateWorld(new RNG(1), params, terrain);
    world.r.fill(0);
    world.b.fill(0);
    // sin(2*pi*tick/period) = -1 at tick = period * 3/4, where the cyclical term clamps to 0.
    const troughTick = 75;
    regrowFood(world, troughTick, params);
    expect(Array.from(world.r).every((v) => v === 0)).toBe(true);
  });
});
