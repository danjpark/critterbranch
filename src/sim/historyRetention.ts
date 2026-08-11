/**
 * Retention policy for dense time-series observation history (populationHistory, traitHistory) —
 * NOT for discrete events (speciation/extinction in taxonomyEvents), which are never downsampled
 * or dropped; a species either split or it didn't, and there's no "approximately" version of that.
 * Dense samples are different: there are a LOT of them on a long run (one per taxonomyIntervalTicks,
 * forever), and old ones matter far less than recent ones — nobody needs tick-100-resolution detail
 * from 200,000 ticks ago, just the overall shape.
 *
 * Three resolution bands going back from the current tick: full resolution recently, coarser
 * further back, coarsest beyond that.
 */
export interface HistoryRetentionConfig {
  recentFullResolutionTicks: number;
  mediumResolutionWindowTicks: number;
  mediumResolutionSampleEvery: number;
  oldResolutionSampleEvery: number;
}

/** Recent 10k ticks: every sample. 10k-100k ticks back: every 5th. Older: every 20th. */
export const DEFAULT_HISTORY_RETENTION: HistoryRetentionConfig = {
  recentFullResolutionTicks: 10_000,
  mediumResolutionWindowTicks: 100_000,
  mediumResolutionSampleEvery: 5,
  oldResolutionSampleEvery: 20,
};

/**
 * Downsamples a tick-ordered history array by dropping samples from the older two resolution
 * bands, keeping every Nth sample within each band (by position within the band, not by tick
 * value — samples don't necessarily land on round tick numbers). Deterministic: the same input
 * and currentTick always produce the same output. Called periodically (not every tick — see
 * sim.ts) rather than maintained incrementally; at the cadence it runs, a full O(n) pass over a
 * history that's already been kept bounded by the previous pass is cheap.
 */
export function compactHistory<T>(history: T[], getTick: (item: T) => number, currentTick: number, config: HistoryRetentionConfig): T[] {
  const recentCutoff = currentTick - config.recentFullResolutionTicks;
  const mediumCutoff = currentTick - config.mediumResolutionWindowTicks;

  const result: T[] = [];
  let mediumIndex = 0;
  let oldIndex = 0;
  for (const item of history) {
    const tick = getTick(item);
    if (tick >= recentCutoff) {
      result.push(item);
    } else if (tick >= mediumCutoff) {
      if (mediumIndex % config.mediumResolutionSampleEvery === 0) result.push(item);
      mediumIndex++;
    } else {
      if (oldIndex % config.oldResolutionSampleEvery === 0) result.push(item);
      oldIndex++;
    }
  }
  return result;
}
