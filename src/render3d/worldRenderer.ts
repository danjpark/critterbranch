import * as THREE from "three";
import type { Params } from "../params.ts";
import { cachedGenotypeColor, type ColorOptions } from "../render/color.ts";
import { computeCompetitionTint } from "../render/overlays.ts";
import type { Creature } from "../sim/creature.ts";
import { derivePhenotype } from "../sim/phenotype.ts";
import type { SimState } from "../sim/sim.ts";
import { cellIndexAt } from "../sim/trees.ts";
import { clamp01, lerp } from "../sim/util.ts";
import { createWorldScene, type WorldScene } from "./scene.ts";
import { createTerrainMesh, HEIGHT_SCALE, type TerrainMeshHandle } from "./terrainMesh.ts";
import { createCreatureField } from "./creatureField.ts";
import { createTreeField } from "./treeField.ts";

/**
 * Ties the Three.js scene/terrain/creature/tree pieces together into one World view (SPEC.md
 * Addendum 21) — the 3D successor to render/worldView.ts. One instance per canvas, matching the
 * existing "independent per canvas" precedent for Classic Sandbox vs. Game Mode.
 */

export interface WorldRenderOptions {
  colorOptions: ColorOptions;
  selectedCreatureId: number | null;
  lineageFilter: Set<number> | null;
  /** Blends the per-species competition heatmap into the terrain's own colors (see
   * render/overlays.ts). Off by default — it deliberately recolors the landscape, so it's a mode
   * you turn on to answer "who is eating where," not a permanent decoration. */
  showCompetitionHeatmap: boolean;
}

// Bumped up from the 2D glyph's original 0.09/0.4 — Dan asked for trees "slightly bigger" once he
// could see them at real scale next to creatures and terrain in 3D.
const MIN_CANOPY_RADIUS_FRAC = 0.13;
const MAX_CANOPY_RADIUS_FRAC = 0.55;
const POOR_TREE_RADIUS_SCALE = 0.6;
const SELECTION_RING_COLOR = 0xffffff;

/** Scaled the exact same way the terrain mesh's own vertices are (see HEIGHT_SCALE), so an entity
 * placed at this height always sits flush with the ground beneath it, not floating or sunken. */
function terrainHeightAt(state: SimState, params: Params, x: number, y: number): number {
  const idx = cellIndexAt(x, y, params, state.evolution.world);
  return state.evolution.terrain.elevation[idx] * HEIGHT_SCALE;
}

export interface WorldRenderer {
  scene: WorldScene;
  render: (state: SimState, params: Params, options: WorldRenderOptions) => void;
  /** Nearest living creature to a canvas-space click, projecting each creature's 3D position to
   * screen space rather than raycasting against its (small, thin) geometry directly — more
   * forgiving to click, and doesn't care how any one body part is shaped. */
  findCreatureAt: (state: SimState, screenX: number, screenY: number, canvasWidth: number, canvasHeight: number) => Creature | null;
  /** World-space (x, y) under a canvas-space click, via a real raycast against the terrain mesh —
   * null if the click doesn't land on the terrain at all (e.g. off into the sky). */
  worldPointAt: (screenX: number, screenY: number, canvasWidth: number, canvasHeight: number) => { x: number; y: number } | null;
  /** Flies the camera in to look at one creature, sitting it on the terrain surface the same way
   * the render pass places it so the subject isn't half-buried or floating. */
  focusOnCreature: (state: SimState, params: Params, creature: Creature) => void;
}

/** How close the camera settles when focusing a single creature — a fraction of the world's span,
 * so it stays sensible if the world size ever changes. Close enough to make out one creature's
 * body plan, far enough to keep its surroundings (who and what it lives among) in frame. */
const CREATURE_FOCUS_DISTANCE_FRAC = 0.16;

export function createWorldRenderer(canvas: HTMLCanvasElement, params: Params, initialState: SimState): WorldRenderer {
  const scene = createWorldScene(canvas, params.worldWidth, params.worldHeight);

  const terrainHandle: TerrainMeshHandle = createTerrainMesh(initialState.evolution.terrain, params);
  scene.scene.add(terrainHandle.mesh);

  // Instanced fields rather than a Map of per-entity models (SPEC.md Addendum 26): draw cost is now
  // a fixed handful of calls regardless of population, and there is no per-entity lifecycle to
  // track — an entity that isn't queued this frame simply isn't drawn, so death and the lineage
  // filter both need no explicit teardown.
  const creatureField = createCreatureField();
  const treeField = createTreeField();
  scene.scene.add(creatureField.root, treeField.root);

  const selectionRing = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 16),
    new THREE.MeshBasicMaterial({ color: SELECTION_RING_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
  );
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.visible = false;
  scene.scene.add(selectionRing);

  const raycaster = new THREE.Raycaster();

  function ndcFromScreen(screenX: number, screenY: number, canvasWidth: number, canvasHeight: number): THREE.Vector2 {
    return new THREE.Vector2((screenX / canvasWidth) * 2 - 1, -(screenY / canvasHeight) * 2 + 1);
  }

  function render(state: SimState, renderParams: Params, options: WorldRenderOptions): void {
    terrainHandle.syncToTerrain(state.evolution.terrain, renderParams);
    terrainHandle.setCompetitionTint(options.showCompetitionHeatmap ? computeCompetitionTint(state, options.colorOptions) : null);

    const { world, terrain, trees, tick } = state.evolution;
    const poorCapacityFloor = renderParams.treeFruitCapacity * 0.15;
    const richnessSpan = Math.max(renderParams.treeFruitCapacity - poorCapacityFloor, 1e-6);
    const cellSize = Math.min(renderParams.worldWidth / terrain.cols, renderParams.worldHeight / terrain.rows);

    treeField.begin();
    for (const tree of trees.trees) {
      const idx = cellIndexAt(tree.x, tree.y, renderParams, world);
      const ceiling = tree.capacity * terrain.fertility[idx];
      const fruitFrac = ceiling > 1e-6 ? clamp01(world.fruit[idx] / ceiling) : 0;
      const growth = tree.maturedTick !== null ? 1 : clamp01((tick - tree.plantedTick) / Math.max(renderParams.treeMaturityTicks, 1e-6));
      const richnessFrac = clamp01((tree.capacity - poorCapacityFloor) / richnessSpan);
      const grownRadius = cellSize * lerp(MAX_CANOPY_RADIUS_FRAC * POOR_TREE_RADIUS_SCALE, MAX_CANOPY_RADIUS_FRAC, richnessFrac);
      const canopyRadius = lerp(cellSize * MIN_CANOPY_RADIUS_FRAC, grownRadius, growth);
      const trunkHeight = lerp(canopyRadius * 0.6, canopyRadius * 1.4, growth);

      treeField.add(tree.id, tree.x, terrainHeightAt(state, renderParams, tree.x, tree.y), tree.y, canopyRadius, trunkHeight, fruitFrac);
    }
    treeField.commit();

    creatureField.begin();
    let selectedWorldPos: THREE.Vector3 | null = null;
    for (const creature of state.evolution.creatures) {
      if (options.lineageFilter && !options.lineageFilter.has(creature.lineageId)) continue;

      const morphology = derivePhenotype(creature.genome, renderParams).morphology;
      const fill = cachedGenotypeColor(creature, state.evolution.foundingCentroid, options.colorOptions);
      const y = terrainHeightAt(state, renderParams, creature.x, creature.y);
      creatureField.add(creature.x, y, creature.y, creature.heading, morphology, fill);

      if (options.selectedCreatureId === creature.id) {
        selectedWorldPos = new THREE.Vector3(creature.x, y, creature.y);
      }
    }
    creatureField.commit();

    if (selectedWorldPos) {
      selectionRing.visible = true;
      selectionRing.position.copy(selectedWorldPos);
      selectionRing.position.y += 0.05;
    } else {
      selectionRing.visible = false;
    }

    scene.render();
  }

  function findCreatureAt(state: SimState, screenX: number, screenY: number, canvasWidth: number, canvasHeight: number): Creature | null {
    const projected = new THREE.Vector3();
    let closest: Creature | null = null;
    let closestDistSq = Infinity;
    const pickRadiusPx = 24;

    for (const creature of state.evolution.creatures) {
      const y = terrainHeightAt(state, params, creature.x, creature.y);
      projected.set(creature.x, y, creature.y).project(scene.camera);
      const px = ((projected.x + 1) / 2) * canvasWidth;
      const py = ((1 - projected.y) / 2) * canvasHeight;
      const dx = px - screenX;
      const dy = py - screenY;
      const distSq = dx * dx + dy * dy;
      if (distSq < closestDistSq && distSq <= pickRadiusPx * pickRadiusPx) {
        closestDistSq = distSq;
        closest = creature;
      }
    }
    return closest;
  }

  function worldPointAt(screenX: number, screenY: number, canvasWidth: number, canvasHeight: number): { x: number; y: number } | null {
    raycaster.setFromCamera(ndcFromScreen(screenX, screenY, canvasWidth, canvasHeight), scene.camera);
    const hit = raycaster.intersectObject(terrainHandle.mesh)[0];
    if (!hit) return null;
    return { x: hit.point.x, y: hit.point.z };
  }

  function focusOnCreature(state: SimState, focusParams: Params, creature: Creature): void {
    const y = terrainHeightAt(state, focusParams, creature.x, creature.y);
    const span = Math.max(focusParams.worldWidth, focusParams.worldHeight);
    scene.focusOn(creature.x, y, creature.y, span * CREATURE_FOCUS_DISTANCE_FRAC);
  }

  return { scene, render, findCreatureAt, worldPointAt, focusOnCreature };
}
