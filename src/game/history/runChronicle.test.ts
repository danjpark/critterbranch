import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../../params.ts";
import { createSimState, type SimInstance } from "../../sim/sim.ts";
import type { Intervention } from "../../sim/intervention.ts";
import type { Genome } from "../../sim/genome.ts";
import type { SpeciationEvidence, TaxonomyEvent } from "../../sim/taxonomy.ts";
import { createDiscoveryJournal } from "../discovery/discoveryJournal.ts";
import { buildRunChronicle } from "./runChronicle.ts";

/**
 * The claims this module makes are causal, so the tests are mostly about when it must DECLINE to
 * claim — an attribution engine that credits the player for everything is worse than none, because
 * "did what I do matter" then always answers yes.
 */

function evidence(overrides: Partial<SpeciationEvidence> = {}): SpeciationEvidence {
  return {
    geneticSeparation: 0.4,
    minimumBarrierPassability: 0.02,
    spatialSeparation: 60,
    founderCount: 20,
    divergenceDominanceRatio: 0.8,
    dominantDivergentGene: "speed" as keyof Genome,
    ...overrides,
  };
}

function speciation(tick: number, mechanism: "allopatric" | "sympatric" | "founder", overrides: Partial<SpeciationEvidence> = {}): TaxonomyEvent {
  return {
    type: "speciation",
    event: {
      tick,
      speciesId: 1,
      parentId: 0,
      mechanism,
      dominantDivergentGene: "speed" as keyof Genome,
      founderCount: 20,
      evidence: evidence(overrides),
    },
  };
}

function extinction(tick: number): TaxonomyEvent {
  return { type: "extinction", event: { tick, speciesId: 2, lifespanTicks: 4000, peakMemberCount: 120 } };
}

function simWith(events: TaxonomyEvent[], log: Intervention[]): SimInstance {
  const sim = createSimState(1, DEFAULT_PARAMS);
  sim.state.observations.taxonomyEvents = events;
  sim.interventionLog.push(...log);
  return sim;
}

const barrierAt = (tick: number): Intervention => ({
  tick,
  tool: "barrierStamp",
  params: { x1: 0, y1: 0, x2: 10, y2: 10, width: 8, targetPassability: 0, formationTicks: 0 },
});

const meteorAt = (tick: number): Intervention => ({ tick, tool: "meteor", params: { x: 50, y: 50, radius: 20, craterRecoveryTicks: 0 } });

const treesAt = (tick: number): Intervention => ({ tick, tool: "plantTree", params: { x: 50, y: 50, radius: 20, count: 5 } });

function chronicle(events: TaxonomyEvent[], log: Intervention[] = []) {
  return buildRunChronicle(simWith(events, log), 3, createDiscoveryJournal());
}

/** The first speciation/extinction entry. The timeline interleaves the player's own actions with
 * outcomes and sorts by tick, so position alone no longer identifies the outcome under test. */
function firstOutcome(result: ReturnType<typeof chronicle>) {
  return result.entries.find((entry) => entry.kind !== "action")!;
}

describe("buildRunChronicle — attribution", () => {
  it("credits a barrier for the allopatric split that followed it", () => {
    const result = chronicle([speciation(5_000, "allopatric")], [barrierAt(1_000)]);
    const entry = firstOutcome(result);
    expect(entry.cause).toEqual({ tool: "barrierStamp", tick: 1_000 });
    expect(entry.evidence).toContain("barrier you drew");
    expect(entry.evidence).toContain("0.02"); // the measured passability that justifies the claim
  });

  it("does NOT credit the player for an allopatric split they built nothing for", () => {
    const result = chronicle([speciation(5_000, "allopatric")]);
    expect(firstOutcome(result).cause).toBeNull();
    expect(firstOutcome(result).evidence).toContain("Natural geography");
  });

  // The mechanism classification is the sim's own answer to "was this geographic". Claiming a
  // barrier caused a split the sim already determined was NOT geographic would be a flat lie, no
  // matter how well the timing lines up.
  it("never credits a barrier for a sympatric split, however well-timed", () => {
    const result = chronicle([speciation(5_000, "sympatric")], [barrierAt(4_900)]);
    expect(firstOutcome(result).cause).toBeNull();
    expect(firstOutcome(result).evidence).toContain("without any barrier");
  });

  it("never credits a barrier for a founder-effect split", () => {
    const result = chronicle([speciation(5_000, "founder")], [barrierAt(4_900)]);
    expect(firstOutcome(result).cause).toBeNull();
    expect(firstOutcome(result).evidence).toContain("Drift");
  });

  it("ignores actions taken after the outcome they would supposedly explain", () => {
    const result = chronicle([speciation(5_000, "allopatric")], [barrierAt(9_000)]);
    expect(firstOutcome(result).cause).toBeNull();
  });

  it("ignores an action too long ago to plausibly be the cause", () => {
    const result = chronicle([speciation(60_000, "allopatric")], [barrierAt(1_000)]);
    expect(firstOutcome(result).cause).toBeNull();
  });

  it("picks the most recent qualifying action when several could explain the same split", () => {
    const result = chronicle([speciation(20_000, "allopatric")], [barrierAt(1_000), barrierAt(15_000)]);
    expect(firstOutcome(result).cause).toEqual({ tool: "barrierStamp", tick: 15_000 });
  });

  it("credits a meteor for an extinction close behind it", () => {
    const result = chronicle([extinction(3_100)], [meteorAt(3_000)]);
    expect(firstOutcome(result).cause).toEqual({ tool: "meteor", tick: 3_000 });
    expect(firstOutcome(result).evidence).toContain("meteor you called down");
  });

  // An extinction long after a meteor is a different story that merely follows it.
  it("does not credit a meteor for an extinction far behind it", () => {
    const result = chronicle([extinction(9_000)], [meteorAt(3_000)]);
    expect(firstOutcome(result).cause).toBeNull();
    expect(firstOutcome(result).evidence).toContain("Not something you did");
  });

  it("does not treat a harmless action as a cause of extinction", () => {
    const result = chronicle([extinction(3_100)], [treesAt(3_000)]);
    expect(firstOutcome(result).cause).toBeNull();
  });

  it("is deterministic — the same run always produces the same history", () => {
    const events = [speciation(5_000, "allopatric"), extinction(6_000)];
    const log = [barrierAt(1_000), meteorAt(5_900)];
    expect(chronicle(events, log)).toEqual(chronicle(events, log));
  });
});

describe("buildRunChronicle — the player's own actions", () => {
  // Attribution to named outcomes is far too sparse on its own: a barrier only earns credit for a
  // split the sim independently classified allopatric, and most splits in ordinary play are not.
  // Without action entries a whole run can be correctly attributed to nobody, which reads as "you
  // are irrelevant" rather than as information.
  it("records every action as its own entry, always the player's", () => {
    const result = chronicle([], [barrierAt(1_000), meteorAt(2_000)]);
    const actions = result.entries.filter((entry) => entry.kind === "action");
    expect(actions).toHaveLength(2);
    expect(actions.every((entry) => entry.cause !== null)).toBe(true);
  });

  it("measures what followed an action, without claiming it caused it", () => {
    const sim = simWith([], [meteorAt(1_000)]);
    sim.state.observations.populationHistory = [
      { tick: 1_000, counts: { 0: 400 } },
      { tick: 2_500, counts: { 0: 200 } },
    ];
    const entry = buildRunChronicle(sim, 1, createDiscoveryJournal()).entries.find((e) => e.kind === "action")!;
    expect(entry.evidence).toContain("−50%");
    expect(entry.evidence).toContain("400");
    expect(entry.evidence).toContain("200");
    // A measurement of what followed, never an assertion of cause.
    expect(entry.evidence.toLowerCase()).not.toContain("caused");
  });

  it("says so plainly when nothing much followed", () => {
    const sim = simWith([], [barrierAt(1_000)]);
    sim.state.observations.populationHistory = [
      { tick: 1_000, counts: { 0: 300 } },
      { tick: 2_500, counts: { 0: 306 } },
    ];
    const entry = buildRunChronicle(sim, 1, createDiscoveryJournal()).entries.find((e) => e.kind === "action")!;
    expect(entry.evidence).toContain("roughly flat");
  });

  it("declines to measure an action the run hasn't yet moved past", () => {
    const sim = simWith([], [barrierAt(1_000)]);
    sim.state.observations.populationHistory = [{ tick: 1_000, counts: { 0: 300 } }];
    const entry = buildRunChronicle(sim, 1, createDiscoveryJournal()).entries.find((e) => e.kind === "action")!;
    expect(entry.evidence).toContain("Too early");
  });

  it("interleaves actions and outcomes into one timeline, oldest first", () => {
    const result = chronicle([speciation(5_000, "allopatric")], [barrierAt(1_000), meteorAt(9_000)]);
    expect(result.entries.map((entry) => entry.tick)).toEqual([1_000, 5_000, 9_000]);
  });
});

describe("buildRunChronicle — scorecard", () => {
  it("counts how many outcomes trace back to something the player did", () => {
    const result = chronicle(
      [speciation(5_000, "allopatric"), speciation(6_000, "sympatric"), extinction(7_000)],
      [barrierAt(1_000), meteorAt(6_900)],
    );
    // The allopatric split and the extinction are attributable; the sympatric split is not.
    expect(result.scorecard.attributedOutcomes).toBe(2);
    expect(result.scorecard.notableOutcomes).toBe(3);
  });

  // Actions are the player's by definition, so counting them would report a perfect attribution
  // rate however little influence the player actually had.
  it("excludes the player's own actions from the attribution rate", () => {
    const result = chronicle([speciation(5_000, "sympatric")], [barrierAt(1_000), meteorAt(2_000), treesAt(3_000)]);
    expect(result.scorecard.notableOutcomes).toBe(1);
    expect(result.scorecard.attributedOutcomes).toBe(0);
  });

  it("reports run totals from recorded state", () => {
    const result = chronicle([extinction(3_000), extinction(4_000)], [barrierAt(100), treesAt(200)]);
    expect(result.scorecard.erasCompleted).toBe(3);
    expect(result.scorecard.extinctions).toBe(2);
    expect(result.scorecard.terraformActions).toBe(2);
    expect(result.scorecard.currentPopulation).toBe(DEFAULT_PARAMS.foundingPopulationSize);
    expect(result.scorecard.livingSpecies).toBe(1);
  });

  it("reports peak population as the highest ever reached, not the current one", () => {
    const sim = simWith([], []);
    sim.state.observations.populationHistory = [
      { tick: 0, counts: { 0: 100 } },
      { tick: 100, counts: { 0: 400, 1: 120 } },
      { tick: 200, counts: { 0: 90 } },
    ];
    const result = buildRunChronicle(sim, 1, createDiscoveryJournal());
    expect(result.scorecard.peakPopulation).toBe(520);
  });
});
