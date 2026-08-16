import * as THREE from "three";
import type { MorphologyProfile } from "../sim/morphology.ts";
import { InstancedPart } from "./instancedPart.ts";

/**
 * Every creature in the world, drawn as one instanced mesh per body part (SPEC.md Addendum 26) —
 * the successor to createCreatureModel's one-THREE.Mesh-per-body-part-per-creature rig.
 *
 * The rig itself is unchanged: same procedural mammal built from MorphologyProfile (Addendum 17),
 * same emergent fin/fangs (Addendum 25), same low-poly flat-shaded primitives. What changed is who
 * owns the meshes. Previously each creature held ~10-13 meshes and the scene held population x that
 * many objects, each one a draw call and each one carrying Object3D matrix bookkeeping. Now there
 * are 8 meshes total no matter how many creatures exist: body, head, ear, snout, tail, fin, fang,
 * leg — parts that appear more than once per creature (2 ears, 2 fangs, 4 legs) simply push more
 * instances into the same one.
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
// 3 radial segments makes the fin read as a flat blade once squashed on one axis.
const finGeometry = new THREE.ConeGeometry(0.5, 1, 3);
const fangGeometry = new THREE.ConeGeometry(0.5, 1, 3);

// The capsule defaults to lying along Y — rotate the shared buffer once, up front, so no instance
// has to carry that rotation in its own matrix.
bodyGeometry.rotateZ(Math.PI / 2);

/** Below this a feature counts as not grown yet and contributes no instance at all. A zero-scaled
 * instance still occupies a slot and still transforms; skipping it is both cheaper and the honest
 * encoding of "this creature does not have one." */
const FEATURE_VISIBILITY_EPSILON = 0.01;

export interface CreatureField {
  root: THREE.Group;
  /** Clears last frame's instances. Call once before the per-creature adds. */
  begin: () => void;
  /** Queues one creature. `groundY` is the terrain height it stands on, `heading` the sim's own
   * heading (this negates it internally for Three's opposite rotation convention). */
  add: (x: number, groundY: number, z: number, heading: number, morphology: MorphologyProfile, colorCss: string) => void;
  /** Uploads the frame's instance data. Call once after the last add. */
  commit: () => void;
  /** Instances drawn per part last frame — exposed for tests and diagnostics. */
  counts: () => Record<string, number>;
  dispose: () => void;
}

export function createCreatureField(): CreatureField {
  const root = new THREE.Group();
  // White base colour so each instance's own colour comes through exactly rather than being
  // multiplied by a tint.
  const material = new THREE.MeshLambertMaterial({ flatShading: true, color: 0xffffff });

  const parts = {
    body: new InstancedPart(root, bodyGeometry, material),
    head: new InstancedPart(root, headGeometry, material),
    ear: new InstancedPart(root, earGeometry, material, 128),
    snout: new InstancedPart(root, snoutGeometry, material),
    tail: new InstancedPart(root, tailGeometry, material),
    fin: new InstancedPart(root, finGeometry, material, 32),
    fang: new InstancedPart(root, fangGeometry, material, 32),
    leg: new InstancedPart(root, legGeometry, material, 256),
  };

  // Scratch objects reused across every creature and every part — the whole point of instancing is
  // to stop allocating per-part objects, so allocating a Matrix4 per push would give a chunk of
  // that back.
  const local = new THREE.Object3D();
  const rootMatrix = new THREE.Matrix4();
  const partMatrix = new THREE.Matrix4();
  const rootPosition = new THREE.Vector3();
  const rootQuaternion = new THREE.Quaternion();
  const rootScale = new THREE.Vector3(1, 1, 1);
  const euler = new THREE.Euler();
  const color = new THREE.Color();

  /** Composes this part's local transform onto the creature's root transform and queues it. */
  function pushPart(part: InstancedPart): void {
    local.updateMatrix();
    partMatrix.multiplyMatrices(rootMatrix, local.matrix);
    part.push(partMatrix, color);
  }

  function add(x: number, groundY: number, z: number, heading: number, morphology: MorphologyProfile, colorCss: string): void {
    color.set(colorCss);
    rootPosition.set(x, groundY, z);
    // Three's rotation.y runs from +Z toward +X while the sim's heading runs from +X toward +Y, so
    // negating is what makes "facing +X" agree between the two rather than facing backward.
    euler.set(0, -heading, 0);
    rootQuaternion.setFromEuler(euler);
    rootMatrix.compose(rootPosition, rootQuaternion, rootScale);

    const r = morphology.bodyScale;
    const bodyLength = r * 1.6;
    const bodyRadius = r * 0.55;
    const headRadius = r * 0.42;
    const headX = bodyLength * 0.42;
    const headY = bodyRadius * 0.25;

    local.rotation.set(0, 0, 0);
    local.position.set(0, 0, 0);
    local.scale.set(bodyLength, bodyRadius, bodyRadius);
    pushPart(parts.body);

    local.scale.setScalar(headRadius);
    local.position.set(headX, headY, 0);
    pushPart(parts.head);

    const earRadius = r * (0.08 + 0.14 * morphology.earSize);
    for (const side of [1, -1]) {
      local.scale.setScalar(earRadius);
      local.position.set(headX - headRadius * 0.2, headY + headRadius * 0.75, side * headRadius * 0.6);
      pushPart(parts.ear);
    }

    const snoutLength = r * (0.15 + 0.55 * morphology.jawSize);
    const snoutX = headX + headRadius * 0.5 + snoutLength * 0.5;
    const snoutY = headY - headRadius * 0.1;
    local.rotation.set(0, 0, -Math.PI / 2);
    local.scale.set(headRadius * 0.6, snoutLength, headRadius * 0.6);
    local.position.set(snoutX, snoutY, 0);
    pushPart(parts.snout);

    const tailLength = r * (0.4 + 1.1 * morphology.tailForm);
    const tailWidth = r * (0.08 + 0.2 * morphology.tailForm);
    local.rotation.set(0, 0, Math.PI / 2);
    local.scale.set(tailWidth, tailLength, tailWidth);
    local.position.set(-bodyLength * 0.55 - tailLength * 0.5, bodyRadius * 0.1, 0);
    pushPart(parts.tail);

    // --- Emergent features (Addendum 25): absent entirely until earned ---
    if (morphology.finProminence > FEATURE_VISIBILITY_EPSILON) {
      const finSize = morphology.finProminence;
      const finHeight = r * 0.75 * finSize;
      const finLength = bodyLength * 0.42 * (0.5 + 0.5 * finSize);
      local.rotation.set(0, 0, 0);
      // Squashed flat across Z so the cone reads as a blade standing out of the back, and seated
      // slightly into the body so no gap opens between fin and spine.
      local.scale.set(finLength, finHeight, r * 0.05);
      local.position.set(bodyLength * 0.02, bodyRadius * 0.85 + finHeight * 0.4, 0);
      pushPart(parts.fin);
    }

    if (morphology.fangProminence > FEATURE_VISIBILITY_EPSILON) {
      const fangSize = morphology.fangProminence;
      const fangLength = r * 0.2 * fangSize;
      const fangRadius = r * 0.045 * (0.6 + 0.4 * fangSize);
      for (const side of [1, -1]) {
        local.rotation.set(0, 0, Math.PI); // point downward
        local.scale.set(fangRadius, fangLength, fangRadius);
        local.position.set(snoutX + snoutLength * 0.35, snoutY - fangLength * 0.45, side * headRadius * 0.28);
        pushPart(parts.fang);
      }
    }

    // Limbs broaden and shorten toward paddles as a lineage commits to water — the same four legs
    // reshaped, so it reads as those limbs adapting rather than different parts swapped in.
    const paddling = morphology.finProminence;
    const legLength = r * (0.3 + 0.9 * morphology.limbLength) * (1 - 0.45 * paddling);
    const legRadius = r * 0.09 * (1 + 1.5 * paddling);
    local.rotation.set(0, 0, 0);
    for (const alongX of [bodyLength * 0.28, -bodyLength * 0.28]) {
      for (const side of [1, -1]) {
        local.scale.set(legRadius, legLength, legRadius);
        local.position.set(alongX, -legLength * 0.5, side * bodyRadius * 0.7);
        pushPart(parts.leg);
      }
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
