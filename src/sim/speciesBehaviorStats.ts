/**
 * Per-species decaying behavior accumulators — the raw data behind game/observability's
 * SpeciesProfile (SPEC.md Addendum 5). Mirrors consumption.ts's ConsumptionGrid pattern
 * deliberately: recorded every tick at the point the behavior happens, decayed in a batched
 * periodic pass rather than every tick, pruned once a species' trace becomes negligible (catches
 * extinct species instead of leaving an ever-growing tail of all-but-zero entries).
 *
 * Used to also track diet (R/B food-type share) here, removed by SPEC.md Addendum 6 along with
 * the diet trade-off axis itself — see game/observability/speciesProfile.ts's history for that.
 */
export interface SpeciesBehaviorAccumulator {
  births: number;
  deaths: number;
  /** Sum of `creature.age` at the moment of death, across every death recorded — divide by
   * `deaths` for a decayed-average realized lifespan. */
  sumAgeAtDeath: number;
}

export interface SpeciesBehaviorStats {
  bySpecies: Map<number, SpeciesBehaviorAccumulator>;
}

function zeroAccumulator(): SpeciesBehaviorAccumulator {
  return { births: 0, deaths: 0, sumAgeAtDeath: 0 };
}

export function initSpeciesBehaviorStats(): SpeciesBehaviorStats {
  return { bySpecies: new Map() };
}

export function cloneSpeciesBehaviorStats(stats: SpeciesBehaviorStats): SpeciesBehaviorStats {
  const bySpecies = new Map<number, SpeciesBehaviorAccumulator>();
  for (const [speciesId, acc] of stats.bySpecies) bySpecies.set(speciesId, { ...acc });
  return { bySpecies };
}

function getOrCreate(stats: SpeciesBehaviorStats, lineageId: number): SpeciesBehaviorAccumulator {
  let acc = stats.bySpecies.get(lineageId);
  if (!acc) {
    acc = zeroAccumulator();
    stats.bySpecies.set(lineageId, acc);
  }
  return acc;
}

export function recordBirth(stats: SpeciesBehaviorStats, lineageId: number): void {
  getOrCreate(stats, lineageId).births += 1;
}

export function recordDeath(stats: SpeciesBehaviorStats, lineageId: number, ageAtDeath: number): void {
  const acc = getOrCreate(stats, lineageId);
  acc.deaths += 1;
  acc.sumAgeAtDeath += ageAtDeath;
}

// Matches consumption.ts's PRUNE_THRESHOLD/rationale exactly — below this, every field's
// remaining trace is imperceptible, so keeping the entry only wastes memory on long-extinct
// species.
const PRUNE_THRESHOLD = 1e-4;

/** `retention` is the fraction kept for this call, already exponentiated for however many ticks
 * have elapsed since the last decay pass — see sim.ts, batched the same way decayConsumption is. */
export function decaySpeciesBehaviorStats(stats: SpeciesBehaviorStats, retention: number): void {
  for (const [speciesId, acc] of stats.bySpecies) {
    acc.births *= retention;
    acc.deaths *= retention;
    acc.sumAgeAtDeath *= retention;
    if (acc.births < PRUNE_THRESHOLD && acc.deaths < PRUNE_THRESHOLD && acc.sumAgeAtDeath < PRUNE_THRESHOLD) {
      stats.bySpecies.delete(speciesId);
    }
  }
}
