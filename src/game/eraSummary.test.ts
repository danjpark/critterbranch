import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../params.ts";
import { advanceGameEra, createGame } from "./game.ts";
import { computeEraDelta } from "./eraSummary.ts";

const TEST_ERA_CONFIG = { ticksPerEra: 300 };

describe("advanceGameEra summary", () => {
  it("captures matching before/after snapshots and a consistent delta", () => {
    const game = createGame({ mode: "sandbox", seed: 3, params: DEFAULT_PARAMS, eraConfig: TEST_ERA_CONFIG });
    const summary = advanceGameEra(game);

    expect(summary.before.tick).toBe(0);
    expect(summary.after.tick).toBe(TEST_ERA_CONFIG.ticksPerEra);
    expect(summary.delta).toEqual(computeEraDelta(summary.before, summary.after));
    expect(summary.delta.populationChange).toBe(summary.after.totalPopulation - summary.before.totalPopulation);
  });

  it("computeEraDelta reports species that appeared and disappeared between two snapshots", () => {
    const before = { era: 0, tick: 0, totalPopulation: 10, livingSpeciesCount: 2, livingSpeciesIds: [0, 1] };
    const after = { era: 1, tick: 100, totalPopulation: 12, livingSpeciesCount: 2, livingSpeciesIds: [0, 2] };

    const delta = computeEraDelta(before, after);

    expect(delta.newSpeciesIds).toEqual([2]);
    expect(delta.extinctSpeciesIds).toEqual([1]);
    expect(delta.populationChange).toBe(2);
  });
});
