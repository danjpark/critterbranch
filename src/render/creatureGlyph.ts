import type { MorphologyProfile } from "../sim/morphology.ts";
import { lerp } from "../sim/util.ts";

/**
 * One procedural mammal rig, drawn from MorphologyProfile (SPEC.md Addendum 17) — replaces the flat
 * colored circle every creature used to render as. Same technique as worldView.ts's drawTrees
 * (layered canvas primitives, a deterministic pseudoRandom hash instead of Math.random() for the
 * small per-individual jitter that keeps identical-morphology siblings from looking robotically
 * identical), extended to a moving, oriented body instead of a stationary tree.
 *
 * Deliberately the ONLY rig — no separate simplified/detailed tier (SPEC.md Addendum 18). Drawn at
 * whatever screen radius the camera's current zoom implies, so it reads as a small-but-real body at
 * population scale and a detailed individual up close, from one draw call.
 */

/** Cheap deterministic per-creature "randomness," identical pattern to worldView.ts's own
 * pseudoRandom — a hash of id and salt, not RNG, so a creature's jitter is stable frame to frame
 * without storing anything extra on Creature itself. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const BODY_RADIUS_Y_FRAC = 0.62; // torso squash — an ellipse reads as a body, a circle reads as a dot
const HEAD_OFFSET_FRAC = 0.85;
const HEAD_RADIUS_FRAC = 0.42;
const SNOUT_MIN_FRAC = 0.05;
const SNOUT_MAX_FRAC = 0.55;
const EAR_MIN_FRAC = 0.1;
const EAR_MAX_FRAC = 0.26;
const LEG_MIN_FRAC = 0.15;
const LEG_MAX_FRAC = 0.85;
const TAIL_MIN_FRAC = 0.3;
const TAIL_MAX_FRAC = 1.5;
const TAIL_MIN_WIDTH_FRAC = 0.06;
const TAIL_MAX_WIDTH_FRAC = 0.28; // a fully aquatic tailForm reads as paddle-like, not just longer

/**
 * Draws one creature glyph centered at (screenX, screenY), oriented by `heading` (radians, 0 =
 * facing local +x, matching Math.atan2's convention already used by stepCreature's own heading
 * math), sized by `bodyRadius` (screen-space, already camera-scaled by the caller). `seed` is a
 * stable per-creature value (its id) driving the small jitter offsets below.
 */
export function drawCreatureGlyph(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  bodyRadius: number,
  heading: number,
  morphology: MorphologyProfile,
  fillColor: string,
  seed: number,
): void {
  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.rotate(heading);

  const r = bodyRadius;
  const bodyRadiusY = r * BODY_RADIUS_Y_FRAC;

  // Tail first, so it's drawn behind the body/head/legs, not on top of them.
  const tailLength = r * lerp(TAIL_MIN_FRAC, TAIL_MAX_FRAC, morphology.tailForm);
  const tailWidth = r * lerp(TAIL_MIN_WIDTH_FRAC, TAIL_MAX_WIDTH_FRAC, morphology.tailForm);
  const tailWag = (pseudoRandom(seed * 3) - 0.5) * 0.3;
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = tailWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.9, 0);
  ctx.quadraticCurveTo(-r * 1.2, tailWag * r, -r * 0.9 - tailLength, tailWag * r * 1.5);
  ctx.stroke();

  // Legs: two pairs (fore/hind), length driven by limbLength, splayed slightly outward from the
  // body's long axis so they read as legs rather than a single perpendicular tick mark.
  const legLength = r * lerp(LEG_MIN_FRAC, LEG_MAX_FRAC, morphology.limbLength);
  ctx.strokeStyle = fillColor;
  ctx.lineWidth = Math.max(1, r * 0.14);
  for (const [alongX, side] of [
    [r * 0.5, 1],
    [r * 0.5, -1],
    [-r * 0.4, 1],
    [-r * 0.4, -1],
  ] as const) {
    const jitter = (pseudoRandom(seed * 5 + alongX + side) - 0.5) * 0.15;
    ctx.beginPath();
    ctx.moveTo(alongX, side * bodyRadiusY * 0.6);
    ctx.lineTo(alongX + jitter * r, side * (bodyRadiusY * 0.6 + legLength));
    ctx.stroke();
  }

  // Body torso.
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, bodyRadiusY, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head + snout, offset toward the front of the body (local +x).
  const headX = r * HEAD_OFFSET_FRAC;
  const headRadius = r * HEAD_RADIUS_FRAC;
  ctx.beginPath();
  ctx.arc(headX, 0, headRadius, 0, Math.PI * 2);
  ctx.fill();

  const snoutLength = r * lerp(SNOUT_MIN_FRAC, SNOUT_MAX_FRAC, morphology.jawSize);
  ctx.beginPath();
  ctx.ellipse(headX + headRadius * 0.7 + snoutLength * 0.5, 0, snoutLength * 0.5, headRadius * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ears: two small circles atop the head, a slight jittered angle apart.
  const earRadius = r * lerp(EAR_MIN_FRAC, EAR_MAX_FRAC, morphology.earSize);
  for (const side of [1, -1] as const) {
    const angleJitter = (pseudoRandom(seed * 7 + side) - 0.5) * 0.4;
    const earX = headX - headRadius * 0.3 + Math.cos(angleJitter) * headRadius * 0.5;
    const earY = side * (headRadius * 0.7 + Math.sin(angleJitter) * headRadius * 0.3);
    ctx.beginPath();
    ctx.arc(earX, earY, earRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
