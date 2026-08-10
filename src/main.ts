import "./style.css";
import { isScenario, SimRunner } from "./app/simRunner.ts";
import { DEFAULT_PARAMS } from "./params.ts";
import { renderMuller } from "./render/mullerView.ts";
import { renderCompetitionHeatmap } from "./render/overlays.ts";
import { findPointAt, renderScatter } from "./render/scatterView.ts";
import { findBranchAt, renderTree } from "./render/treeView.ts";
import { findCreatureAt, invalidateTerrainCache, renderWorld } from "./render/worldView.ts";
import type { Genome } from "./sim/genome.ts";
import {
  createControls,
  createEventFeed,
  createGeneFlowChart,
  createGodModePanel,
  createLegend,
  createScatterPanel,
  createScenarioPanel,
  createTraitChart,
  createTreePanel,
} from "./ui/controls.ts";

const CANVAS_SIZE = 640;
type ViewName = "world" | "tree" | "muller" | "scatter";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = "";

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

app.append(canvasArea, sidebar);

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
    treePanel.setSelectedSpecies(null, 0, runner.colorOptions, runner.sim.state.foundingCentroid);
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
  if (!isScenario(parsed)) {
    window.alert("That file doesn't look like a Critterbranch scenario.");
    return;
  }
  runner.loadScenario(parsed);
  controls.setInspected(null);
  godModePanel.setActiveTool(null);
  godModePanel.setUndoEnabled(false);
  treePanel.setSelectedSpecies(null, 0, runner.colorOptions, runner.sim.state.foundingCentroid);
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
    const scaleX = worldCanvas.width / DEFAULT_PARAMS.worldWidth;
    const scaleY = worldCanvas.height / DEFAULT_PARAMS.worldHeight;
    runner.useToolAt(canvasX / scaleX, canvasY / scaleY);
    godModePanel.setUndoEnabled(runner.canUndoMeteor());
    render();
    return;
  }

  const creature = findCreatureAt(runner.sim.state, DEFAULT_PARAMS, canvasX, canvasY, worldCanvas.width, worldCanvas.height);
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
  // Terrain is normally cached (see worldView.ts) since it's static — but an in-progress god-mode
  // effect (barrier still forming, crater still recovering) changes it every tick, so the cache
  // must be invalidated every frame while any of those are active.
  if (runner.sim.state.activeTransitions.length > 0) {
    invalidateTerrainCache(runner.sim.state.terrain);
  }

  // Only the currently-visible canvas needs to actually redraw each frame — Tree/Muller cost
  // scales with species count (small) rather than population (not small), but there's no reason
  // to pay even that when the tab isn't showing.
  if (activeView === "world") {
    renderWorld(worldCtx, runner.sim.state, DEFAULT_PARAMS, {
      colorOptions: runner.colorOptions,
      selectedCreatureId: runner.selectedCreatureId,
      lineageFilter: runner.lineageFilter,
    });
    if (showCompetitionHeatmap) {
      renderCompetitionHeatmap(worldCtx, runner.sim.state, DEFAULT_PARAMS, runner.colorOptions);
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
  for (const species of runner.sim.state.taxonomy.species.values()) {
    if (species.extinctTick === null) livingSpeciesCount++;
  }
  controls.setStatus(runner.sim.state.tick, runner.sim.state.creatures.length, livingSpeciesCount);
  eventFeed.setEvents(runner.sim.state.taxonomyEvents);
  geneFlowChart.render(runner.sim.state.geneFlow.history);
  traitChart.render(runner.sim.state.traitHistory, traitChartGene);
  treePanel.setSelectedSpecies(runner.selectedSpecies(), runner.sim.state.tick, runner.colorOptions, runner.sim.state.foundingCentroid);

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
