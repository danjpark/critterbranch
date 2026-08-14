import { describe, expect, it } from "vitest";
import { clampCamera, createDefaultCamera, MAX_ZOOM, MIN_ZOOM, panCamera, screenScale, screenToWorld, worldToScreen, zoomCamera, type WorldExtent } from "./camera.ts";

const EXTENT: WorldExtent = { worldWidth: 100, worldHeight: 100 };
const VIEWPORT = 640;

describe("createDefaultCamera / worldToScreen", () => {
  it("at the default camera, matches the old flat full-canvas-fit exactly (SPEC.md Addendum 18's non-regression requirement)", () => {
    const camera = createDefaultCamera(EXTENT, VIEWPORT, VIEWPORT);
    const oldScaleX = VIEWPORT / EXTENT.worldWidth;
    const oldScaleY = VIEWPORT / EXTENT.worldHeight;

    for (const [wx, wy] of [
      [0, 0],
      [50, 50],
      [37, 82],
      [99, 1],
    ]) {
      const screen = worldToScreen(camera, EXTENT, wx, wy);
      expect(screen.x).toBeCloseTo(wx * oldScaleX);
      expect(screen.y).toBeCloseTo(wy * oldScaleY);
    }
  });

  it("supports a non-square world/viewport combination (independent X/Y scale, same as the old scaleX/scaleY)", () => {
    const wideExtent: WorldExtent = { worldWidth: 200, worldHeight: 100 };
    const camera = createDefaultCamera(wideExtent, VIEWPORT, VIEWPORT);
    const screen = worldToScreen(camera, wideExtent, 200, 100);
    expect(screen.x).toBeCloseTo(VIEWPORT);
    expect(screen.y).toBeCloseTo(VIEWPORT);
  });
});

describe("worldToScreen / screenToWorld round-trip", () => {
  it("round-trips at the default camera", () => {
    const camera = createDefaultCamera(EXTENT, VIEWPORT, VIEWPORT);
    for (const [wx, wy] of [
      [10, 10],
      [90, 5],
      [50.5, 33.3],
    ]) {
      const screen = worldToScreen(camera, EXTENT, wx, wy);
      const world = screenToWorld(camera, EXTENT, screen.x, screen.y);
      expect(world.x).toBeCloseTo(wx);
      expect(world.y).toBeCloseTo(wy);
    }
  });

  it("round-trips after panning and zooming", () => {
    let camera = createDefaultCamera(EXTENT, VIEWPORT, VIEWPORT);
    camera = zoomCamera(camera, EXTENT, VIEWPORT / 2, VIEWPORT / 2, 2);
    camera = panCamera(camera, EXTENT, 15, -10);

    const screen = worldToScreen(camera, EXTENT, 42, 61);
    const world = screenToWorld(camera, EXTENT, screen.x, screen.y);
    expect(world.x).toBeCloseTo(42);
    expect(world.y).toBeCloseTo(61);
  });
});

describe("clampCamera", () => {
  it("clamps zoom below MIN_ZOOM up to MIN_ZOOM", () => {
    const camera = createDefaultCamera(EXTENT, VIEWPORT, VIEWPORT);
    const clamped = clampCamera({ ...camera, zoom: 0.2 }, EXTENT);
    expect(clamped.zoom).toBe(MIN_ZOOM);
  });

  it("clamps zoom above MAX_ZOOM down to MAX_ZOOM", () => {
    const camera = createDefaultCamera(EXTENT, VIEWPORT, VIEWPORT);
    const clamped = clampCamera({ ...camera, zoom: 999 }, EXTENT);
    expect(clamped.zoom).toBe(MAX_ZOOM);
  });

  it("keeps the visible window within world bounds — never shows blank space past the edge", () => {
    const camera = createDefaultCamera(EXTENT, VIEWPORT, VIEWPORT);
    const clamped = clampCamera({ ...camera, zoom: 4, centerX: -1000, centerY: -1000 }, EXTENT);
    const topLeft = screenToWorld(clamped, EXTENT, 0, 0);
    const bottomRight = screenToWorld(clamped, EXTENT, VIEWPORT, VIEWPORT);
    expect(topLeft.x).toBeGreaterThanOrEqual(-1e-9);
    expect(topLeft.y).toBeGreaterThanOrEqual(-1e-9);
    expect(bottomRight.x).toBeLessThanOrEqual(EXTENT.worldWidth + 1e-9);
    expect(bottomRight.y).toBeLessThanOrEqual(EXTENT.worldHeight + 1e-9);
  });

  it("at MIN_ZOOM, centers exactly on the world regardless of requested center", () => {
    const camera = createDefaultCamera(EXTENT, VIEWPORT, VIEWPORT);
    const clamped = clampCamera({ ...camera, centerX: 5, centerY: 5 }, EXTENT);
    expect(clamped.centerX).toBeCloseTo(EXTENT.worldWidth / 2);
    expect(clamped.centerY).toBeCloseTo(EXTENT.worldHeight / 2);
  });
});

describe("zoomCamera", () => {
  it("increases zoom on a factor > 1 and decreases on a factor < 1", () => {
    const camera = createDefaultCamera(EXTENT, VIEWPORT, VIEWPORT);
    const zoomedIn = zoomCamera(camera, EXTENT, VIEWPORT / 2, VIEWPORT / 2, 2);
    expect(zoomedIn.zoom).toBeGreaterThan(camera.zoom);
    const zoomedBackOut = zoomCamera(zoomedIn, EXTENT, VIEWPORT / 2, VIEWPORT / 2, 0.5);
    expect(zoomedBackOut.zoom).toBeCloseTo(camera.zoom);
  });

  it("keeps the world point under the cursor at the same screen position after zooming (zoom-toward-pointer)", () => {
    const camera = createDefaultCamera(EXTENT, VIEWPORT, VIEWPORT);
    const cursorScreen = { x: 200, y: 300 };
    const worldUnderCursorBefore = screenToWorld(camera, EXTENT, cursorScreen.x, cursorScreen.y);

    const zoomed = zoomCamera(camera, EXTENT, cursorScreen.x, cursorScreen.y, 2);
    const screenAfter = worldToScreen(zoomed, EXTENT, worldUnderCursorBefore.x, worldUnderCursorBefore.y);

    expect(screenAfter.x).toBeCloseTo(cursorScreen.x, 0);
    expect(screenAfter.y).toBeCloseTo(cursorScreen.y, 0);
  });
});

describe("panCamera", () => {
  it("moves the center in world-space proportional to the screen-space drag delta", () => {
    let camera = createDefaultCamera(EXTENT, VIEWPORT, VIEWPORT);
    camera = zoomCamera(camera, EXTENT, VIEWPORT / 2, VIEWPORT / 2, 2); // zoom in first so there's room to pan
    const beforeCenter = { x: camera.centerX, y: camera.centerY };
    const panned = panCamera(camera, EXTENT, 10, 0);
    // Dragging the screen right (+dx) should move the camera's world center left (content follows the drag).
    expect(panned.centerX).toBeLessThan(beforeCenter.x);
  });

  it("clamps panning so it never moves the center past the world's bounds", () => {
    let camera = createDefaultCamera(EXTENT, VIEWPORT, VIEWPORT);
    camera = zoomCamera(camera, EXTENT, VIEWPORT / 2, VIEWPORT / 2, 2);
    const panned = panCamera(camera, EXTENT, -100000, -100000);
    const bottomRight = screenToWorld(panned, EXTENT, VIEWPORT, VIEWPORT);
    expect(bottomRight.x).toBeLessThanOrEqual(EXTENT.worldWidth + 1e-9);
    expect(bottomRight.y).toBeLessThanOrEqual(EXTENT.worldHeight + 1e-9);
  });
});

describe("screenScale", () => {
  it("matches the old Math.min(scaleX, scaleY) convention at the default camera", () => {
    const camera = createDefaultCamera(EXTENT, VIEWPORT, VIEWPORT);
    expect(screenScale(camera, EXTENT)).toBeCloseTo(VIEWPORT / EXTENT.worldWidth);
  });

  it("scales up with zoom", () => {
    const camera = createDefaultCamera(EXTENT, VIEWPORT, VIEWPORT);
    const zoomed = zoomCamera(camera, EXTENT, VIEWPORT / 2, VIEWPORT / 2, 2);
    expect(screenScale(zoomed, EXTENT)).toBeCloseTo(screenScale(camera, EXTENT) * 2);
  });
});
