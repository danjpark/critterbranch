import { describe, expect, it } from "vitest";
import { createSimState, tick } from "./sim.ts";
import { hashState } from "./testHash.ts";
import { DEFAULT_PARAMS } from "../params.ts";

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
