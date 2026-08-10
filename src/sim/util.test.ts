import { describe, expect, it } from "vitest";
import { clamp, clamp01, lerp, torDelta, torDist, wrap } from "./util.ts";

describe("clamp", () => {
  it("passes values already inside the range through unchanged", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("clamps below the minimum", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });
  it("clamps above the maximum", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("clamp01", () => {
  it("clamps to [0, 1]", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1.5)).toBe(1);
  });
});

describe("lerp", () => {
  it("interpolates linearly, including outside [0, 1]", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 2)).toBe(20);
  });
});

describe("wrap", () => {
  it("leaves in-range values unchanged", () => {
    expect(wrap(5, 10)).toBe(5);
  });
  it("wraps values at or above size back into [0, size)", () => {
    expect(wrap(10, 10)).toBe(0);
    expect(wrap(15, 10)).toBe(5);
  });
  it("wraps negative values into [0, size)", () => {
    expect(wrap(-1, 10)).toBe(9);
    expect(wrap(-15, 10)).toBe(5);
  });
});

describe("torDelta", () => {
  it("matches plain subtraction when there is no wraparound", () => {
    expect(torDelta(7, 3, 100)).toBe(4);
  });
  it("takes the shorter path around the torus", () => {
    // 99 vs 1 on a size-100 torus: going forward from 1 to 99 is 98, backward is -2.
    expect(torDelta(99, 1, 100)).toBe(-2);
    expect(torDelta(1, 99, 100)).toBe(2);
  });
});

describe("torDist", () => {
  it("is zero for coincident points", () => {
    expect(torDist(5, 5, 5, 5, 100, 100)).toBe(0);
  });
  it("uses the wrapped-around distance when it is shorter", () => {
    // Two points near opposite edges of a size-100 torus are actually close together.
    const dist = torDist(1, 1, 99, 1, 100, 100);
    expect(dist).toBe(2);
  });
});
