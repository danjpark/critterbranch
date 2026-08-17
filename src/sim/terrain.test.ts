import { describe, expect, it } from "vitest";
import { elevationBand, generateTerrain, passabilityFromSteepness, terrainDerivedFields, type TerrainGrid } from "./terrain.ts";
import { RNG } from "./rng.ts";
import { DEFAULT_PARAMS, type Params } from "../params.ts";

const ROUGHNESS = 0.3;

/**
 * The cells the ocean border (SPEC.md Addendum 31) doesn't touch — the landmass the player actually
 * plays on. Yields [x, y, elevation]. Mirrors generateTerrain's own borderCells derivation, so if
 * the border width changes these tests follow it instead of silently measuring the wrong region.
 */
function* interiorCells(terrain: TerrainGrid, params: Params): Generator<[number, number, number]> {
  const border = Math.round(Math.min(terrain.cols, terrain.rows) * params.oceanBorderFraction);
  for (let y = border; y < terrain.rows - border; y++) {
    for (let x = border; x < terrain.cols - border; x++) yield [x, y, terrain.elevation[y * terrain.cols + x]];
  }
}

// Moved from render/terrainPalette.test.ts — elevationBand's definition moved here too (SPEC.md
// Addendum 15), since it's pure domain classification, not a rendering concern.
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

describe("generateTerrain", () => {
  it("is deterministic for a given RNG sequence", () => {
    const terrainA = generateTerrain(new RNG(42), DEFAULT_PARAMS, 20, 20);
    const terrainB = generateTerrain(new RNG(42), DEFAULT_PARAMS, 20, 20);
    expect(Array.from(terrainA.elevation)).toEqual(Array.from(terrainB.elevation));
    expect(terrainA.seaLevel).toBe(terrainB.seaLevel);
  });

  it("keeps INTERIOR elevation within [-terrainRoughness, terrainRoughness] (signed hills, symmetric normalization)", () => {
    // The ocean border (SPEC.md Addendum 31) is deliberately outside this range — it blends toward
    // an absolute floor below sea level so the rim is unambiguously deep water. Everything the
    // player actually lives on still obeys the symmetric normalization.
    const params = { ...DEFAULT_PARAMS, terrainRoughness: 0.4 };
    const terrain = generateTerrain(new RNG(1), params, 20, 20);
    for (const [x, y, e] of interiorCells(terrain, params)) {
      expect(e, `cell ${x},${y}`).toBeGreaterThanOrEqual(-0.4 - 1e-9);
      expect(e, `cell ${x},${y}`).toBeLessThanOrEqual(0.4 + 1e-9);
    }
  });

  // SPEC.md Addendum 31. The island border is what makes a hand-drawn barrier mean anything: the
  // map still wraps, but no land creature can reach the seam to walk around a wall through it.
  it("drowns the outer rim deep enough that it is impassable", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const terrain = generateTerrain(new RNG(seed), DEFAULT_PARAMS, 40, 40);
      let rimBest = 0;
      for (let x = 0; x < terrain.cols; x++) {
        rimBest = Math.max(rimBest, terrain.passability[x], terrain.passability[(terrain.rows - 1) * terrain.cols + x]);
      }
      for (let y = 0; y < terrain.rows; y++) {
        rimBest = Math.max(rimBest, terrain.passability[y * terrain.cols], terrain.passability[y * terrain.cols + terrain.cols - 1]);
      }
      expect(rimBest, `seed ${seed}`).toBe(0);
    }
  });

  it("leaves the interior coastline irregular rather than stamping a rectangular island", () => {
    // The border blends toward the ocean floor, so the underlying hill noise survives inside it —
    // a hard rectangle would read as a game board rather than a continent. Measured as: the depth
    // at a fixed distance from the edge is not the same all the way around.
    const terrain = generateTerrain(new RNG(3), DEFAULT_PARAMS, 60, 60);
    const borderCells = Math.round(Math.min(terrain.cols, terrain.rows) * DEFAULT_PARAMS.oceanBorderFraction);
    const ring: number[] = [];
    for (let x = borderCells; x < terrain.cols - borderCells; x++) ring.push(terrain.elevation[borderCells * terrain.cols + x]);
    expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(0.05);
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
    // Measured over the INTERIOR since Addendum 31: the ocean border is water by construction, so
    // counting it would just report the border's own size. seaLevel is likewise chosen from the
    // interior alone — otherwise the border's deep water dominates the percentile and drags the
    // waterline so low the landmass has no lakes or coast at all.
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const terrain = generateTerrain(new RNG(seed), DEFAULT_PARAMS, 30, 30);
      const interior = [...interiorCells(terrain, DEFAULT_PARAMS)];
      const underwater = interior.filter(([, , e]) => e < terrain.seaLevel).length;
      expect(underwater / interior.length, `seed ${seed}`).toBeCloseTo(DEFAULT_PARAMS.seaLevelTargetWaterFraction, 1);
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

  // Deep water (past shallowWaterMaxDepth) stays exactly as barren as Addendum 9 originally made
  // ALL water — the "no aquatic food" claim only ever applied past the shallow band (SPEC.md
  // Addendum 10 gave shallow water real, if modest, fertility; see the "shallow water" describe
  // block below for that).
  it("gives deep water cells hard-zero fertility regardless of depth", () => {
    expect(terrainDerivedFields(-1, 0, DEFAULT_PARAMS).fertility).toBe(0);
    const justPastShallow = terrainDerivedFields(-(DEFAULT_PARAMS.shallowWaterMaxDepth + 0.001), 0, DEFAULT_PARAMS);
    expect(justPastShallow.fertility).toBe(0);
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

// SPEC.md Addendum 10 (Milestone 4: water as a real niche).
describe("terrainDerivedFields — shallow water", () => {
  it("gives real, nonzero fertility right at the waterline, tapering to 0 at shallowWaterMaxDepth", () => {
    // elevation exactly at seaLevel (relative = 0) is the LAND branch (full fertility) — the
    // waterline's shallow-water limit is depth -> 0+, approached but not reached from below.
    const justUnderwater = terrainDerivedFields(-1e-6, 0, DEFAULT_PARAMS);
    expect(justUnderwater.fertility).toBeCloseTo(DEFAULT_PARAMS.shallowWaterFertilityCeiling, 3);

    const atShallowBoundary = terrainDerivedFields(-DEFAULT_PARAMS.shallowWaterMaxDepth, 0, DEFAULT_PARAMS);
    expect(atShallowBoundary.fertility).toBeCloseTo(0);
  });

  it("decreases fertility monotonically with depth within the shallow band", () => {
    const nearShore = terrainDerivedFields(-0.01, 0, DEFAULT_PARAMS);
    const deeperShallow = terrainDerivedFields(-0.03, 0, DEFAULT_PARAMS);
    expect(deeperShallow.fertility).toBeLessThan(nearShore.fertility);
    expect(deeperShallow.fertility).toBeGreaterThan(0);
  });

  it("never exceeds shallowWaterFertilityCeiling, staying well below land's max of 1 (a modest bonus, not a jackpot)", () => {
    // depth starts just past 0 — depth exactly 0 (elevation === seaLevel) is the LAND branch.
    for (let depth = 0.001; depth <= DEFAULT_PARAMS.shallowWaterMaxDepth; depth += 0.005) {
      expect(terrainDerivedFields(-depth, 0, DEFAULT_PARAMS).fertility).toBeLessThanOrEqual(DEFAULT_PARAMS.shallowWaterFertilityCeiling + 1e-9);
    }
    expect(DEFAULT_PARAMS.shallowWaterFertilityCeiling).toBeLessThan(1);
  });

  it("leaves passability untouched by the shallow-water fertility change", () => {
    const params = { ...DEFAULT_PARAMS, shallowWaterFertilityCeiling: 0.9 };
    const a = terrainDerivedFields(-0.02, 0, DEFAULT_PARAMS);
    const b = terrainDerivedFields(-0.02, 0, params);
    expect(a.passability).toBeCloseTo(b.passability);
  });
});

// SPEC.md Addendum 12 (Milestone 6) — the shared low-level shape terrainDerivedFields and
// phenotype.ts's phenotype-aware movement both call, just with different steepness constants.
describe("passabilityFromSteepness", () => {
  it("gives full passability exactly at the waterline (relative=0), regardless of steepness", () => {
    expect(passabilityFromSteepness(0, 1.5, 10)).toBe(1);
    expect(passabilityFromSteepness(0, 5, 0.8)).toBe(1);
  });

  it("tapers land passability with landSteepness, ignoring waterSteepness entirely", () => {
    expect(passabilityFromSteepness(0.1, 1.5, 999)).toBeCloseTo(1 - 1.5 * 0.1);
  });

  it("tapers water passability with waterSteepness, ignoring landSteepness entirely", () => {
    expect(passabilityFromSteepness(-0.1, 999, 0.8)).toBeCloseTo(1 - 0.8 * 0.1);
  });

  it("clamps to [0, 1] rather than going negative or above 1", () => {
    expect(passabilityFromSteepness(10, 1.5, 10)).toBe(0);
    expect(passabilityFromSteepness(-10, 10, 0.8)).toBe(0);
  });

  it("matches terrainDerivedFields exactly when called with the default flat steepness constants", () => {
    const relative = 0.05;
    const viaHelper = passabilityFromSteepness(relative, DEFAULT_PARAMS.passabilitySteepness, DEFAULT_PARAMS.waterPassabilitySteepness);
    const viaTerrainDerivedFields = terrainDerivedFields(relative, 0, DEFAULT_PARAMS).passability;
    expect(viaHelper).toBeCloseTo(viaTerrainDerivedFields);
  });
});
