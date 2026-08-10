import type { Creature } from "./creature.ts";
import { GENE_KEYS, GENE_RANGES, type Genome, geneticDistance, genomeCentroid } from "./genome.ts";
import type { TerrainGrid } from "./terrain.ts";
import { wrap } from "./util.ts";
import type { Params } from "../params.ts";

export type SpeciationMechanism = "founder-population" | "allopatric" | "sympatric" | "founder";

export interface Species {
  id: number;
  parentId: number | null;
  originTick: number;
  extinctTick: number | null;
  foundingCentroid: Genome;
  /** Running mean of currently-living members' genomes; updated every taxonomy pass. */
  centroid: Genome;
  memberCount: number;
  peakMemberCount: number;
  mechanism: SpeciationMechanism;
  dominantDivergentGene: keyof Genome | null;
}

export interface SpeciationEvent {
  tick: number;
  speciesId: number;
  parentId: number;
  mechanism: SpeciationMechanism;
  dominantDivergentGene: keyof Genome;
  founderCount: number;
}

export interface ExtinctionEvent {
  tick: number;
  speciesId: number;
  lifespanTicks: number;
  peakMemberCount: number;
}

export type TaxonomyEvent = { type: "speciation"; event: SpeciationEvent } | { type: "extinction"; event: ExtinctionEvent };

export interface TaxonomyState {
  nextSpeciesId: number;
  species: Map<number, Species>;
}

/** Species 0 is the founding population. Mutates each founder's lineageId to 0. */
export function initTaxonomy(founders: Creature[], tick: number): TaxonomyState {
  const centroid = genomeCentroid(founders.map((c) => c.genome));
  for (const c of founders) c.lineageId = 0;
  const species: Species = {
    id: 0,
    parentId: null,
    originTick: tick,
    extinctTick: null,
    foundingCentroid: centroid,
    centroid,
    memberCount: founders.length,
    peakMemberCount: founders.length,
    mechanism: "founder-population",
    dominantDivergentGene: null,
  };
  return { nextSpeciesId: 1, species: new Map([[0, species]]) };
}

export function cloneTaxonomy(taxonomy: TaxonomyState): TaxonomyState {
  const species = new Map<number, Species>();
  for (const [id, s] of taxonomy.species) {
    species.set(id, { ...s, foundingCentroid: { ...s.foundingCentroid }, centroid: { ...s.centroid } });
  }
  return { nextSpeciesId: taxonomy.nextSpeciesId, species };
}

function mostDivergentGene(a: Genome, b: Genome): keyof Genome {
  let best: keyof Genome = GENE_KEYS[0];
  let bestDiff = -Infinity;
  for (const key of GENE_KEYS) {
    const [min, max] = GENE_RANGES[key];
    const diff = Math.abs(a[key] - b[key]) / (max - min);
    if (diff > bestDiff) {
      bestDiff = diff;
      best = key;
    }
  }
  return best;
}

/** Fraction of total (normalized, squared) divergence explained by the single largest gene — high means "one axis drove this," low means "spread across many genes" (a drift signature). */
function dominanceRatio(a: Genome, b: Genome): number {
  let total = 0;
  let max = 0;
  for (const key of GENE_KEYS) {
    const [min, rangeMax] = GENE_RANGES[key];
    const d = ((a[key] - b[key]) / (rangeMax - min)) ** 2;
    total += d;
    if (d > max) max = d;
  }
  return total > 0 ? max / total : 0;
}

/** Farthest-point-sampling heuristic for the two most genetically distant members: two O(n) passes instead of an O(n^2) all-pairs search — this runs periodically over the whole living population, which can be thousands of creatures. */
function findExtremePair(members: Creature[]): [Creature, Creature] {
  let b = members[0];
  let maxDist = -1;
  for (const m of members) {
    const d = geneticDistance(m.genome, members[0].genome);
    if (d > maxDist) {
      maxDist = d;
      b = m;
    }
  }
  let a = b;
  maxDist = -1;
  for (const m of members) {
    const d = geneticDistance(m.genome, b.genome);
    if (d > maxDist) {
      maxDist = d;
      a = m;
    }
  }
  return [a, b];
}

interface Split {
  keep: Creature[];
  spinoff: Creature[];
}

function findSplit(members: Creature[], threshold: number, minFounders: number): Split | null {
  if (members.length < minFounders * 2) return null;

  const [seedA, seedB] = findExtremePair(members);
  if (geneticDistance(seedA.genome, seedB.genome) <= threshold) return null;

  const clusterA: Creature[] = [];
  const clusterB: Creature[] = [];
  for (const m of members) {
    const dA = geneticDistance(m.genome, seedA.genome);
    const dB = geneticDistance(m.genome, seedB.genome);
    (dA <= dB ? clusterA : clusterB).push(m);
  }
  if (clusterA.length < minFounders || clusterB.length < minFounders) return null;

  const centroidA = genomeCentroid(clusterA.map((c) => c.genome));
  const centroidB = genomeCentroid(clusterB.map((c) => c.genome));
  if (geneticDistance(centroidA, centroidB) <= threshold) return null;

  // Larger cluster keeps the parent species id; the smaller one spins off as new.
  return clusterA.length >= clusterB.length ? { keep: clusterA, spinoff: clusterB } : { keep: clusterB, spinoff: clusterA };
}

function averagePosition(members: Creature[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const m of members) {
    sx += m.x;
    sy += m.y;
  }
  return { x: sx / members.length, y: sy / members.length };
}

function sampleMinPassabilityAlongLine(terrain: TerrainGrid, params: Params, x1: number, y1: number, x2: number, y2: number): number {
  const steps = 12;
  let minPassability = 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    const gx = wrap(Math.floor(x / params.gridCellSize), terrain.cols);
    const gy = wrap(Math.floor(y / params.gridCellSize), terrain.rows);
    const p = terrain.passability[gy * terrain.cols + gx];
    if (p < minPassability) minPassability = p;
  }
  return minPassability;
}

/**
 * Infers why a split happened from the state at the tick it was detected — see SPEC.md's "tag
 * every speciation event with its mechanism":
 * - allopatric: a low-passability region separates the two sub-clusters spatially.
 * - founder: few founders, no single dominant gene, no spatial barrier — a drift signature.
 * - sympatric: neither of the above — disruptive selection while sharing the same space.
 */
function classifyMechanism(spinoff: Creature[], keep: Creature[], parentCentroid: Genome, newCentroid: Genome, terrain: TerrainGrid, params: Params): SpeciationMechanism {
  const posA = averagePosition(spinoff);
  const posB = averagePosition(keep);
  const minPassability = sampleMinPassabilityAlongLine(terrain, params, posA.x, posA.y, posB.x, posB.y);
  if (minPassability < params.allopatricPassabilityThreshold) return "allopatric";

  if (spinoff.length < params.founderCountThreshold && dominanceRatio(newCentroid, parentCentroid) < 0.5) {
    return "founder";
  }

  return "sympatric";
}

/**
 * Periodic taxonomy pass: recompute each living species' membership/centroid from the current
 * population, detect splits and extinctions, and mutate creatures' lineageId in place for any
 * that get reassigned to a new species. Returns the events detected this pass (for the event
 * feed / gene-flow-adjacent history).
 */
export function updateTaxonomy(taxonomy: TaxonomyState, creatures: Creature[], terrain: TerrainGrid, params: Params, tick: number): TaxonomyEvent[] {
  const events: TaxonomyEvent[] = [];
  const bySpecies = new Map<number, Creature[]>();
  for (const c of creatures) {
    const arr = bySpecies.get(c.lineageId);
    if (arr) arr.push(c);
    else bySpecies.set(c.lineageId, [c]);
  }

  // Snapshot the species list before iterating — new species can be added mid-loop.
  const currentSpecies = Array.from(taxonomy.species.values());

  for (const species of currentSpecies) {
    if (species.extinctTick !== null) continue;
    const members = bySpecies.get(species.id) ?? [];

    if (members.length === 0) {
      species.extinctTick = tick;
      events.push({
        type: "extinction",
        event: { tick, speciesId: species.id, lifespanTicks: tick - species.originTick, peakMemberCount: species.peakMemberCount },
      });
      continue;
    }

    species.memberCount = members.length;
    species.peakMemberCount = Math.max(species.peakMemberCount, members.length);

    const split = findSplit(members, params.speciationThreshold, params.minFounders);
    if (!split) {
      species.centroid = genomeCentroid(members.map((m) => m.genome));
      continue;
    }

    const keepCentroid = genomeCentroid(split.keep.map((c) => c.genome));
    const newCentroid = genomeCentroid(split.spinoff.map((c) => c.genome));
    const dominantGene = mostDivergentGene(newCentroid, keepCentroid);
    const mechanism = classifyMechanism(split.spinoff, split.keep, keepCentroid, newCentroid, terrain, params);

    const newId = taxonomy.nextSpeciesId++;
    for (const c of split.spinoff) c.lineageId = newId;

    taxonomy.species.set(newId, {
      id: newId,
      parentId: species.id,
      originTick: tick,
      extinctTick: null,
      foundingCentroid: newCentroid,
      centroid: newCentroid,
      memberCount: split.spinoff.length,
      peakMemberCount: split.spinoff.length,
      mechanism,
      dominantDivergentGene: dominantGene,
    });

    species.memberCount = split.keep.length;
    species.centroid = keepCentroid;

    events.push({
      type: "speciation",
      event: { tick, speciesId: newId, parentId: species.id, mechanism, dominantDivergentGene: dominantGene, founderCount: split.spinoff.length },
    });
  }

  return events;
}
