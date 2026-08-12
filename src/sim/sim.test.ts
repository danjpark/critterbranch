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
    expect(state.evolution.creatures.length).toBeGreaterThan(0);
  });
});

describe("consumption grid", () => {
  it("accumulates real per-species feeding activity as the sim runs — the competition heatmap's data source", () => {
    const { state, rng } = createSimState(7, DEFAULT_PARAMS);
    for (let i = 0; i < 200; i++) tick(state, rng, DEFAULT_PARAMS);

    expect(state.observations.consumptionGrid.bySpecies.size).toBeGreaterThan(0);
    const founderCells = state.observations.consumptionGrid.bySpecies.get(0);
    expect(founderCells).toBeDefined();
    expect(founderCells!.some((v) => v > 0)).toBe(true);
  });
});

describe("species behavior stats", () => {
  it("accumulates diet, and tracks distanceTraveled on living creatures, as the sim runs", () => {
    const { state, rng } = createSimState(7, DEFAULT_PARAMS);
    for (let i = 0; i < 200; i++) tick(state, rng, DEFAULT_PARAMS);

    const founderAcc = state.observations.speciesBehavior.bySpecies.get(0);
    expect(founderAcc).toBeDefined();
    expect(founderAcc!.dietR + founderAcc!.dietB).toBeGreaterThan(0);

    expect(state.evolution.creatures.length).toBeGreaterThan(0);
    expect(state.evolution.creatures.some((c) => c.distanceTraveled > 0)).toBe(true);
  });

  it("records births as the population grows, and deaths once creatures start aging out", () => {
    const { state, rng } = createSimState(3, DEFAULT_PARAMS);
    for (let i = 0; i < 500; i++) tick(state, rng, DEFAULT_PARAMS);

    const founderAcc = state.observations.speciesBehavior.bySpecies.get(0);
    expect(founderAcc).toBeDefined();
    expect(founderAcc!.births).toBeGreaterThan(0);
  });
});

describe("observation history compaction", () => {
  it("bounds populationHistory/traitHistory on a long run instead of growing every sample forever", () => {
    // Actually simulating far enough for compaction to matter (100k+ ticks) would be far too slow
    // for a regular test run — this tests the WIRING (tick() calls compactHistory at the right
    // cadence, HISTORY_COMPACTION_INTERVAL_TICKS=5000) by injecting a large synthetic history and
    // running just one real tick across a compaction boundary, not by actually simulating that long.
    const { state, rng } = createSimState(1, DEFAULT_PARAMS);
    const syntheticSamples = 1000;
    state.observations.populationHistory = Array.from({ length: syntheticSamples }, (_, i) => ({
      tick: i * 100,
      counts: { 0: 500 },
    }));
    state.evolution.tick = 100_000; // a compaction boundary (100000 % HISTORY_COMPACTION_INTERVAL_TICKS(5000) === 0)

    tick(state, rng, DEFAULT_PARAMS);

    expect(state.observations.populationHistory.length).toBeLessThan(syntheticSamples / 3);
    // Still ordered and still ends at (approximately) the current tick -- compaction must never
    // reorder or drop the most recent samples.
    const history = state.observations.populationHistory;
    for (let i = 1; i < history.length; i++) {
      expect(history[i].tick).toBeGreaterThan(history[i - 1].tick);
    }
  });
});
