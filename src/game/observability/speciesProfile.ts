import type { Creature } from "../../sim/creature.ts";
import { elevationBand, type ElevationBand, type TerrainGrid } from "../../sim/terrain.ts";
import type { Species, TaxonomyState } from "../../sim/taxonomy.ts";
import type { SpeciesBehaviorStats } from "../../sim/speciesBehaviorStats.ts";
import { wrap } from "../../sim/util.ts";
import type { SimInstance } from "../../sim/sim.ts";
import type { Params } from "../../params.ts";

/**
 * Demonstrated (not genotype-proxied) per-species behavior aggregates — see SPEC.md Addendum 5.
 * Genome != Capability: every field here describes what a species has actually been doing, not
 * what its genes say it should do. Recomputed fresh from current sim state each time it's called
 * (not maintained as its own persistent history) — the underlying accumulators it reads
 * (speciesBehavior birth/death totals, Creature.distanceTraveled) are what carry the "recent
 * behavior, decayed" property; this function is a pure read over them.
 *
 * Used to have a `diet` dimension (food-type R/B share), removed by Addendum 6 along with the old
 * diet axis, and back per Addendum 7 reshaped around fruit vs. meat.
 */
export interface DietProfile {
  /** Fraction of this species' decayed food intake that came from meat (kills), in [0, 1]. 0.5 if
   * the species hasn't recorded any intake yet (no evidence either way). */
  meatShare: number;
  /** Decayed total intake (fruit + meat) — how much evidence meatShare is actually based on. */
  totalConsumed: number;
}

export interface HabitatProfile {
  waterShare: number;
  lowlandShare: number;
  hillShare: number;
  mountainShare: number;
}

export interface MovementProfile {
  /** Mean of (distanceTraveled / age) across this species' living members — world units per
   * tick, self-normalized so it's comparable across creatures of different ages. */
  averageRealizedSpeed: number;
}

export interface ReproductionProfile {
  /** Decayed births per current member — a rate, not a raw count, so it's comparable across
   * species of different sizes. */
  birthsPerCapita: number;
  deathsPerCapita: number;
  /** Decayed-average age at death, or null if this species has no recorded deaths yet. */
  averageLifespanAtDeath: number | null;
}

export interface SurvivalProfile {
  /** Coefficient of variation (stdev/mean) of this species' population count over the recent
   * history window — low means stable, high means volatile. 0 if fewer than 2 samples exist yet. */
  volatility: number;
  /** Newest sampled count vs. oldest sampled count in the same window. */
  trend: "growing" | "stable" | "declining";
}

export interface SpeciesProfile {
  speciesId: number;
  memberCount: number;
  diet: DietProfile;
  habitat: HabitatProfile;
  movement: MovementProfile;
  reproduction: ReproductionProfile;
  survival: SurvivalProfile;
}

/** Population-wide averages, for classifiers that need "relative to everyone else" rather than an
 * absolute threshold (e.g. Fast-mover only means something next to how fast other species move). */
export interface PopulationBaseline {
  averageRealizedSpeed: number;
  averageBirthsPerCapita: number;
}

export interface SpeciesProfileSet {
  profiles: Map<number, SpeciesProfile>;
  baseline: PopulationBaseline;
}

function dietProfile(stats: SpeciesBehaviorStats, speciesId: number): DietProfile {
  const acc = stats.bySpecies.get(speciesId);
  const totalConsumed = acc ? acc.dietFruit + acc.dietMeat : 0;
  const meatShare = acc && totalConsumed > 1e-9 ? acc.dietMeat / totalConsumed : 0.5;
  return { meatShare, totalConsumed };
}

function habitatProfile(members: Creature[], terrain: TerrainGrid, params: Params): HabitatProfile {
  if (members.length === 0) return { waterShare: 0, lowlandShare: 0, hillShare: 0, mountainShare: 0 };
  const counts: Record<ElevationBand, number> = { water: 0, lowland: 0, hill: 0, mountain: 0 };
  for (const c of members) {
    const gx = wrap(Math.floor(c.x / params.gridCellSize), terrain.cols);
    const gy = wrap(Math.floor(c.y / params.gridCellSize), terrain.rows);
    const band = elevationBand(terrain.elevation[gy * terrain.cols + gx], terrain.seaLevel, params.terrainRoughness);
    counts[band]++;
  }
  return {
    waterShare: counts.water / members.length,
    lowlandShare: counts.lowland / members.length,
    hillShare: counts.hill / members.length,
    mountainShare: counts.mountain / members.length,
  };
}

function movementProfile(members: Creature[]): MovementProfile {
  if (members.length === 0) return { averageRealizedSpeed: 0 };
  const total = members.reduce((sum, c) => sum + (c.age > 0 ? c.distanceTraveled / c.age : 0), 0);
  return { averageRealizedSpeed: total / members.length };
}

function reproductionProfile(stats: SpeciesBehaviorStats, speciesId: number, memberCount: number): ReproductionProfile {
  const acc = stats.bySpecies.get(speciesId);
  if (!acc || memberCount === 0) return { birthsPerCapita: 0, deathsPerCapita: 0, averageLifespanAtDeath: null };
  return {
    birthsPerCapita: acc.births / memberCount,
    deathsPerCapita: acc.deaths / memberCount,
    averageLifespanAtDeath: acc.deaths > 1e-9 ? acc.sumAgeAtDeath / acc.deaths : null,
  };
}

/** How many recent taxonomy-pass samples survival looks back over — a display/classification
 * smoothing window, not a scientifically tuned constant, so (like sim.ts's
 * HISTORY_COMPACTION_INTERVAL_TICKS) it's a local constant rather than a Params field. */
const SURVIVAL_HISTORY_WINDOW = 10;

function survivalProfile(taxonomy: TaxonomyState, speciesId: number, populationHistory: SimInstance["state"]["observations"]["populationHistory"]): SurvivalProfile {
  const species = taxonomy.species.get(speciesId);
  if (!species) return { volatility: 0, trend: "stable" };

  const counts: number[] = [];
  for (let i = populationHistory.length - 1; i >= 0 && counts.length < SURVIVAL_HISTORY_WINDOW; i--) {
    const sample = populationHistory[i];
    if (sample.tick < species.originTick) break;
    if (speciesId in sample.counts) counts.unshift(sample.counts[speciesId]);
  }

  if (counts.length < 2) return { volatility: 0, trend: "stable" };

  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / counts.length;
  const volatility = mean > 0 ? Math.sqrt(variance) / mean : 0;

  const oldest = counts[0];
  const newest = counts[counts.length - 1];
  const trend = newest > oldest * 1.1 ? "growing" : newest < oldest * 0.9 ? "declining" : "stable";

  return { volatility, trend };
}

/** Computes a fresh SpeciesProfile for every currently-living species from the sim's current
 * state. Read-only, pure, and cheap enough (one pass over living creatures) to call on demand —
 * not wired into the tick loop, since aggregation logic belongs in game/, not sim/ (sim/ must
 * never import from game/, see architectureBoundary.test.ts). */
export function computeSpeciesProfiles(sim: SimInstance): SpeciesProfileSet {
  const { evolution, observations } = sim.state;
  const params = sim.params;

  const membersBySpecies = new Map<number, Creature[]>();
  for (const c of evolution.creatures) {
    const arr = membersBySpecies.get(c.lineageId);
    if (arr) arr.push(c);
    else membersBySpecies.set(c.lineageId, [c]);
  }

  const profiles = new Map<number, SpeciesProfile>();
  let speedTotal = 0;
  let birthsTotal = 0;
  let livingCount = 0;

  for (const species of observations.taxonomy.species.values()) {
    if (species.extinctTick !== null) continue;
    const members = membersBySpecies.get(species.id) ?? [];
    const movement = movementProfile(members);
    const reproduction = reproductionProfile(observations.speciesBehavior, species.id, species.memberCount);

    profiles.set(species.id, {
      speciesId: species.id,
      memberCount: species.memberCount,
      diet: dietProfile(observations.speciesBehavior, species.id),
      habitat: habitatProfile(members, evolution.terrain, params),
      movement,
      reproduction,
      survival: survivalProfile(observations.taxonomy, species.id, observations.populationHistory),
    });

    speedTotal += movement.averageRealizedSpeed;
    birthsTotal += reproduction.birthsPerCapita;
    livingCount++;
  }

  return {
    profiles,
    baseline: {
      averageRealizedSpeed: livingCount > 0 ? speedTotal / livingCount : 0,
      averageBirthsPerCapita: livingCount > 0 ? birthsTotal / livingCount : 0,
    },
  };
}

/** Exported for tests that want to check a single species' profile without recomputing the whole
 * set — thin wrapper, not a second code path. */
export function getSpeciesProfile(set: SpeciesProfileSet, speciesId: number): SpeciesProfile | undefined {
  return set.profiles.get(speciesId);
}

export type { Species };
