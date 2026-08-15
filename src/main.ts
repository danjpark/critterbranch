import "./style.css";
import { GameRunner } from "./app/gameRunner.ts";
import { SimRunner } from "./app/simRunner.ts";
import { PROTOTYPE_CHALLENGES } from "./game/challenges/prototypeChallenges.ts";
import type { ColorOptions } from "./render/color.ts";
import { renderMuller } from "./render/mullerView.ts";
import { findPointAt, renderScatter } from "./render/scatterView.ts";
import { findBranchAt, renderTree } from "./render/treeView.ts";
import { createWorldRenderer, type WorldRenderer } from "./render3d/worldRenderer.ts";
import type { Genome } from "./sim/genome.ts";
import { parseRunConfig } from "./sim/runConfig.ts";
import { classifySpecies } from "./game/observability/capabilityClassifier.ts";
import { computeSpeciesProfiles } from "./game/observability/speciesProfile.ts";
import {
  createCheckpointsPanel,
  createControls,
  createEraSummaryPanel,
  createEventFeed,
  createGameControlsPanel,
  createGeneFlowChart,
  createGodModePanel,
  createLegend,
  createObjectivesPanel,
  createScatterPanel,
  createScenarioPanel,
  createTraitChart,
  createTreePanel,
} from "./ui/controls.ts";
import { enablePanelWorkspace } from "./ui/panelWorkspace.ts";

const CANVAS_SIZE = 640;
type ViewName = "world" | "tree" | "muller" | "scatter";
type AppMode = "classic" | "game";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = "";

const appModeTabRow = document.createElement("div");
appModeTabRow.className = "row mode-tabs";
const classicModeButton = document.createElement("button");
classicModeButton.textContent = "Classic Sandbox";
classicModeButton.classList.add("active");
classicModeButton.addEventListener("click", () => setAppMode("classic"));
const gameModeButton = document.createElement("button");
gameModeButton.textContent = "Game";
gameModeButton.addEventListener("click", () => setAppMode("game"));
appModeTabRow.append(classicModeButton, gameModeButton);
app.appendChild(appModeTabRow);

const classicRoot = document.createElement("div");
classicRoot.className = "app-mode-root";
const gameRoot = document.createElement("div");
gameRoot.className = "app-mode-root";
gameRoot.style.display = "none";
app.append(classicRoot, gameRoot);

function setAppMode(mode: AppMode): void {
  classicModeButton.classList.toggle("active", mode === "classic");
  gameModeButton.classList.toggle("active", mode === "game");
  classicRoot.style.display = mode === "classic" ? "grid" : "none";
  gameRoot.style.display = mode === "game" ? "grid" : "none";
  if (mode === "game") renderGame();
}

const canvasArea = document.createElement("div");
canvasArea.className = "canvas-area";

const tabRow = document.createElement("div");
tabRow.className = "row view-tabs";
const tabButtons = new Map<ViewName, HTMLButtonElement>();
const VIEW_LABELS: Record<ViewName, string> = { world: "World", tree: "Tree", muller: "Muller", scatter: "Scatter" };
for (const view of ["world", "tree", "muller", "scatter"] as ViewName[]) {
  const btn = document.createElement("button");
  btn.textContent = VIEW_LABELS[view];
  btn.addEventListener("click", () => setActiveView(view));
  tabButtons.set(view, btn);
  tabRow.appendChild(btn);
}

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = CANVAS_SIZE;
  c.height = CANVAS_SIZE;
  return c;
}

function canvasCoords(canvas: HTMLCanvasElement, event: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: ((event.clientX - rect.left) / rect.width) * canvas.width, y: ((event.clientY - rect.top) / rect.height) * canvas.height };
}

const DRAG_THRESHOLD_PX = 4;

/** Distinguishes a genuine click from a camera-orbit drag on a World canvas (SPEC.md Addendum 21)
 * — OrbitControls (see render3d/scene.ts) already handles the actual camera dragging itself by
 * listening on the same canvas element, so this only needs to track whether the mouse moved past
 * DRAG_THRESHOLD_PX between mousedown and mouseup, not perform any camera math itself. Returns
 * consumeDrag(), which the canvas's existing "click" listener calls first: a real drag suppresses
 * that click's tool-use/creature-selection action, since a mousedown+move+up on the same element
 * still fires a native click otherwise. */
function attachClickGuard(canvas: HTMLCanvasElement): { consumeDrag: () => boolean } {
  let tracking = false;
  let dragged = false;
  let start = { x: 0, y: 0 };

  canvas.addEventListener("mousedown", (event) => {
    tracking = true;
    dragged = false;
    start = canvasCoords(canvas, event);
  });

  window.addEventListener("mousemove", (event) => {
    if (!tracking) return;
    const p = canvasCoords(canvas, event);
    if (Math.abs(p.x - start.x) > DRAG_THRESHOLD_PX || Math.abs(p.y - start.y) > DRAG_THRESHOLD_PX) dragged = true;
  });

  window.addEventListener("mouseup", () => {
    tracking = false;
  });

  return {
    consumeDrag: () => {
      const was = dragged;
      dragged = false;
      return was;
    },
  };
}

const worldCanvas = makeCanvas();
const treeCanvas = makeCanvas();
const mullerCanvas = makeCanvas();
const scatterCanvas = makeCanvas();
const canvases: Record<ViewName, HTMLCanvasElement> = {
  world: worldCanvas,
  tree: treeCanvas,
  muller: mullerCanvas,
  scatter: scatterCanvas,
};

canvasArea.append(tabRow, worldCanvas, treeCanvas, mullerCanvas, scatterCanvas);

const sidebar = document.createElement("div");
sidebar.className = "sidebar";

classicRoot.append(canvasArea, sidebar);

// worldCanvas is now a WebGL canvas (see render3d/scene.ts) — no 2D context here anymore, a canvas
// can only ever hand out one context type in its lifetime.
const treeCtx = treeCanvas.getContext("2d")!;
const mullerCtx = mullerCanvas.getContext("2d")!;
const scatterCtx = scatterCanvas.getContext("2d")!;

const runner = new SimRunner(12345);
// SPEC.md Addendum 21 — real 3D World view on Three.js, replacing the flat 2D camera/projection
// system (Addendum 18/20 are both superseded). No camera-reset-on-restart needed the way the old
// 2D CameraState required: OrbitControls' camera position is a user viewing preference that has no
// dependency on world content, and terrainMesh's syncToTerrain already detects a restart's fresh
// TerrainGrid object (see its own doc comment) and rebuilds automatically.
const worldRenderer: WorldRenderer = createWorldRenderer(worldCanvas, runner.sim.params, runner.sim.state);
let activeView: ViewName = "world";
let scatterXGene: keyof Genome = "speed";
let scatterYGene: keyof Genome = "senseRadius";
let traitChartGene: keyof Genome = "speed";

function setActiveView(view: ViewName): void {
  activeView = view;
  for (const [name, btn] of tabButtons) btn.classList.toggle("active", name === view);
  for (const [name, c] of Object.entries(canvases) as [ViewName, HTMLCanvasElement][]) {
    c.style.display = name === view ? "block" : "none";
  }
  render();
}
// Just the tab/visibility bookkeeping for now — render() isn't callable until every panel below
// is constructed (it references controls/godModePanel/treePanel), so the first real render()
// call happens at the bottom of this file instead.
for (const [name, btn] of tabButtons) btn.classList.toggle("active", name === activeView);
for (const [name, c] of Object.entries(canvases) as [ViewName, HTMLCanvasElement][]) {
  c.style.display = name === activeView ? "block" : "none";
}

const controls = createControls({
  onPlayPause: () => controls.setPlaying(runner.togglePlaying()),
  onStep: () => {
    runner.stepOnce();
    controls.setPlaying(false);
    render();
  },
  onSpeedChange: (speed) => runner.setSpeed(speed),
  onRestart: (seed) => {
    runner.restart(seed);
    controls.setInspected(null);
    godModePanel.setActiveTool(null);
    godModePanel.setUndoEnabled(false);
    treePanel.setSelectedSpecies(null, 0, runner.colorOptions, runner.sim.state.evolution.foundingCentroid, []);
    treePanel.setLineageFilterActive(false);
    render();
  },
  onDeuteranopiaToggle: (enabled) => {
    runner.setDeuteranopiaSafe(enabled);
    render();
  },
  // Not yet ported to the 3D World view (SPEC.md Addendum 21) — the old renderCompetitionHeatmap
  // drew directly onto worldCanvas's 2D context, which no longer exists. Checkbox is left wired
  // (not removed from ui/controls.ts) but currently has no visible effect on the World view.
  onCompetitionHeatmapToggle: () => {},
  onAutoPaceToggle: (enabled) => runner.setAutoPace(enabled),
});

const godModePanel = createGodModePanel({
  onToolSelect: (tool) => runner.setActiveTool(tool),
  onRadiusChange: (radius) => (runner.brush.radius = radius),
  onStrengthChange: (strength) => (runner.brush.strength = strength),
  onDurationChange: (durationTicks) => (runner.brush.durationTicks = durationTicks),
  onSeedCountChange: (count) => (runner.brush.seedCount = count),
  onUndoMeteor: () => {
    runner.undoLastMeteor();
    godModePanel.setUndoEnabled(runner.canUndoMeteor());
    render();
  },
});

const treePanel = createTreePanel({
  onMechanismFilterChange: (filter) => {
    runner.setMechanismFilter(filter);
    render();
  },
  onFilterToLineage: () => {
    runner.filterToSelectedLineage();
    treePanel.setLineageFilterActive(true);
    render();
  },
  onClearLineageFilter: () => {
    runner.clearLineageFilter();
    treePanel.setLineageFilterActive(false);
    render();
  },
});

function loadScenarioAndRefresh(parsed: unknown): void {
  const config = parseRunConfig(parsed);
  if (!config) {
    window.alert("That file doesn't look like a Critterbranch scenario.");
    return;
  }
  runner.loadScenario(config);
  controls.setInspected(null);
  godModePanel.setActiveTool(null);
  godModePanel.setUndoEnabled(false);
  treePanel.setSelectedSpecies(null, 0, runner.colorOptions, runner.sim.state.evolution.foundingCentroid, []);
  treePanel.setLineageFilterActive(false);
  render();
}

const scenarioPanel = createScenarioPanel({
  onExport: () => {
    const scenario = runner.exportScenario();
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `critterbranch-scenario-seed${scenario.seed}.json`;
    link.click();
    URL.revokeObjectURL(url);
  },
  onLoad: (file) => {
    file
      .text()
      .then((text) => loadScenarioAndRefresh(JSON.parse(text)))
      .catch(() => window.alert("Couldn't read that file as a scenario."));
  },
  onLoadExample: (name) => {
    // import.meta.env.BASE_URL, not a hardcoded "/", so this still resolves correctly when
    // served from a GitHub Pages project path (see vite.config.ts's `base`).
    fetch(`${import.meta.env.BASE_URL}scenarios/${name}.json`)
      .then((response) => response.json())
      .then((parsed: unknown) => loadScenarioAndRefresh(parsed))
      .catch(() => window.alert(`Couldn't load the "${name}" example scenario.`));
  },
});

const scatterPanel = createScatterPanel(scatterXGene, scatterYGene, {
  onXGeneChange: (gene) => {
    scatterXGene = gene;
    render();
  },
  onYGeneChange: (gene) => {
    scatterYGene = gene;
    render();
  },
});

const eventFeed = createEventFeed();
const geneFlowChart = createGeneFlowChart();
const traitChart = createTraitChart(traitChartGene, (gene) => {
  traitChartGene = gene;
  render();
});

sidebar.append(
  createLegend(),
  controls.root,
  godModePanel.root,
  treePanel.root,
  scatterPanel.root,
  scenarioPanel.root,
  geneFlowChart.root,
  traitChart.root,
  eventFeed.root,
  controls.inspectorRoot,
);
enablePanelWorkspace(sidebar, "classic");

const worldClickGuard = attachClickGuard(worldCanvas);

worldCanvas.addEventListener("click", (event) => {
  if (worldClickGuard.consumeDrag()) return;
  const { x: canvasX, y: canvasY } = canvasCoords(worldCanvas, event);

  if (runner.activeTool) {
    const world = worldRenderer.worldPointAt(canvasX, canvasY, worldCanvas.width, worldCanvas.height);
    if (!world) return; // click landed off the terrain mesh entirely (e.g. past the world edge)
    runner.useToolAt(world.x, world.y);
    godModePanel.setUndoEnabled(runner.canUndoMeteor());
    render();
    return;
  }

  const creature = worldRenderer.findCreatureAt(runner.sim.state, canvasX, canvasY, worldCanvas.width, worldCanvas.height);
  runner.select(creature?.id ?? null);
  controls.setInspected(creature);
  render();
});

treeCanvas.addEventListener("click", (event) => {
  const rect = treeCanvas.getBoundingClientRect();
  const canvasX = ((event.clientX - rect.left) / rect.width) * treeCanvas.width;
  const canvasY = ((event.clientY - rect.top) / rect.height) * treeCanvas.height;

  const speciesId = findBranchAt(runner.sim.state, treeCanvas.width, canvasX, canvasY);
  runner.selectSpecies(speciesId);
  render();
});

scatterCanvas.addEventListener("click", (event) => {
  const rect = scatterCanvas.getBoundingClientRect();
  const canvasX = ((event.clientX - rect.left) / rect.width) * scatterCanvas.width;
  const canvasY = ((event.clientY - rect.top) / rect.height) * scatterCanvas.height;

  const creature = findPointAt(
    runner.sim.state,
    { xGene: scatterXGene, yGene: scatterYGene, lineageFilter: runner.lineageFilter },
    canvasX,
    canvasY,
    scatterCanvas.width,
    scatterCanvas.height,
  );
  runner.select(creature?.id ?? null);
  controls.setInspected(creature);
  render();
});

function render(): void {
  // Only the currently-visible canvas needs to actually redraw each frame — Tree/Muller cost
  // scales with species count (small) rather than population (not small), but there's no reason
  // to pay even that when the tab isn't showing.
  if (activeView === "world") {
    worldRenderer.render(runner.sim.state, runner.sim.params, {
      colorOptions: runner.colorOptions,
      selectedCreatureId: runner.selectedCreatureId,
      lineageFilter: runner.lineageFilter,
    });
    // showCompetitionHeatmap intentionally not read here — see its declaration above.
  } else if (activeView === "tree") {
    renderTree(treeCtx, runner.sim.state, {
      colorOptions: runner.colorOptions,
      selectedSpeciesId: runner.selectedSpeciesId,
      mechanismFilter: runner.mechanismFilter,
    });
  } else if (activeView === "muller") {
    renderMuller(mullerCtx, runner.sim.state, runner.colorOptions);
  } else {
    renderScatter(scatterCtx, runner.sim.state, {
      xGene: scatterXGene,
      yGene: scatterYGene,
      colorOptions: runner.colorOptions,
      selectedCreatureId: runner.selectedCreatureId,
      lineageFilter: runner.lineageFilter,
    });
  }

  let livingSpeciesCount = 0;
  for (const species of runner.sim.state.observations.taxonomy.species.values()) {
    if (species.extinctTick === null) livingSpeciesCount++;
  }
  controls.setStatus(runner.sim.state.evolution.tick, runner.sim.state.evolution.creatures.length, livingSpeciesCount, runner.isFastForwarding());
  eventFeed.setEvents(runner.sim.state.observations.taxonomyEvents);
  geneFlowChart.render(runner.sim.state.observations.geneFlow.history);
  traitChart.render(runner.sim.state.observations.traitHistory, traitChartGene);
  const selectedSpecies = runner.selectedSpecies();
  const selectedCapabilities = selectedSpecies
    ? (() => {
        const { profiles, baseline } = computeSpeciesProfiles(runner.sim);
        const profile = profiles.get(selectedSpecies.id);
        return profile ? classifySpecies(profile, baseline) : [];
      })()
    : [];
  treePanel.setSelectedSpecies(selectedSpecies, runner.sim.state.evolution.tick, runner.colorOptions, runner.sim.state.evolution.foundingCentroid, selectedCapabilities);

  if (runner.selectedCreatureId !== null) {
    controls.setInspected(runner.selectedCreature());
  }
}

function frame(): void {
  runner.advance();
  render();
}

// setInterval rather than requestAnimationFrame: rAF can be fully suspended for a backgrounded
// or otherwise non-visible tab, and this loop should keep advancing regardless of tab focus.
render();
setInterval(frame, 16);

// --- Game Mode: the terraform -> advance era -> discovery loop (src/game/), a separate
// interaction model from the classic sandbox's continuous play/pause/speed loop above. Shares
// nothing at runtime with `runner` — see app/gameRunner.ts's class doc for why.

const GAME_COLOR_OPTIONS: ColorOptions = { deuteranopiaSafe: false, divergenceScale: 0.35 };

const gameCanvas = makeCanvas();
// gameCanvas is a WebGL canvas (see render3d/scene.ts) — no 2D context here, same as worldCanvas.
const gameCanvasArea = document.createElement("div");
gameCanvasArea.className = "canvas-area";
gameCanvasArea.appendChild(gameCanvas);

const gameSidebar = document.createElement("div");
gameSidebar.className = "sidebar";

gameRoot.append(gameCanvasArea, gameSidebar);

let gameRunner = new GameRunner("sandbox", 12345);
// SPEC.md Addendum 21 — same 3D World renderer as Classic Sandbox, its own independent instance
// (own camera/controls/terrain-mesh cache). Reassigning gameRunner on restart (below) doesn't need
// a matching reassignment here — render() always passes the CURRENT gameRunner.game.sim
// state/params in fresh each call, and the terrain mesh cache already detects a restart's new
// TerrainGrid object on its own (see terrainMesh.ts's syncToTerrain doc comment).
const gameWorldRenderer: WorldRenderer = createWorldRenderer(gameCanvas, gameRunner.game.sim.params, gameRunner.game.sim.state);

const gameGodModePanel = createGodModePanel(
  {
    onToolSelect: (tool) => gameRunner.setActiveTool(tool),
    onRadiusChange: (radius) => (gameRunner.brush.radius = radius),
    onStrengthChange: (strength) => (gameRunner.brush.strength = strength),
    onDurationChange: (durationTicks) => (gameRunner.brush.durationTicks = durationTicks),
    onSeedCountChange: (count) => (gameRunner.brush.seedCount = count),
    onUndoMeteor: () => {},
  },
  false, // Game Mode has no meteor-undo checkpoint machinery — see gameRunner.ts.
);

const gameControls = createGameControlsPanel(PROTOTYPE_CHALLENGES, {
  onRestart: (seed, mode, challengeId) => {
    const challenge = challengeId ? PROTOTYPE_CHALLENGES.find((c) => c.id === challengeId) : undefined;
    gameRunner = new GameRunner(mode, seed, challenge);
    gameGodModePanel.setActiveTool(null);
    renderGame();
  },
  onAdvanceEra: () => {
    gameRunner.advanceEra();
    renderGame();
  },
  onContinue: () => {
    gameRunner.continueToTerraform();
    renderGame();
  },
  onSpeedChange: (speed) => gameRunner.setSpeed(speed),
});

const eraSummaryPanel = createEraSummaryPanel();
const objectivesPanel = createObjectivesPanel();
const checkpointsPanel = createCheckpointsPanel({
  onSave: (name) => {
    gameRunner.saveCheckpoint(name);
    renderGame();
  },
  onRestore: (id) => {
    gameRunner.restoreCheckpoint(id);
    gameGodModePanel.setActiveTool(null);
    renderGame();
  },
  onDelete: (id) => {
    gameRunner.deleteCheckpoint(id);
    renderGame();
  },
});

gameSidebar.append(gameControls.root, gameGodModePanel.root, objectivesPanel.root, eraSummaryPanel.root, checkpointsPanel.root);
enablePanelWorkspace(gameSidebar, "game");

const gameClickGuard = attachClickGuard(gameCanvas);

gameCanvas.addEventListener("click", (event) => {
  if (gameClickGuard.consumeDrag()) return;
  if (!gameRunner.activeTool) return;
  const { x: canvasX, y: canvasY } = canvasCoords(gameCanvas, event);
  const world = gameWorldRenderer.worldPointAt(canvasX, canvasY, gameCanvas.width, gameCanvas.height);
  if (!world) return;
  gameRunner.useToolAt(world.x, world.y);
  renderGame();
});

function renderGame(): void {
  const { game } = gameRunner;
  gameWorldRenderer.render(game.sim.state, game.sim.params, {
    colorOptions: GAME_COLOR_OPTIONS,
    selectedCreatureId: null,
    lineageFilter: null,
  });

  let livingSpeciesCount = 0;
  for (const species of game.sim.state.observations.taxonomy.species.values()) {
    if (species.extinctTick === null) livingSpeciesCount++;
  }
  gameControls.setStatus(
    game.gameState.era,
    game.gameState.phase,
    game.sim.state.evolution.tick,
    game.sim.state.evolution.creatures.length,
    livingSpeciesCount,
  );
  gameControls.setBudget(game.budget?.remaining ?? null);
  gameControls.setAdvanceEnabled(gameRunner.canAdvanceEra());
  gameControls.setContinueEnabled(gameRunner.canContinueToTerraform());
  gameControls.setProgress(gameRunner.eraProgress());
  gameControls.setTerraformError(gameRunner.lastTerraformError);
  eraSummaryPanel.setSummary(gameRunner.lastEraSummary);
  objectivesPanel.setChallenge(gameRunner.objectives(), gameRunner.challengeStatus());
  checkpointsPanel.setCheckpoints(gameRunner.listCheckpoints());
}

function gameFrame(): void {
  gameRunner.stepEraAdvance();
  renderGame();
}

// Same "keep advancing regardless of tab focus" reasoning as the classic sandbox's frame() loop
// above — a player mid-era-advance who switches to the Classic tab shouldn't come back to find
// it paused.
renderGame();
setInterval(gameFrame, 16);
