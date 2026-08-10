import "./style.css";
import { isScenario, SimRunner } from "./app/simRunner.ts";
import { DEFAULT_PARAMS } from "./params.ts";
import { findCreatureAt, invalidateTerrainCache, renderWorld } from "./render/worldView.ts";
import { createControls, createEventFeed, createGeneFlowChart, createGodModePanel, createLegend, createScenarioPanel } from "./ui/controls.ts";

const CANVAS_SIZE = 640;

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = "";

const canvas = document.createElement("canvas");
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

const sidebar = document.createElement("div");
sidebar.className = "sidebar";

app.append(canvas, sidebar);

const ctx = canvas.getContext("2d")!;
const runner = new SimRunner(12345);

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
    render();
  },
  onDeuteranopiaToggle: (enabled) => {
    runner.setDeuteranopiaSafe(enabled);
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

function loadScenarioAndRefresh(parsed: unknown): void {
  if (!isScenario(parsed)) {
    window.alert("That file doesn't look like a Critterbranch scenario.");
    return;
  }
  runner.loadScenario(parsed);
  controls.setInspected(null);
  godModePanel.setActiveTool(null);
  godModePanel.setUndoEnabled(false);
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

const eventFeed = createEventFeed();
const geneFlowChart = createGeneFlowChart();

sidebar.append(
  createLegend(),
  controls.root,
  godModePanel.root,
  scenarioPanel.root,
  geneFlowChart.root,
  eventFeed.root,
  controls.inspectorRoot,
);

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const canvasX = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const canvasY = ((event.clientY - rect.top) / rect.height) * canvas.height;

  if (runner.activeTool) {
    const scaleX = canvas.width / DEFAULT_PARAMS.worldWidth;
    const scaleY = canvas.height / DEFAULT_PARAMS.worldHeight;
    runner.useToolAt(canvasX / scaleX, canvasY / scaleY);
    godModePanel.setUndoEnabled(runner.canUndoMeteor());
    render();
    return;
  }

  const creature = findCreatureAt(runner.sim.state, DEFAULT_PARAMS, canvasX, canvasY, canvas.width, canvas.height);
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

  renderWorld(ctx, runner.sim.state, DEFAULT_PARAMS, {
    colorOptions: runner.colorOptions,
    selectedCreatureId: runner.selectedCreatureId,
  });

  let livingSpeciesCount = 0;
  for (const species of runner.sim.state.taxonomy.species.values()) {
    if (species.extinctTick === null) livingSpeciesCount++;
  }
  controls.setStatus(runner.sim.state.tick, runner.sim.state.creatures.length, livingSpeciesCount);
  eventFeed.setEvents(runner.sim.state.taxonomyEvents);
  geneFlowChart.render(runner.sim.state.geneFlow.history);

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
