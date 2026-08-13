/**
 * Regenerates the bundled example scenarios (public/scenarios/*.json) against whatever
 * DEFAULT_PARAMS/ENGINE_VERSION the current build has, and verifies each still demonstrates what
 * it's named for. These are RunConfig exports, not hand-authored data — a params-shape change
 * (like SPEC.md Addendum 6/7's food redesign) leaves the old files loadable (mergeRunParams falls
 * back to defaults for anything missing) but silently no longer demonstrating their own premise,
 * since they were tuned against a food/predation economy that no longer exists. Re-run this
 * whenever a change to core sim dynamics might have shifted speciation/extinction timing enough to
 * break these — the verification step below is what would have caught last time's silent failure.
 */
import { writeFileSync } from "node:fs";
import { createRunConfig } from "../src/sim/runConfig.ts";
import { runSimulationFromConfig, type SimState } from "../src/sim/sim.ts";
import { DEFAULT_PARAMS } from "../src/params.ts";

// seed=3, barrier at tick 2000: produces an allopatric split within 20,000 ticks under current
// params. Re-swept (was seed=8) after SPEC.md Addendum 12 (Milestone 6: aquaticAdaptation) shifted
// population dynamics enough to break the previous choice — swept seeds
// 1/2/3/4/5/6/7/8/9/10/11/12/20/30/40/42/50, seeds 3/6/30/40/42 all produced a confirmed allopatric
// split with a healthy surviving population; picked the first one found.
const barrierSplit = createRunConfig(3, DEFAULT_PARAMS, [
  { tick: 2000, tool: "barrierStamp", params: { x1: 100, y1: 0, x2: 100, y2: 200, width: 10, targetPassability: 0.02, formationTicks: 400 } },
]);

// seed=6, meteor at tick 7600, targeting (76, 92) — the minority sub-lineage's actual centroid at
// that tick (confirmed directly). Re-tuned after SPEC.md Addendum 12 (Milestone 6:
// aquaticAdaptation) shifted population dynamics enough to break the previous seed=10 choice —
// this seed's split happens to land on the amphibious axis specifically (dominantDivergentGene is
// aquaticAdaptation), same seed used by "golden scenario: extinction and radiation" in
// src/sim/goldenScenarios.test.ts. Demonstrates extinction of an already-established regional
// lineage; does NOT reliably demonstrate post-extinction radiation into a new lineage — a known,
// documented gap (see Addendum 9's "Implementation status").
const meteorRadiation = createRunConfig(6, DEFAULT_PARAMS, [
  { tick: 7600, tool: "meteor", params: { x: 76, y: 92, radius: 35, craterRecoveryTicks: 800 } },
]);

writeFileSync("public/scenarios/barrier-split.json", JSON.stringify(barrierSplit, null, 2) + "\n");
writeFileSync("public/scenarios/meteor-radiation.json", JSON.stringify(meteorRadiation, null, 2) + "\n");
console.log("Wrote public/scenarios/{barrier-split,meteor-radiation}.json\n");

function summarize(label: string, state: SimState, checks: Record<string, boolean>): void {
  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  const status = failed.length === 0 ? "OK" : `FAILED: ${failed.map(([name]) => name).join(", ")}`;
  console.log(`${label}: pop=${state.evolution.creatures.length} species=${state.observations.taxonomy.species.size} — ${status}`);
}

const barrierState = runSimulationFromConfig(barrierSplit, 20000);
const hasAllopatric = barrierState.observations.taxonomyEvents.some((e) => e.type === "speciation" && e.event.mechanism === "allopatric");
summarize("barrier-split (20k ticks)", barrierState, { "allopatric split occurred": hasAllopatric });

const meteorState = runSimulationFromConfig(meteorRadiation, 27000);
const extinctions = meteorState.observations.taxonomyEvents.filter((e) => e.type === "extinction");
// Post-extinction radiation is NOT checked here — a known, documented gap (see the comment above
// and SPEC.md Addendum 9). This scenario demonstrates extinction of a regional lineage only.
summarize("meteor-radiation (27k ticks)", meteorState, { "extinction occurred": extinctions.length > 0 });
