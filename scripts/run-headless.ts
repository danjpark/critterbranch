import { GENE_KEYS, genomeCentroid } from "../src/sim/genome.ts";
import { createSimState, tick } from "../src/sim/sim.ts";
import { DEFAULT_PARAMS } from "../src/params.ts";

const seed = Number(process.argv[2] ?? 12345);
const totalTicks = Number(process.argv[3] ?? 10000);
const printEvery = 500;

const { state, rng } = createSimState(seed, DEFAULT_PARAMS);

console.log(`seed=${seed} ticks=${totalTicks}`);
console.log(`tick=0 pop=${state.evolution.creatures.length}`);

for (let t = 0; t < totalTicks; t++) {
  tick(state, rng, DEFAULT_PARAMS);

  if (state.evolution.tick % printEvery === 0) {
    const pop = state.evolution.creatures.length;
    if (pop === 0) {
      console.log(`tick=${state.evolution.tick} pop=0 -- population extinct`);
      break;
    }
    const means = genomeCentroid(state.evolution.creatures.map((c) => c.genome));
    const meanStr = GENE_KEYS.map((k) => `${k}=${means[k].toFixed(3)}`).join(" ");
    console.log(`tick=${state.evolution.tick} pop=${pop} ${meanStr}`);
  }
}
