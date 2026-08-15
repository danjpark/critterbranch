import { describe, expect, it } from "vitest";
import { GENE_RANGES } from "./sim/genome.ts";
import { DEFAULT_PARAMS, DEFAULT_RUN_PARAMS, flattenParams, groupParams, mergeRunParams, sanitizeParams, type RunParams } from "./params.ts";

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

describe("sanitizeParams", () => {
  it("leaves an already-valid set of params completely untouched", () => {
    const result = sanitizeParams(DEFAULT_PARAMS);
    expect(result.params).toEqual(DEFAULT_PARAMS);
    expect(result.repairs).toEqual([]);
  });

  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["a string", "3" as unknown as number],
    ["null", null as unknown as number],
    ["undefined", undefined as unknown as number],
  ])("replaces %s with the field's default", (_label, value) => {
    const result = sanitizeParams({ ...DEFAULT_PARAMS, intakeRate: value });
    expect(result.params.intakeRate).toBe(DEFAULT_PARAMS.intakeRate);
    expect(result.repairs).toHaveLength(1);
  });

  // Each of these is a value that leaves the sim running but silently broken rather than visibly
  // wrong — see PARAM_MINIMUMS in params.ts for what each one disables or poisons.
  it.each([
    ["regrowthCyclePeriod", "regrowthCyclePeriod"],
    ["taxonomyIntervalTicks", "taxonomyIntervalTicks"],
    ["consumptionDecayIntervalTicks", "consumptionDecayIntervalTicks"],
    ["treeCrowdingCheckIntervalTicks", "treeCrowdingCheckIntervalTicks"],
    ["gridCellSize", "gridCellSize"],
  ] as const)("raises a zero %s to a usable minimum", (_label, key) => {
    const result = sanitizeParams({ ...DEFAULT_PARAMS, [key]: 0 });
    expect(result.params[key]).toBeGreaterThan(0);
    expect(result.repairs.join(" ")).toContain(key);
  });

  it("snaps world dimensions to a whole number of grid cells so the sim's two notions of world width agree", () => {
    // createSimState derives cols = round(worldWidth / gridCellSize), so movement wraps at
    // cols * gridCellSize while reproduce()/trySeedSapling() wrap at params.worldWidth. 201/4
    // rounds to 50 cells = 200 units, leaving a 1-unit strip creatures can be placed in but never
    // move within.
    const result = sanitizeParams({ ...DEFAULT_PARAMS, worldWidth: 201, gridCellSize: 4 });
    expect(result.params.worldWidth).toBe(200);
    expect(result.params.worldWidth % result.params.gridCellSize).toBe(0);
    expect(result.repairs.join(" ")).toContain("worldWidth");
  });

  it("reports every repair it made, so a caller can surface them rather than silently accepting junk", () => {
    const result = sanitizeParams({ ...DEFAULT_PARAMS, intakeRate: NaN, taxonomyIntervalTicks: 0 });
    expect(result.repairs).toHaveLength(2);
  });
});
