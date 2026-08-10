import { describe, expect, it } from "vitest";
import { generateTerrain } from "./terrain.ts";
import { RNG } from "./rng.ts";
import { DEFAULT_PARAMS } from "../params.ts";

describe("generateTerrain", () => {
  it("is deterministic for a given RNG sequence", () => {
    const terrainA = generateTerrain(new RNG(42), DEFAULT_PARAMS, 20, 20);
    const terrainB = generateTerrain(new RNG(42), DEFAULT_PARAMS, 20, 20);
    expect(Array.from(terrainA.elevation)).toEqual(Array.from(terrainB.elevation));
  });

  it("keeps elevation within [0, terrainRoughness]", () => {
    const params = { ...DEFAULT_PARAMS, terrainRoughness: 0.4 };
    const terrain = generateTerrain(new RNG(1), params, 20, 20);
    for (const e of terrain.elevation) {
      expect(e).toBeGreaterThanOrEqual(0);
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

  it("gives higher elevation strictly lower passability and fertility", () => {
    const params = { ...DEFAULT_PARAMS, passabilitySteepness: 1, fertilitySteepness: 1 };
    const terrain = generateTerrain(new RNG(1), params, 20, 20);
    let maxIdx = 0;
    let minIdx = 0;
    for (let i = 1; i < terrain.elevation.length; i++) {
      if (terrain.elevation[i] > terrain.elevation[maxIdx]) maxIdx = i;
      if (terrain.elevation[i] < terrain.elevation[minIdx]) minIdx = i;
    }
    expect(terrain.passability[maxIdx]).toBeLessThanOrEqual(terrain.passability[minIdx]);
    expect(terrain.fertility[maxIdx]).toBeLessThanOrEqual(terrain.fertility[minIdx]);
  });
});
