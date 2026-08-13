import type { SimState } from "./sim.ts";

/** Deterministic, order-sensitive hash of everything that should be identical between two runs
 * with the same seed/params/interventions. Shared by determinism and replay tests. */
export function hashState(state: SimState): string {
  const { evolution, observations } = state;
  const creatureSnapshot = evolution.creatures.map((c) => [
    c.id,
    c.parentId,
    c.lineageId,
    c.x.toFixed(6),
    c.y.toFixed(6),
    c.energy.toFixed(6),
    c.age,
    c.distanceTraveled.toFixed(6),
    c.attackCooldownUntilTick,
    JSON.stringify(c.genome),
  ]);
  const speciesSnapshot = Array.from(observations.taxonomy.species.values())
    .sort((a, b) => a.id - b.id)
    .map((s) => [s.id, s.parentId, s.originTick, s.extinctTick, s.mechanism, s.memberCount, JSON.stringify(s.centroid)]);
  const treeSnapshot = evolution.trees.trees
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((t) => [t.id, t.x.toFixed(6), t.y.toFixed(6), t.plantedTick, t.maturedTick, t.capacity.toFixed(6)]);
  const payload = JSON.stringify({
    tick: evolution.tick,
    creatures: creatureSnapshot,
    fruit: Array.from(evolution.world.fruit),
    trees: treeSnapshot,
    elevation: Array.from(evolution.terrain.elevation),
    passability: Array.from(evolution.terrain.passability),
    fertility: Array.from(evolution.terrain.fertility),
    seaLevel: evolution.terrain.seaLevel,
    species: speciesSnapshot,
    taxonomyEventCount: observations.taxonomyEvents.length,
  });

  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (Math.imul(31, hash) + payload.charCodeAt(i)) | 0;
  }
  return `${hash.toString(16)}:${payload.length}`;
}
