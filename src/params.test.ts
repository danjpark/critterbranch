import { describe, expect, it } from "vitest";
import { GENE_RANGES } from "./sim/genome.ts";
import { DEFAULT_PARAMS, DEFAULT_RUN_PARAMS, flattenParams, groupParams, mergeRunParams, type RunParams } from "./params.ts";

describe("DEFAULT_PARAMS safety invariants", () => {
  it("keeps offspringEnergyFractionMax below the lowest possible reproThreshold", () => {
    // If this ever stops holding, a child's birth energy can itself clear its own reproduction
    // threshold before it forages — the exact windfall-cascade bug reproduce() was written to
    // prevent (see creature.test.ts). This guards the invariant at the params level so a future
    // tuning change can't silently reintroduce it.
    const [minReproThreshold] = GENE_RANGES.reproThreshold;
    expect(DEFAULT_PARAMS.offspringEnergyFractionMax).toBeLessThan(minReproThreshold);
  });

  it("keeps every metabolic cost coefficient positive — no trait should be free", () => {
    expect(DEFAULT_PARAMS.baseCost).toBeGreaterThan(0);
    expect(DEFAULT_PARAMS.moveCost).toBeGreaterThan(0);
    expect(DEFAULT_PARAMS.senseCost).toBeGreaterThan(0);
  });
});

describe("RunParams grouping", () => {
  it("groupParams/flattenParams round-trip losslessly", () => {
    expect(flattenParams(groupParams(DEFAULT_PARAMS))).toEqual(DEFAULT_PARAMS);
    expect(groupParams(flattenParams(DEFAULT_RUN_PARAMS))).toEqual(DEFAULT_RUN_PARAMS);
  });

  it("accounts for every Params field exactly once across the domain groups", () => {
    const flatKeys = Object.keys(DEFAULT_PARAMS).sort();
    const groupedKeys = Object.values(DEFAULT_RUN_PARAMS)
      .flatMap((group) => Object.keys(group))
      .sort();
    expect(groupedKeys).toEqual(flatKeys);
  });

  it("mergeRunParams fills in a missing field within one subgroup without dropping its siblings", () => {
    const partial: Partial<Record<keyof RunParams, unknown>> = {
      world: { ...DEFAULT_RUN_PARAMS.world, worldWidth: 999 },
      // reproduction deliberately omitted entirely -- must come back as full defaults, not undefined.
    };
    const merged = mergeRunParams(DEFAULT_RUN_PARAMS, partial);
    expect(merged.world.worldWidth).toBe(999);
    expect(merged.world.worldHeight).toBe(DEFAULT_RUN_PARAMS.world.worldHeight);
    expect(merged.reproduction).toEqual(DEFAULT_RUN_PARAMS.reproduction);
  });
});
