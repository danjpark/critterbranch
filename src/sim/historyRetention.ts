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
  /** Minimum tick gap between retained samples in the medium band. A tick SPACING, not a "keep 1
   * in N samples" ratio — see compactHistory for why the distinction is load-bearing. */
  mediumResolutionSpacingTicks: number;
  /** Minimum tick gap between retained samples in the oldest band. */
  oldResolutionSpacingTicks: number;
}

/** Recent 10k ticks: every sample. 10k-100k ticks back: one per 500 ticks. Older: one per 2,000.
 * The two spacings are 5x and 20x params.taxonomyIntervalTicks at its default of 100 — i.e. the
 * same retained density the previous "every 5th / every 20th sample" wording described, just
 * expressed in the units that make the rule idempotent. */
export const DEFAULT_HISTORY_RETENTION: HistoryRetentionConfig = {
  recentFullResolutionTicks: 10_000,
  mediumResolutionWindowTicks: 100_000,
  mediumResolutionSpacingTicks: 500,
  oldResolutionSpacingTicks: 2_000,
};

/**
 * Downsamples a tick-ordered history array by thinning the older two resolution bands to a minimum
 * tick SPACING, keeping the first sample of each band and then every sample at least `spacing`
 * ticks past the last one kept. Deterministic: the same input and currentTick always produce the
 * same output. Called periodically (not every tick — see sim.ts) rather than maintained
 * incrementally; at the cadence it runs, a full O(n) pass over a history that's already been kept
 * bounded by the previous pass is cheap.
 *
 * Spacing, not "every Nth sample by position within the band". Position-based thinning is not
 * idempotent, and this function is called REPEATEDLY over its own output as a run grows — every
 * HISTORY_COMPACTION_INTERVAL_TICKS, forever. Each pass re-thinned samples an earlier pass had
 * already thinned, so retained density collapsed geometrically in the number of passes instead of
 * settling at the documented 1-in-5 / 1-in-20. Measured on a 150,000-tick run at the cadence
 * sim.ts actually uses: 115 samples survived where a single pass over the same raw history keeps
 * 305, and the gap widens the longer a run goes. A tick-spacing rule is a fixed point — running it
 * twice at the same currentTick is a no-op — so the retained resolution is what the config says it
 * is no matter how many times a run has been compacted.
 */
export function compactHistory<T>(history: T[], getTick: (item: T) => number, currentTick: number, config: HistoryRetentionConfig): T[] {
  const recentCutoff = currentTick - config.recentFullResolutionTicks;
  const mediumCutoff = currentTick - config.mediumResolutionWindowTicks;

  const result: T[] = [];
  let lastKeptMediumTick = -Infinity;
  let lastKeptOldTick = -Infinity;
  for (const item of history) {
    const tick = getTick(item);
    if (tick >= recentCutoff) {
      result.push(item);
    } else if (tick >= mediumCutoff) {
      if (tick - lastKeptMediumTick >= config.mediumResolutionSpacingTicks) {
        lastKeptMediumTick = tick;
        result.push(item);
      }
    } else if (tick - lastKeptOldTick >= config.oldResolutionSpacingTicks) {
      lastKeptOldTick = tick;
      result.push(item);
    }
  }
  return result;
}
