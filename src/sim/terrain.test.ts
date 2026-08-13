import { describe, expect, it } from "vitest";
import { generateTerrain, terrainDerivedFields } from "./terrain.ts";
import { RNG } from "./rng.ts";
import { DEFAULT_PARAMS } from "../params.ts";

describe("generateTerrain", () => {
  it("is deterministic for a given RNG sequence", () => {
    const terrainA = generateTerrain(new RNG(42), DEFAULT_PARAMS, 20, 20);
    const terrainB = generateTerrain(new RNG(42), DEFAULT_PARAMS, 20, 20);
    expect(Array.from(terrainA.elevation)).toEqual(Array.from(terrainB.elevation));
    expect(terrainA.seaLevel).toBe(terrainB.seaLevel);
  });

  it("keeps elevation within [-terrainRoughness, terrainRoughness] (signed hills, symmetric normalization)", () => {
    const params = { ...DEFAULT_PARAMS, terrainRoughness: 0.4 };
    const terrain = generateTerrain(new RNG(1), params, 20, 20);
    for (const e of terrain.elevation) {
      expect(e).toBeGreaterThanOrEqual(-0.4 - 1e-9);
      expect(e).toBeLessThanOrEqual(0.4 + 1e-9);
    }
  });

  it("keeps passability and fertility within [0, 1]", () => {
    const terrain = generateTerrain(new RNG(1), DEFAULT_PARAMS, 20, 20);
    for (let i = 0; i < terrain.passability.length; i++) {
      expect(terrain.passability[i]).toBeGreaterThanOrEqual(0);
      expect(terrain.passability[i]).toBeLessThanOrEqual(1);
      expect(terrain.fertility[i]).toBeGreaterThanOrEqual(0);
      expect(terrain.fertility[i]).toBeLessThanOrEqual(1);
    }
  });

  // Regression test for a real bug (SPEC.md Addendum 9): a fixed seaLevel threshold against a
  // landscape built from only ~5 signed random hills is wildly seed-dependent — measured 33% to
  // 100% water coverage across 5 seeds at a fixed seaLevel=0 before this fix. Percentile-based
  // seaLevel selection (seaLevelForTargetWaterFraction) is what actually keeps it stable.
  it("hits its target water fraction consistently across seeds, not just on average", () => {
    const cols = 30;
    const rows = 30;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const terrain = generateTerrain(new RNG(seed), DEFAULT_PARAMS, cols, rows);
      let underwater = 0;
      for (const e of terrain.elevation) if (e < terrain.seaLevel) underwater++;
      const fraction = underwater / terrain.elevation.length;
      expect(fraction).toBeCloseTo(DEFAULT_PARAMS.seaLevelTargetWaterFraction, 1);
    }
  });
});

describe("terrainDerivedFields", () => {
  it("gives full passability and fertility exactly at sea level", () => {
    const { passability, fertility } = terrainDerivedFields(0.1, 0.1, DEFAULT_PARAMS);
    expect(passability).toBe(1);
    expect(fertility).toBe(1);
  });

  it("decreases land passability/fertility monotonically with height above sea level", () => {
    const params = { ...DEFAULT_PARAMS, passabilitySteepness: 1, fertilitySteepness: 1 };
    const near = terrainDerivedFields(0.05, 0, params);
    const far = terrainDerivedFields(0.2, 0, params);
    expect(far.passability).toBeLessThan(near.passability);
    expect(far.fertility).toBeLessThan(near.fertility);
  });

  it("gives water cells hard-zero fertility regardless of depth (no aquatic food until M4)", () => {
    expect(terrainDerivedFields(-0.01, 0, DEFAULT_PARAMS).fertility).toBe(0);
    expect(terrainDerivedFields(-1, 0, DEFAULT_PARAMS).fertility).toBe(0);
  });

  it("decreases water passability monotonically with depth, steeper than the land falloff", () => {
    const shallow = terrainDerivedFields(-0.02, 0, DEFAULT_PARAMS);
    const deep = terrainDerivedFields(-0.15, 0, DEFAULT_PARAMS);
    expect(deep.passability).toBeLessThan(shallow.passability);
    expect(deep.passability).toBe(0);
  });

  it("treats elevation relative to sea level, not absolute zero", () => {
    // A cell at elevation 0.2 with seaLevel 0.2 is right at the waterline (full passability);
    // the same absolute elevation with seaLevel 0 is well inland and penalized.
    const atWaterline = terrainDerivedFields(0.2, 0.2, DEFAULT_PARAMS);
    const inland = terrainDerivedFields(0.2, 0, DEFAULT_PARAMS);
    expect(atWaterline.passability).toBe(1);
    expect(inland.passability).toBeLessThan(1);
  });
});
