import "./style.css";
import { GameRunner } from "./app/gameRunner.ts";
import { SimRunner } from "./app/simRunner.ts";
import { PROTOTYPE_CHALLENGES } from "./game/challenges/prototypeChallenges.ts";
import type { ColorOptions } from "./render/color.ts";
import { renderMuller } from "./render/mullerView.ts";
import { renderCompetitionHeatmap } from "./render/overlays.ts";
import { findPointAt, renderScatter } from "./render/scatterView.ts";
import { findBranchAt, renderTree } from "./render/treeView.ts";
import { findCreatureAt, renderWorld } from "./render/worldView.ts";
import type { Genome } from "./sim/genome.ts";
import { parseRunConfig } from "./sim/runConfig.ts";
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
  classicRoot.style.display = mode === "classic" ? "flex" : "none";
  gameRoot.style.display = mode === "game" ? "flex" : "none";
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

const worldCtx = worldCanvas.getContext("2d")!;
const treeCtx = treeCanvas.getContext("2d")!;
const mullerCtx = mullerCanvas.getContext("2d")!;
const scatterCtx = scatterCanvas.getContext("2d")!;

const runner = new SimRunner(12345);
let activeView: ViewName = "world";
let scatterXGene: keyof Genome = "dietPref";
let scatterYGene: keyof Genome = "senseRadius";
let showCompetitionHeatmap = false;
let traitChartGene: keyof Genome = "dietPref";

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
    treePanel.setSelectedSpecies(null, 0, runner.colorOptions, runner.sim.state.evolution.foundingCentroid);
    treePanel.setLineageFilterActive(false);
    render();
  },
  onDeuteranopiaToggle: (enabled) => {
    runner.setDeuteranopiaSafe(enabled);
    render();
  },
  onCompetitionHeatmapToggle: (enabled) => {
    showCompetitionHeatmap = enabled;
    render();
  },
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
  treePanel.setSelectedSpecies(null, 0, runner.colorOptions, runner.sim.state.evolution.foundingCentroid);
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

worldCanvas.addEventListener("click", (event) => {
  const rect = worldCanvas.getBoundingClientRect();
  const canvasX = ((event.clientX - rect.left) / rect.width) * worldCanvas.width;
  const canvasY = ((event.clientY - rect.top) / rect.height) * worldCanvas.height;

  if (runner.activeTool) {
    const scaleX = worldCanvas.width / runner.sim.params.worldWidth;
    const scaleY = worldCanvas.height / runner.sim.params.worldHeight;
    runner.useToolAt(canvasX / scaleX, canvasY / scaleY);
    godModePanel.setUndoEnabled(runner.canUndoMeteor());
    render();
    return;
  }

  const creature = findCreatureAt(runner.sim.state, runner.sim.params, canvasX, canvasY, worldCanvas.width, worldCanvas.height);
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
    renderWorld(worldCtx, runner.sim.state, runner.sim.params, {
      colorOptions: runner.colorOptions,
      selectedCreatureId: runner.selectedCreatureId,
      lineageFilter: runner.lineageFilter,
    });
    if (showCompetitionHeatmap) {
      renderCompetitionHeatmap(worldCtx, runner.sim.state, runner.sim.params, runner.colorOptions);
    }
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
  controls.setStatus(runner.sim.state.evolution.tick, runner.sim.state.evolution.creatures.length, livingSpeciesCount);
  eventFeed.setEvents(runner.sim.state.observations.taxonomyEvents);
  geneFlowChart.render(runner.sim.state.observations.geneFlow.history);
  traitChart.render(runner.sim.state.observations.traitHistory, traitChartGene);
  treePanel.setSelectedSpecies(runner.selectedSpecies(), runner.sim.state.evolution.tick, runner.colorOptions, runner.sim.state.evolution.foundingCentroid);

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
const gameCtx = gameCanvas.getContext("2d")!;
const gameCanvasArea = document.createElement("div");
gameCanvasArea.className = "canvas-area";
gameCanvasArea.appendChild(gameCanvas);

const gameSidebar = document.createElement("div");
gameSidebar.className = "sidebar";

gameRoot.append(gameCanvasArea, gameSidebar);

let gameRunner = new GameRunner("sandbox", 12345);

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

gameCanvas.addEventListener("click", (event) => {
  if (!gameRunner.activeTool) return;
  const rect = gameCanvas.getBoundingClientRect();
  const canvasX = ((event.clientX - rect.left) / rect.width) * gameCanvas.width;
  const canvasY = ((event.clientY - rect.top) / rect.height) * gameCanvas.height;
  const scaleX = gameCanvas.width / gameRunner.game.sim.params.worldWidth;
  const scaleY = gameCanvas.height / gameRunner.game.sim.params.worldHeight;
  gameRunner.useToolAt(canvasX / scaleX, canvasY / scaleY);
  renderGame();
});

function renderGame(): void {
  const { game } = gameRunner;
  renderWorld(gameCtx, game.sim.state, game.sim.params, {
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
