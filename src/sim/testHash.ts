import type { SimState } from "./sim.ts";

/**
 * Deterministic, order-sensitive hash of everything that should be identical between two runs with
 * the same seed/params/interventions. Shared by determinism and replay tests.
 *
 * Covers every field the NEXT tick reads, not just the ones a human would look at on screen. That
 * distinction matters: `heading` was originally omitted, and it is the single largest input to
 * where a creature ends up next tick. A divergence in heading alone is invisible to a hash taken
 * at that instant and only shows up a tick later as a position difference — so a test comparing
 * hashes at the final tick of a run could not see a divergence introduced on that final tick at
 * all. Same reasoning for the id allocators (nextId / trees.nextId / nextSpeciesId), the in-flight
 * god-mode effects, and regrowthModifier: two states that agree on everything visible but disagree
 * on those will produce different futures, which is exactly what "deterministic" is claiming won't
 * happen.
 */
export function hashState(state: SimState): string {
  const { evolution, observations } = state;
  const creatureSnapshot = evolution.creatures.map((c) => [
    c.id,
    c.parentId,
    c.lineageId,
    c.x.toFixed(6),
    c.y.toFixed(6),
    c.heading.toFixed(6),
    c.energy.toFixed(6),
    c.age,
    c.distanceTraveled.toFixed(6),
    c.attackCooldownUntilTick,
    c.nursingUntilTick,
    JSON.stringify(c.genome),
  ]);
  const speciesSnapshot = Array.from(observations.taxonomy.species.values())
    .sort((a, b) => a.id - b.id)
    .map((s) => [s.id, s.parentId, s.originTick, s.extinctTick, s.mechanism, s.memberCount, JSON.stringify(s.centroid)]);
  const treeSnapshot = evolution.trees.trees
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((t) => [t.id, t.x.toFixed(6), t.y.toFixed(6), t.plantedTick, t.maturedTick, t.capacity.toFixed(6)]);
  const transitionSnapshot = evolution.activeTransitions.map((t) => [t.field, t.startTick, t.durationTicks, t.cellIndices.length]);
  const overrideSnapshot = evolution.activeRegrowthOverrides.map((o) => [o.multiplier, o.startTick, o.endTick, o.cellIndices.length]);
  const payload = JSON.stringify({
    tick: evolution.tick,
    nextCreatureId: evolution.nextId,
    creatures: creatureSnapshot,
    fruit: Array.from(evolution.world.fruit),
    regrowthModifier: Array.from(evolution.world.regrowthModifier),
    trees: treeSnapshot,
    nextTreeId: evolution.trees.nextId,
    elevation: Array.from(evolution.terrain.elevation),
    passability: Array.from(evolution.terrain.passability),
    fertility: Array.from(evolution.terrain.fertility),
    seaLevel: evolution.terrain.seaLevel,
    species: speciesSnapshot,
    nextSpeciesId: observations.taxonomy.nextSpeciesId,
    taxonomyEventCount: observations.taxonomyEvents.length,
    activeTransitions: transitionSnapshot,
    activeRegrowthOverrides: overrideSnapshot,
  });

  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (Math.imul(31, hash) + payload.charCodeAt(i)) | 0;
  }
  return `${hash.toString(16)}:${payload.length}`;
}
