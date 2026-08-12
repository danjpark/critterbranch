/**
 * Per-species decaying behavior accumulators — the raw data behind game/observability's
 * SpeciesProfile (SPEC.md Addendum 5). Mirrors consumption.ts's ConsumptionGrid pattern
 * deliberately: recorded every tick at the point the behavior happens, decayed in a batched
 * periodic pass rather than every tick, pruned once a species' trace becomes negligible (catches
 * extinct species instead of leaving an ever-growing tail of all-but-zero entries).
 *
 * Diet is tracked here as two non-spatial running totals (R/B), separate from ConsumptionGrid's
 * per-cell totals — SpeciesProfile only ever needs a species' aggregate diet *composition*, not
 * where on the map it was eating, so this avoids doubling ConsumptionGrid's per-cell memory cost
 * for data nothing reads spatially.
 */
export interface SpeciesBehaviorAccumulator {
  dietR: number;
  dietB: number;
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
  return { dietR: 0, dietB: 0, births: 0, deaths: 0, sumAgeAtDeath: 0 };
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

export function recordDiet(stats: SpeciesBehaviorStats, lineageId: number, foodType: 0 | 1, amount: number): void {
  if (amount <= 0) return;
  const acc = getOrCreate(stats, lineageId);
  if (foodType === 0) acc.dietR += amount;
  else acc.dietB += amount;
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
    acc.dietR *= retention;
    acc.dietB *= retention;
    acc.births *= retention;
    acc.deaths *= retention;
    acc.sumAgeAtDeath *= retention;
    if (
      acc.dietR < PRUNE_THRESHOLD &&
      acc.dietB < PRUNE_THRESHOLD &&
      acc.births < PRUNE_THRESHOLD &&
      acc.deaths < PRUNE_THRESHOLD &&
      acc.sumAgeAtDeath < PRUNE_THRESHOLD
    ) {
      stats.bySpecies.delete(speciesId);
    }
  }
}
