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
    const idx = gy * state.terrain.cols + gx;

    const beforeElevation = state.terrain.elevation[idx];
    const beforePassability = state.terrain.passability[idx];

    const intervention: Intervention = { tick: 0, tool: "raiseTerrain", params: { x, y, radius: 12, strength: 1 } };
    applyIntervention(state, rng, params, intervention);

    expect(state.terrain.elevation[idx]).toBeGreaterThan(beforeElevation);
    expect(state.terrain.passability[idx]).toBeLessThanOrEqual(beforePassability);
  });

  it("lowerTerrain decreases elevation, never below 0", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const x = params.worldWidth / 2;
    const y = params.worldHeight / 2;

    for (let i = 0; i < 20; i++) {
      applyIntervention(state, rng, params, { tick: 0, tool: "lowerTerrain", params: { x, y, radius: 12, strength: 1 } });
    }

    expect(Array.from(state.terrain.elevation).every((e) => e >= 0)).toBe(true);
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
    applyIntervention(state, rng, params, intervention);

    const gy = Math.floor(100 / params.gridCellSize);
    const idx = gy * state.terrain.cols + Math.floor(50 / params.gridCellSize);
    expect(state.terrain.passability[idx]).toBe(0);
  });

  it("ramps passability gradually when formationTicks > 0", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const gy = Math.floor(100 / params.gridCellSize);
    const idx = gy * state.terrain.cols + Math.floor(50 / params.gridCellSize);
    const before = state.terrain.passability[idx];

    const intervention: Intervention = {
      tick: 0,
      tool: "barrierStamp",
      params: { x1: 0, y1: 100, x2: 200, y2: 100, width: 8, targetPassability: 0, formationTicks: 100 },
    };
    applyIntervention(state, rng, params, intervention);

    // Immediately after applying, nothing has ramped yet (transition starts at tick 0, no processing has run).
    expect(state.terrain.passability[idx]).toBeCloseTo(before);

    processActiveTransitions(state, 50);
    const halfway = state.terrain.passability[idx];
    expect(halfway).toBeLessThan(before);
    expect(halfway).toBeGreaterThan(0);

    processActiveTransitions(state, 100);
    expect(state.terrain.passability[idx]).toBeCloseTo(0);
    expect(state.activeTransitions.length).toBe(0);
  });
});

describe("dropFood", () => {
  it("increases both capacity and current amount near the target point", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const x = params.worldWidth / 2;
    const y = params.worldHeight / 2;
    const gx = Math.floor(x / params.gridCellSize);
    const gy = Math.floor(y / params.gridCellSize);
    const idx = gy * state.world.cols + gx;

    const beforeCapacity = state.world.capacityR[idx];
    const beforeAmount = state.world.r[idx];

    applyIntervention(state, rng, params, { tick: 0, tool: "dropFood", params: { x, y, radius: 8, foodType: 0, density: 5 } });

    expect(state.world.capacityR[idx]).toBeGreaterThan(beforeCapacity);
    expect(state.world.r[idx]).toBeGreaterThan(beforeAmount);
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
    const idx = gy * state.world.cols + gx;

    state.world.r[idx] = 0;
    applyIntervention(state, rng, params, { tick: 0, tool: "drought", params: { x, y, radius: 8, multiplier: 0, durationTicks: 50 } });

    processRegrowthOverrides(state, 0);
    expect(state.world.regrowthModifier[idx]).toBe(0);

    processRegrowthOverrides(state, 60);
    expect(state.world.regrowthModifier[idx]).toBe(1);
  });
});

describe("meteor", () => {
  it("kills every creature within radius and leaves creatures outside it alone", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const cx = params.worldWidth / 2;
    const cy = params.worldHeight / 2;

    state.creatures = state.creatures.map((c, i) => ({ ...c, x: i === 0 ? cx : cx + 90, y: cy }));
    const populationBefore = state.creatures.length;

    applyIntervention(state, rng, params, { tick: 0, tool: "meteor", params: { x: cx, y: cy, radius: 10, craterRecoveryTicks: 200 } });

    expect(state.creatures.length).toBeLessThan(populationBefore);
    expect(state.creatures.some((c) => Math.abs(c.x - (cx + 90)) < 1)).toBe(true);
  });

  it("zeroes fertility immediately and recovers it over craterRecoveryTicks", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const x = params.worldWidth / 2;
    const y = params.worldHeight / 2;
    const gx = Math.floor(x / params.gridCellSize);
    const gy = Math.floor(y / params.gridCellSize);
    const idx = gy * state.terrain.cols + gx;

    applyIntervention(state, rng, params, { tick: 0, tool: "meteor", params: { x, y, radius: 10, craterRecoveryTicks: 100 } });
    expect(state.terrain.fertility[idx]).toBe(0);

    processActiveTransitions(state, 100);
    expect(state.terrain.fertility[idx]).toBeGreaterThan(0);
  });
});

describe("seedFounders", () => {
  it("adds exactly count creatures near the target point", () => {
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const params = DEFAULT_PARAMS;
    const before = state.creatures.length;

    applyIntervention(state, rng, params, {
      tick: 0,
      tool: "seedFounders",
      params: { x: 50, y: 50, spreadRadius: 2, count: 10, genome: "random" },
    });

    expect(state.creatures.length).toBe(before + 10);
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
    const totalTicks = instance.state.tick;

    // Headless replay from just the captured log.
    const replayed = runSimulation(seed, params, instance.interventionLog, totalTicks);
    const replayHash = hashState(replayed);

    expect(replayHash).toBe(liveHash);
  });
});
