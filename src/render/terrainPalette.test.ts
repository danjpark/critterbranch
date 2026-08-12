import { describe, expect, it } from "vitest";
import { elevationBand, terrainCellColor } from "./terrainPalette.ts";

const ROUGHNESS = 0.3;

describe("elevationBand", () => {
  it("classifies low elevation as lowland", () => {
    expect(elevationBand(0, ROUGHNESS)).toBe("lowland");
    expect(elevationBand(ROUGHNESS * 0.2, ROUGHNESS)).toBe("lowland");
  });

  it("classifies mid elevation as hill", () => {
    expect(elevationBand(ROUGHNESS * 0.5, ROUGHNESS)).toBe("hill");
  });

  it("classifies high elevation as mountain", () => {
    expect(elevationBand(ROUGHNESS * 0.9, ROUGHNESS)).toBe("mountain");
  });

  it("clamps a hand-raised peak far above terrainRoughness into mountain, not a new category", () => {
    expect(elevationBand(3, ROUGHNESS)).toBe("mountain");
  });

  it("treats zero/negative roughness as an edge case that still returns a valid band", () => {
    expect(elevationBand(0.1, 0)).toBe("mountain");
  });
});

describe("terrainCellColor", () => {
  it("produces a valid rgb() string", () => {
    const color = terrainCellColor(0.1, 0.5, 1, ROUGHNESS);
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it("darkens a low-passability cell relative to an otherwise identical high-passability one", () => {
    const passable = terrainCellColor(0.05, 0.3, 1, ROUGHNESS);
    const blocked = terrainCellColor(0.05, 0.3, 0, ROUGHNESS);
    const channel = (rgb: string) => rgb.match(/\d+/g)!.map(Number);
    const [pr, pg, pb] = channel(passable);
    const [br, bg, bb] = channel(blocked);
    expect(br + bg + bb).toBeLessThan(pr + pg + pb);
  });

  it("a near-peak mountain cell is lighter than a cell just past the mountain threshold", () => {
    const justMountain = terrainCellColor(ROUGHNESS * 0.71, 0, 1, ROUGHNESS);
    const nearPeak = terrainCellColor(ROUGHNESS * 0.99, 0, 1, ROUGHNESS);
    const brightness = (rgb: string) => rgb.match(/\d+/g)!.map(Number).reduce((a, b) => a + b, 0);
    expect(brightness(nearPeak)).toBeGreaterThan(brightness(justMountain));
  });
});
