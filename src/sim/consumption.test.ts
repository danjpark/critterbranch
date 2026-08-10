import { describe, expect, it } from "vitest";
import { cloneConsumptionGrid, decayConsumption, initConsumptionGrid, recordConsumption } from "./consumption.ts";

describe("consumption grid", () => {
  it("accumulates consumption per species per cell", () => {
    const grid = initConsumptionGrid(4, 4);
    recordConsumption(grid, 0, 5, 1.5);
    recordConsumption(grid, 0, 5, 0.5);
    recordConsumption(grid, 1, 5, 2.0);

    expect(grid.bySpecies.get(0)?.[5]).toBeCloseTo(2.0);
    expect(grid.bySpecies.get(1)?.[5]).toBeCloseTo(2.0);
  });

  it("ignores non-positive amounts", () => {
    const grid = initConsumptionGrid(4, 4);
    recordConsumption(grid, 0, 0, 0);
    recordConsumption(grid, 0, 0, -1);
    expect(grid.bySpecies.has(0)).toBe(false);
  });

  it("decays every cell toward zero each call, and prunes a species once its trace is negligible", () => {
    const grid = initConsumptionGrid(2, 2);
    recordConsumption(grid, 0, 0, 1.0);

    decayConsumption(grid, 0.5);
    expect(grid.bySpecies.get(0)?.[0]).toBeCloseTo(0.5);

    for (let i = 0; i < 30; i++) decayConsumption(grid, 0.5);
    expect(grid.bySpecies.has(0)).toBe(false);
  });

  it("clones independently of the original", () => {
    const grid = initConsumptionGrid(2, 2);
    recordConsumption(grid, 0, 0, 1.0);
    const clone = cloneConsumptionGrid(grid);

    recordConsumption(grid, 0, 0, 5.0);
    expect(clone.bySpecies.get(0)?.[0]).toBeCloseTo(1.0);
    expect(grid.bySpecies.get(0)?.[0]).toBeCloseTo(6.0);
  });
});
