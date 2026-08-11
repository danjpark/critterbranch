import { describe, expect, it } from "vitest";
import { findCreatureAt } from "./worldView.ts";
import { createCreature, type Creature } from "../sim/creature.ts";
import { randomGenome } from "../sim/genome.ts";
import { RNG } from "../sim/rng.ts";
import { createSimState } from "../sim/sim.ts";
import { DEFAULT_PARAMS } from "../params.ts";

const CANVAS_SIZE = 640;

function makeCreatureAt(id: number, x: number, y: number): Creature {
  const rng = new RNG(id + 1);
  return createCreature({ id, parentId: null, lineageId: 0, genome: randomGenome(rng), x, y, energy: 1, birthTick: 0, rng });
}

describe("findCreatureAt", () => {
  it("finds a creature directly under the click", () => {
    const { state } = createSimState(1, DEFAULT_PARAMS);
    state.evolution.creatures = [makeCreatureAt(0, 100, 100)];
    const scale = CANVAS_SIZE / DEFAULT_PARAMS.worldWidth;

    const found = findCreatureAt(state, DEFAULT_PARAMS, 100 * scale, 100 * scale, CANVAS_SIZE, CANVAS_SIZE);
    expect(found?.id).toBe(0);
  });

  it("returns null when nothing is close enough", () => {
    const { state } = createSimState(1, DEFAULT_PARAMS);
    state.evolution.creatures = [makeCreatureAt(0, 10, 10)];

    const found = findCreatureAt(state, DEFAULT_PARAMS, CANVAS_SIZE - 1, CANVAS_SIZE - 1, CANVAS_SIZE, CANVAS_SIZE);
    expect(found).toBeNull();
  });

  it("picks the nearer of two creatures", () => {
    const { state } = createSimState(1, DEFAULT_PARAMS);
    state.evolution.creatures = [makeCreatureAt(0, 100, 100), makeCreatureAt(1, 102, 100)];
    const scale = CANVAS_SIZE / DEFAULT_PARAMS.worldWidth;

    const found = findCreatureAt(state, DEFAULT_PARAMS, 101 * scale, 100 * scale, CANVAS_SIZE, CANVAS_SIZE);
    expect(found?.id).toBe(1);
  });

  it("accounts for toroidal wraparound when picking the nearest creature", () => {
    const { state } = createSimState(1, DEFAULT_PARAMS);
    // A creature at the far edge (worldWidth - 1) is actually adjacent to x=0 on a torus.
    state.evolution.creatures = [makeCreatureAt(0, DEFAULT_PARAMS.worldWidth - 1, 100)];
    const scale = CANVAS_SIZE / DEFAULT_PARAMS.worldWidth;

    const found = findCreatureAt(state, DEFAULT_PARAMS, 0, 100 * scale, CANVAS_SIZE, CANVAS_SIZE);
    expect(found?.id).toBe(0);
  });
});
