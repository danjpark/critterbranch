import { isBimodal } from "../src/sim/bimodality.ts";
import { GENE_KEYS } from "../src/sim/genome.ts";
import { createSimState, tick } from "../src/sim/sim.ts";
import { DEFAULT_PARAMS, type Params } from "../src/params.ts";

const axis = process.argv[2] ?? "neutral";
const seed = Number(process.argv[3] ?? 1);
const ticks = Number(process.argv[4] ?? 10000);

// "diet" axis lived here until SPEC.md Addendum 6 removed the old R/B diet trade-off entirely
// (single-food-type fruit trees). Addendum 7 reinstated a diet axis around carnivory (fruit vs.
// meat via predation) — "predation" below is that axis's isolation entry. It's a genuinely
// different mechanism than the old passive R/B food-source choice (active combat, not just
// foraging preference), so it isn't simply the old "diet" entry renamed.
const NEUTRAL = { patchBimodality: 0, regrowthCycleAmplitude: 0 };

const overridesByAxis: Record<string, Partial<Params>> = {
  neutral: { ...NEUTRAL },
  foraging: { ...NEUTRAL, patchBimodality: 1.0 },
  lifehistory: { ...NEUTRAL, regrowthCycleAmplitude: 1.0, regrowthCyclePeriod: 3000 },
  "lifehistory-mild": { ...NEUTRAL, regrowthCycleAmplitude: 0.6, regrowthCyclePeriod: 3000 },
  "lifehistory-slow": { ...NEUTRAL, regrowthCycleAmplitude: 0.6, regrowthCyclePeriod: 6000 },
  "foraging-no-nursing": { ...NEUTRAL, patchBimodality: 1.0, nursingRatePerTick: 0 },
  predation: { ...NEUTRAL, specializationExponent: 3 },
};

const params = { ...DEFAULT_PARAMS, ...overridesByAxis[axis] };
const { state, rng } = createSimState(seed, params);

console.log(`axis=${axis} seed=${seed} ticks=${ticks}`);
console.log(
  `params: patchBimodality=${params.patchBimodality} regrowthCycleAmplitude=${params.regrowthCycleAmplitude} specializationExponent=${params.specializationExponent}`,
);

for (let t = 0; t < ticks; t++) {
  tick(state, rng, params);
  if (state.evolution.tick % 1000 === 0) {
    if (state.evolution.creatures.length === 0) {
      console.log(`tick=${state.evolution.tick} EXTINCT`);
      break;
    }
    const bimodalGenes = GENE_KEYS.filter((key) => isBimodal(state.evolution.creatures.map((c) => c.genome[key])));
    console.log(`tick=${state.evolution.tick} pop=${state.evolution.creatures.length} bimodal=[${bimodalGenes.join(",")}] species=${state.observations.taxonomy.species.size} events=${state.observations.taxonomyEvents.length}`);
  }
}
