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

// seed=42, barrier at tick 2000: produces an allopatric split by tick ~10,000 under current
// tree/predation params — doesn't depend on pre-existing speciation, the barrier itself drives
// the divergence, so this one wasn't seed-sensitive the way meteor-radiation turned out to be.
const barrierSplit = createRunConfig(42, DEFAULT_PARAMS, [
  { tick: 2000, tool: "barrierStamp", params: { x1: 100, y1: 0, x2: 100, y2: 200, width: 10, targetPassability: 0.02, formationTicks: 400 } },
]);

// seed=1, meteor at tick 7000: seed=42 (the original choice) never speciates into regional
// lineages at all under the tree-food geometry (confirmed directly — still one species at tick
// 12,000) — a meteor needs a REGIONAL lineage to wipe out for "extinction" to mean anything. Seed
// 1 reliably speciates by ~tick 6,000; tick 7,000 gives that split time to establish first. Same
// seed/tick "golden scenario: extinction and radiation" (src/sim/goldenScenarios.test.ts) uses.
const meteorRadiation = createRunConfig(1, DEFAULT_PARAMS, [
  { tick: 7000, tool: "meteor", params: { x: 100, y: 100, radius: 60, craterRecoveryTicks: 800 } },
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
const lastExtinctionTick = extinctions.length > 0 ? Math.max(...extinctions.map((e) => e.event.tick)) : -1;
const hasRadiation = meteorState.observations.taxonomyEvents.some((e) => e.type === "speciation" && e.event.tick > lastExtinctionTick);
summarize("meteor-radiation (27k ticks)", meteorState, {
  "extinction occurred": extinctions.length > 0,
  "post-extinction radiation occurred": hasRadiation,
});
