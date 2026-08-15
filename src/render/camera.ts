/**
 * A real pan/zoom camera for the World view (SPEC.md Addendum 18) — replaces the flat, implicit
 * "always fit the whole world to the canvas" projection every render/hit-test call used to do its
 * own inline scaleX/scaleY math for. At zoom=1 and a centered camera, `worldToScreen` is
 * byte-identical to that old fit, so nothing regresses until a player actually pans or zooms.
 */

export interface CameraState {
  /** World-space point the viewport is centered on. */
  centerX: number;
  centerY: number;
  /** 1 = the whole world exactly fills the viewport (today's old behavior). Only ever >= MIN_ZOOM
   * — there's no wraparound-tile rendering yet (Addendum 18's deliberately-deferred list), so
   * zooming OUT past "the world exactly fills the viewport" would just show blank space past the
   * world's edge. Zooming in is unrestricted up to MAX_ZOOM. */
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
  /** 0 (default, byte-identical to pre-Addendum-20 rendering) to 1 (full effect) — how much
   * elevation visually shifts a drawn entity's screen position (see elevationScreenOffset below).
   * Not a rotation/orbit — there's no "around" in this fixed top-down + height-offset scheme, only
   * how much height reads as depth. SPEC.md Addendum 20. */
  tilt: number;
}

export interface WorldExtent {
  worldWidth: number;
  worldHeight: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const MIN_TILT = 0;
export const MAX_TILT = 1;

export function createDefaultCamera(extent: WorldExtent, viewportWidth: number, viewportHeight: number): CameraState {
  return { centerX: extent.worldWidth / 2, centerY: extent.worldHeight / 2, zoom: 1, viewportWidth, viewportHeight, tilt: MIN_TILT };
}

/** Clamps to [MIN_TILT, MAX_TILT] and returns a new CameraState; does not mutate. Deliberately
 * separate from clampCamera (which is about pan/zoom staying within the world's bounds) — tilt has
 * nothing to do with world-edge clamping. */
export function withTilt(camera: CameraState, tilt: number): CameraState {
  return { ...camera, tilt: Math.min(MAX_TILT, Math.max(MIN_TILT, tilt)) };
}

/** World units of visual height per unit of elevation, at tilt=1 — empirically picked so a
 * full-height mountain (elevation = a typical terrainRoughness of ~0.3) shifts by roughly one grid
 * cell's worth of screen space, a visible but not exaggerated rise. SPEC.md Addendum 20. */
const ELEVATION_HEIGHT_SCALE = 15;

/** The screen-space Y offset an entity at `elevation` should be drawn with, given the camera's
 * current scale (screen pixels per world unit — see screenScale) and tilt. Negative: higher
 * elevation draws further UP the screen (standard "raised terrain reads as further back/up" 2.5D
 * convention). Zero at tilt=0, so nothing visually changes until tilt is actually raised. */
export function elevationScreenOffset(elevation: number, scale: number, tilt: number): number {
  return -elevation * ELEVATION_HEIGHT_SCALE * tilt * scale;
}

function baseScale(extent: WorldExtent, camera: CameraState): { scaleX: number; scaleY: number } {
  return {
    scaleX: (camera.viewportWidth / extent.worldWidth) * camera.zoom,
    scaleY: (camera.viewportHeight / extent.worldHeight) * camera.zoom,
  };
}

/** World-space coordinates of the viewport's top-left corner at the camera's current center/zoom —
 * the implicit origin every worldToScreen/screenToWorld call measures from. */
function topLeft(extent: WorldExtent, camera: CameraState): { x: number; y: number } {
  const { scaleX, scaleY } = baseScale(extent, camera);
  return {
    x: camera.centerX - camera.viewportWidth / (2 * scaleX),
    y: camera.centerY - camera.viewportHeight / (2 * scaleY),
  };
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export function worldToScreen(camera: CameraState, extent: WorldExtent, worldX: number, worldY: number): ScreenPoint {
  const { scaleX, scaleY } = baseScale(extent, camera);
  const origin = topLeft(extent, camera);
  return { x: (worldX - origin.x) * scaleX, y: (worldY - origin.y) * scaleY };
}

export interface WorldPoint {
  x: number;
  y: number;
}

export function screenToWorld(camera: CameraState, extent: WorldExtent, screenX: number, screenY: number): WorldPoint {
  const { scaleX, scaleY } = baseScale(extent, camera);
  const origin = topLeft(extent, camera);
  return { x: screenX / scaleX + origin.x, y: screenY / scaleY + origin.y };
}

/** Uniform screen-space scale a world-space length should be drawn at (e.g. a creature glyph's
 * bodyScale-derived radius) — the smaller of the two axis scales, same "don't distort" convention
 * drawCreatures' old `Math.min(scaleX, scaleY)` radius calculation already used. */
export function screenScale(camera: CameraState, extent: WorldExtent): number {
  const { scaleX, scaleY } = baseScale(extent, camera);
  return Math.min(scaleX, scaleY);
}

/** Keeps zoom within [MIN_ZOOM, MAX_ZOOM] and the center far enough from the world's edge that the
 * viewport never shows blank space past it — the "clamped panning" policy Addendum 18 chose over
 * building wraparound-tile rendering this pass. Returns a new CameraState; does not mutate. */
export function clampCamera(camera: CameraState, extent: WorldExtent): CameraState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom));
  const clamped = { ...camera, zoom };
  const { scaleX, scaleY } = baseScale(extent, clamped);
  const halfVisibleWidth = clamped.viewportWidth / (2 * scaleX);
  const halfVisibleHeight = clamped.viewportHeight / (2 * scaleY);

  // At zoom === MIN_ZOOM the visible window exactly equals the world, so the valid center range
  // collapses to a single point (the world's own center) — clamp() handles that correctly since
  // min === max in that case, no special-casing needed.
  const centerX = Math.min(extent.worldWidth - halfVisibleWidth, Math.max(halfVisibleWidth, clamped.centerX));
  const centerY = Math.min(extent.worldHeight - halfVisibleHeight, Math.max(halfVisibleHeight, clamped.centerY));

  return { ...clamped, centerX, centerY };
}

/** Applies a wheel-zoom step centered on a screen-space point (so the world point under the cursor
 * stays under the cursor after zooming, standard "zoom toward pointer" feel) and clamps the result. */
export function zoomCamera(camera: CameraState, extent: WorldExtent, screenX: number, screenY: number, zoomFactor: number): CameraState {
  const worldUnderCursor = screenToWorld(camera, extent, screenX, screenY);
  const zoomed = clampCamera({ ...camera, zoom: camera.zoom * zoomFactor }, extent);
  // Re-derive where that same world point now falls on screen under the new zoom, then shift the
  // center by the difference so the cursor point doesn't visually jump.
  const screenAfter = worldToScreen(zoomed, extent, worldUnderCursor.x, worldUnderCursor.y);
  const { scaleX, scaleY } = baseScale(extent, zoomed);
  // Screen position moves in the OPPOSITE direction of a center shift (screen = ... - center*scale
  // + ...), so correcting screenAfter toward the target screenX/screenY means subtracting the
  // error scaled back into world units, not adding it.
  return clampCamera(
    {
      ...zoomed,
      centerX: zoomed.centerX - (screenX - screenAfter.x) / scaleX,
      centerY: zoomed.centerY - (screenY - screenAfter.y) / scaleY,
    },
    extent,
  );
}

/** Applies a screen-space drag delta as a world-space pan and clamps the result. */
export function panCamera(camera: CameraState, extent: WorldExtent, screenDeltaX: number, screenDeltaY: number): CameraState {
  const { scaleX, scaleY } = baseScale(extent, camera);
  return clampCamera({ ...camera, centerX: camera.centerX - screenDeltaX / scaleX, centerY: camera.centerY - screenDeltaY / scaleY }, extent);
}
