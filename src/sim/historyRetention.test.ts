import { describe, expect, it } from "vitest";
import { compactHistory, type HistoryRetentionConfig } from "./historyRetention.ts";

const config: HistoryRetentionConfig = {
  recentFullResolutionTicks: 100,
  mediumResolutionWindowTicks: 1000,
  mediumResolutionSampleEvery: 5,
  oldResolutionSampleEvery: 20,
};

function sampleAt(tick: number): { tick: number } {
  return { tick };
}

describe("compactHistory", () => {
  it("keeps every sample within the recent full-resolution window", () => {
    const history = Array.from({ length: 20 }, (_, i) => sampleAt(950 + i)); // ticks 950-969
    const result = compactHistory(history, (s) => s.tick, 1000, config);
    expect(result).toEqual(history);
  });

  it("keeps only every Nth sample in the medium-resolution band", () => {
    // Ticks 0-899, well before the recent cutoff (currentTick=1000, recentFullResolutionTicks=100
    // -> recentCutoff=900) and within the medium window (mediumCutoff = 1000-1000 = 0).
    const history = Array.from({ length: 90 }, (_, i) => sampleAt(i * 10)); // ticks 0,10,...,890
    const result = compactHistory(history, (s) => s.tick, 1000, config);
    // Every 5th by position within the band: indices 0,5,10,...
    expect(result.length).toBe(Math.ceil(90 / 5));
    expect(result[0].tick).toBe(0);
    expect(result[1].tick).toBe(50);
  });

  it("keeps only every Nth sample in the old-resolution band, further downsampled than medium", () => {
    const bigConfig: HistoryRetentionConfig = { ...config, mediumResolutionWindowTicks: 500 };
    // currentTick=2000: recentCutoff=1900, mediumCutoff=1500. Ticks 0-1490 are "old".
    const history = Array.from({ length: 150 }, (_, i) => sampleAt(i * 10)); // ticks 0..1490
    const result = compactHistory(history, (s) => s.tick, 2000, bigConfig);
    expect(result.length).toBe(Math.ceil(150 / 20));
  });

  it("never drops the discrete-event-like invariant of preserving order", () => {
    const history = Array.from({ length: 300 }, (_, i) => sampleAt(i * 7));
    const result = compactHistory(history, (s) => s.tick, 2000, config);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].tick).toBeGreaterThan(result[i - 1].tick);
    }
  });

  it("is deterministic: the same input and currentTick always produce the same output", () => {
    const history = Array.from({ length: 250 }, (_, i) => sampleAt(i * 13));
    const a = compactHistory(history, (s) => s.tick, 3000, config);
    const b = compactHistory(history, (s) => s.tick, 3000, config);
    expect(a).toEqual(b);
  });

  it("substantially bounds a long history's size relative to keeping every sample", () => {
    // Simulates ~200,000 ticks of samples taken every 100 ticks (2000 raw samples).
    const history = Array.from({ length: 2000 }, (_, i) => sampleAt(i * 100));
    const result = compactHistory(history, (s) => s.tick, 200_000, config);
    expect(result.length).toBeLessThan(history.length / 3);
  });
});
