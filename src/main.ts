import "./style.css";
import { DEFAULT_COLOR_OPTIONS } from "./render/color.ts";
import { findCreatureAt, renderWorld } from "./render/worldView.ts";
import { createSimState, tick, type SimInstance } from "./sim/sim.ts";
import { createControls, type SpeedSetting } from "./ui/controls.ts";
import { DEFAULT_PARAMS } from "./ui/params.ts";

const CANVAS_SIZE = 640;
const MAX_SPEED_BUDGET_MS = 40;

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = "";

const canvas = document.createElement("canvas");
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

const sidebar = document.createElement("div");
sidebar.className = "sidebar";

app.append(canvas, sidebar);

const ctx = canvas.getContext("2d")!;

let sim: SimInstance = createSimState(12345, DEFAULT_PARAMS);
let playing = false;
let speed: SpeedSetting = 1;
let selectedCreatureId: number | null = null;

const controls = createControls({
  onPlayPause: () => {
    playing = !playing;
    controls.setPlaying(playing);
  },
  onStep: () => {
    playing = false;
    controls.setPlaying(false);
    tick(sim.state, sim.rng, DEFAULT_PARAMS);
    render();
  },
  onSpeedChange: (newSpeed) => {
    speed = newSpeed;
  },
  onRestart: (seed) => {
    sim = createSimState(seed, DEFAULT_PARAMS);
    selectedCreatureId = null;
    controls.setInspected(null);
    render();
  },
  onDeuteranopiaToggle: (enabled) => {
    colorOptions.deuteranopiaSafe = enabled;
    render();
  },
});

sidebar.append(controls.root, controls.inspectorRoot);

const colorOptions = { ...DEFAULT_COLOR_OPTIONS };

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const canvasX = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const canvasY = ((event.clientY - rect.top) / rect.height) * canvas.height;
  const creature = findCreatureAt(sim.state, DEFAULT_PARAMS, canvasX, canvasY, canvas.width, canvas.height);
  selectedCreatureId = creature?.id ?? null;
  controls.setInspected(creature);
  render();
});

function render(): void {
  renderWorld(ctx, sim.state, DEFAULT_PARAMS, { colorOptions, selectedCreatureId });
  controls.setStatus(sim.state.tick, sim.state.creatures.length);

  if (selectedCreatureId !== null) {
    const stillAlive = sim.state.creatures.find((c) => c.id === selectedCreatureId) ?? null;
    controls.setInspected(stillAlive);
    if (!stillAlive) selectedCreatureId = null;
  }
}

function advance(): void {
  if (speed === "max") {
    const start = performance.now();
    while (performance.now() - start < MAX_SPEED_BUDGET_MS) {
      tick(sim.state, sim.rng, DEFAULT_PARAMS);
    }
  } else {
    for (let i = 0; i < speed; i++) {
      tick(sim.state, sim.rng, DEFAULT_PARAMS);
    }
  }
}

function frame(): void {
  if (playing) {
    advance();
  }
  render();
}

// setInterval rather than requestAnimationFrame: rAF can be fully suspended for a backgrounded
// or otherwise non-visible tab, and this loop should keep advancing regardless of tab focus.
render();
setInterval(frame, 16);
