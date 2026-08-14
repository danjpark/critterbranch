import type { ConsumptionGrid } from "./consumption.ts";
import { recordConsumption } from "./consumption.ts";
import { gainPerUnit, mutate, type Genome } from "./genome.ts";
import type { Params } from "../params.ts";
import { derivePhenotype, movementEfficiency } from "./phenotype.ts";
import { type CreatureIndex, findBestNearbyCreature, type PredationAttempt } from "./predation.ts";
import type { RNG } from "./rng.ts";
import { recordDiet, type SpeciesBehaviorStats } from "./speciesBehaviorStats.ts";
import type { TerrainGrid } from "./terrain.ts";
import { trySeedSapling, type TreeState } from "./trees.ts";
import { torDelta, torDist, wrap, lerp } from "./util.ts";
import type { World } from "./world.ts";

export { gainPerUnit } from "./genome.ts";

export interface Creature {
  id: number;
  parentId: number | null;
  lineageId: number;
  genome: Genome;
  x: number;
  y: number;
  heading: number;
  energy: number;
  age: number;
  birthTick: number;
  /** Tick at which this creature stops receiving ongoing nursing from parentId (see
   * sim/nursing.ts). Meaningless when parentId is null (founders are never nursed). */
  nursingUntilTick: number;
  /** Cumulative straight-line distance actually traveled (world units), incremented in
   * stepCreature's move step. Lifetime total, not windowed — game/observability's SpeciesProfile
   * (Addendum 5) divides this by age to get a realized-speed measurement per creature, which is
   * self-normalizing without needing any decay/reset logic here. */
  distanceTraveled: number;
  /** Tick before which this creature won't attempt another attack — set on every attempt
   * (success or failure), not just successes. Without this, a predator that's caught up to prey
   * gets a fresh attack roll EVERY tick it stays in range with no cost for a miss, and even
   * modest per-attempt odds compound to near-certain death within a handful of ticks — found via
   * a real population collapsing from 100 to 15 within 200 ticks under plain default params. A
   * recovery cooldown after every lunge, hit or miss, is standard in predator-prey modeling, not
   * an artificial anti-collapse safeguard (SPEC.md Addendum 7). */
  attackCooldownUntilTick: number;
}

export interface NewCreatureOptions {
  id: number;
  parentId: number | null;
  lineageId: number;
  genome: Genome;
  x: number;
  y: number;
  energy: number;
  birthTick: number;
  /** Only meaningful when parentId is non-null (see nursing.ts) — every other caller (founders,
   * god-mode seeding, tests) creates parentless creatures, so this defaults to "not nursed." */
  nursingUntilTick?: number;
  rng: RNG;
}

export function createCreature(options: NewCreatureOptions): Creature {
  return {
    id: options.id,
    parentId: options.parentId,
    lineageId: options.lineageId,
    genome: options.genome,
    x: options.x,
    y: options.y,
    heading: options.rng.nextRange(0, Math.PI * 2),
    energy: options.energy,
    age: 0,
    birthTick: options.birthTick,
    nursingUntilTick: options.nursingUntilTick ?? options.birthTick,
    distanceTraveled: 0,
    attackCooldownUntilTick: options.birthTick,
  };
}

export function energyCapacity(genome: Genome, params: Params): number {
  return params.baseEnergyCapacity * genome.size;
}

export function metabolicCost(genome: Genome, params: Params): number {
  return (
    params.baseCost * genome.size +
    params.moveCost * genome.speed * genome.speed * genome.size +
    params.senseCost * genome.senseRadius
  );
}

interface SenseResult {
  x: number;
  y: number;
  score: number;
  /** Set only when the best-scoring sensed target was a nearby creature (prey), not a fruit cell —
   * see SPEC.md Addendum 7. A creature that steers toward this still opportunistically eats fruit
   * at whatever cell it ends up on too (unchanged from before), the two aren't mutually exclusive. */
  preyTarget: Creature | null;
}

function senseFoodOrPrey(
  creature: Creature,
  world: World,
  creatureIndex: CreatureIndex,
  params: Params,
  worldWidth: number,
  worldHeight: number,
): SenseResult | null {
  const fruitGain = gainPerUnit(creature.genome.carnivory, 0, params);

  const cellSize = params.gridCellSize;
  const cx = Math.floor(creature.x / cellSize);
  const cy = Math.floor(creature.y / cellSize);
  const radiusCells = Math.ceil(creature.genome.senseRadius / cellSize);

  let best: SenseResult | null = null;
  for (let dy = -radiusCells; dy <= radiusCells; dy++) {
    const gy = wrap(cy + dy, world.rows);
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      const gx = wrap(cx + dx, world.cols);
      const idx = gy * world.cols + gx;
      const cellCenterX = gx * cellSize + cellSize / 2;
      const cellCenterY = gy * cellSize + cellSize / 2;
      const dist = torDist(creature.x, creature.y, cellCenterX, cellCenterY, worldWidth, worldHeight);
      if (dist > creature.genome.senseRadius) continue;

      const amt = world.fruit[idx];
      if (amt > 1e-3) {
        const score = (amt * fruitGain) / (dist + 1);
        if (!best || score > best.score) best = { x: cellCenterX, y: cellCenterY, score, preyTarget: null };
      }
    }
  }

  // Only a creature with real carnivory investment ever senses/attempts prey at all (SPEC.md
  // Addendum 14) — without this floor, gainPerUnit's meat curve is nonzero for almost any
  // carnivory above ~0, so virtually the whole population ends up opportunistically attacking for
  // a near-zero payoff instead of predation being a genuine specialist behavior.
  if (creature.genome.carnivory >= params.carnivoryHuntingThreshold) {
    const meatGain = gainPerUnit(creature.genome.carnivory, 1, params);
    const prey = findBestNearbyCreature(
      creatureIndex,
      creature.x,
      creature.y,
      creature.genome.senseRadius,
      creature.id,
      (candidate, dist) => (candidate.energy * meatGain) / (dist + 1),
    );
    if (prey && (!best || prey.score > best.score)) {
      best = { x: prey.creature.x, y: prey.creature.y, score: prey.score, preyTarget: prey.creature };
    }
  }

  return best;
}

/** Advances one creature by one tick in place: sense, steer, move, pay metabolism, eat/attack.
 * Returns a queued predation attempt if it ended this move within attackRange of the prey it was
 * steering toward — see sim/predation.ts's resolvePredation for why resolution is deferred rather
 * than happening synchronously here. */
export function stepCreature(
  creature: Creature,
  world: World,
  terrain: TerrainGrid,
  treeState: TreeState,
  creatureIndex: CreatureIndex,
  rng: RNG,
  params: Params,
  tick: number,
  consumptionGrid: ConsumptionGrid | null = null,
  speciesBehavior: SpeciesBehaviorStats | null = null,
): PredationAttempt | null {
  const worldWidth = world.cols * params.gridCellSize;
  const worldHeight = world.rows * params.gridCellSize;

  const target = senseFoodOrPrey(creature, world, creatureIndex, params, worldWidth, worldHeight);
  if (target) {
    const dx = torDelta(target.x, creature.x, worldWidth);
    const dy = torDelta(target.y, creature.y, worldHeight);
    creature.heading = Math.atan2(dy, dx);
  } else {
    const randomHeading = rng.nextRange(0, Math.PI * 2);
    const persistence = creature.genome.wanderPersistence;
    const wx = Math.cos(creature.heading) * persistence + Math.cos(randomHeading) * (1 - persistence);
    const wy = Math.sin(creature.heading) * persistence + Math.sin(randomHeading) * (1 - persistence);
    creature.heading = Math.atan2(wy, wx);
  }

  const cellX = wrap(Math.floor(creature.x / params.gridCellSize), world.cols);
  const cellY = wrap(Math.floor(creature.y / params.gridCellSize), world.rows);
  const cellIdx = cellY * world.cols + cellX;

  const travel = movementEfficiency(derivePhenotype(creature.genome, params), { elevation: terrain.elevation[cellIdx], seaLevel: terrain.seaLevel }, params);
  creature.x = wrap(creature.x + Math.cos(creature.heading) * travel, worldWidth);
  creature.y = wrap(creature.y + Math.sin(creature.heading) * travel, worldHeight);
  creature.distanceTraveled += travel;

  creature.energy -= metabolicCost(creature.genome, params);

  let attempt: PredationAttempt | null = null;
  if (target?.preyTarget && tick >= creature.attackCooldownUntilTick) {
    const distToPrey = torDist(creature.x, creature.y, target.preyTarget.x, target.preyTarget.y, worldWidth, worldHeight);
    if (distToPrey <= params.attackRange) {
      attempt = { predatorId: creature.id, preyId: target.preyTarget.id };
      creature.attackCooldownUntilTick = tick + params.attackCooldownTicks;
    }
  }

  const idx =
    wrap(Math.floor(creature.y / params.gridCellSize), world.rows) * world.cols +
    wrap(Math.floor(creature.x / params.gridCellSize), world.cols);
  const take = Math.min(world.fruit[idx], params.intakeRate);

  if (take > 0) {
    world.fruit[idx] -= take;
    creature.energy += take * gainPerUnit(creature.genome.carnivory, 0, params);
    if (consumptionGrid) recordConsumption(consumptionGrid, creature.lineageId, idx, take);
    if (speciesBehavior) recordDiet(speciesBehavior, creature.lineageId, 0, take);
    trySeedSapling(treeState, creature.x, creature.y, rng, params, terrain, tick, world);
  }

  creature.age += 1;
  return attempt;
}

export function isReadyToReproduce(creature: Creature, params: Params): boolean {
  return creature.energy >= creature.genome.reproThreshold * energyCapacity(creature.genome, params);
}

/**
 * Splits a parent's reproductive spend across its offspring and returns them.
 * Mutates the parent's energy in place; does not check isReadyToReproduce itself
 * (callers decide when to invoke this) and does not touch the parent's age/position
 * beyond scattering children with a small jitter around it.
 *
 * Each child's birth energy is a fraction of ITS OWN capacity (see params.ts docs on
 * offspringEnergyFraction{Min,Max}) — never the parent's, and never enough to itself clear
 * the lowest possible reproThreshold. That constraint is what stops a single energy windfall
 * from cascading into runaway fission (see Phase 1 commit history for the bug this replaced).
 */
export function reproduce(creature: Creature, rng: RNG, params: Params, tick: number, allocateId: () => number): Creature[] {
  const numOffspring = Math.max(1, Math.round(lerp(params.maxOffspringCount, 1, creature.genome.offspringInvestment)));
  const investmentFraction = lerp(
    params.offspringEnergyFractionMin,
    params.offspringEnergyFractionMax,
    creature.genome.offspringInvestment,
  );

  const childGenomes = Array.from({ length: numOffspring }, () => mutate(creature.genome, rng));
  const childEnergies = childGenomes.map((g) => investmentFraction * energyCapacity(g, params));
  const totalCost = childEnergies.reduce((sum, e) => sum + e, 0);

  // Never let reproduction push the parent below zero, even if a lucky mutation briefly
  // inflated a child's capacity beyond what the parent can actually fund.
  const affordableFraction = totalCost > 0 ? Math.min(1, creature.energy / totalCost) : 1;
  creature.energy -= totalCost * affordableFraction;

  return childGenomes.map((genome, i) =>
    createCreature({
      id: allocateId(),
      parentId: creature.id,
      lineageId: creature.lineageId,
      genome,
      x: wrap(creature.x + rng.nextRange(-1, 1), params.worldWidth),
      y: wrap(creature.y + rng.nextRange(-1, 1), params.worldHeight),
      energy: childEnergies[i] * affordableFraction,
      birthTick: tick,
      // Parent's own gene decides how long it keeps caring for this child, same as
      // offspringInvestment already deciding the one-time birth endowment above.
      nursingUntilTick: tick + creature.genome.nursingDuration,
      rng,
    }),
  );
}
