import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * Real 3D World view on Three.js (SPEC.md Addendum 21) — replaces the flat Canvas 2D
 * camera/projection system (Addendum 18/20). One WorldScene per canvas, so Classic Sandbox and
 * Game Mode each get their own independent camera/controls, same "independent per canvas"
 * precedent Addendum 18 established for the old 2D camera.
 *
 * Art direction (given mid-implementation, referencing Thronefall/Bad North): flat-shaded,
 * low-poly, and a CONSTRAINED orbit — this always reads as "orbiting a diorama," not a free-fly 3D
 * flight sim. See createWorldScene's OrbitControls limits below.
 */
export interface WorldScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** Re-renders the current frame — call this on the same interval the rest of the app already
   * re-renders on (see main.ts's setInterval loop); controls.update() (needed for damping) happens
   * inside here, not as a separate step callers need to remember. */
  render: () => void;
  /** Frees GPU resources — call when a canvas's scene is being torn down (e.g. never currently,
   * since both app-mode scenes live for the page's whole lifetime, but here for correctness/future
   * use rather than leaking silently if that ever changes). */
  dispose: () => void;
}

// Warm parchment-adjacent background — canvas letterboxing (aspect-ratio mismatches, camera
// looking past the world edge) reads as "ambient sky/void," not a jarring pure black.
const BACKGROUND_COLOR = 0x2a2318;
const AMBIENT_COLOR = 0xfff2e0;
const SUN_COLOR = 0xfff5e6;

export function createWorldScene(canvas: HTMLCanvasElement, worldWidth: number, worldHeight: number): WorldScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);

  const centerX = worldWidth / 2;
  const centerZ = worldHeight / 2;
  const worldSpan = Math.max(worldWidth, worldHeight);

  const camera = new THREE.PerspectiveCamera(45, canvas.width / Math.max(canvas.height, 1), worldSpan * 0.01, worldSpan * 8);
  camera.position.set(centerX, worldSpan * 0.7, centerZ + worldSpan * 0.7);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.width, canvas.height, false); // false: don't fight the CSS-driven display size (see style.css)

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(centerX, 0, centerZ);
  // Constrained orbit, not free-fly (Thronefall/Bad North reference) — always looking down at the
  // diorama from a plausible angle/distance, never from directly overhead or from ground level.
  controls.minDistance = worldSpan * 0.2;
  controls.maxDistance = worldSpan * 1.8;
  controls.minPolarAngle = Math.PI * 0.15;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.update();

  scene.add(new THREE.AmbientLight(AMBIENT_COLOR, 0.65));
  const sun = new THREE.DirectionalLight(SUN_COLOR, 1.1);
  sun.position.set(centerX + worldSpan * 0.4, worldSpan * 0.9, centerZ - worldSpan * 0.3);
  sun.target.position.set(centerX, 0, centerZ);
  scene.add(sun, sun.target);

  return {
    scene,
    camera,
    renderer,
    controls,
    render: () => {
      controls.update();
      renderer.render(scene, camera);
    },
    dispose: () => {
      controls.dispose();
      renderer.dispose();
    },
  };
}
