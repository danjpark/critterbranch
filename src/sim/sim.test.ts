import { describe, expect, it } from "vitest";
import { createSimState, tick, type SimState } from "./sim.ts";
import { DEFAULT_PARAMS } from "../ui/params.ts";

function hashState(state: SimState): string {
  const creatureSnapshot = state.creatures.map((c) => [
    c.id,
    c.parentId,
    c.x.toFixed(6),
    c.y.toFixed(6),
    c.energy.toFixed(6),
    c.age,
    JSON.stringify(c.genome),
  ]);
  const payload = JSON.stringify({
    tick: state.tick,
    creatures: creatureSnapshot,
    r: Array.from(state.world.r),
    b: Array.from(state.world.b),
  });

  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (Math.imul(31, hash) + payload.charCodeAt(i)) | 0;
  }
  return `${hash.toString(16)}:${payload.length}`;
}

function runToTick(seed: number, ticks: number): string {
  const { state, rng } = createSimState(seed, DEFAULT_PARAMS);
  for (let i = 0; i < ticks; i++) tick(state, rng, DEFAULT_PARAMS);
  return hashState(state);
}

describe("determinism", () => {
  it("produces an identical hashed state for the same seed after 5000 ticks", () => {
    expect(runToTick(42, 5000)).toBe(runToTick(42, 5000));
  });

  it("produces different states for different seeds", () => {
    expect(runToTick(1, 2000)).not.toBe(runToTick(2, 2000));
  });
});

describe("population dynamics", () => {
  it("does not go extinct immediately under default params", () => {
    const { state, rng } = createSimState(7, DEFAULT_PARAMS);
    for (let i = 0; i < 3000; i++) tick(state, rng, DEFAULT_PARAMS);
    expect(state.creatures.length).toBeGreaterThan(0);
  });
});
