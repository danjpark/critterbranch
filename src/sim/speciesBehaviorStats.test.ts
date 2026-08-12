import { describe, expect, it } from "vitest";
import { cloneSpeciesBehaviorStats, decaySpeciesBehaviorStats, initSpeciesBehaviorStats, recordBirth, recordDeath } from "./speciesBehaviorStats.ts";

describe("species behavior stats", () => {
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
    recordBirth(stats, 0);
    recordDeath(stats, 0, 100);

    decaySpeciesBehaviorStats(stats, 0.5);
    expect(stats.bySpecies.get(0)?.births).toBeCloseTo(0.5);
    expect(stats.bySpecies.get(0)?.deaths).toBeCloseTo(0.5);

    for (let i = 0; i < 30; i++) decaySpeciesBehaviorStats(stats, 0.5);
    expect(stats.bySpecies.has(0)).toBe(false);
  });

  it("clones independently of the original", () => {
    const stats = initSpeciesBehaviorStats();
    recordBirth(stats, 0);
    const clone = cloneSpeciesBehaviorStats(stats);

    recordBirth(stats, 0);
    expect(clone.bySpecies.get(0)?.births).toBe(1);
    expect(stats.bySpecies.get(0)?.births).toBe(2);
  });
});
