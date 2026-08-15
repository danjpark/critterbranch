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
  /** Matches the drawing buffer and camera aspect to the canvas's CURRENT displayed size. The
   * World view is no longer a fixed 640x640 square (see style.css) — it fills whatever the desktop
   * layout gives it, so the buffer has to follow or the scene renders at one resolution and gets
   * stretched to another. Returns true when something actually changed, so callers can skip
   * redundant work. Idempotent and cheap: safe to call every frame or from a ResizeObserver. */
  resizeToDisplaySize: () => boolean;
  /** Smoothly flies the camera to look at a world point from `distance` away, preserving the
   * player's current viewing ANGLE rather than snapping to a canned one — being thrown to a fixed
   * viewpoint is disorienting, and the angle you were already using is the one you understand.
   * Advanced by render(); calling it again mid-flight retargets from wherever it currently is. */
  focusOn: (x: number, y: number, z: number, distance: number) => void;
  /** Frees GPU resources — call when a canvas's scene is being torn down (e.g. never currently,
   * since both app-mode scenes live for the page's whole lifetime, but here for correctness/future
   * use rather than leaking silently if that ever changes). */
  dispose: () => void;
}

/** Capped at 2: beyond that the pixel cost grows faster than the visible gain, and a 3x/4x phone
 * DPR on a full-width canvas is a real framerate cliff for no perceptible benefit. */
const MAX_PIXEL_RATIO = 2;

/** Long enough to read as travel (so you keep your bearings about where you were taken from),
 * short enough not to feel like waiting. */
const FOCUS_FLIGHT_MS = 700;

/** Standard ease-in-out — starts and ends at rest, which is what makes the flight read as a camera
 * move rather than a cut. */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
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
  renderer.setSize(canvas.width, canvas.height, false); // false: don't fight the CSS-driven display size (see style.css)

  /** Sizes the drawing buffer to the canvas's laid-out CSS box times the device pixel ratio. Done
   * by writing canvas.width/height directly rather than via renderer.setPixelRatio + setSize:
   * canvas.width IS the coordinate space every hit-test in this app works in (see main.ts's
   * canvasCoords, worldRenderer's findCreatureAt/worldPointAt), so letting Three.js own a separate
   * internal pixel-ratio multiplier would put picking and rendering in two different spaces. */
  function resizeToDisplaySize(): boolean {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    // Fall back to the current buffer size when the element isn't laid out yet (display:none, or
    // called before first layout) — resizing to 0 would make the aspect NaN and blank the view.
    const width = Math.max(1, Math.round((canvas.clientWidth || canvas.width) * ratio));
    const height = Math.max(1, Math.round((canvas.clientHeight || canvas.height) * ratio));
    if (canvas.width === width && canvas.height === height) return false;

    canvas.width = width;
    canvas.height = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    return true;
  }

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

  let focusFlight: { fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromPos: THREE.Vector3; toPos: THREE.Vector3; startMs: number } | null = null;

  function focusOn(x: number, y: number, z: number, distance: number): void {
    const toTarget = new THREE.Vector3(x, y, z);
    // Keep the direction the player is currently looking from, just closer to the new subject.
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1e-9) direction.set(0, 1, 1);
    direction.normalize();
    const clamped = Math.min(Math.max(distance, controls.minDistance), controls.maxDistance);
    focusFlight = {
      fromTarget: controls.target.clone(),
      toTarget,
      fromPos: camera.position.clone(),
      toPos: toTarget.clone().add(direction.multiplyScalar(clamped)),
      startMs: performance.now(),
    };
  }

  /** Returns true while a flight is still in progress. OrbitControls is disabled for its duration
   * so its damping doesn't fight the tween for ownership of the camera transform. */
  function advanceFocusFlight(): boolean {
    if (!focusFlight) return false;
    const t = Math.min(1, (performance.now() - focusFlight.startMs) / FOCUS_FLIGHT_MS);
    const eased = easeInOut(t);
    controls.target.lerpVectors(focusFlight.fromTarget, focusFlight.toTarget, eased);
    camera.position.lerpVectors(focusFlight.fromPos, focusFlight.toPos, eased);
    if (t >= 1) focusFlight = null;
    return true;
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    resizeToDisplaySize,
    focusOn,
    render: () => {
      // Checked per frame rather than only from a ResizeObserver: this also covers a canvas that
      // was hidden (display:none, so zero-sized) when it was last resized and has since become
      // visible — switching view tabs or app modes does exactly that.
      resizeToDisplaySize();
      const flying = advanceFocusFlight();
      // controls.update() applies damping toward its own internal spherical state, which would
      // undo the tween's writes; skipping it mid-flight lets the tween own the transform, and the
      // update() on the final frame re-syncs the controls to where the camera actually ended up.
      if (!flying) controls.update();
      renderer.render(scene, camera);
    },
    dispose: () => {
      controls.dispose();
      renderer.dispose();
    },
  };
}
