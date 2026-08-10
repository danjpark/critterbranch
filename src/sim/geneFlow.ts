import type { Creature } from "./creature.ts";
import type { Params } from "../params.ts";

/** One completed measurement window: how many creatures crossed the region boundary during it. */
export interface GeneFlowSample {
  tick: number;
  migrations: number;
}

export interface GeneFlowState {
  /** Which half of the world (0 = x < worldWidth/2, 1 = x >= worldWidth/2) each living creature was in last tick. */
  regionOf: Map<number, 0 | 1>;
  windowStartTick: number;
  migrationsInWindow: number;
  history: GeneFlowSample[];
}

export function initGeneFlow(): GeneFlowState {
  return { regionOf: new Map(), windowStartTick: 0, migrationsInWindow: 0, history: [] };
}

export function cloneGeneFlow(state: GeneFlowState): GeneFlowState {
  return {
    regionOf: new Map(state.regionOf),
    windowStartTick: state.windowStartTick,
    migrationsInWindow: state.migrationsInWindow,
    history: state.history.map((s) => ({ ...s })),
  };
}

function regionOf(x: number, params: Params): 0 | 1 {
  return x < params.worldWidth / 2 ? 0 : 1;
}

/**
 * Tracks migration between the two halves of the world — this is the instrument SPEC.md calls
 * for: "speciation IS the moment that [migration rate] line goes to zero." Runs every tick (a
 * crossing between tick T and T+1 would be missed if this only sampled periodically), but the
 * per-tick cost is just a Map read+write per creature; the history array only grows once per
 * geneFlowWindowTicks.
 */
export function updateGeneFlow(state: GeneFlowState, creatures: Creature[], params: Params, tick: number): void {
  for (const c of creatures) {
    const region = regionOf(c.x, params);
    const previous = state.regionOf.get(c.id);
    if (previous !== undefined && previous !== region) {
      state.migrationsInWindow++;
    }
    state.regionOf.set(c.id, region);
  }

  if (tick - state.windowStartTick >= params.geneFlowWindowTicks) {
    state.history.push({ tick, migrations: state.migrationsInWindow });
    state.migrationsInWindow = 0;
    state.windowStartTick = tick;

    // Prune entries for creatures that have since died — only here, not every tick, since it's
    // an O(population) pass and correctness doesn't depend on doing it immediately.
    const liveIds = new Set(creatures.map((c) => c.id));
    for (const id of state.regionOf.keys()) {
      if (!liveIds.has(id)) state.regionOf.delete(id);
    }
  }
}
