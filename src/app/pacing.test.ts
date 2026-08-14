import { describe, expect, it } from "vitest";
import { DEFAULT_RAMP_CONFIG, rampedTicksPerFrame } from "./pacing.ts";

describe("rampedTicksPerFrame", () => {
  it("starts at floorSpeedTicks the instant an eventful moment happens", () => {
    expect(rampedTicksPerFrame(10, 0, DEFAULT_RAMP_CONFIG)).toBe(DEFAULT_RAMP_CONFIG.floorSpeedTicks);
  });

  it("reaches the full target speed once rampTicks have elapsed", () => {
    expect(rampedTicksPerFrame(10, DEFAULT_RAMP_CONFIG.rampTicks, DEFAULT_RAMP_CONFIG)).toBe(10);
    expect(rampedTicksPerFrame(10, DEFAULT_RAMP_CONFIG.rampTicks + 500, DEFAULT_RAMP_CONFIG)).toBe(10);
  });

  it("interpolates monotonically between the floor and the target across the ramp window", () => {
    const config = { rampTicks: 100, floorSpeedTicks: 1 };
    let previous = 0;
    for (let ticksSinceEventful = 0; ticksSinceEventful <= 100; ticksSinceEventful += 10) {
      const speed = rampedTicksPerFrame(50, ticksSinceEventful, config);
      expect(speed).toBeGreaterThanOrEqual(previous);
      previous = speed;
    }
    expect(previous).toBe(50);
  });

  it("clamps negative ticksSinceEventful (e.g. right after a checkpoint restore) to the floor", () => {
    expect(rampedTicksPerFrame(10, -50, DEFAULT_RAMP_CONFIG)).toBe(DEFAULT_RAMP_CONFIG.floorSpeedTicks);
  });
});
