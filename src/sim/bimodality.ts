/**
 * Simple, dependency-free bimodality heuristic: is there a clear gap in the sorted values that
 * splits the population into two non-trivial clusters? This isn't a rigorous statistical dip
 * test — it's deliberately simple so it's easy to reason about in a test assertion (see
 * sim.axisIsolation.test.ts), matching the "sit and eyeball a histogram" intuition SPEC.md is
 * getting at with phrases like "watch one blob become two."
 */
export function isBimodal(values: number[], minGapFraction = 0.15, minClusterFraction = 0.15): boolean {
  if (values.length < 4) return false;

  const sorted = [...values].sort((a, b) => a - b);
  const range = sorted[sorted.length - 1] - sorted[0];
  if (range <= 0) return false;

  let bestGapIndex = -1;
  let bestGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > bestGap) {
      bestGap = gap;
      bestGapIndex = i;
    }
  }
  if (bestGapIndex === -1) return false;

  const gapFraction = bestGap / range;
  const lowerClusterFraction = bestGapIndex / sorted.length;
  const upperClusterFraction = 1 - lowerClusterFraction;

  return gapFraction >= minGapFraction && lowerClusterFraction >= minClusterFraction && upperClusterFraction >= minClusterFraction;
}
