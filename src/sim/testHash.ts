import type { SimState } from "./sim.ts";

/** Deterministic, order-sensitive hash of everything that should be identical between two runs
 * with the same seed/params/interventions. Shared by determinism and replay tests. */
export function hashState(state: SimState): string {
  const creatureSnapshot = state.creatures.map((c) => [
    c.id,
    c.parentId,
    c.x.toFixed(6),
    c.y.toFixed(6),
    c.energy.toFixed(6),
    c.age,
    JSON.stringify(c.genome),
  ]);
  const payload = JSON.stringify({
    tick: state.tick,
    creatures: creatureSnapshot,
    r: Array.from(state.world.r),
    b: Array.from(state.world.b),
    elevation: Array.from(state.terrain.elevation),
    passability: Array.from(state.terrain.passability),
    fertility: Array.from(state.terrain.fertility),
  });

  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (Math.imul(31, hash) + payload.charCodeAt(i)) | 0;
  }
  return `${hash.toString(16)}:${payload.length}`;
}
