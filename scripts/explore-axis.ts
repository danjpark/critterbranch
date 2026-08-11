import { isBimodal } from "../src/sim/bimodality.ts";
import { GENE_KEYS } from "../src/sim/genome.ts";
import { createSimState, tick } from "../src/sim/sim.ts";
import { DEFAULT_PARAMS, type Params } from "../src/params.ts";

const axis = process.argv[2] ?? "diet";
const seed = Number(process.argv[3] ?? 1);
const ticks = Number(process.argv[4] ?? 10000);

const NEUTRAL = { specializationExponent: 0, patchBimodality: 0, regrowthCycleAmplitude: 0 };

const overridesByAxis: Record<string, Partial<Params>> = {
  neutral: { ...NEUTRAL },
  diet: { ...NEUTRAL, specializationExponent: 3 },
  foraging: { ...NEUTRAL, patchBimodality: 1.0 },
  lifehistory: { ...NEUTRAL, regrowthCycleAmplitude: 1.0, regrowthCyclePeriod: 3000 },
  "lifehistory-mild": { ...NEUTRAL, regrowthCycleAmplitude: 0.6, regrowthCyclePeriod: 3000 },
  "lifehistory-slow": { ...NEUTRAL, regrowthCycleAmplitude: 0.6, regrowthCyclePeriod: 6000 },
  "foraging-no-nursing": { ...NEUTRAL, patchBimodality: 1.0, nursingRatePerTick: 0 },
};

const params = { ...DEFAULT_PARAMS, ...overridesByAxis[axis] };
const { state, rng } = createSimState(seed, params);

console.log(`axis=${axis} seed=${seed} ticks=${ticks}`);
console.log(`params: specializationExponent=${params.specializationExponent} patchBimodality=${params.patchBimodality} regrowthCycleAmplitude=${params.regrowthCycleAmplitude}`);

for (let t = 0; t < ticks; t++) {
  tick(state, rng, params);
  if (state.tick % 1000 === 0) {
    if (state.creatures.length === 0) {
      console.log(`tick=${state.tick} EXTINCT`);
      break;
    }
    const bimodalGenes = GENE_KEYS.filter((key) => isBimodal(state.creatures.map((c) => c.genome[key])));
    console.log(`tick=${state.tick} pop=${state.creatures.length} bimodal=[${bimodalGenes.join(",")}] species=${state.taxonomy.species.size} events=${state.taxonomyEvents.length}`);
  }
}
