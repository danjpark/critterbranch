import { describe, expect, it } from "vitest";
import { layoutTree } from "./treeLayout.ts";
import { randomGenome, type Genome } from "../sim/genome.ts";
import { RNG } from "../sim/rng.ts";
import { collectDescendantIds, type Species, type TaxonomyState } from "../sim/taxonomy.ts";

function genome(): Genome {
  return randomGenome(new RNG(1));
}

function makeSpecies(overrides: Partial<Species> & { id: number }): Species {
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
    ...overrides,
  };
}

function taxonomyOf(species: Species[]): TaxonomyState {
  return {
    nextSpeciesId: Math.max(...species.map((s) => s.id)) + 1,
    species: new Map(species.map((s) => [s.id, s])),
    candidates: new Map(),
  };
}

describe("layoutTree", () => {
  it("gives a single root a single row spanning to the current tick", () => {
    const taxonomy = taxonomyOf([makeSpecies({ id: 0, originTick: 0 })]);
    const layout = layoutTree(taxonomy, 500);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0]).toMatchObject({ speciesId: 0, parentId: null, row: 0, originTick: 0, endTick: 500, isExtinct: false });
    expect(layout.rowCount).toBe(1);
  });

  it("gives every node a distinct row, parent before children", () => {
    const taxonomy = taxonomyOf([
      makeSpecies({ id: 0, originTick: 0 }),
      makeSpecies({ id: 1, parentId: 0, originTick: 100 }),
      makeSpecies({ id: 2, parentId: 0, originTick: 200 }),
      makeSpecies({ id: 3, parentId: 1, originTick: 300 }),
    ]);
    const layout = layoutTree(taxonomy, 1000);
    const rows = layout.nodes.map((n) => n.row);
    expect(new Set(rows).size).toBe(rows.length); // all distinct

    const rowOf = (id: number) => layout.nodes.find((n) => n.speciesId === id)!.row;
    expect(rowOf(0)).toBeLessThan(rowOf(1));
    expect(rowOf(0)).toBeLessThan(rowOf(2));
    expect(rowOf(1)).toBeLessThan(rowOf(3));
  });

  it("gives an extinct species endTick = its extinctTick, not the current tick", () => {
    const taxonomy = taxonomyOf([makeSpecies({ id: 0, originTick: 0, extinctTick: 400 })]);
    const layout = layoutTree(taxonomy, 1000);
    expect(layout.nodes[0].endTick).toBe(400);
    expect(layout.nodes[0].isExtinct).toBe(true);
  });

  it("handles multiple roots (a forest) for a multi-founder run", () => {
    const taxonomy = taxonomyOf([makeSpecies({ id: 0, originTick: 0 }), makeSpecies({ id: 1, originTick: 0 })]);
    const layout = layoutTree(taxonomy, 100);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.nodes.map((n) => n.parentId)).toEqual([null, null]);
  });

  it("orders siblings deterministically by originTick then id", () => {
    const taxonomy = taxonomyOf([
      makeSpecies({ id: 0, originTick: 0 }),
      makeSpecies({ id: 2, parentId: 0, originTick: 200 }),
      makeSpecies({ id: 1, parentId: 0, originTick: 100 }),
    ]);
    const layout = layoutTree(taxonomy, 1000);
    // Species 1 originated before species 2, so it should get the earlier row despite its id being smaller-after-2 in insertion order.
    const rowOf = (id: number) => layout.nodes.find((n) => n.speciesId === id)!.row;
    expect(rowOf(1)).toBeLessThan(rowOf(2));
  });
});

describe("collectDescendantIds", () => {
  it("includes the root itself even with no children", () => {
    const taxonomy = taxonomyOf([makeSpecies({ id: 0 })]);
    expect(collectDescendantIds(taxonomy, 0)).toEqual(new Set([0]));
  });

  it("includes all transitive descendants, not just direct children", () => {
    const taxonomy = taxonomyOf([
      makeSpecies({ id: 0 }),
      makeSpecies({ id: 1, parentId: 0 }),
      makeSpecies({ id: 2, parentId: 1 }),
      makeSpecies({ id: 3, parentId: 0 }),
      makeSpecies({ id: 99 }), // unrelated root, must not be included
    ]);
    expect(collectDescendantIds(taxonomy, 0)).toEqual(new Set([0, 1, 2, 3]));
  });

  it("a leaf species' descendants is just itself", () => {
    const taxonomy = taxonomyOf([makeSpecies({ id: 0 }), makeSpecies({ id: 1, parentId: 0 })]);
    expect(collectDescendantIds(taxonomy, 1)).toEqual(new Set([1]));
  });
});
