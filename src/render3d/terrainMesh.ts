import * as THREE from "three";
import type { Params } from "../params.ts";
import type { TerrainGrid } from "../sim/terrain.ts";
import { terrainCellColorRgb } from "../render/terrainPalette.ts";

/**
 * A real heightmap mesh for the World view (SPEC.md Addendum 21) — one vertex per terrain cell,
 * Y-displaced by elevation, vertex-colored by reusing terrainPalette.ts's existing pure color math
 * (the COLOR FORMULA is reused; the canvas-painting code around it is not). Low-poly and
 * flat-shaded by design (Thronefall/Bad North reference) — the grid's own per-cell faceting IS the
 * look once flat-shaded, no subdivision or smoothing needed to get there.
 */

/** World units of visual height per unit of elevation — elevation typically sits in
 * [-terrainRoughness, terrainRoughness] (default 0.3), so this puts a full-height mountain at
 * roughly 3-4% of a 200-unit default world's span. Empirically tunable; verify live, not just by
 * inspection, same discipline every prior height-scale constant in this codebase got. Exported so
 * worldRenderer.ts can place creatures/trees at the exact same height the terrain mesh itself
 * uses — two independent copies of this constant would silently drift apart the moment either one
 * got retuned.
 *
 * Lowered from 60 after Dan tried the Raise/Lower Terrain tool live: at 60, a single ordinary
 * terraform click read as a dramatic, oversized mountain rather than the modest local bump the
 * tool's own radius/strength sliders imply — the sim-side elevation math never changed, only how
 * aggressively it gets exaggerated into visual height. */
export const HEIGHT_SCALE = 20;

export function buildTerrainGeometry(terrain: TerrainGrid, params: Params): THREE.BufferGeometry {
  const { cols, rows, elevation, fertility, passability, seaLevel } = terrain;
  const roughness = Math.max(params.terrainRoughness, 1e-6);
  const cellW = params.worldWidth / cols;
  const cellH = params.worldHeight / rows;

  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  // Reused across every cell — terrainCellColorRgb writes into it rather than returning a fresh
  // tuple, so this whole loop allocates nothing per cell.
  const rgb: [number, number, number] = [0, 0, 0];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      const elev = elevation[idx];

      positions[idx * 3] = (x + 0.5) * cellW;
      positions[idx * 3 + 1] = elev * HEIGHT_SCALE;
      positions[idx * 3 + 2] = (y + 0.5) * cellH;

      terrainCellColorRgb(elev, seaLevel, fertility[idx], passability[idx], roughness, rgb);
      colors[idx * 3] = rgb[0];
      colors[idx * 3 + 1] = rgb[1];
      colors[idx * 3 + 2] = rgb[2];
    }
  }

  // Two triangles per cell, connecting this cell's vertex to its right and below neighbors — the
  // last column/row has no "next" neighbor to form a quad with, so the loop stops one short in
  // each direction (matches the torus's own seam: no wraparound face is drawn here, same seam
  // policy the old 2D contour-line renderer already used — see worldView.ts's paintElevationContours).
  const indices: number[] = [];
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const i00 = y * cols + x;
      const i10 = y * cols + (x + 1);
      const i01 = (y + 1) * cols + x;
      const i11 = (y + 1) * cols + (x + 1);
      indices.push(i00, i01, i10, i10, i01, i11);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface TerrainMeshHandle {
  mesh: THREE.Mesh;
  /** Rebuilds the mesh's geometry in place if `terrain` is a different object OR its `revision`
   * has changed since the last call — same "only repaint when actually stale" caching principle
   * the old 2D terrain layer used (Addendum 18), adapted to disposing/replacing a BufferGeometry
   * instead of blitting a cached canvas. Checking object identity too (not just the revision
   * number) matters for restart: a fresh TerrainGrid after Restart starts back at revision 0,
   * which would false-negative a rebuild against a previous never-edited terrain that also sat at
   * revision 0 if only the number were compared. Call once per frame; it's a no-op on every frame
   * except the one right after an edit or a restart. */
  syncToTerrain: (terrain: TerrainGrid, params: Params) => void;
}

export function createTerrainMesh(terrain: TerrainGrid, params: Params): TerrainMeshHandle {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(buildTerrainGeometry(terrain, params), material);
  let lastTerrain: TerrainGrid = terrain;
  let lastRevision = terrain.revision;

  return {
    mesh,
    syncToTerrain: (nextTerrain, nextParams) => {
      if (nextTerrain === lastTerrain && nextTerrain.revision === lastRevision) return;
      mesh.geometry.dispose();
      mesh.geometry = buildTerrainGeometry(nextTerrain, nextParams);
      lastTerrain = nextTerrain;
      lastRevision = nextTerrain.revision;
    },
  };
}
