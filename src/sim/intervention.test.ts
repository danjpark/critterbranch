import { describe, expect, it } from "vitest";
import {
  applyIntervention,
  processActiveTransitions,
  processRegrowthOverrides,
  type Intervention,
} from "./intervention.ts";
import { createSimState, tick, applyInterventionNow, runSimulation } from "./sim.ts";
import { hashState } from "./testHash.ts";
import { DEFAULT_PARAMS } from "../params.ts";

describe("raiseTerrain / lowerTerrain", () => {
  it("raiseTerrain increases elevation and decreases passability/fertility at the target point", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const x = params.worldWidth / 2;
    const y = params.worldHeight / 2;
    const gx = Math.floor(x / params.gridCellSize);
    const gy = Math.floor(y / params.gridCellSize);
    const idx = gy * state.evolution.terrain.cols + gx;

    const beforeElevation = state.evolution.terrain.elevation[idx];
    const beforePassability = state.evolution.terrain.passability[idx];

    const intervention: Intervention = { tick: 0, tool: "raiseTerrain", params: { x, y, radius: 12, strength: 1 } };
    applyIntervention(state.evolution, rng, params, intervention);

    expect(state.evolution.terrain.elevation[idx]).toBeGreaterThan(beforeElevation);
    expect(state.evolution.terrain.passability[idx]).toBeLessThanOrEqual(beforePassability);
  });

  it("lowerTerrain decreases elevation, can carve new water below the old absolute-0 floor", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const x = params.worldWidth / 2;
    const y = params.worldHeight / 2;
    const gx = Math.floor(x / params.gridCellSize);
    const gy = Math.floor(y / params.gridCellSize);
    const idx = gy * state.evolution.terrain.cols + gx;

    for (let i = 0; i < 20; i++) {
      applyIntervention(state.evolution, rng, params, { tick: 0, tool: "lowerTerrain", params: { x, y, radius: 12, strength: 1 } });
    }

    expect(Array.from(state.evolution.terrain.elevation).every((e) => e >= -3 - 1e-9)).toBe(true);
    expect(state.evolution.terrain.elevation[idx]).toBeLessThan(state.evolution.terrain.seaLevel);
    expect(state.evolution.terrain.fertility[idx]).toBe(0);
  });
});

describe("raiseSeaLevel / lowerSeaLevel", () => {
  it("raiseSeaLevel raises the waterline and floods previously-dry cells", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const before = state.evolution.terrain.seaLevel;

    applyIntervention(state.evolution, rng, params, { tick: 0, tool: "raiseSeaLevel", params: { strength: 1 } });

    expect(state.evolution.terrain.seaLevel).toBeGreaterThan(before);
    let floodedSomething = false;
    let floodedSomethingDeep = false;
    for (let i = 0; i < state.evolution.terrain.elevation.length; i++) {
      const depth = state.evolution.terrain.seaLevel - state.evolution.terrain.elevation[i];
      if (depth > 0) {
        floodedSomething = true;
        // Shallow water gets real (if modest) fertility since SPEC.md Addendum 10 — only past
        // shallowWaterMaxDepth does flooding zero it out entirely.
        if (depth > params.shallowWaterMaxDepth) {
          expect(state.evolution.terrain.fertility[i]).toBe(0);
          floodedSomethingDeep = true;
        }
      }
    }
    expect(floodedSomething).toBe(true);
    expect(floodedSomethingDeep).toBe(true);
  });

  it("lowerSeaLevel lowers the waterline", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const before = state.evolution.terrain.seaLevel;

    applyIntervention(state.evolution, rng, params, { tick: 0, tool: "lowerSeaLevel", params: { strength: 1 } });

    expect(state.evolution.terrain.seaLevel).toBeLessThan(before);
  });

  it("recomputes passability/fertility for the whole grid, not just cells near a click point", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const revisionBefore = state.evolution.terrain.revision;

    applyIntervention(state.evolution, rng, params, { tick: 0, tool: "raiseSeaLevel", params: { strength: 1 } });

    expect(state.evolution.terrain.revision).toBeGreaterThan(revisionBefore);
    for (let i = 0; i < state.evolution.terrain.elevation.length; i++) {
      const expectedPassability =
        state.evolution.terrain.elevation[i] >= state.evolution.terrain.seaLevel
          ? 1 - params.passabilitySteepness * (state.evolution.terrain.elevation[i] - state.evolution.terrain.seaLevel)
          : undefined;
      if (expectedPassability !== undefined && expectedPassability >= 0 && expectedPassability <= 1) {
        expect(state.evolution.terrain.passability[i]).toBeCloseTo(expectedPassability);
      }
    }
  });
});

describe("barrierStamp", () => {
  it("instantly sets passability along the line when formationTicks is 0", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const intervention: Intervention = {
      tick: 0,
      tool: "barrierStamp",
      params: { x1: 0, y1: 100, x2: 200, y2: 100, width: 8, targetPassability: 0, formationTicks: 0 },
    };
    applyIntervention(state.evolution, rng, params, intervention);

    const gy = Math.floor(100 / params.gridCellSize);
    const idx = gy * state.evolution.terrain.cols + Math.floor(50 / params.gridCellSize);
    expect(state.evolution.terrain.passability[idx]).toBe(0);
  });

  it("ramps passability gradually when formationTicks > 0", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const gy = Math.floor(100 / params.gridCellSize);
    const idx = gy * state.evolution.terrain.cols + Math.floor(50 / params.gridCellSize);
    const before = state.evolution.terrain.passability[idx];

    const intervention: Intervention = {
      tick: 0,
      tool: "barrierStamp",
      params: { x1: 0, y1: 100, x2: 200, y2: 100, width: 8, targetPassability: 0, formationTicks: 100 },
    };
    applyIntervention(state.evolution, rng, params, intervention);

    // Immediately after applying, nothing has ramped yet (transition starts at tick 0, no processing has run).
    expect(state.evolution.terrain.passability[idx]).toBeCloseTo(before);

    processActiveTransitions(state.evolution, 50);
    const halfway = state.evolution.terrain.passability[idx];
    expect(halfway).toBeLessThan(before);
    expect(halfway).toBeGreaterThan(0);

    processActiveTransitions(state.evolution, 100);
    expect(state.evolution.terrain.passability[idx]).toBeCloseTo(0);
    expect(state.evolution.activeTransitions.length).toBe(0);
  });
});

describe("plantTree", () => {
  it("adds count new mature trees near the target point, with fruit filled at their cells", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const x = params.worldWidth / 2;
    const y = params.worldHeight / 2;
    const before = state.evolution.trees.trees.length;

    applyIntervention(state.evolution, rng, params, { tick: 0, tool: "plantTree", params: { x, y, radius: 8, count: 5 } });

    expect(state.evolution.trees.trees.length).toBe(before + 5);
    const planted = state.evolution.trees.trees.slice(before);
    for (const tree of planted) {
      expect(tree.maturedTick).toBe(0);
      const gx = Math.floor(tree.x / params.gridCellSize);
      const gy = Math.floor(tree.y / params.gridCellSize);
      const idx = gy * state.evolution.world.cols + gx;
      expect(state.evolution.world.fruit[idx]).toBeCloseTo(params.treeFruitCapacity * state.evolution.terrain.fertility[idx]);
    }
  });
});

describe("drought / bloom", () => {
  it("drought (low multiplier) suppresses regrowth for its duration, then regrowth resumes", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const x = params.worldWidth / 2;
    const y = params.worldHeight / 2;
    const gx = Math.floor(x / params.gridCellSize);
    const gy = Math.floor(y / params.gridCellSize);
    const idx = gy * state.evolution.world.cols + gx;

    state.evolution.world.fruit[idx] = 0;
    applyIntervention(state.evolution, rng, params, { tick: 0, tool: "drought", params: { x, y, radius: 8, multiplier: 0, durationTicks: 50 } });

    processRegrowthOverrides(state.evolution, 0);
    expect(state.evolution.world.regrowthModifier[idx]).toBe(0);

    processRegrowthOverrides(state.evolution, 60);
    expect(state.evolution.world.regrowthModifier[idx]).toBe(1);
  });
});

describe("meteor", () => {
  it("kills every creature within radius and leaves creatures outside it alone", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const cx = params.worldWidth / 2;
    const cy = params.worldHeight / 2;

    state.evolution.creatures = state.evolution.creatures.map((c, i) => ({ ...c, x: i === 0 ? cx : cx + 90, y: cy }));
    const populationBefore = state.evolution.creatures.length;

    applyIntervention(state.evolution, rng, params, { tick: 0, tool: "meteor", params: { x: cx, y: cy, radius: 10, craterRecoveryTicks: 200 } });

    expect(state.evolution.creatures.length).toBeLessThan(populationBefore);
    expect(state.evolution.creatures.some((c) => Math.abs(c.x - (cx + 90)) < 1)).toBe(true);
  });

  it("zeroes fertility immediately, and recovers it over craterRecoveryTicks when the crater stays above sea level", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const x = params.worldWidth / 2;
    const y = params.worldHeight / 2;
    const gx = Math.floor(x / params.gridCellSize);
    const gy = Math.floor(y / params.gridCellSize);
    const idx = gy * state.evolution.terrain.cols + gx;

    // Raise the impact site well above sea level first so the crater (elevation -= 0.5) can't dig
    // it back underwater — a crater that DOES end up underwater legitimately stays barren forever
    // (a crater lake), which is covered by the next test, not this one.
    applyIntervention(state.evolution, rng, params, { tick: 0, tool: "raiseTerrain", params: { x, y, radius: 10, strength: 2 } });
    applyIntervention(state.evolution, rng, params, { tick: 0, tool: "meteor", params: { x, y, radius: 10, craterRecoveryTicks: 100 } });
    expect(state.evolution.terrain.fertility[idx]).toBe(0);
    expect(state.evolution.terrain.elevation[idx]).toBeGreaterThan(state.evolution.terrain.seaLevel);

    processActiveTransitions(state.evolution, 100);
    expect(state.evolution.terrain.fertility[idx]).toBeGreaterThan(0);
  });

  it("a crater that ends up underwater stays barren after recovery — a crater lake, not a bug", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const x = params.worldWidth / 2;
    const y = params.worldHeight / 2;
    const gx = Math.floor(x / params.gridCellSize);
    const gy = Math.floor(y / params.gridCellSize);
    const idx = gy * state.evolution.terrain.cols + gx;

    // Lower the impact site well below sea level first so the crater can't help but stay underwater.
    applyIntervention(state.evolution, rng, params, { tick: 0, tool: "lowerTerrain", params: { x, y, radius: 10, strength: 2 } });
    applyIntervention(state.evolution, rng, params, { tick: 0, tool: "meteor", params: { x, y, radius: 10, craterRecoveryTicks: 100 } });
    expect(state.evolution.terrain.elevation[idx]).toBeLessThan(state.evolution.terrain.seaLevel);

    processActiveTransitions(state.evolution, 100);
    expect(state.evolution.terrain.fertility[idx]).toBe(0);
  });
});

describe("seedFounders", () => {
  it("adds exactly count creatures near the target point", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const before = state.evolution.creatures.length;

    applyIntervention(state.evolution, rng, params, {
      tick: 0,
      tool: "seedFounders",
      params: { x: 50, y: 50, spreadRadius: 2, count: 10, genome: "random" },
    });

    expect(state.evolution.creatures.length).toBe(before + 10);
  });
});

describe("replay reproduces a live run with interventions exactly", () => {
  it("hashes identically whether interventions are applied live or replayed from the log", () => {
    const seed = 99;
    const params = DEFAULT_PARAMS;

    // "Live" run: interleave normal ticking with god-mode actions, exactly like the UI would.
    const instance = createSimState(seed, params);
    for (let i = 0; i < 300; i++) tick(instance.state, instance.rng, params);

    applyInterventionNow(instance, params, "barrierStamp", {
      x1: 0,
      y1: 100,
      x2: 200,
      y2: 100,
      width: 6,
      targetPassability: 0.05,
      formationTicks: 150,
    });

    for (let i = 0; i < 400; i++) tick(instance.state, instance.rng, params);

    applyInterventionNow(instance, params, "meteor", { x: 60, y: 60, radius: 15, craterRecoveryTicks: 200 });

    for (let i = 0; i < 200; i++) tick(instance.state, instance.rng, params);

    applyInterventionNow(instance, params, "seedFounders", { x: 150, y: 150, spreadRadius: 5, count: 8, genome: "random" });

    for (let i = 0; i < 300; i++) tick(instance.state, instance.rng, params);

    const liveHash = hashState(instance.state);
    const totalTicks = instance.state.evolution.tick;

    // Headless replay from just the captured log.
    const replayed = runSimulation(seed, params, instance.interventionLog, totalTicks);
    const replayHash = hashState(replayed);

    expect(replayHash).toBe(liveHash);
  });
});
