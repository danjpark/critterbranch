import { isBimodal } from "../src/sim/bimodality.ts";
import { GENE_KEYS } from "../src/sim/genome.ts";
import { createSimState, tick } from "../src/sim/sim.ts";
import { DEFAULT_PARAMS, type Params } from "../src/params.ts";

// "diet" axis lived here until SPEC.md Addendum 6 removed the old R/B diet trade-off entirely
// (single-food-type fruit trees). Addendum 7 reinstated a diet axis around carnivory (fruit vs.
// meat via predation) — "predation" below is that axis's isolation entry. It's a genuinely
// different mechanism than the old passive R/B food-source choice (active combat, not just
// foraging preference), so it isn't simply the old "diet" entry renamed.
//
// Keep this baseline synchronized with axisIsolation.test.ts and goldenScenarios.test.ts. Each
// newer shipped mechanism is a real selective pressure, so leaving even one active makes an
// "isolated" run misleading: nursing adds life-history noise, natural water creates geography,
// aquaticAdaptation adds a land/water trade-off, and carnivory enables predation.
const NEUTRAL: Partial<Params> = {
  patchBimodality: 0,
  regrowthCycleAmplitude: 0,
  nursingRatePerTick: 0,
  waterPassabilitySteepness: 0,
  aquaticLandPassabilitySteepness: DEFAULT_PARAMS.passabilitySteepness,
  aquaticWaterPassabilitySteepness: 0,
  carnivoryHuntingThreshold: 1.01,
};

const overridesByAxis = {
  neutral: { ...NEUTRAL },
  foraging: { ...NEUTRAL, patchBimodality: 1.0 },
  lifehistory: { ...NEUTRAL, regrowthCycleAmplitude: 1.0, regrowthCyclePeriod: 3000 },
  "lifehistory-mild": { ...NEUTRAL, regrowthCycleAmplitude: 0.6, regrowthCyclePeriod: 3000 },
  "lifehistory-slow": { ...NEUTRAL, regrowthCycleAmplitude: 0.6, regrowthCyclePeriod: 6000 },
  "foraging-no-nursing": { ...NEUTRAL, patchBimodality: 1.0, nursingRatePerTick: 0 },
  predation: {
    ...NEUTRAL,
    specializationExponent: 3,
    carnivoryHuntingThreshold: DEFAULT_PARAMS.carnivoryHuntingThreshold,
  },
  geography: {
    ...NEUTRAL,
    waterPassabilitySteepness: DEFAULT_PARAMS.waterPassabilitySteepness,
    // Match both endpoints so aquaticAdaptation cannot change movement in a geography-only run.
    aquaticLandPassabilitySteepness: DEFAULT_PARAMS.passabilitySteepness,
    aquaticWaterPassabilitySteepness: DEFAULT_PARAMS.waterPassabilitySteepness,
  },
  aquatic: {
    ...NEUTRAL,
    waterPassabilitySteepness: DEFAULT_PARAMS.waterPassabilitySteepness,
    aquaticLandPassabilitySteepness: DEFAULT_PARAMS.aquaticLandPassabilitySteepness,
    aquaticWaterPassabilitySteepness: DEFAULT_PARAMS.aquaticWaterPassabilitySteepness,
  },
} satisfies Record<string, Partial<Params>>;

type Axis = keyof typeof overridesByAxis;
const axisNames = Object.keys(overridesByAxis) as Axis[];

function usage(): string {
  return [
    "Usage: tsx scripts/explore-axis.ts [axis] [seed] [ticks]",
    `Axes: ${axisNames.join(", ")}`,
    "Defaults: axis=neutral seed=1 ticks=10000",
    "Example: tsx scripts/explore-axis.ts aquatic 6 12000",
  ].join("\n");
}

function parseInteger(value: string, label: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}; received ${JSON.stringify(value)}`);
  }
  return parsed;
}

const [axisArg = "neutral", seedArg = "1", ticksArg = "10000"] = process.argv.slice(2);
if (axisArg === "--help" || axisArg === "-h") {
  console.log(usage());
  process.exit(0);
}
if (!Object.hasOwn(overridesByAxis, axisArg)) {
  console.error(`Unknown axis ${JSON.stringify(axisArg)}.\n${usage()}`);
  process.exit(1);
}

const axis = axisArg as Axis;
let seed: number;
let ticks: number;
try {
  seed = parseInteger(seedArg, "seed", 0);
  ticks = parseInteger(ticksArg, "ticks", 1);
} catch (error) {
  console.error(`${error instanceof Error ? error.message : String(error)}\n${usage()}`);
  process.exit(1);
}

const params = { ...DEFAULT_PARAMS, ...overridesByAxis[axis] };
const { state, rng } = createSimState(seed, params);

console.log(`axis=${axis} seed=${seed} ticks=${ticks}`);
console.log(
  `params: patchBimodality=${params.patchBimodality} regrowthCycleAmplitude=${params.regrowthCycleAmplitude} specializationExponent=${params.specializationExponent} nursingRatePerTick=${params.nursingRatePerTick} carnivoryHuntingThreshold=${params.carnivoryHuntingThreshold} waterPassabilitySteepness=${params.waterPassabilitySteepness} aquaticLand/Water=${params.aquaticLandPassabilitySteepness}/${params.aquaticWaterPassabilitySteepness}`,
);

for (let t = 0; t < ticks; t++) {
  tick(state, rng, params);
  if (state.evolution.creatures.length === 0) {
    console.log(`tick=${state.evolution.tick} EXTINCT`);
    break;
  }
  if (state.evolution.tick % 1000 === 0) {
    const bimodalGenes = GENE_KEYS.filter((key) => isBimodal(state.evolution.creatures.map((c) => c.genome[key])));
    console.log(`tick=${state.evolution.tick} pop=${state.evolution.creatures.length} bimodal=[${bimodalGenes.join(",")}] species=${state.observations.taxonomy.species.size} events=${state.observations.taxonomyEvents.length}`);
  }
}

const speciations = state.observations.taxonomyEvents.filter((event) => event.type === "speciation");
const mechanisms = speciations.map((event) => `${event.event.mechanism}:${event.event.dominantDivergentGene ?? "mixed"}`);
console.log(`final: tick=${state.evolution.tick} pop=${state.evolution.creatures.length} species=${state.observations.taxonomy.species.size} splits=[${mechanisms.join(",")}]`);
