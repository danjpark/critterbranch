import * as THREE from "three";

/**
 * Procedural 3D fruit-tree model — the 3D successor to the 2D canopy glyph (worldView.ts's
 * drawTrees, Addendum 18), same growth/richness/fruit-fraction inputs, same deterministic
 * per-tree jitter for an organic (not perfectly round) canopy cluster. Low-poly/flat-shaded
 * (Addendum 21) — icosahedra for canopy blobs, a thin low-segment cylinder for the trunk.
 */

const TRUNK_RADIAL_SEGMENTS = 5;
const CANOPY_DETAIL = 0;
const BLOB_COUNT = 3;

const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, TRUNK_RADIAL_SEGMENTS);
const canopyGeometry = new THREE.IcosahedronGeometry(0.5, CANOPY_DETAIL);

const TRUNK_COLOR = 0x3b2e1f; // same ink-brown as the 2D glyph's TRUNK_COLOR
const CANOPY_FULL_COLOR = new THREE.Color(74 / 255, 157 / 255, 61 / 255);
const CANOPY_DEPLETED_COLOR = new THREE.Color(150 / 255, 142 / 255, 108 / 255);

/** Same hash pattern as worldView.ts's pseudoRandom — a deterministic per-tree "randomness," not
 * Math.random(), so a tree's canopy silhouette is stable frame to frame. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export interface TreeModel {
  root: THREE.Group;
  /** Updates size/color to match current growth/richness/fruitFrac — cheap transform+color only,
   * safe to call every frame unconditionally. `treeId` seeds the blobs' fixed jitter layout, only
   * actually used the first time (blob positions are set once at creation, matching the 2D glyph's
   * own "stable silhouette per tree id" behavior) but passed each call for a simpler call site. */
  update: (treeId: number, canopyRadius: number, trunkHeight: number, fruitFrac: number) => void;
}

export function createTreeModel(treeId: number): TreeModel {
  const trunkMaterial = new THREE.MeshLambertMaterial({ color: TRUNK_COLOR, flatShading: true });
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);

  const canopyMaterials: THREE.MeshLambertMaterial[] = [];
  const blobs: THREE.Mesh[] = [];
  const blobOffsets: { angle: number; radialFrac: number; sizeFrac: number }[] = [];
  for (let i = 0; i < BLOB_COUNT; i++) {
    const material = new THREE.MeshLambertMaterial({ flatShading: true });
    canopyMaterials.push(material);
    blobs.push(new THREE.Mesh(canopyGeometry, material));
    blobOffsets.push({
      angle: pseudoRandom(treeId * 7 + i) * Math.PI * 2,
      radialFrac: pseudoRandom(treeId * 13 + i) * 0.35,
      sizeFrac: 0.55 + pseudoRandom(treeId * 19 + i) * 0.25,
    });
  }

  const root = new THREE.Group();
  root.add(trunk, ...blobs);

  function update(_treeId: number, canopyRadius: number, trunkHeight: number, fruitFrac: number): void {
    trunk.scale.set(canopyRadius * 0.12, trunkHeight, canopyRadius * 0.12);
    trunk.position.set(0, trunkHeight * 0.5, 0);

    const canopyColor = CANOPY_DEPLETED_COLOR.clone().lerp(CANOPY_FULL_COLOR, fruitFrac);
    const canopyCenterY = trunkHeight;
    blobs.forEach((blob, i) => {
      const { angle, radialFrac, sizeFrac } = blobOffsets[i];
      const offset = canopyRadius * radialFrac;
      blob.position.set(Math.cos(angle) * offset, canopyCenterY + Math.sin(angle) * offset * 0.5, Math.sin(angle) * offset);
      blob.scale.setScalar(canopyRadius * sizeFrac);
      canopyMaterials[i].color.copy(canopyColor);
    });
  }

  return { root, update };
}
