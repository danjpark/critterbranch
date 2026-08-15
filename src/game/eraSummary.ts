import type { Genome, TraitSample } from "../sim/genome.ts";
import { GENE_KEYS } from "../sim/genome.ts";
import type { DiscoveryMatch } from "./discovery/discoveryJournal.ts";
import type { Game } from "./game.ts";

export interface EraSnapshot {
  era: number;
  tick: number;
  totalPopulation: number;
  livingSpeciesCount: number;
  livingSpeciesIds: number[];
}

export function captureEraSnapshot(game: Game): EraSnapshot {
  const livingSpeciesIds: number[] = [];
  for (const species of game.sim.state.observations.taxonomy.species.values()) {
    if (species.extinctTick === null) livingSpeciesIds.push(species.id);
  }
  return {
    era: game.gameState.era,
    tick: game.sim.state.evolution.tick,
    totalPopulation: game.sim.state.evolution.creatures.length,
    livingSpeciesCount: livingSpeciesIds.length,
    livingSpeciesIds,
  };
}

export interface EraDelta {
  populationChange: number;
  newSpeciesIds: number[];
  extinctSpeciesIds: number[];
  livingSpeciesCountBefore: number;
  livingSpeciesCountAfter: number;
}

export function computeEraDelta(before: EraSnapshot, after: EraSnapshot): EraDelta {
  const beforeSet = new Set(before.livingSpeciesIds);
  const afterSet = new Set(after.livingSpeciesIds);
  return {
    populationChange: after.totalPopulation - before.totalPopulation,
    newSpeciesIds: after.livingSpeciesIds.filter((id) => !beforeSet.has(id)),
    extinctSpeciesIds: before.livingSpeciesIds.filter((id) => !afterSet.has(id)),
    livingSpeciesCountBefore: before.livingSpeciesCount,
    livingSpeciesCountAfter: after.livingSpeciesCount,
  };
}

export interface TraitShift {
  gene: keyof Genome;
  before: number;
  after: number;
  /** Change relative to |before| — e.g. 0.34 means +34%. */
  fractionChange: number;
}

/** Trait history is sampled periodically (params.taxonomyIntervalTicks), not every tick, so era
 * boundaries rarely land on an exact sample — this picks the latest sample at or before the tick. */
function traitSampleAtOrBefore(history: TraitSample[], tick: number): TraitSample | null {
  let result: TraitSample | null = null;
  for (const sample of history) {
    if (sample.tick > tick) break;
    result = sample;
  }
  return result;
}

const MIN_NOTABLE_FRACTION_CHANGE = 0.1;

/** The population-mean gene shifts across one era whose magnitude clears a noise floor, largest
 * first — deliberately not an exhaustive statistical treatment (see roadmap M1-E5-T2: "avoid
 * complex ranking algorithms"). */
export function computeNotableTraitShifts(game: Game, beforeTick: number, afterTick: number): TraitShift[] {
  const history = game.sim.state.observations.traitHistory;
  const before = traitSampleAtOrBefore(history, beforeTick);
  const after = traitSampleAtOrBefore(history, afterTick);
  if (!before || !after) return [];

  const shifts: TraitShift[] = [];
  for (const gene of GENE_KEYS) {
    const b = before.mean[gene];
    const a = after.mean[gene];
    if (Math.abs(b) < 1e-9) continue;
    const fractionChange = (a - b) / Math.abs(b);
    if (Math.abs(fractionChange) >= MIN_NOTABLE_FRACTION_CHANGE) {
      shifts.push({ gene, before: b, after: a, fractionChange });
    }
  }
  return shifts.sort((x, y) => Math.abs(y.fractionChange) - Math.abs(x.fractionChange));
}

export interface EraSummary {
  before: EraSnapshot;
  after: EraSnapshot;
  delta: EraDelta;
  notableTraitShifts: TraitShift[];
  /** Non-null when app/gameRunner.ts's stepEraAdvance switched to fast-forwarding once the
   * ecosystem went quiet (see sim/equilibrium.ts) — the tick that happened at. The era still always
   * simulates every tick up to its full planned target either way (SPEC.md Addendum 19, fixing a
   * real divergence from headless replay that Addendum 13's original early-end design had); this
   * only records that the tail was watched fast instead of at normal pace. Null for an era watched
   * at its normal pace the whole way, and always null for game.ts's headless advanceGameEra, which
   * has no animation to speed up. */
  fastForwardedFromTick: number | null;
  /** Critterdex entries newly confirmed this era (SPEC.md Addendum 16) — empty most eras. */
  newDiscoveries: DiscoveryMatch[];
}
