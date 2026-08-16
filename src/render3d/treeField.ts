import * as THREE from "three";
import { InstancedPart } from "./instancedPart.ts";

/**
 * Every fruit tree in the world, as two instanced meshes (SPEC.md Addendum 26) — the successor to
 * createTreeModel's per-tree Group of a trunk plus three canopy blobs. At the default maxTreeCount
 * of 350 that rig cost 1,400 draw calls per frame on its own; this costs 2.
 *
 * The look is unchanged: same trunk proportions, same three-blob canopy with the same deterministic
 * per-tree jitter, same depleted-to-full colour ramp. Blob layout still comes from the tree's id,
 * so a given tree's silhouette is identical frame to frame — it just gets recomputed per frame now
 * instead of being stored on a per-tree object, which is cheaper than the object it replaces.
 */

const TRUNK_RADIAL_SEGMENTS = 5;
const CANOPY_DETAIL = 0;
const BLOB_COUNT = 3;

const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, TRUNK_RADIAL_SEGMENTS);
const canopyGeometry = new THREE.IcosahedronGeometry(0.5, CANOPY_DETAIL);

const TRUNK_COLOR = new THREE.Color(0x3b2e1f); // same ink-brown as the original 2D glyph
const CANOPY_FULL_COLOR = new THREE.Color(74 / 255, 157 / 255, 61 / 255);
const CANOPY_DEPLETED_COLOR = new THREE.Color(150 / 255, 142 / 255, 108 / 255);

/** Same hash as the original glyph's pseudoRandom — a deterministic per-tree "randomness", not
 * Math.random(), so a canopy's silhouette is stable across frames and across runs. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export interface TreeField {
  root: THREE.Group;
  begin: () => void;
  add: (treeId: number, x: number, groundY: number, z: number, canopyRadius: number, trunkHeight: number, fruitFrac: number) => void;
  commit: () => void;
  counts: () => Record<string, number>;
  dispose: () => void;
}

export function createTreeField(): TreeField {
  const root = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ flatShading: true, color: 0xffffff });

  const parts = {
    trunk: new InstancedPart(root, trunkGeometry, material, 128),
    canopy: new InstancedPart(root, canopyGeometry, material, 384),
  };

  const local = new THREE.Object3D();
  const rootMatrix = new THREE.Matrix4();
  const partMatrix = new THREE.Matrix4();
  const rootPosition = new THREE.Vector3();
  const identityQuaternion = new THREE.Quaternion();
  const unitScale = new THREE.Vector3(1, 1, 1);
  const canopyColor = new THREE.Color();

  function pushPart(part: InstancedPart, color: THREE.Color): void {
    local.updateMatrix();
    partMatrix.multiplyMatrices(rootMatrix, local.matrix);
    part.push(partMatrix, color);
  }

  function add(treeId: number, x: number, groundY: number, z: number, canopyRadius: number, trunkHeight: number, fruitFrac: number): void {
    rootPosition.set(x, groundY, z);
    rootMatrix.compose(rootPosition, identityQuaternion, unitScale);

    local.rotation.set(0, 0, 0);
    local.scale.set(canopyRadius * 0.12, trunkHeight, canopyRadius * 0.12);
    local.position.set(0, trunkHeight * 0.5, 0);
    pushPart(parts.trunk, TRUNK_COLOR);

    canopyColor.copy(CANOPY_DEPLETED_COLOR).lerp(CANOPY_FULL_COLOR, fruitFrac);
    for (let i = 0; i < BLOB_COUNT; i++) {
      const angle = pseudoRandom(treeId * 7 + i) * Math.PI * 2;
      const radialFrac = pseudoRandom(treeId * 13 + i) * 0.35;
      const sizeFrac = 0.55 + pseudoRandom(treeId * 19 + i) * 0.25;
      const offset = canopyRadius * radialFrac;
      local.scale.setScalar(canopyRadius * sizeFrac);
      local.position.set(Math.cos(angle) * offset, trunkHeight + Math.sin(angle) * offset * 0.5, Math.sin(angle) * offset);
      pushPart(parts.canopy, canopyColor);
    }
  }

  return {
    root,
    begin: () => {
      for (const part of Object.values(parts)) part.begin();
    },
    add,
    commit: () => {
      for (const part of Object.values(parts)) part.commit();
    },
    counts: () => Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, part.instanceCount])),
    dispose: () => {
      for (const part of Object.values(parts)) part.dispose();
      material.dispose();
    },
  };
}
