import * as THREE from "three";
import type { MorphologyProfile } from "../sim/morphology.ts";

/**
 * Procedural 3D mammal rig, built from MorphologyProfile (Addendum 17) — the 3D successor to the
 * 2D canvas glyph (Addendum 18), same "purely formula-derived, no authored assets" principle
 * confirmed for this pass (Addendum 21). Low-poly, flat-shaded primitives (Thronefall/Bad North
 * reference) — icosahedra instead of smooth spheres, low radial-segment cones/cylinders.
 *
 * Geometries are SHARED module-level singletons, reused across every creature via per-mesh
 * position/rotation/scale — only the material (one per creature, for its genotype color) and the
 * transform are actually per-instance. Avoids allocating thousands of near-identical
 * BufferGeometry buffers for a large population.
 */

const BODY_RADIAL_SEGMENTS = 6;
const BODY_CAP_SEGMENTS = 2;
const HEAD_DETAIL = 0; // icosahedron subdivision level — 0 keeps the low-poly faceted look
const CONE_RADIAL_SEGMENTS = 5;
const LEG_RADIAL_SEGMENTS = 5;

const bodyGeometry = new THREE.CapsuleGeometry(0.5, 1, BODY_CAP_SEGMENTS, BODY_RADIAL_SEGMENTS);
const headGeometry = new THREE.IcosahedronGeometry(0.5, HEAD_DETAIL);
const earGeometry = new THREE.IcosahedronGeometry(0.5, HEAD_DETAIL);
const snoutGeometry = new THREE.ConeGeometry(0.5, 1, CONE_RADIAL_SEGMENTS);
const legGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, LEG_RADIAL_SEGMENTS);
const tailGeometry = new THREE.ConeGeometry(0.5, 1, CONE_RADIAL_SEGMENTS);
// Emergent features (SPEC.md Addendum 25) — parts a creature grows rather than parts it always
// has. 3 radial segments makes the fin read as a flat blade once squashed on one axis.
const finGeometry = new THREE.ConeGeometry(0.5, 1, 3);
const fangGeometry = new THREE.ConeGeometry(0.5, 1, 3);

// bodyGeometry's capsule defaults to lying along Y — rotate its (shared) buffer once, up front, so
// every creature's body mesh can just use identity-ish transforms afterward instead of every
// instance repeating the same rotation.
bodyGeometry.rotateZ(Math.PI / 2);

interface CreaturePart {
  mesh: THREE.Mesh;
}

export interface CreatureModel {
  root: THREE.Group;
  /** Updates the rig's shape to match a (possibly changed) morphology and re-tints it — called
   * every frame; cheap (transform-only, no geometry/material allocation) so no dirty-check is
   * needed before calling it. */
  update: (morphology: MorphologyProfile, colorCss: string) => void;
  dispose: () => void;
}

function part(geometry: THREE.BufferGeometry, material: THREE.Material): CreaturePart {
  const mesh = new THREE.Mesh(geometry, material);
  return { mesh };
}

/** Builds one creature's rig. `material` is this creature's own instance (not shared — its color
 * needs to vary independently), reused across every body part so there's only one material per
 * creature rather than one per part. */
export function createCreatureModel(): CreatureModel {
  const material = new THREE.MeshLambertMaterial({ flatShading: true });

  const body = part(bodyGeometry, material);
  const head = part(headGeometry, material);
  const earL = part(earGeometry, material);
  const earR = part(earGeometry, material);
  const snout = part(snoutGeometry, material);
  const tail = part(tailGeometry, material);
  const fin = part(finGeometry, material);
  const fangL = part(fangGeometry, material);
  const fangR = part(fangGeometry, material);
  const legs = [part(legGeometry, material), part(legGeometry, material), part(legGeometry, material), part(legGeometry, material)];

  const root = new THREE.Group();
  root.add(body.mesh, head.mesh, earL.mesh, earR.mesh, snout.mesh, tail.mesh, fin.mesh, fangL.mesh, fangR.mesh, ...legs.map((l) => l.mesh));

  function update(morphology: MorphologyProfile, colorCss: string): void {
    material.color.set(colorCss);

    const r = morphology.bodyScale;
    const bodyLength = r * 1.6;
    const bodyRadius = r * 0.55;
    body.mesh.scale.set(bodyLength, bodyRadius, bodyRadius);

    const headRadius = r * 0.42;
    head.mesh.scale.setScalar(headRadius);
    head.mesh.position.set(bodyLength * 0.42, bodyRadius * 0.25, 0);

    const earRadius = r * (0.08 + 0.14 * morphology.earSize);
    for (const [ear, side] of [
      [earL, 1],
      [earR, -1],
    ] as const) {
      ear.mesh.scale.setScalar(earRadius);
      ear.mesh.position.set(head.mesh.position.x - headRadius * 0.2, head.mesh.position.y + headRadius * 0.75, side * headRadius * 0.6);
    }

    const snoutLength = r * (0.15 + 0.55 * morphology.jawSize);
    snout.mesh.scale.set(headRadius * 0.6, snoutLength, headRadius * 0.6);
    snout.mesh.rotation.z = -Math.PI / 2;
    snout.mesh.position.set(head.mesh.position.x + headRadius * 0.5 + snoutLength * 0.5, head.mesh.position.y - headRadius * 0.1, 0);

    const tailLength = r * (0.4 + 1.1 * morphology.tailForm);
    const tailWidth = r * (0.08 + 0.2 * morphology.tailForm);
    tail.mesh.scale.set(tailWidth, tailLength, tailWidth);
    tail.mesh.rotation.z = Math.PI / 2;
    tail.mesh.position.set(-bodyLength * 0.55 - tailLength * 0.5, bodyRadius * 0.1, 0);

    // --- Emergent features (SPEC.md Addendum 25) ------------------------------------------------
    // Hidden outright at zero rather than scaled to nothing: a zero-scaled mesh still costs a draw
    // call, and a sub-pixel sliver of geometry reads as a rendering artifact rather than as
    // absence. `visible` is the honest encoding of "this creature does not have one."
    const finSize = morphology.finProminence;
    fin.mesh.visible = finSize > 0.01;
    if (fin.mesh.visible) {
      const finHeight = r * 0.75 * finSize;
      const finLength = bodyLength * 0.42 * (0.5 + 0.5 * finSize);
      // Squashed flat across Z so the cone reads as a blade standing up out of the back, and
      // seated slightly into the body so no gap opens up between fin and spine.
      fin.mesh.scale.set(finLength, finHeight, r * 0.05);
      fin.mesh.position.set(bodyLength * 0.02, bodyRadius * 0.85 + finHeight * 0.4, 0);
    }

    const fangSize = morphology.fangProminence;
    fangL.mesh.visible = fangSize > 0.01;
    fangR.mesh.visible = fangL.mesh.visible;
    if (fangL.mesh.visible) {
      const fangLength = r * 0.2 * fangSize;
      const fangRadius = r * 0.045 * (0.6 + 0.4 * fangSize);
      // Point DOWN (rotation.z = pi flips the cone), hanging from the end of the snout.
      for (const [fang, side] of [
        [fangL, 1],
        [fangR, -1],
      ] as const) {
        fang.mesh.scale.set(fangRadius, fangLength, fangRadius);
        fang.mesh.rotation.z = Math.PI;
        fang.mesh.position.set(snout.mesh.position.x + snoutLength * 0.35, snout.mesh.position.y - fangLength * 0.45, side * headRadius * 0.28);
      }
    }

    // Limbs broaden and shorten toward paddles as a lineage commits to water — the same four leg
    // meshes, reshaped, so the change costs nothing and reads as the SAME limbs adapting rather
    // than legs being swapped for something else.
    const paddling = morphology.finProminence;
    const legLength = r * (0.3 + 0.9 * morphology.limbLength) * (1 - 0.45 * paddling);
    const legRadius = r * 0.09 * (1 + 1.5 * paddling);
    const legPositions: [number, number][] = [
      [bodyLength * 0.28, 1],
      [bodyLength * 0.28, -1],
      [-bodyLength * 0.28, 1],
      [-bodyLength * 0.28, -1],
    ];
    legs.forEach((leg, i) => {
      const [alongX, side] = legPositions[i];
      leg.mesh.scale.set(legRadius, legLength, legRadius);
      leg.mesh.position.set(alongX, -legLength * 0.5, side * bodyRadius * 0.7);
    });
  }

  return {
    root,
    update,
    dispose: () => material.dispose(),
  };
}
