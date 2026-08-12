import type { ConsumptionGrid } from "./consumption.ts";
import { recordConsumption } from "./consumption.ts";
import { mutate, type Genome } from "./genome.ts";
import type { Params } from "../params.ts";
import type { RNG } from "./rng.ts";
import { recordDiet, type SpeciesBehaviorStats } from "./speciesBehaviorStats.ts";
import type { TerrainGrid } from "./terrain.ts";
import { torDelta, torDist, wrap, lerp } from "./util.ts";
import type { World } from "./world.ts";

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

/** Energy yield per unit of food type `f` (0 = R, 1 = B) for a given diet preference. */
export function gainPerUnit(dietPref: number, foodType: 0 | 1, params: Params): number {
  return params.maxGain * Math.pow(1 - Math.abs(dietPref - foodType), params.specializationExponent);
}

interface SenseResult {
  x: number;
  y: number;
  score: number;
}

/** rGain/bGain are passed in rather than recomputed here — they only depend on dietPref, not position. */
function senseFood(
  creature: Creature,
  world: World,
  params: Params,
  worldWidth: number,
  worldHeight: number,
  rGain: number,
  bGain: number,
): SenseResult | null {
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

      const rAmt = world.r[idx];
      const bAmt = world.b[idx];
      if (rAmt > 1e-3) {
        const score = (rAmt * rGain) / (dist + 1);
        if (!best || score > best.score) best = { x: cellCenterX, y: cellCenterY, score };
      }
      if (bAmt > 1e-3) {
        const score = (bAmt * bGain) / (dist + 1);
        if (!best || score > best.score) best = { x: cellCenterX, y: cellCenterY, score };
      }
    }
  }
  return best;
}

/** Advances one creature by one tick in place: sense, steer, move, pay metabolism, eat. */
export function stepCreature(
  creature: Creature,
  world: World,
  terrain: TerrainGrid,
  rng: RNG,
  params: Params,
  consumptionGrid: ConsumptionGrid | null = null,
  behaviorStats: SpeciesBehaviorStats | null = null,
): void {
  const worldWidth = world.cols * params.gridCellSize;
  const worldHeight = world.rows * params.gridCellSize;
  const rGain = gainPerUnit(creature.genome.dietPref, 0, params);
  const bGain = gainPerUnit(creature.genome.dietPref, 1, params);

  const target = senseFood(creature, world, params, worldWidth, worldHeight, rGain, bGain);
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
  const passability = terrain.passability[cellY * world.cols + cellX];

  const travel = creature.genome.speed * passability;
  creature.x = wrap(creature.x + Math.cos(creature.heading) * travel, worldWidth);
  creature.y = wrap(creature.y + Math.sin(creature.heading) * travel, worldHeight);
  creature.distanceTraveled += travel;

  creature.energy -= metabolicCost(creature.genome, params);

  const idx =
    wrap(Math.floor(creature.y / params.gridCellSize), world.rows) * world.cols +
    wrap(Math.floor(creature.x / params.gridCellSize), world.cols);
  const rTake = Math.min(world.r[idx], params.intakeRate);
  const bTake = Math.min(world.b[idx], params.intakeRate);

  if (rTake * rGain >= bTake * bGain && rTake > 0) {
    world.r[idx] -= rTake;
    creature.energy += rTake * rGain;
    if (consumptionGrid) recordConsumption(consumptionGrid, creature.lineageId, idx, rTake);
    if (behaviorStats) recordDiet(behaviorStats, creature.lineageId, 0, rTake);
  } else if (bTake > 0) {
    world.b[idx] -= bTake;
    creature.energy += bTake * bGain;
    if (consumptionGrid) recordConsumption(consumptionGrid, creature.lineageId, idx, bTake);
    if (behaviorStats) recordDiet(behaviorStats, creature.lineageId, 1, bTake);
  }

  creature.age += 1;
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
