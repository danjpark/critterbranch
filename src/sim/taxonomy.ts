import { isBimodal } from "./bimodality.ts";
import type { Creature } from "./creature.ts";
import { GENE_KEYS, GENE_RANGES, type Genome, geneticDistance, genomeCentroid } from "./genome.ts";
import type { TerrainGrid } from "./terrain.ts";
import { circularMean, wrap, wrappedLerp } from "./util.ts";
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

/**
 * A split findSplit() has detected but not yet confirmed — tracked across passes so a single
 * fluctuation can't create a permanent species (see params.speciationConfirmationPasses). Matched
 * pass-to-pass by centroid proximity of the spinoff cluster: "Do not over-engineer cluster
 * tracking initially. Centroid continuity plus persistence is acceptable."
 */
export interface CandidateSplit {
  parentSpeciesId: number;
  firstDetectedTick: number;
  consecutiveDetections: number;
  /** Ticks since this candidate's last confirming detection — reset to 0 each time findSplit
   * re-detects a matching split, incremented by taxonomyIntervalTicks otherwise. Once this
   * exceeds params.speciationCandidateTimeoutPasses worth of ticks, the candidate is dropped. */
  ticksSinceLastDetection: number;
  centroidKeep: Genome;
  centroidSpinoff: Genome;
  separation: number;
}

export interface TaxonomyState {
  nextSpeciesId: number;
  species: Map<number, Species>;
  /** Pending splits awaiting confirmation, keyed by the species they'd split from. At most one
   * candidate per species at a time — a second, different split direction replaces rather than
   * stacks (see updateTaxonomy). */
  candidates: Map<number, CandidateSplit>;
}

/** One point in time for the Muller plot: every living species' population count. */
export interface PopulationSample {
  tick: number;
  counts: Record<number, number>;
}

export function samplePopulation(taxonomy: TaxonomyState, tick: number): PopulationSample {
  const counts: Record<number, number> = {};
  for (const species of taxonomy.species.values()) {
    if (species.extinctTick === null) counts[species.id] = species.memberCount;
  }
  return { tick, counts };
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
  return { nextSpeciesId: 1, species: new Map([[0, species]]), candidates: new Map() };
}

export function cloneTaxonomy(taxonomy: TaxonomyState): TaxonomyState {
  const species = new Map<number, Species>();
  for (const [id, s] of taxonomy.species) {
    species.set(id, { ...s, foundingCentroid: { ...s.foundingCentroid }, centroid: { ...s.centroid } });
  }
  const candidates = new Map<number, CandidateSplit>();
  for (const [id, c] of taxonomy.candidates) {
    candidates.set(id, { ...c, centroidKeep: { ...c.centroidKeep }, centroidSpinoff: { ...c.centroidSpinoff } });
  }
  return { nextSpeciesId: taxonomy.nextSpeciesId, species, candidates };
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

  // Signed 1D projection onto the seedA<->seedB axis: negative = closer to A, positive = closer
  // to B, magnitude = how decisively. This is what isBimodal actually checks for a valley in —
  // just partitioning by nearest-seed (below) always succeeds for *any* population with enough
  // spread, bimodal or not, since two arbitrary extreme points always have separated centroids.
  // Without this gap check, a single wide, continuously-varying population (pure drift, no real
  // structure) gets sliced in two and misreported as a split every time. That's exactly the
  // false-positive SPEC.md's neutral-control test exists to catch.
  const projections = members.map((m) => geneticDistance(m.genome, seedA.genome) - geneticDistance(m.genome, seedB.genome));
  if (!isBimodal(projections)) return null;

  const clusterA: Creature[] = [];
  const clusterB: Creature[] = [];
  for (let i = 0; i < members.length; i++) {
    (projections[i] <= 0 ? clusterA : clusterB).push(members[i]);
  }
  if (clusterA.length < minFounders || clusterB.length < minFounders) return null;

  const centroidA = genomeCentroid(clusterA.map((c) => c.genome));
  const centroidB = genomeCentroid(clusterB.map((c) => c.genome));
  if (geneticDistance(centroidA, centroidB) <= threshold) return null;

  // Larger cluster keeps the parent species id; the smaller one spins off as new.
  return clusterA.length >= clusterB.length ? { keep: clusterA, spinoff: clusterB } : { keep: clusterB, spinoff: clusterA };
}

/** Circular (torus-aware) mean position — a plain average breaks near the wrap seam, where two
 * points that are actually close together (e.g. x=1 and worldWidth-1) would otherwise average to
 * a point on the far side of the map from either of them. */
function averagePosition(members: Creature[], params: Params): { x: number; y: number } {
  return {
    x: circularMean(members.map((m) => m.x), params.worldWidth),
    y: circularMean(members.map((m) => m.y), params.worldHeight),
  };
}

/** Samples passability along the SHORTEST wrapped path between two points, not a straight line in
 * unwrapped coordinates — the latter can sample clean terrain straight through the middle of the
 * map while completely missing a barrier that actually separates the two points the short way,
 * around the edge. */
function sampleMinPassabilityAlongLine(terrain: TerrainGrid, params: Params, x1: number, y1: number, x2: number, y2: number): number {
  const steps = 12;
  let minPassability = 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = wrappedLerp(x1, x2, t, params.worldWidth);
    const y = wrappedLerp(y1, y2, t, params.worldHeight);
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
export function classifyMechanism(spinoff: Creature[], keep: Creature[], parentCentroid: Genome, newCentroid: Genome, terrain: TerrainGrid, params: Params): SpeciationMechanism {
  const posA = averagePosition(spinoff, params);
  const posB = averagePosition(keep, params);
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
    const existingCandidate = taxonomy.candidates.get(species.id);

    if (!split) {
      // No split detected this pass. An in-progress candidate isn't dropped immediately — a
      // population can wobble in and out of clean bimodality pass to pass even while a real split
      // is genuinely underway (see sim/axisIsolation.test.ts) — but it does age out eventually if
      // it never gets re-confirmed, so a one-off fluctuation can't linger forever.
      if (existingCandidate) {
        existingCandidate.ticksSinceLastDetection += params.taxonomyIntervalTicks;
        if (existingCandidate.ticksSinceLastDetection > params.speciationCandidateTimeoutPasses * params.taxonomyIntervalTicks) {
          taxonomy.candidates.delete(species.id);
        }
      }
      species.centroid = genomeCentroid(members.map((m) => m.genome));
      continue;
    }

    const keepCentroid = genomeCentroid(split.keep.map((c) => c.genome));
    const newCentroid = genomeCentroid(split.spinoff.map((c) => c.genome));
    const separation = geneticDistance(keepCentroid, newCentroid);

    // Match against any in-progress candidate by spinoff-centroid proximity: within one
    // speciationThreshold of the last-seen spinoff centroid counts as "the same split, still
    // going," anything further is a different split direction that starts its own count.
    const isSameCandidate = existingCandidate !== undefined && geneticDistance(existingCandidate.centroidSpinoff, newCentroid) <= params.speciationThreshold;

    const consecutiveDetections = isSameCandidate ? existingCandidate.consecutiveDetections + 1 : 1;

    if (consecutiveDetections < params.speciationConfirmationPasses) {
      // Not confirmed yet — record/update the candidate, but the population stays one species
      // (all members, not just "keep") until confirmation actually happens.
      taxonomy.candidates.set(species.id, {
        parentSpeciesId: species.id,
        firstDetectedTick: isSameCandidate ? existingCandidate.firstDetectedTick : tick,
        consecutiveDetections,
        ticksSinceLastDetection: 0,
        centroidKeep: keepCentroid,
        centroidSpinoff: newCentroid,
        separation,
      });
      species.centroid = genomeCentroid(members.map((m) => m.genome));
      continue;
    }

    // Confirmed: the split has now been seen on speciationConfirmationPasses consecutive passes.
    taxonomy.candidates.delete(species.id);

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
