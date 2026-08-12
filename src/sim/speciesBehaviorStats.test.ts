import { describe, expect, it } from "vitest";
import {
  cloneSpeciesBehaviorStats,
  decaySpeciesBehaviorStats,
  initSpeciesBehaviorStats,
  recordBirth,
  recordDeath,
  recordDiet,
} from "./speciesBehaviorStats.ts";

describe("species behavior stats", () => {
  it("accumulates diet totals per species, split by food type", () => {
    const stats = initSpeciesBehaviorStats();
    recordDiet(stats, 0, 0, 1.5);
    recordDiet(stats, 0, 1, 0.5);
    recordDiet(stats, 1, 0, 2.0);

    expect(stats.bySpecies.get(0)).toMatchObject({ dietR: 1.5, dietB: 0.5 });
    expect(stats.bySpecies.get(1)).toMatchObject({ dietR: 2.0, dietB: 0 });
  });

  it("ignores non-positive diet amounts", () => {
    const stats = initSpeciesBehaviorStats();
    recordDiet(stats, 0, 0, 0);
    recordDiet(stats, 0, 0, -1);
    expect(stats.bySpecies.has(0)).toBe(false);
  });

  it("counts births and deaths, tracking age-at-death separately from raw death count", () => {
    const stats = initSpeciesBehaviorStats();
    recordBirth(stats, 0);
    recordBirth(stats, 0);
    recordDeath(stats, 0, 100);
    recordDeath(stats, 0, 300);

    const acc = stats.bySpecies.get(0)!;
    expect(acc.births).toBe(2);
    expect(acc.deaths).toBe(2);
    expect(acc.sumAgeAtDeath).toBe(400);
  });

  it("decays every field toward zero each call, and prunes a species once its trace is negligible", () => {
    const stats = initSpeciesBehaviorStats();
    recordDiet(stats, 0, 0, 1.0);
    recordBirth(stats, 0);

    decaySpeciesBehaviorStats(stats, 0.5);
    expect(stats.bySpecies.get(0)?.dietR).toBeCloseTo(0.5);
    expect(stats.bySpecies.get(0)?.births).toBeCloseTo(0.5);

    for (let i = 0; i < 30; i++) decaySpeciesBehaviorStats(stats, 0.5);
    expect(stats.bySpecies.has(0)).toBe(false);
  });

  it("clones independently of the original", () => {
    const stats = initSpeciesBehaviorStats();
    recordDiet(stats, 0, 0, 1.0);
    const clone = cloneSpeciesBehaviorStats(stats);

    recordDiet(stats, 0, 0, 5.0);
    expect(clone.bySpecies.get(0)?.dietR).toBeCloseTo(1.0);
    expect(stats.bySpecies.get(0)?.dietR).toBeCloseTo(6.0);
  });
});
