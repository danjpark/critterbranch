import fs from "node:fs";
import path from "node:path";
import type { Intervention } from "../src/sim/intervention.ts";
import { runSimulation } from "../src/sim/sim.ts";
import { DEFAULT_PARAMS } from "../src/params.ts";

const OUT_DIR = path.join(import.meta.dirname, "..", "public", "scenarios");
fs.mkdirSync(OUT_DIR, { recursive: true });

interface Scenario {
  seed: number;
  interventionLog: Intervention[];
}

function writeScenario(name: string, scenario: Scenario, sanityCheckTicks: number): void {
  // Sanity check: make sure the scenario actually replays without throwing and doesn't wipe out
  // the population, before shipping it as an example.
  const result = runSimulation(scenario.seed, DEFAULT_PARAMS, scenario.interventionLog, sanityCheckTicks);
  if (result.creatures.length === 0) {
    throw new Error(`${name}: population went extinct by tick ${sanityCheckTicks} — pick different numbers`);
  }
  console.log(`${name}: population ${result.creatures.length} at tick ${sanityCheckTicks} — OK`);

  const filePath = path.join(OUT_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(scenario, null, 2));
  console.log(`  wrote ${filePath}`);
}

// A vertical barrier straight through the middle of the map, forming gradually over 400 ticks —
// slow enough to watch gene flow fight divergence as the passable gap narrows, per SPEC.md's
// "partial-barrier case is the interesting one."
writeScenario(
  "barrier-split",
  {
    seed: 42,
    interventionLog: [
      {
        tick: 2000,
        tool: "barrierStamp",
        params: {
          x1: 100,
          y1: 0,
          x2: 100,
          y2: 200,
          width: 10,
          targetPassability: 0.02,
          formationTicks: 400,
        },
      },
    ],
  },
  6000,
);

// A mass-extinction event partway through a run, emptying a big chunk of the map. Per SPEC.md:
// "a mass extinction empties niches, and the survivors radiate into them — that is the single
// bushiest tree-producing event available."
writeScenario(
  "meteor-radiation",
  {
    seed: 42,
    interventionLog: [
      {
        tick: 3000,
        tool: "meteor",
        params: { x: 100, y: 100, radius: 60, craterRecoveryTicks: 800 },
      },
    ],
  },
  6000,
);
