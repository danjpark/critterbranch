import type { Intervention } from "../../sim/intervention.ts";
import type { SimInstance } from "../../sim/sim.ts";
import type { SpeciationEvent, ExtinctionEvent } from "../../sim/taxonomy.ts";
import type { DiscoveryJournal } from "../discovery/discoveryJournal.ts";

/**
 * The run's history, and — the point of the whole module — WHICH OF IT YOU CAUSED.
 *
 * SPEC.md Addendum 30. Dan put the game down because "I couldn't tell if I was doing well". The
 * era summary already reported what happened (population moved, a species split, a trait shifted)
 * but never whether the player was involved, so every era read as weather: something occurred, you
 * weren't clearly implicated, and there was no reason to think the next one depended on you.
 *
 * Everything here is a deterministic join over data the sim ALREADY records — `interventionLog`
 * (every action with the exact tick it happened) against `taxonomyEvents` (every speciation and
 * extinction, each carrying the mechanism it was classified as and the measurements behind that
 * classification). No new simulation state, no sampling, and emphatically no language model: the
 * causal claims are fixed rules over recorded evidence, so the same run always produces the same
 * history and every claim can be checked against the numbers that produced it.
 *
 * The honest half matters as much as the attributed half. An outcome with no plausible cause is
 * reported as having happened on its own, rather than being silently omitted or vaguely credited —
 * "this split happened without you" is exactly as informative as "your barrier did this" when the
 * question is whether your terraforming is doing anything.
 */

/** Tools that can plausibly create a geographic barrier between populations. Sea level counts: it
 * floods low ground everywhere, which is how a land bridge becomes a strait. */
const BARRIER_TOOLS: ReadonlySet<Intervention["tool"]> = new Set(["barrierStamp", "raiseCliff", "raiseTerrain", "raiseSeaLevel", "lowerCliff", "lowerTerrain"]);

/** Tools that kill outright or strip a region's food. */
const CATASTROPHE_TOOLS: ReadonlySet<Intervention["tool"]> = new Set(["meteor", "drought", "raiseSeaLevel"]);

/**
 * How long after an action an outcome can still be attributed to it.
 *
 * Generous for speciation, tight for extinction, because the two have genuinely different lags. A
 * barrier separates populations immediately but they need thousands of ticks to drift far enough
 * apart to be detected as separate species — and detection itself lags, since taxonomy requires
 * `speciationConfirmationPasses` consecutive confirmations. A meteor, by contrast, kills the moment
 * it lands, so an extinction recorded long afterward is a different story that happens to follow it.
 */
const SPECIATION_ATTRIBUTION_WINDOW_TICKS = 25_000;
const EXTINCTION_ATTRIBUTION_WINDOW_TICKS = 600;

/**
 * How long after an action its effect on population is measured.
 *
 * Actions get their own entries, with a MEASURED consequence, because attribution to named
 * outcomes alone is far too sparse to answer "did that work". A barrier only earns credit for a
 * split the sim independently classified as allopatric, and in ordinary play most splits are
 * sympatric or drift — so a run could contain a dozen events, all correctly unattributed, and tell
 * the player nothing except that they seem to be irrelevant. Measuring what actually followed each
 * action always says something, and says it from recorded numbers.
 *
 * Deliberately reported as "what happened after", never "what this caused": the population would
 * have moved anyway, and the honest claim is the correlation, not a causal one.
 */
const ACTION_EFFECT_WINDOW_TICKS = 1_500;

/** Below this, population movement is ordinary drift rather than a response worth reporting. */
const NOTABLE_POPULATION_SHIFT = 0.08;

export type ChronicleOutcomeKind = "speciation" | "extinction" | "action";

export interface ChronicleCause {
  tool: Intervention["tool"];
  tick: number;
}

export interface ChronicleEntry {
  kind: ChronicleOutcomeKind;
  tick: number;
  /** The species involved, for outcome entries. -1 for an action, which concerns the whole world. */
  speciesId: number;
  /** The action this is attributed to, or null when nothing you did plausibly explains it. */
  cause: ChronicleCause | null;
  /** Plain statement of what happened, built from recorded fields only. */
  summary: string;
  /** The measurement that justifies (or declines) the causal claim — never an assertion on its
   * own. Same principle sim/taxonomy.ts's SpeciationEvidence established: keep the evidence next to
   * the interpretation so "why does it say that" always has an answer beyond "the code decided". */
  evidence: string;
}

export interface RunScorecard {
  erasCompleted: number;
  ticksElapsed: number;
  currentPopulation: number;
  peakPopulation: number;
  livingSpecies: number;
  speciesEverCreated: number;
  extinctions: number;
  discoveries: number;
  terraformActions: number;
  /** Speciations and extinctions recorded this run — the denominator for attribution. */
  notableOutcomes: number;
  /** How many of those trace back to something the player did. The headline "did I matter" number. */
  attributedOutcomes: number;
}

export interface RunChronicle {
  entries: ChronicleEntry[];
  scorecard: RunScorecard;
}

/** Most recent qualifying action at or before `tick`, within `window`. Most recent rather than
 * first: if you raised three barriers, the one immediately before a split is the better explanation
 * than one from twenty eras ago. */
function mostRecentCause(
  log: readonly Intervention[],
  tick: number,
  window: number,
  tools: ReadonlySet<Intervention["tool"]>,
): ChronicleCause | null {
  let best: ChronicleCause | null = null;
  for (const intervention of log) {
    if (intervention.tick > tick) break; // log is applied in tick order
    if (tick - intervention.tick > window) continue;
    if (!tools.has(intervention.tool)) continue;
    best = { tool: intervention.tool, tick: intervention.tick };
  }
  return best;
}

const TOOL_PHRASES: Record<Intervention["tool"], string> = {
  raiseTerrain: "the ground you raised",
  lowerTerrain: "the hollow you pressed in",
  raiseCliff: "the cliff you raised",
  lowerCliff: "the chasm you carved",
  barrierStamp: "the barrier you drew",
  plantTree: "the trees you planted",
  drought: "the drought you caused",
  bloom: "the bloom you caused",
  meteor: "the meteor you called down",
  seedFounders: "the founders you seeded",
  raiseSeaLevel: "the sea level you raised",
  lowerSeaLevel: "the sea level you lowered",
};

/** What the player did, in the past tense — the headline of an action entry. Separate from
 * TOOL_PHRASES, which reads mid-sentence ("caused by the barrier you drew at tick N"). */
const ACTION_LABELS: Record<Intervention["tool"], string> = {
  raiseTerrain: "You raised the ground.",
  lowerTerrain: "You lowered the ground.",
  raiseCliff: "You raised a cliff.",
  lowerCliff: "You carved a chasm.",
  barrierStamp: "You drew a barrier.",
  plantTree: "You planted trees.",
  drought: "You caused a drought.",
  bloom: "You caused a bloom.",
  meteor: "You called down a meteor.",
  seedFounders: "You seeded new founders.",
  raiseSeaLevel: "You raised the sea level.",
  lowerSeaLevel: "You lowered the sea level.",
};

function describeSpeciation(event: SpeciationEvent, cause: ChronicleCause | null): { summary: string; evidence: string } {
  const summary = `Species ${event.speciesId} split away from species ${event.parentId}, diverging most on ${event.dominantDivergentGene}.`;
  const passability = event.evidence.minimumBarrierPassability;

  // Only an allopatric split is claimed for the player, and only when they actually built something
  // beforehand. The sim has already measured that a low-passability region separated the two
  // groups; the open question is whether the player made that region, and a barrier-capable action
  // before it is what answers that. Sympatric and founder-effect splits are NEVER attributed —
  // they are by definition not caused by geography.
  if (event.mechanism === "allopatric" && cause) {
    return {
      summary,
      evidence: `Caused by ${TOOL_PHRASES[cause.tool]} at tick ${cause.tick.toLocaleString()} — the ground between the two groups fell to ${passability.toFixed(2)} passability, low enough to stop them mixing.`,
    };
  }
  if (event.mechanism === "allopatric") {
    return { summary, evidence: `Natural geography did this — terrain at ${passability.toFixed(2)} passability separated them, and you hadn't reshaped that ground.` };
  }
  if (event.mechanism === "sympatric") {
    return { summary, evidence: "Happened without any barrier — the two groups lived in the same space and specialised apart anyway." };
  }
  return { summary, evidence: `Drift, not pressure — only ${event.founderCount} founders, with divergence spread across several genes rather than one.` };
}

/**
 * How far a history sample may sit from the tick being asked about and still count as measuring it.
 * Deliberately much tighter than the effect window: if the nearest sample to "1,500 ticks after the
 * action" is actually the one AT the action — because the run hasn't got that far yet, or history
 * was compacted away — then reusing it would compare a value against itself and report "no change"
 * for something simply not measured yet.
 */
const SAMPLE_MATCH_TOLERANCE_TICKS = 400;

/** Total population at the sample nearest `tick`, or null when no sample is close enough to count. */
function populationNear(history: readonly { tick: number; counts: Record<number, number> }[], tick: number): number | null {
  let best: { tick: number; counts: Record<number, number> } | null = null;
  for (const sample of history) {
    if (best === null || Math.abs(sample.tick - tick) < Math.abs(best.tick - tick)) best = sample;
  }
  if (!best || Math.abs(best.tick - tick) > SAMPLE_MATCH_TOLERANCE_TICKS) return null;
  let total = 0;
  for (const count of Object.values(best.counts)) total += count;
  return total;
}

/**
 * What followed one of the player's actions, measured. Phrased as a sequence rather than a
 * consequence — "population fell 18% over the next 1,500 ticks" is a fact; "your drought cut the
 * population by 18%" is a claim this module has no way to substantiate, since the population was
 * moving on its own the whole time.
 */
function describeAction(intervention: Intervention, history: readonly { tick: number; counts: Record<number, number> }[]): { summary: string; evidence: string } {
  const summary = ACTION_LABELS[intervention.tool];
  const before = populationNear(history, intervention.tick);
  const after = populationNear(history, intervention.tick + ACTION_EFFECT_WINDOW_TICKS);

  if (before === null || after === null || before === 0) {
    return { summary, evidence: "Too early to say what followed — the run hasn't gone far enough past it yet." };
  }
  const change = (after - before) / before;
  const window = ACTION_EFFECT_WINDOW_TICKS.toLocaleString();
  if (Math.abs(change) < NOTABLE_POPULATION_SHIFT) {
    return { summary, evidence: `Next ${window} ticks: population ${before.toLocaleString()} → ${after.toLocaleString()}, roughly flat.` };
  }
  // Deliberately a reading, not a verdict: "population went from A to B" rather than "your drought
  // cut the population". A young population climbs steeply on its own, so an early action would
  // otherwise appear to take credit for growth that was always going to happen.
  const sign = change > 0 ? "+" : "−";
  return {
    summary,
    evidence: `Next ${window} ticks: population ${before.toLocaleString()} → ${after.toLocaleString()} (${sign}${Math.abs(Math.round(change * 100))}%).`,
  };
}

function describeExtinction(event: ExtinctionEvent, cause: ChronicleCause | null): { summary: string; evidence: string } {
  const summary = `Species ${event.speciesId} died out after ${event.lifespanTicks.toLocaleString()} ticks, having peaked at ${event.peakMemberCount.toLocaleString()}.`;
  if (cause) {
    return {
      summary,
      evidence: `Caused by ${TOOL_PHRASES[cause.tool]} at tick ${cause.tick.toLocaleString()}, ${(event.tick - cause.tick).toLocaleString()} ticks earlier.`,
    };
  }
  return { summary, evidence: "Not something you did — it lost ground to competition, predation, or a food supply that ran out." };
}

/**
 * Builds the whole run's history. Pure and read-only: computed on demand from current state the
 * same way game/observability's SpeciesProfile is, so nothing here can feed back into the
 * simulation.
 */
export function buildRunChronicle(sim: SimInstance, era: number, journal: DiscoveryJournal): RunChronicle {
  const { evolution, observations } = sim.state;
  const log = sim.interventionLog;

  const entries: ChronicleEntry[] = [];
  for (const taxonomyEvent of observations.taxonomyEvents) {
    if (taxonomyEvent.type === "speciation") {
      const event = taxonomyEvent.event;
      // A cause is only looked for when the mechanism admits one — asking "what did the player do"
      // about a sympatric split would invite a false answer.
      const cause = event.mechanism === "allopatric" ? mostRecentCause(log, event.tick, SPECIATION_ATTRIBUTION_WINDOW_TICKS, BARRIER_TOOLS) : null;
      const { summary, evidence } = describeSpeciation(event, cause);
      entries.push({ kind: "speciation", tick: event.tick, speciesId: event.speciesId, cause, summary, evidence });
    } else {
      const event = taxonomyEvent.event;
      const cause = mostRecentCause(log, event.tick, EXTINCTION_ATTRIBUTION_WINDOW_TICKS, CATASTROPHE_TOOLS);
      const { summary, evidence } = describeExtinction(event, cause);
      entries.push({ kind: "extinction", tick: event.tick, speciesId: event.speciesId, cause, summary, evidence });
    }
  }

  // The player's own actions, each with what followed it. These are always "yours" by definition —
  // they're the things you did — so the history reads as your run rather than a list of weather.
  for (const intervention of log) {
    const { summary, evidence } = describeAction(intervention, observations.populationHistory);
    entries.push({
      kind: "action",
      tick: intervention.tick,
      speciesId: -1,
      cause: { tool: intervention.tool, tick: intervention.tick },
      summary,
      evidence,
    });
  }

  // One timeline, oldest first — the run as it actually unfolded, actions and outcomes interleaved,
  // which is what makes a barrier sitting just before a split legible as a story rather than two
  // unrelated lists.
  entries.sort((a, b) => a.tick - b.tick || a.kind.localeCompare(b.kind));

  let peakPopulation = evolution.creatures.length;
  for (const sample of observations.populationHistory) {
    let total = 0;
    for (const count of Object.values(sample.counts)) total += count;
    if (total > peakPopulation) peakPopulation = total;
  }

  let livingSpecies = 0;
  for (const species of observations.taxonomy.species.values()) {
    if (species.extinctTick === null) livingSpecies++;
  }

  return {
    entries,
    scorecard: {
      erasCompleted: era,
      ticksElapsed: evolution.tick,
      currentPopulation: evolution.creatures.length,
      peakPopulation,
      livingSpecies,
      // nextSpeciesId counts every species ever minted, including the founding one.
      speciesEverCreated: observations.taxonomy.nextSpeciesId,
      extinctions: entries.filter((entry) => entry.kind === "extinction").length,
      discoveries: journal.matches.size,
      terraformActions: log.length,
      // OUTCOMES only. An action entry always carries a cause (it IS the cause), so counting every
      // entry with one would report a perfect attribution rate no matter what the world did.
      notableOutcomes: entries.filter((entry) => entry.kind !== "action").length,
      attributedOutcomes: entries.filter((entry) => entry.kind !== "action" && entry.cause !== null).length,
    },
  };
}
