import { GENE_KEYS, GENE_RANGES, type TraitSample } from "./genome.ts";
import type { PopulationSample, TaxonomyEvent } from "./taxonomy.ts";

export interface EquilibriumConfig {
  /** How many recent samples (each params.taxonomyIntervalTicks apart) to look at. */
  windowSamples: number;
  /** Max fractional swing (range / mean) in total population across the window to still count as stable. */
  populationTolerance: number;
  /** Max drift (range / gene's own [min,max] span) in any single gene's mean across the window to
   * still count as stable — the worst-drifting gene decides, so one axis still actively diverging
   * blocks "stable" even if every other gene has settled. */
  traitTolerance: number;
}

/** Tuned empirically (scripts/probe-equilibrium.ts, since deleted) against real GameRunner eras
 * under DEFAULT_PARAMS, 3 seeds x 6 eras each: never fired during era 1-3 (population still
 * climbing from founding size — genuinely active, correctly never called "stable"), fired in about
 * a quarter of later eras once population/traits settled toward carrying capacity, and always well
 * past any reasonable early-end floor (typically 50-70% through the era, never right at the edge of
 * the window it was first checkable). A tighter tolerance (0.06/0.01) almost never fired (useless);
 * a looser window (8 samples, 0.05/0.008) never fired at all despite the tighter tolerances, because
 * requiring 8 consecutive quiet samples is a harder bar than loosening the per-sample tolerance —
 * see SPEC.md Addendum 13. */
export const DEFAULT_EQUILIBRIUM_CONFIG: EquilibriumConfig = {
  windowSamples: 5,
  populationTolerance: 0.08,
  traitTolerance: 0.015,
};

function totalPopulation(sample: PopulationSample): number {
  let total = 0;
  for (const count of Object.values(sample.counts)) total += count;
  return total;
}

/**
 * True when the ecosystem has stopped changing in any way a player would actually notice:
 * population size, every gene's mean, and taxonomy events (splits/extinctions) have all been flat
 * across the last `config.windowSamples` observation samples. Reads only existing sampled history
 * (populationHistory/traitHistory, sampled every params.taxonomyIntervalTicks) — adds no new
 * per-tick instrumentation. Used by app/gameRunner.ts (early-end an era once it's gone quiet) and
 * app/simRunner.ts (auto-pace fast-forward) — see SPEC.md Addendum 13.
 */
export function isEcosystemStable(
  populationHistory: PopulationSample[],
  traitHistory: TraitSample[],
  taxonomyEvents: TaxonomyEvent[],
  config: EquilibriumConfig = DEFAULT_EQUILIBRIUM_CONFIG,
): boolean {
  const { windowSamples, populationTolerance, traitTolerance } = config;
  if (populationHistory.length < windowSamples || traitHistory.length < windowSamples) return false;

  const popWindow = populationHistory.slice(-windowSamples);
  const traitWindow = traitHistory.slice(-windowSamples);
  const windowStartTick = popWindow[0].tick;

  // A split or extinction is inherently eventful — never call the window "stable" while one just
  // happened, even if population/trait means haven't visibly moved yet.
  for (const taxonomyEvent of taxonomyEvents) {
    const eventTick = taxonomyEvent.type === "speciation" ? taxonomyEvent.event.tick : taxonomyEvent.event.tick;
    if (eventTick >= windowStartTick) return false;
  }

  const totals = popWindow.map(totalPopulation);
  const popMean = totals.reduce((sum, v) => sum + v, 0) / totals.length;
  if (popMean <= 0) return false; // extinct isn't "stable," it's over — never treat it as equilibrium
  const popRange = Math.max(...totals) - Math.min(...totals);
  if (popRange / popMean > populationTolerance) return false;

  for (const gene of GENE_KEYS) {
    const values = traitWindow.map((sample) => sample.mean[gene]);
    const [min, max] = GENE_RANGES[gene];
    const range = max - min;
    const drift = (Math.max(...values) - Math.min(...values)) / range;
    if (drift > traitTolerance) return false;
  }

  return true;
}
