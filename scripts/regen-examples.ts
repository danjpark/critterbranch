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

// seed=12, barrier at tick 2000: produces an allopatric split within 20,000 ticks under current
// params. Re-swept (was seed=42) after SPEC.md Addendum 9's terrain generation change (signed
// hills consume an extra RNG draw per hill, reshuffling downstream dynamics) broke the previous
// choice — turns out this scenario IS seed-sensitive after all now, unlike before: swept seeds
// 1/6/9/12/20/30/40/42/50, only seed 12 produced a confirmed allopatric split in that window.
const barrierSplit = createRunConfig(12, DEFAULT_PARAMS, [
  { tick: 2000, tool: "barrierStamp", params: { x1: 100, y1: 0, x2: 100, y2: 200, width: 10, targetPassability: 0.02, formationTicks: 400 } },
]);

// seed=6, meteor at tick 7000, targeting (114, 60) — the minority sub-lineage's actual centroid at
// that tick (confirmed directly). Re-tuned after SPEC.md Addendum 9's terrain generation change
// (signed hills consume an extra RNG draw per hill, reshuffling downstream speciation timing) broke
// the previous seed=1 choice — it no longer speciates at all under the new terrain within any
// reasonable window. Demonstrates extinction of an already-established regional lineage; does NOT
// reliably demonstrate post-extinction radiation into a new lineage — a known, documented gap (see
// Addendum 9's "Implementation status"), same reason "golden scenario: extinction and radiation" in
// src/sim/goldenScenarios.test.ts only asserts the extinction half.
const meteorRadiation = createRunConfig(6, DEFAULT_PARAMS, [
  { tick: 7000, tool: "meteor", params: { x: 114, y: 60, radius: 35, craterRecoveryTicks: 800 } },
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
