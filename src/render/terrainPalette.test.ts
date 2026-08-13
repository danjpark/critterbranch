import { describe, expect, it } from "vitest";
import { elevationBand, terrainCellColor } from "./terrainPalette.ts";

const ROUGHNESS = 0.3;

describe("elevationBand", () => {
  it("classifies elevation below sea level as water", () => {
    expect(elevationBand(-0.01, 0, ROUGHNESS)).toBe("water");
    expect(elevationBand(0, 0.05, ROUGHNESS)).toBe("water");
  });

  it("classifies low elevation above sea level as lowland", () => {
    expect(elevationBand(0, 0, ROUGHNESS)).toBe("lowland");
    expect(elevationBand(ROUGHNESS * 0.2, 0, ROUGHNESS)).toBe("lowland");
  });

  it("bands are measured relative to sea level, not absolute elevation", () => {
    // Same absolute elevation, different sea level: right at the waterline reads as lowland
    // (norm 0), well above it reads as hill — the point of measuring relative to seaLevel.
    expect(elevationBand(0.2, 0.2, ROUGHNESS)).toBe("lowland");
    expect(elevationBand(0.2, 0, ROUGHNESS)).toBe("hill");
  });

  it("classifies mid elevation as hill", () => {
    expect(elevationBand(ROUGHNESS * 0.5, 0, ROUGHNESS)).toBe("hill");
  });

  it("classifies high elevation as mountain", () => {
    expect(elevationBand(ROUGHNESS * 0.9, 0, ROUGHNESS)).toBe("mountain");
  });

  it("clamps a hand-raised peak far above terrainRoughness into mountain, not a new category", () => {
    expect(elevationBand(3, 0, ROUGHNESS)).toBe("mountain");
  });

  it("treats zero/negative roughness as an edge case that still returns a valid band", () => {
    expect(elevationBand(0.1, 0, 0)).toBe("mountain");
  });
});

describe("terrainCellColor", () => {
  it("produces a valid rgb() string", () => {
    const color = terrainCellColor(0.1, 0, 0.5, 1, ROUGHNESS);
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it("darkens a low-passability cell relative to an otherwise identical high-passability one", () => {
    const passable = terrainCellColor(0.05, 0, 0.3, 1, ROUGHNESS);
    const blocked = terrainCellColor(0.05, 0, 0.3, 0, ROUGHNESS);
    const channel = (rgb: string) => rgb.match(/\d+/g)!.map(Number);
    const [pr, pg, pb] = channel(passable);
    const [br, bg, bb] = channel(blocked);
    expect(br + bg + bb).toBeLessThan(pr + pg + pb);
  });

  it("a near-peak mountain cell is lighter than a cell just past the mountain threshold", () => {
    const justMountain = terrainCellColor(ROUGHNESS * 0.71, 0, 0, 1, ROUGHNESS);
    const nearPeak = terrainCellColor(ROUGHNESS * 0.99, 0, 0, 1, ROUGHNESS);
    const brightness = (rgb: string) => rgb.match(/\d+/g)!.map(Number).reduce((a, b) => a + b, 0);
    expect(brightness(nearPeak)).toBeGreaterThan(brightness(justMountain));
  });

  it("darkens deeper water relative to shallow water, both distinct from land", () => {
    const land = terrainCellColor(0.05, 0, 0.3, 1, ROUGHNESS);
    const shallow = terrainCellColor(-0.01, 0, 0, 0.9, ROUGHNESS);
    const deep = terrainCellColor(-0.15, 0, 0, 0.1, ROUGHNESS);
    const brightness = (rgb: string) => rgb.match(/\d+/g)!.map(Number).reduce((a, b) => a + b, 0);
    expect(brightness(deep)).toBeLessThan(brightness(shallow));
    expect(shallow).not.toBe(land);
  });

  // SPEC.md Addendum 10 (Milestone 4: water as a real niche) — fertile shallow water reads
  // differently from barren water at the same depth/passability, so "this coastline has food" is
  // visible without a separate legend entry.
  it("gives fertile water a different tint than barren water at the same depth", () => {
    const barren = terrainCellColor(-0.01, 0, 0, 0.9, ROUGHNESS);
    const fertile = terrainCellColor(-0.01, 0, 0.3, 0.9, ROUGHNESS);
    expect(fertile).not.toBe(barren);
  });
});
