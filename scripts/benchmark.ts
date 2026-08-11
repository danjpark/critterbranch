/**
 * Performance benchmark harness — separate from correctness tests (vitest), run on demand via
 * `npm run benchmark`. Deterministic: every run uses a fixed seed, so numbers are comparable
 * across runs and machines aren't fighting simulation randomness on top of hardware variance.
 *
 * Measures the two things SPEC.md's Performance section actually cares about (ticks/sec at
 * realistic population sizes) plus the two subsystems most likely to become a bottleneck as
 * population grows: the periodic taxonomy pass (near-linear per species, but runs over the whole
 * population) and the competition-heatmap consumption-decay pass (the exact subsystem that
 * already caused one real slowdown this project hit — see git history around "batch the decay").
 */
import { createSimState, tick } from "../src/sim/sim.ts";
import { decayConsumption } from "../src/sim/consumption.ts";
import { updateTaxonomy } from "../src/sim/taxonomy.ts";
import { DEFAULT_PARAMS, type Params } from "../src/params.ts";

const SEED = 12345;

function benchmarkTicksPerSecond(foundingPopulationSize: number, ticks: number): { ticksPerSecond: number; finalPopulation: number } {
  const params: Params = { ...DEFAULT_PARAMS, foundingPopulationSize };
  const { state, rng } = createSimState(SEED, params);

  const start = performance.now();
  for (let i = 0; i < ticks; i++) tick(state, rng, params);
  const elapsedMs = performance.now() - start;

  return { ticksPerSecond: (ticks / elapsedMs) * 1000, finalPopulation: state.evolution.creatures.length };
}

/** Warms up to a population roughly the target size, then times isolated calls to one subsystem
 * in place — separate from ticksPerSecond above, which measures the whole tick() pipeline. */
function benchmarkSubsystem(foundingPopulationSize: number, warmupTicks: number, trials: number, run: (state: ReturnType<typeof createSimState>["state"], params: Params) => void): number {
  const params: Params = { ...DEFAULT_PARAMS, foundingPopulationSize };
  const { state, rng } = createSimState(SEED, params);
  for (let i = 0; i < warmupTicks; i++) tick(state, rng, params);

  const start = performance.now();
  for (let i = 0; i < trials; i++) run(state, params);
  return (performance.now() - start) / trials;
}

const POPULATION_SIZES = [100, 500, 1000, 5000];
const TICKS_PER_RUN = 500;

console.log(`Critterbranch benchmark — seed=${SEED}, ${TICKS_PER_RUN} ticks per population size\n`);

console.log("ticks/sec (full tick() pipeline):");
for (const size of POPULATION_SIZES) {
  const { ticksPerSecond, finalPopulation } = benchmarkTicksPerSecond(size, TICKS_PER_RUN);
  console.log(`  founding=${String(size).padStart(5)}  ticks/sec=${ticksPerSecond.toFixed(0).padStart(6)}  final population=${finalPopulation}`);
}

console.log("\ntaxonomy pass (updateTaxonomy), ms/call after 300-tick warmup:");
for (const size of POPULATION_SIZES) {
  const ms = benchmarkSubsystem(size, 300, 20, (state, params) =>
    updateTaxonomy(state.observations.taxonomy, state.evolution.creatures, state.evolution.terrain, params, state.evolution.tick),
  );
  console.log(`  founding=${String(size).padStart(5)}  ${ms.toFixed(3)} ms/call`);
}

console.log("\nconsumption decay (decayConsumption), ms/call after 300-tick warmup:");
for (const size of POPULATION_SIZES) {
  const ms = benchmarkSubsystem(size, 300, 50, (state, params) => decayConsumption(state.observations.consumptionGrid, params.consumptionRetentionPerTick));
  console.log(`  founding=${String(size).padStart(5)}  ${ms.toFixed(3)} ms/call`);
}

if (typeof process !== "undefined" && typeof process.memoryUsage === "function") {
  const longRunTicks = 20_000;
  const { state, rng } = createSimState(SEED, { ...DEFAULT_PARAMS, foundingPopulationSize: 1000 });
  for (let i = 0; i < longRunTicks; i++) tick(state, rng, DEFAULT_PARAMS);
  const heapMb = process.memoryUsage().heapUsed / (1024 * 1024);
  console.log(`\nmemory after ${longRunTicks} ticks (founding=1000, approximate — GC timing affects this): ${heapMb.toFixed(1)} MB heap used`);
}
