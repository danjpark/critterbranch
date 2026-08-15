import { describe, expect, it } from "vitest";
import { compactHistory, DEFAULT_HISTORY_RETENTION, type HistoryRetentionConfig } from "./historyRetention.ts";

// Samples in these tests land every 10 ticks, so spacings of 50/200 are the "every 5th / every
// 20th" densities the old ratio-based config expressed.
const config: HistoryRetentionConfig = {
  recentFullResolutionTicks: 100,
  mediumResolutionWindowTicks: 1000,
  mediumResolutionSpacingTicks: 50,
  oldResolutionSpacingTicks: 200,
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

  it("thins the medium-resolution band to one sample per mediumResolutionSpacingTicks", () => {
    // Ticks 0-899, well before the recent cutoff (currentTick=1000, recentFullResolutionTicks=100
    // -> recentCutoff=900) and within the medium window (mediumCutoff = 1000-1000 = 0).
    const history = Array.from({ length: 90 }, (_, i) => sampleAt(i * 10)); // ticks 0,10,...,890
    const result = compactHistory(history, (s) => s.tick, 1000, config);
    // One sample per 50 ticks across ticks 0-890: 0, 50, 100, ..., 850.
    expect(result.length).toBe(Math.ceil(90 / 5));
    expect(result[0].tick).toBe(0);
    expect(result[1].tick).toBe(50);
  });

  it("thins the old-resolution band further than medium", () => {
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

  // The three below run against DEFAULT_HISTORY_RETENTION and a 100-tick sample cadence
  // deliberately: that's the shipping config against the cadence sim.ts actually produces samples
  // at (params.taxonomyIntervalTicks), so what they measure is the real retained resolution of a
  // real long run, not a synthetic one.
  const REAL_SAMPLE_INTERVAL = 100;
  const longRun = (finalTick: number) =>
    Array.from({ length: finalTick / REAL_SAMPLE_INTERVAL }, (_, i) => sampleAt(i * REAL_SAMPLE_INTERVAL));

  it("substantially bounds a long history's size relative to keeping every sample", () => {
    const history = longRun(200_000); // 2000 raw samples
    const result = compactHistory(history, (s) => s.tick, 200_000, DEFAULT_HISTORY_RETENTION);
    expect(result.length).toBeLessThan(history.length / 3);
  });

  // The load-bearing property, and the one the original index-based rule didn't have: sim.ts calls
  // this repeatedly over its own output as a run grows (every HISTORY_COMPACTION_INTERVAL_TICKS,
  // forever), so a rule that re-thins already-thinned samples compounds. Under the old rule a
  // 150,000-tick run retained 115 samples where a single pass over the same raw history keeps 305.
  it("is idempotent: re-compacting its own output at the same tick changes nothing", () => {
    const history = longRun(200_000);
    const once = compactHistory(history, (s) => s.tick, 200_000, DEFAULT_HISTORY_RETENTION);
    const twice = compactHistory(once, (s) => s.tick, 200_000, DEFAULT_HISTORY_RETENTION);
    expect(twice).toEqual(once);
  });

  it("retains comparable history whether compacted incrementally as a run grows or once at the end", () => {
    const compactEveryTicks = 5_000; // sim.ts's HISTORY_COMPACTION_INTERVAL_TICKS
    const finalTick = 200_000;

    let incremental: { tick: number }[] = [];
    for (let t = 0; t < finalTick; t += REAL_SAMPLE_INTERVAL) {
      incremental.push(sampleAt(t));
      if (t > 0 && t % compactEveryTicks === 0) {
        incremental = compactHistory(incremental, (s) => s.tick, t, DEFAULT_HISTORY_RETENTION);
      }
    }
    const singlePass = compactHistory(longRun(finalTick), (s) => s.tick, finalTick, DEFAULT_HISTORY_RETENTION);

    // Not byte-identical — the incremental path thins a sample while it's still in the medium band
    // and can't un-thin it once that sample ages into the coarser old band — but it must land in
    // the same ballpark rather than collapsing by a multiple, which is exactly what index-based
    // thinning did (115 vs 305 on a 150k-tick run).
    expect(incremental.length).toBeGreaterThan(singlePass.length * 0.8);
  });
});
