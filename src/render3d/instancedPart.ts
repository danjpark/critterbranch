import * as THREE from "three";

/**
 * One repeated piece of geometry drawn once for the whole world (SPEC.md Addendum 26).
 *
 * The World view previously gave every body part of every creature its own THREE.Mesh: at a
 * steady-state population of 681 that measured 7,517 draw calls per frame, since a draw call is
 * issued per mesh. Grouping by PART instead of by creature — every creature's body in one
 * instanced mesh, every head in another — makes that one call per part regardless of population.
 *
 * Usage is per frame: `begin()`, then `push()` once per instance in any order, then `commit()`.
 * Instances not pushed this frame simply aren't drawn, so a creature dying or a feature being lost
 * needs no explicit removal — the count just comes out lower.
 */
export class InstancedPart {
  readonly mesh: THREE.InstancedMesh;
  private capacity: number;
  private count = 0;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.Material;
  private readonly parent: THREE.Object3D;

  constructor(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, initialCapacity = 64) {
    this.parent = parent;
    this.geometry = geometry;
    this.material = material;
    this.capacity = Math.max(1, initialCapacity);
    this.mesh = this.createMesh(this.capacity);
    parent.add(this.mesh);
  }

  private createMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    // Instances are spread across the whole world, so the mesh's bounding volume covers the entire
    // map and per-object frustum culling can never exclude it — it only costs a bounds test that
    // always says "visible". Off-screen instances are still clipped by the GPU.
    mesh.frustumCulled = false;
    mesh.count = 0;
    // instanceColor is allocated lazily by Three.js on the first setColorAt, which would mean the
    // buffer appears mid-frame; allocating it up front keeps every frame's work identical.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    return mesh;
  }

  /** Doubles capacity when a frame needs more instances than the buffers hold. Recreating is the
   * only option — InstancedMesh sizes its buffers at construction — so growth is amortized by
   * doubling rather than tracking the population exactly. */
  private grow(needed: number): void {
    let capacity = this.capacity;
    while (capacity < needed) capacity *= 2;
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    const grown = this.createMesh(capacity);
    this.capacity = capacity;
    // `readonly` is about the public contract (callers must not swap it); rebuilding on growth is
    // this class's own business.
    (this as { mesh: THREE.InstancedMesh }).mesh = grown;
    this.parent.add(grown);
  }

  begin(): void {
    this.count = 0;
  }

  push(matrix: THREE.Matrix4, color: THREE.Color): void {
    if (this.count >= this.capacity) this.grow(this.count + 1);
    this.mesh.setMatrixAt(this.count, matrix);
    this.mesh.setColorAt(this.count, color);
    this.count++;
  }

  commit(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** How many instances the last committed frame drew — the honest measure of "how many of these
   * exist right now", and what the tests assert against. */
  get instanceCount(): number {
    return this.count;
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }
}
