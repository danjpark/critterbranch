import "./style.css";
import { SimRunner } from "./app/simRunner.ts";
import { DEFAULT_PARAMS } from "./params.ts";
import { findCreatureAt, renderWorld } from "./render/worldView.ts";
import { createControls, createLegend } from "./ui/controls.ts";

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
    render();
  },
  onDeuteranopiaToggle: (enabled) => {
    runner.setDeuteranopiaSafe(enabled);
    render();
  },
});

sidebar.append(createLegend(), controls.root, controls.inspectorRoot);

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const canvasX = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const canvasY = ((event.clientY - rect.top) / rect.height) * canvas.height;
  const creature = findCreatureAt(runner.sim.state, DEFAULT_PARAMS, canvasX, canvasY, canvas.width, canvas.height);
  runner.select(creature?.id ?? null);
  controls.setInspected(creature);
  render();
});

function render(): void {
  renderWorld(ctx, runner.sim.state, DEFAULT_PARAMS, {
    colorOptions: runner.colorOptions,
    selectedCreatureId: runner.selectedCreatureId,
  });
  controls.setStatus(runner.sim.state.tick, runner.sim.state.creatures.length);

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
