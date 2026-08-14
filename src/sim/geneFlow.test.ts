import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../params.ts";
import { createCreature, type Creature } from "./creature.ts";
import { randomGenome } from "./genome.ts";
import { cloneGeneFlow, initGeneFlow, updateGeneFlow } from "./geneFlow.ts";
import { RNG } from "./rng.ts";

const params = { ...DEFAULT_PARAMS, worldWidth: 100, geneFlowWindowTicks: 10 };

function creatureAt(id: number, x: number): Creature {
  return createCreature({
    id,
    parentId: null,
    lineageId: 0,
    genome: randomGenome(new RNG(id + 1)),
    x,
    y: 10,
    energy: 1,
    birthTick: 0,
    rng: new RNG(id + 100),
  });
}

describe("gene flow tracking", () => {
  it("does not count a creature's first observation as a migration", () => {
    const state = initGeneFlow();
    updateGeneFlow(state, [creatureAt(1, 75)], params, 1);

    expect(state.migrationsInWindow).toBe(0);
    expect(state.regionOf.get(1)).toBe(1);
  });

  it("counts every crossing between the west and east halves within a window", () => {
    const state = initGeneFlow();
    const creature = creatureAt(1, 25);
    updateGeneFlow(state, [creature], params, 0);

    creature.x = 50; // the midpoint itself belongs to the east half
    updateGeneFlow(state, [creature], params, 1);
    creature.x = 49.9;
    updateGeneFlow(state, [creature], params, 2);

    expect(state.migrationsInWindow).toBe(2);
  });

  it("publishes and resets a completed measurement window", () => {
    const state = initGeneFlow();
    const creature = creatureAt(1, 25);
    updateGeneFlow(state, [creature], params, 0);
    creature.x = 75;
    updateGeneFlow(state, [creature], params, 4);

    updateGeneFlow(state, [creature], params, 10);

    expect(state.history).toEqual([{ tick: 10, migrations: 1 }]);
    expect(state.migrationsInWindow).toBe(0);
    expect(state.windowStartTick).toBe(10);
  });

  it("prunes dead creature ids when a window closes", () => {
    const state = initGeneFlow();
    const survivor = creatureAt(1, 25);
    const dead = creatureAt(2, 75);
    updateGeneFlow(state, [survivor, dead], params, 0);

    updateGeneFlow(state, [survivor], params, 10);

    expect(Array.from(state.regionOf.keys())).toEqual([survivor.id]);
  });

  it("clones maps, samples, and counters without sharing mutable state", () => {
    const original = initGeneFlow();
    original.regionOf.set(1, 0);
    original.migrationsInWindow = 3;
    original.history.push({ tick: 10, migrations: 2 });

    const cloned = cloneGeneFlow(original);
    cloned.regionOf.set(1, 1);
    cloned.history[0].migrations = 99;
    cloned.migrationsInWindow = 7;

    expect(original.regionOf.get(1)).toBe(0);
    expect(original.history[0].migrations).toBe(2);
    expect(original.migrationsInWindow).toBe(3);
  });
});
