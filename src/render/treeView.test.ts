import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../params.ts";
import { randomGenome, type Genome } from "../sim/genome.ts";
import { RNG } from "../sim/rng.ts";
import { createSimState, type SimState } from "../sim/sim.ts";
import type { Species, TaxonomyState } from "../sim/taxonomy.ts";
import { findBranchAt } from "./treeView.ts";

const CANVAS_WIDTH = 640;
const CURRENT_TICK = 1_000;
const ROW_ZERO_Y = 27;
const ROW_ONE_Y = 49;

function genome(): Genome {
  return randomGenome(new RNG(1));
}

function species(overrides: Partial<Species> & { id: number }): Species {
  return {
    parentId: null,
    originTick: 0,
    extinctTick: null,
    foundingCentroid: genome(),
    centroid: genome(),
    memberCount: 10,
    peakMemberCount: 10,
    mechanism: "founder-population",
    dominantDivergentGene: null,
    originEvidence: null,
    ...overrides,
  };
}

function stateWith(speciesList: Species[]): SimState {
  const { state } = createSimState(1, DEFAULT_PARAMS);
  const taxonomy: TaxonomyState = {
    nextSpeciesId: Math.max(...speciesList.map((entry) => entry.id)) + 1,
    species: new Map(speciesList.map((entry) => [entry.id, entry])),
    candidates: new Map(),
  };
  state.observations.taxonomy = taxonomy;
  state.evolution.tick = CURRENT_TICK;
  return state;
}

function xAtTick(tick: number): number {
  return 14 + (tick / CURRENT_TICK) * (CANVAS_WIDTH - 28);
}

describe("findBranchAt", () => {
  it("finds a living root branch along its visible lifetime", () => {
    const state = stateWith([species({ id: 0 })]);
    expect(findBranchAt(state, CANVAS_WIDTH, xAtTick(500), ROW_ZERO_Y)).toBe(0);
  });

  it("finds a child only after its origin tick and on its own row", () => {
    const state = stateWith([species({ id: 0 }), species({ id: 1, parentId: 0, originTick: 500, mechanism: "allopatric" })]);

    expect(findBranchAt(state, CANVAS_WIDTH, xAtTick(750), ROW_ONE_Y)).toBe(1);
    expect(findBranchAt(state, CANVAS_WIDTH, xAtTick(400), ROW_ONE_Y)).toBeNull();
  });

  it("does not hit an extinct branch after its extinction tick", () => {
    const state = stateWith([species({ id: 0, extinctTick: 400 })]);
    expect(findBranchAt(state, CANVAS_WIDTH, xAtTick(700), ROW_ZERO_Y)).toBeNull();
  });

  it("rejects clicks outside the branch row tolerance", () => {
    const state = stateWith([species({ id: 0 })]);
    expect(findBranchAt(state, CANVAS_WIDTH, xAtTick(500), ROW_ZERO_Y + 9)).toBeNull();
  });
});
