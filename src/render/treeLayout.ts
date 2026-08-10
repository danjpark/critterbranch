import type { Genome } from "../sim/genome.ts";
import type { Species, SpeciationMechanism, TaxonomyState } from "../sim/taxonomy.ts";

export interface TreeNode {
  speciesId: number;
  parentId: number | null;
  /** Assigned row (y-slot) via a deterministic pre-order DFS — no two nodes share a row, and a
   * parent's row always comes before its children's, so a straight vertical connector at the
   * child's originTick cleanly joins them without crossing any other branch. */
  row: number;
  originTick: number;
  /** extinctTick if the species has died out, otherwise the tick the layout was computed at (branch runs to "now"). */
  endTick: number;
  isExtinct: boolean;
  mechanism: SpeciationMechanism;
  dominantDivergentGene: keyof Genome | null;
  foundingCentroid: Genome;
  centroid: Genome;
}

export interface TreeLayout {
  nodes: TreeNode[];
  rowCount: number;
}

/**
 * Multi-root capable dendrogram layout: species with parentId === null are roots (a 2-founder
 * run produces a forest, not a single tree — see SPEC.md). Deterministic ordering (by
 * originTick, then id) so the same taxonomy always lays out identically.
 */
export function layoutTree(taxonomy: TaxonomyState, currentTick: number): TreeLayout {
  const speciesList = Array.from(taxonomy.species.values());
  const childrenOf = new Map<number, Species[]>();
  const roots: Species[] = [];

  for (const s of speciesList) {
    if (s.parentId === null) {
      roots.push(s);
    } else {
      const arr = childrenOf.get(s.parentId);
      if (arr) arr.push(s);
      else childrenOf.set(s.parentId, [s]);
    }
  }

  const byOriginThenId = (a: Species, b: Species) => a.originTick - b.originTick || a.id - b.id;
  roots.sort(byOriginThenId);
  for (const arr of childrenOf.values()) arr.sort(byOriginThenId);

  const nodes: TreeNode[] = [];
  let nextRow = 0;

  function visit(s: Species): void {
    nodes.push({
      speciesId: s.id,
      parentId: s.parentId,
      row: nextRow++,
      originTick: s.originTick,
      endTick: s.extinctTick ?? currentTick,
      isExtinct: s.extinctTick !== null,
      mechanism: s.mechanism,
      dominantDivergentGene: s.dominantDivergentGene,
      foundingCentroid: s.foundingCentroid,
      centroid: s.centroid,
    });
    for (const child of childrenOf.get(s.id) ?? []) visit(child);
  }

  for (const root of roots) visit(root);

  return { nodes, rowCount: nextRow };
}

/** A species and every species descended from it — the set a lineage-filter click should show. */
export function collectDescendantIds(taxonomy: TaxonomyState, rootId: number): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const s of taxonomy.species.values()) {
    if (s.parentId !== null) {
      const arr = childrenOf.get(s.parentId);
      if (arr) arr.push(s.id);
      else childrenOf.set(s.parentId, [s.id]);
    }
  }

  const result = new Set<number>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const childId of childrenOf.get(id) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        stack.push(childId);
      }
    }
  }
  return result;
}
