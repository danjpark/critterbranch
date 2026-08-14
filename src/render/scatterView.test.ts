import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../params.ts";
import { createCreature, type Creature } from "../sim/creature.ts";
import { randomGenome } from "../sim/genome.ts";
import { RNG } from "../sim/rng.ts";
import { createSimState } from "../sim/sim.ts";
import { findPointAt } from "./scatterView.ts";

const CANVAS_SIZE = 200;
const options = { xGene: "carnivory" as const, yGene: "aquaticAdaptation" as const, lineageFilter: null };

function creatureAt(id: number, carnivory: number, aquaticAdaptation: number, lineageId = 0): Creature {
  const rng = new RNG(id + 1);
  return createCreature({
    id,
    parentId: null,
    lineageId,
    genome: { ...randomGenome(rng), carnivory, aquaticAdaptation },
    x: 0,
    y: 0,
    energy: 1,
    birthTick: 0,
    rng,
  });
}

describe("findPointAt", () => {
  it("finds a creature at the minimum corner of the selected gene ranges", () => {
    const { state } = createSimState(1, DEFAULT_PARAMS);
    state.evolution.creatures = [creatureAt(1, 0, 0)];

    // Scatter margins place (minimum x, minimum y) at canvas position (44, 170).
    expect(findPointAt(state, options, 44, 170, CANVAS_SIZE, CANVAS_SIZE)?.id).toBe(1);
  });

  it("finds a creature at the maximum corner of the selected gene ranges", () => {
    const { state } = createSimState(1, DEFAULT_PARAMS);
    state.evolution.creatures = [creatureAt(1, 1, 1)];

    // Plot width is 144 and height is 158 after margins, so the maximum corner is (188, 12).
    expect(findPointAt(state, options, 188, 12, CANVAS_SIZE, CANVAS_SIZE)?.id).toBe(1);
  });

  it("respects the active lineage filter during hit testing", () => {
    const { state } = createSimState(1, DEFAULT_PARAMS);
    state.evolution.creatures = [creatureAt(1, 0.5, 0.5, 7)];

    const filteredOptions = { ...options, lineageFilter: new Set([99]) };
    expect(findPointAt(state, filteredOptions, 116, 91, CANVAS_SIZE, CANVAS_SIZE)).toBeNull();
  });

  it("returns null when the click is outside the point-picking radius", () => {
    const { state } = createSimState(1, DEFAULT_PARAMS);
    state.evolution.creatures = [creatureAt(1, 0.5, 0.5)];

    expect(findPointAt(state, options, 20, 20, CANVAS_SIZE, CANVAS_SIZE)).toBeNull();
  });
});
