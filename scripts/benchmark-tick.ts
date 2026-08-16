/**
 * Per-tick breakdown of the simulation, headless. scripts/benchmark.ts reports the tick pipeline's
 * total throughput; this attributes that total to the individual phases inside it, so an
 * optimisation targets whatever is actually expensive rather than whatever looks expensive.
 *
 * Measured against a steady-state world (3,000 ticks of warmup) — a fresh founding population
 * crashes hard before recovering, so a short warmup profiles a near-empty world.
 */
import { DEFAULT_PARAMS } from "../src/params.ts";
import { createSimState, tick } from "../src/sim/sim.ts";
import { buildCreatureIndex } from "../src/sim/predation.ts";
import { applyNursing } from "../src/sim/nursing.ts";
import { updateGeneFlow } from "../src/sim/geneFlow.ts";
import { stepTrees } from "../src/sim/trees.ts";
import { updateTaxonomy } from "../src/sim/taxonomy.ts";
import { stepCreature } from "../src/sim/creature.ts";
import { RNG } from "../src/sim/rng.ts";

const ITERATIONS = 200;

function ms(label: string, iterations: number, run: () => void): number {
  run();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) run();
  const per = (performance.now() - start) / iterations;
  console.log(`  ${label.padEnd(44)} ${per.toFixed(4)} ms/tick`);
  return per;
}

function main(): void {
  for (const founding of [100, 500]) {
    const params = { ...DEFAULT_PARAMS, foundingPopulationSize: founding };
    const sim = createSimState(1, params);
    for (let i = 0; i < 3000; i++) tick(sim.state, sim.rng, params);

    const evo = sim.state.evolution;
    const obs = sim.state.observations;
    console.log(`\nfounding=${founding} — population ${evo.creatures.length}, trees ${evo.trees.trees.length}`);

    const whole = ms("WHOLE tick()", ITERATIONS, () => tick(sim.state, sim.rng, params));

    // Individual phases, run against the same live state. These don't sum exactly to the whole
    // (the per-creature loop does several of them together, and state drifts as it runs) but they
    // show relative weight, which is what an optimisation decision needs.
    const rng = new RNG(1);
    ms("  buildCreatureIndex (alloc Map+arrays)", ITERATIONS, () => {
      buildCreatureIndex(evo.creatures, evo.world, params);
    });
    ms("  applyNursing", ITERATIONS, () => {
      applyNursing(evo.creatures, evo.tick, params);
    });
    ms("  updateGeneFlow", ITERATIONS, () => {
      updateGeneFlow(obs.geneFlow, evo.creatures, params, evo.tick);
    });
    ms("  stepTrees", ITERATIONS, () => {
      stepTrees(evo.trees, evo.world, evo.terrain, rng, params, evo.tick);
    });
    ms("  updateTaxonomy (every 100th tick only)", 20, () => {
      updateTaxonomy(obs.taxonomy, evo.creatures, evo.terrain, params, evo.tick);
    });

    // The per-creature sense/steer/move/eat loop — expected to dominate, since senseFoodOrPrey
    // scans a radius window of cells for every creature every tick.
    const index = buildCreatureIndex(evo.creatures, evo.world, params);
    ms("  stepCreature x population (sense/move/eat)", ITERATIONS, () => {
      for (const c of evo.creatures) {
        stepCreature(c, evo.world, evo.terrain, evo.trees, index, rng, params, evo.tick, obs.consumptionGrid, obs.speciesBehavior);
      }
    });

    console.log(`  -> whole tick was ${whole.toFixed(4)} ms; taxonomy runs 1 tick in ${params.taxonomyIntervalTicks}`);
  }
}

main();
