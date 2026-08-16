/**
 * Render-path benchmark, headless. scripts/benchmark.ts covers the sim's tick() pipeline; this
 * covers the per-frame CPU work the World view does on top of it, which that benchmark never
 * touched and which now runs for every creature on every frame.
 *
 * No WebGL context is needed: everything measured here is scene-graph and math work (deriving a
 * phenotype, positioning a rig's parts, rebuilding a terrain buffer). The GPU-side cost of actually
 * drawing those meshes is NOT measured here — see the draw-call estimate at the end for the part
 * that has to be reasoned about instead.
 */
import { DEFAULT_PARAMS } from "../src/params.ts";
import { createSimState, tick } from "../src/sim/sim.ts";
import { derivePhenotype } from "../src/sim/phenotype.ts";
import { createCreatureField } from "../src/render3d/creatureField.ts";
import { createTreeField } from "../src/render3d/treeField.ts";
import { buildTerrainGeometry, createTerrainMesh } from "../src/render3d/terrainMesh.ts";
import { cachedGenotypeColor } from "../src/render/color.ts";
import { competitionContributors, computeCompetitionTint } from "../src/render/overlays.ts";

const COLOR_OPTIONS = { deuteranopiaSafe: false, divergenceScale: 0.35 };
const FRAMES = 120;

function ms(label: string, frames: number, run: () => void): void {
  run(); // warm up
  const start = performance.now();
  for (let i = 0; i < frames; i++) run();
  const total = performance.now() - start;
  console.log(`  ${label.padEnd(46)} ${(total / frames).toFixed(3)} ms/frame`);
}

function main(): void {
  // 3,000 ticks, not a few hundred: a fresh founding population crashes hard before recovering, so
  // a short warmup measures a near-empty world rather than the steady state you actually watch.
  for (const founding of [100, 500]) {
    const params = { ...DEFAULT_PARAMS, foundingPopulationSize: founding };
    const sim = createSimState(1, params);
    for (let i = 0; i < 3000; i++) tick(sim.state, sim.rng, params);
    const creatures = sim.state.evolution.creatures;
    console.log(`\nfounding=${founding} — live population ${creatures.length}, trees ${sim.state.evolution.trees.trees.length}`);

    ms("derivePhenotype for every creature", FRAMES, () => {
      for (const c of creatures) derivePhenotype(c.genome, params);
    });

    ms("genotype colour for every creature", FRAMES, () => {
      for (const c of creatures) cachedGenotypeColor(c, sim.state.evolution.foundingCentroid, COLOR_OPTIONS);
    });

    const field = createCreatureField();
    const morphologies = creatures.map((c) => derivePhenotype(c.genome, params).morphology);
    ms("creature rig update for every creature", FRAMES, () => {
      field.begin();
      for (let i = 0; i < creatures.length; i++) field.add(creatures[i].x, 0, creatures[i].y, creatures[i].heading, morphologies[i], "rgb(180, 180, 180)");
      field.commit();
    });
    ms("FULL per-frame creature work (derive + colour + rig)", FRAMES, () => {
      field.begin();
      for (const c of creatures) {
        const m = derivePhenotype(c.genome, params).morphology;
        const colour = cachedGenotypeColor(c, sim.state.evolution.foundingCentroid, COLOR_OPTIONS);
        field.add(c.x, 0, c.y, c.heading, m, colour);
      }
      field.commit();
    });
    const creatureCounts = field.counts();
    field.dispose();

    const treeField = createTreeField();
    ms("tree field update for every tree", FRAMES, () => {
      treeField.begin();
      for (const t of sim.state.evolution.trees.trees) treeField.add(t.id, t.x, 0, t.y, 1.5, 1.2, 0.6);
      treeField.commit();
    });
    const treeCounts = treeField.counts();
    treeField.dispose();

    ms("terrain geometry FULL rebuild (was: every terraform tick)", 30, () => {
      buildTerrainGeometry(sim.state.evolution.terrain, params).dispose();
    });
    const handle = createTerrainMesh(sim.state.evolution.terrain, params);
    let revision = sim.state.evolution.terrain.revision;
    ms("terrain in-place update (now: every terraform tick)", 30, () => {
      sim.state.evolution.terrain.revision = ++revision;
      handle.syncToTerrain(sim.state.evolution.terrain, params);
    });

    ms("competition tint (heatmap on)", 30, () => {
      computeCompetitionTint(sim.state, COLOR_OPTIONS);
    });
    ms("competition contributors (legend, heatmap on)", 30, () => {
      competitionContributors(sim.state, COLOR_OPTIONS);
    });

    // Draw calls aren't measurable without a GPU context but are exactly computable, and they were
    // the dominant render cost. Instanced: one call per PART, regardless of population.
    const creatureParts = Object.keys(creatureCounts).length;
    const treeParts = Object.keys(treeCounts).length;
    const before = Object.values(creatureCounts).reduce((a, c) => a + c, 0) + Object.values(treeCounts).reduce((a, c) => a + c, 0);
    console.log(`  draw calls/frame: ${creatureParts + treeParts + 1} (was ~${before + 1} as one mesh per part per entity)`);
  }
}

main();
