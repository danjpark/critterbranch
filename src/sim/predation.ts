import type { Creature } from "./creature.ts";
import { specializationFactor } from "./genome.ts";
import type { Params } from "../params.ts";
import { combatSuccessProbability, derivePhenotype } from "./phenotype.ts";
import type { RNG } from "./rng.ts";
import { recordDeath, recordDiet, type SpeciesBehaviorStats } from "./speciesBehaviorStats.ts";
import { cellIndexAt } from "./trees.ts";
import { torDist, wrap } from "./util.ts";
import type { World } from "./world.ts";

/** Grid-bucketed index of every living creature, rebuilt once per tick before the main
 * per-creature loop — same pattern as trees.ts's crowding-neighbor lookup, needed so prey-sensing
 * is O(local density) per creature instead of an O(n²) all-pairs scan against a population that
 * can run into the thousands. */
export interface CreatureIndex {
  world: World;
  params: Params;
  buckets: Map<number, Creature[]>;
}

export function buildCreatureIndex(creatures: Creature[], world: World, params: Params): CreatureIndex {
  const buckets = new Map<number, Creature[]>();
  for (const c of creatures) {
    const idx = cellIndexAt(c.x, c.y, params, world);
    const bucket = buckets.get(idx);
    if (bucket) bucket.push(c);
    else buckets.set(idx, [c]);
  }
  return { world, params, buckets };
}

/** Best-scoring nearby creature within `radius` of (x, y), excluding `excludeId` (so a creature
 * never targets itself) — same windowed radius-cell scan senseFood already uses for fruit, just
 * bucketed by creature position instead of scanning a dense array. `scoreOf` lets callers plug in
 * whatever "how attractive is this target" formula they need (prey-sensing scores by
 * energy*meatGain/dist; nothing else uses this yet, but it's not hardcoded to one caller's math). */
export interface ScoredCreature {
  creature: Creature;
  score: number;
}

export function findBestNearbyCreature(
  index: CreatureIndex,
  x: number,
  y: number,
  radius: number,
  excludeId: number,
  scoreOf: (candidate: Creature, dist: number) => number,
): ScoredCreature | null {
  const { world, params } = index;
  const worldWidth = world.cols * params.gridCellSize;
  const worldHeight = world.rows * params.gridCellSize;
  const cellSize = params.gridCellSize;
  const cx = Math.floor(x / cellSize);
  const cy = Math.floor(y / cellSize);
  const radiusCells = Math.ceil(radius / cellSize);

  let best: ScoredCreature | null = null;
  for (let dy = -radiusCells; dy <= radiusCells; dy++) {
    const gy = wrap(cy + dy, world.rows);
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      const gx = wrap(cx + dx, world.cols);
      const bucket = index.buckets.get(gy * world.cols + gx);
      if (!bucket) continue;
      for (const candidate of bucket) {
        if (candidate.id === excludeId) continue;
        const dist = torDist(x, y, candidate.x, candidate.y, worldWidth, worldHeight);
        if (dist > radius) continue;
        const score = scoreOf(candidate, dist);
        if (!best || score > best.score) best = { creature: candidate, score };
      }
    }
  }
  return best;
}

/** Queued during the main per-creature pass (stepCreature), resolved afterward — see this
 * module's resolvePredation doc comment for why resolution can't happen synchronously mid-loop. */
export interface PredationAttempt {
  predatorId: number;
  preyId: number;
}

/**
 * Resolves every queued attack attempt against the tick's finalized creature list (nextGeneration,
 * before nursing runs), in queue order. Returns a new array with any successfully-killed prey
 * removed; predators gain energy in place (mutated on the surviving creature objects, same as
 * eating fruit already does).
 *
 * Deliberately a separate pass rather than resolving synchronously inside the main per-creature
 * loop: a kill resolved mid-loop would need every other piece of per-tick logic (the reproduction
 * check, the survival check that builds nextGeneration) to defensively re-check "am I already
 * dead" in ways they don't today, and a creature already pushed into nextGeneration earlier in
 * the loop wouldn't get removed by a later same-tick kill without an explicit final filter
 * anyway — so this pass IS that explicit filter, done once, cleanly, after the fact.
 *
 * Both predator and prey are re-checked against the still-alive set at resolution time, not just
 * queue time: a second attempt targeting prey a first attempt already killed this tick is a
 * genuine no-op, and a predator that died of its own starvation this tick (excluded from
 * nextGeneration by the ordinary survival check before this pass ever runs) never gets to land
 * its queued hit.
 *
 * Also records each kill into speciesBehavior (the same recordDeath the main per-creature loop
 * already calls for starvation/aging-out) — without this, M2's birth/death observability
 * (SpeciesProfile's reproduction dimension) would silently undercount deaths once predation is
 * active, since a predation kill happens in this separate later pass, after the main loop's own
 * recordDeath calls have already run for that tick.
 */
export function resolvePredation(
  creatures: Creature[],
  attempts: PredationAttempt[],
  rng: RNG,
  params: Params,
  speciesBehavior: SpeciesBehaviorStats,
): Creature[] {
  if (attempts.length === 0) return creatures;

  const byId = new Map<number, Creature>();
  for (const c of creatures) byId.set(c.id, c);
  const killed = new Set<number>();

  for (const attempt of attempts) {
    if (killed.has(attempt.preyId) || killed.has(attempt.predatorId)) continue;
    const predator = byId.get(attempt.predatorId);
    const prey = byId.get(attempt.preyId);
    if (!predator || !prey) continue;

    const successProb = combatSuccessProbability(derivePhenotype(predator.genome, params), derivePhenotype(prey.genome, params));

    if (rng.next() < successProb) {
      // How much of the prey's energy the predator actually converts — a pure carnivore
      // (carnivory 1) gets the full amount, a poorly-specialized attacker gets a fraction, the
      // same specialization curve fruit-eating uses (see genome.ts's specializationFactor), just
      // applied against a whole creature's energy instead of a small per-tick bite.
      const meatEfficiency = specializationFactor(predator.genome.carnivory, 1, params);
      const energyGained = prey.energy * meatEfficiency;
      predator.energy += energyGained;
      killed.add(prey.id);
      recordDeath(speciesBehavior, prey.lineageId, prey.age);
      recordDiet(speciesBehavior, predator.lineageId, 1, energyGained);
    }
  }

  if (killed.size === 0) return creatures;
  return creatures.filter((c) => !killed.has(c.id));
}
