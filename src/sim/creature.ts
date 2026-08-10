import type { Genome } from "./genome.ts";
import type { Params } from "../ui/params.ts";
import type { RNG } from "./rng.ts";
import type { TerrainGrid } from "./terrain.ts";
import type { World } from "./world.ts";
import { torDelta, torDist, wrap } from "./util.ts";

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
}

export function createCreature(
  id: number,
  parentId: number | null,
  lineageId: number,
  genome: Genome,
  x: number,
  y: number,
  energy: number,
  birthTick: number,
  rng: RNG,
): Creature {
  return {
    id,
    parentId,
    lineageId,
    genome,
    x,
    y,
    heading: rng.nextRange(0, Math.PI * 2),
    energy,
    age: 0,
    birthTick,
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

function senseFood(creature: Creature, world: World, params: Params, worldWidth: number, worldHeight: number): SenseResult | null {
  const cellSize = params.gridCellSize;
  const cx = Math.floor(creature.x / cellSize);
  const cy = Math.floor(creature.y / cellSize);
  const radiusCells = Math.ceil(creature.genome.senseRadius / cellSize);
  const rGain = gainPerUnit(creature.genome.dietPref, 0, params);
  const bGain = gainPerUnit(creature.genome.dietPref, 1, params);

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
export function stepCreature(creature: Creature, world: World, terrain: TerrainGrid, rng: RNG, params: Params): void {
  const worldWidth = world.cols * params.gridCellSize;
  const worldHeight = world.rows * params.gridCellSize;

  const target = senseFood(creature, world, params, worldWidth, worldHeight);
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

  creature.energy -= metabolicCost(creature.genome, params);

  const idx =
    wrap(Math.floor(creature.y / params.gridCellSize), world.rows) * world.cols +
    wrap(Math.floor(creature.x / params.gridCellSize), world.cols);
  const rGain = gainPerUnit(creature.genome.dietPref, 0, params);
  const bGain = gainPerUnit(creature.genome.dietPref, 1, params);
  const rTake = Math.min(world.r[idx], params.intakeRate);
  const bTake = Math.min(world.b[idx], params.intakeRate);

  if (rTake * rGain >= bTake * bGain && rTake > 0) {
    world.r[idx] -= rTake;
    creature.energy += rTake * rGain;
  } else if (bTake > 0) {
    world.b[idx] -= bTake;
    creature.energy += bTake * bGain;
  }

  creature.age += 1;
}
