import * as THREE from "three";
import type { Params } from "../params.ts";
import type { TerrainGrid } from "../sim/terrain.ts";
import { terrainCellColorRgb } from "../render/terrainPalette.ts";
import type { CompetitionTint } from "../render/overlays.ts";

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
  const { cols, rows } = terrain;

  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  fillTerrainBuffers(positions, colors, terrain, params);

  // Two triangles per cell, connecting this cell's vertex to its right and below neighbors — the
  // last column/row has no "next" neighbor to form a quad with, so the loop stops one short in
  // each direction (matches the torus's own seam: no wraparound face is drawn here, same seam
  // policy the old 2D contour-line renderer already used).
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

/**
 * Writes vertex positions and colors for the current terrain into existing buffers.
 *
 * Split out from buildTerrainGeometry so an EDIT can reuse the geometry it already has. A terrain
 * edit changes elevation and color but never the grid's topology, yet the original code rebuilt the
 * whole BufferGeometry — reallocating both buffers, regenerating ~14,000 indices that were
 * bit-for-bit identical, and re-uploading all of it. That ran once per tick for the entire duration
 * of a barrier formation or crater recovery (intervention.ts bumps terrain.revision every tick
 * while either is in flight), measured at 0.83 ms per rebuild.
 */
function fillTerrainBuffers(positions: Float32Array, colors: Float32Array, terrain: TerrainGrid, params: Params): void {
  const { cols, rows, elevation, fertility, passability, seaLevel } = terrain;
  const roughness = Math.max(params.terrainRoughness, 1e-6);
  const cellW = params.worldWidth / cols;
  const cellH = params.worldHeight / rows;
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
}

/** How far a fully-contested cell's color can pull the terrain toward the feeding species' hue.
 * Short of 1 on purpose: the heatmap should read as a stain laid over the landscape, not a repaint
 * that hides which terrain is underneath it. */
const MAX_TINT_BLEND = 0.85;

export interface TerrainMeshHandle {
  mesh: THREE.Mesh;
  /** Blends the competition heatmap (see render/overlays.ts) into the terrain's vertex colors, or
   * clears it when passed null. Rewrites the existing color attribute in place — no geometry
   * rebuild, no reallocation, no normal recomputation — because consumption changes every single
   * tick and rebuilding the whole mesh at that cadence is exactly the cost this module is
   * otherwise careful to avoid. Cheap enough to call unconditionally each frame. */
  setCompetitionTint: (tint: CompetitionTint | null) => void;
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
  /** The untinted terrain colors, kept so a tint can be re-blended from the original each frame
   * rather than compounding on top of the previous frame's already-tinted buffer. */
  let baseColors = (mesh.geometry.getAttribute("color") as THREE.BufferAttribute).array.slice() as Float32Array;
  /** Skips the rewrite entirely on the (common) frames where the overlay is off and was already
   * off last frame — otherwise a disabled heatmap would still cost a full color-buffer write. */
  let tintApplied = false;

  function setCompetitionTint(tint: CompetitionTint | null): void {
    const attribute = mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const colors = attribute.array as Float32Array;

    if (!tint) {
      if (!tintApplied) return;
      colors.set(baseColors);
      attribute.needsUpdate = true;
      tintApplied = false;
      return;
    }

    const cellCount = Math.min(baseColors.length / 3, tint.strength.length);
    for (let idx = 0; idx < cellCount; idx++) {
      const strength = tint.strength[idx];
      const o = idx * 3;
      if (strength <= 0) {
        colors[o] = baseColors[o];
        colors[o + 1] = baseColors[o + 1];
        colors[o + 2] = baseColors[o + 2];
        continue;
      }
      const t = strength * MAX_TINT_BLEND;
      colors[o] = baseColors[o] + (tint.rgb[o] - baseColors[o]) * t;
      colors[o + 1] = baseColors[o + 1] + (tint.rgb[o + 1] - baseColors[o + 1]) * t;
      colors[o + 2] = baseColors[o + 2] + (tint.rgb[o + 2] - baseColors[o + 2]) * t;
    }
    attribute.needsUpdate = true;
    tintApplied = true;
  }

  return {
    mesh,
    setCompetitionTint,
    syncToTerrain: (nextTerrain, nextParams) => {
      if (nextTerrain === lastTerrain && nextTerrain.revision === lastRevision) return;

      const positionAttribute = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const colorAttribute = mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
      const sameGridSize = positionAttribute.count === nextTerrain.cols * nextTerrain.rows;

      if (sameGridSize) {
        // The common case by far — an edit changes elevation and colour but never the grid's
        // topology, so the existing buffers and the entire index list stay valid. Rewriting the
        // two attributes in place skips reallocating them and regenerating ~14,000 identical
        // indices, which matters because this runs EVERY TICK for the whole duration of a barrier
        // formation or crater recovery.
        fillTerrainBuffers(positionAttribute.array as Float32Array, colorAttribute.array as Float32Array, nextTerrain, nextParams);
        positionAttribute.needsUpdate = true;
        colorAttribute.needsUpdate = true;
        // Normals genuinely do change with elevation, so this one can't be skipped — it's the bulk
        // of the remaining cost, and correctness (lighting on a reshaped hill) depends on it.
        mesh.geometry.computeVertexNormals();
      } else {
        // Only reachable if the grid itself was resized (a different gridCellSize or world size),
        // which no current code path does mid-run — but silently rendering the wrong topology would
        // be far worse than paying for a rebuild here.
        mesh.geometry.dispose();
        mesh.geometry = buildTerrainGeometry(nextTerrain, nextParams);
      }

      // Re-snapshot the now-current untinted colours as the base, and drop the "already tinted"
      // flag so the next tinted frame writes rather than short-circuiting.
      baseColors = (mesh.geometry.getAttribute("color") as THREE.BufferAttribute).array.slice() as Float32Array;
      tintApplied = false;
      lastTerrain = nextTerrain;
      lastRevision = nextTerrain.revision;
    },
  };
}
