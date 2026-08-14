# Evolution Simulator — Build Spec (v2)

Paste this into Claude Code as the initial prompt, or drop it in the repo root as `SPEC.md` and tell Claude Code to work through it phase by phase.

---

## What we're building

A browser-based, deterministic, agent-based evolution simulator. Digital organisms forage in a 2D world. Traits are heritable and mutate on reproduction. Over tens of thousands of ticks the population should **split on its own** into distinct lineages, and the app should render that history as a phylogenetic tree.

The primary deliverable is the tree. The world view exists to make the tree believable; the tree is the product.

## Non-goals

- No physics engine, no ragdolls, no limb/gait evolution.
- No neural networks in v1. Behavior is a small set of scalar genes driving a hand-written policy.
- No server, no database. Everything runs client-side.
- No 3D.

---

## Founding populations

`foundingPopulations` is a config parameter, not a constant. It takes:

- `count` — how many founding groups to seed (default **1**).
- Per-group: `size`, `startingGenome` (explicit values or `random`), `startPosition` (`random` | `clustered` | explicit coords).

Default to 1. Two founders with identical genomes is just one founder with more individuals. Two founders with *different* genomes is a legitimate experiment, but it answers a different question — competitive exclusion, "does the pre-adapted specialist beat the generalist" — not "can a population speciate on its own." Both are worth running; keep them separate in your head. The tree from a 2-founder run has two roots and a forest, not a tree, so the tree view must handle multiple roots.

---

## The tree is shaped by trade-off axes — read this before writing code

A phylogenetic tree only branches where the population faces a choice between two strategies that cannot be combined. Each such **trade-off axis**, if selection on it is disruptive, produces one binary split. One axis gives you two branches and then a flat line forever. That is a boring tree.

To get a bushy tree you need multiple *independent* axes, each with its own disruptive pressure. Three axes can in principle produce up to eight tips. This spec builds in three.

### Axis 1 — Diet (what you eat)

Gene: `dietPref` (0 = food type R, 1 = food type B).

Energy from eating food of type `f`:

```
gain = maxGain * (1 - abs(dietPref - f)) ^ specializationExponent
```

With `specializationExponent > 1`, a generalist at `dietPref = 0.5` does *worse* than the average of the two specialists. That penalty on the middle is what forces the split. Sweeping this slider from 0.8 to 3.0 should visibly turn a one-species run into a two-species run. That sweep is the money demo.

### Axis 2 — Foraging strategy (how you find it)

Genes: `speed`, `senseRadius`, `wanderPersistence`.

The trade-off only exists if the world has **two kinds of patch geometry**: a few large, rich, widely-separated patches and many small, poor, densely-scattered ones. Then:

- *Commuter* strategy: high `speed`, low `senseRadius`, high `wanderPersistence` — cover ground, travel between rich patches.
- *Camper* strategy: low `speed`, high `senseRadius`, low `wanderPersistence` — sit in a dense field of small patches and sweep locally.

Both are viable; the blend is worse than either, because paying for speed *and* sense at once starves you. Config knob: `patchBimodality` — 0 makes all patches identical (axis collapses), 1 makes the two patch classes maximally different.

### Axis 3 — Life history (how you reproduce)

Genes: `reproThreshold`, `offspringInvestment`.

`offspringInvestment` sets how much energy each child receives and how many children per split. Low investment = many cheap offspring that die easily; high investment = few well-provisioned offspring. This axis needs **temporal** structure to bite: make food regrowth oscillate with a configurable period and amplitude (`regrowthCyclePeriod`, `regrowthCycleAmplitude`). Cheap-and-many wins the boom, expensive-and-few survives the bust. Under a constant food supply this axis flattens and you get one strategy — that is the correct behavior and a useful control.

### Optional Axis 4 — Predation

Only after Phase 5 works. Add a `predatory` gene and let creatures eat each other; size becomes both weapon and target. Powerful for tree richness, but it destabilizes the population dynamics badly and can collapse a run to zero. Do not add this until the three-axis version runs reliably.

**The key implication:** if the tree comes out as a single split and then two flat lines, the problem is almost never the tree code. It is that only one axis has real disruptive pressure. Check `specializationExponent`, `patchBimodality`, and `regrowthCycleAmplitude` before touching the renderer.

---

## What the tree actually looks like

A concrete expected run at defaults, so you know what you're aiming at:

- **Tick 0–3,000.** One founding blob. `speed` and `senseRadius` settle toward whatever is metabolically efficient. No branch — this is directional selection, not disruptive. The tree is a single trunk.
- **Tick ~15,000.** `dietPref` goes bimodal. **First branch.** Trunk splits into `sp-1` (R-eater) and `sp-2` (B-eater).
- **Tick ~35,000.** Inside `sp-1`, the patch geometry splits it: `sp-3` commuters and `sp-4` campers. **Second branch,** on a different axis, at a different depth.
- **Tick ~55,000.** A food bust arrives. `sp-2` had drifted to cheap-and-many and crashes — its branch **terminates**. A survivor sublineage `sp-5` had higher `offspringInvestment` and continues.
- **Tick 80,000.** Four tips alive, one extinct branch, three internal nodes.

Each node in the rendered tree should be clickable and show a card: founding genome, peak population, lifespan in ticks, and which gene had the largest deviation from its parent species. That last field is what makes the tree *readable* — it labels each branch with the trait that caused it, which is exactly the thing you said you couldn't picture. A branch is not an abstraction; it is a sentence like "at tick 35,200 this lineage split because sense radius diverged by 2.4 sigma."

---

## Making interaction visible

Creatures in this design do not touch each other. They compete **indirectly**, by depleting shared food. That is real competition, but it is invisible unless you render it. Build these:

1. **World view** — creatures as dots colored by species, food as small squares colored by type. Click a creature to pin an inspector. This is the x/y map; it stays.
2. **Competition heatmap overlay** — a toggleable layer over the world showing, per grid cell, food consumed in the last N ticks, colored by which species ate it. Contested cells render as a blend. This is where you actually *see* two lineages fighting over the same patch, and where you see them stop fighting once they've specialized apart.
3. **Territory overlay** — per grid cell, the dominant species by creature-ticks spent there. Watch niches separate in space.

The competition heatmap is the one to build. It turns "they compete for food" from an assertion in the code into something on screen.

---

## Color encoding

Color carries two different jobs here, and one channel cannot do both. **Genotype** is continuous — it should drift smoothly and show convergence. **Species identity** is discrete — it should let you tell two lineages apart at a glance even when they've barely diverged. Encode them separately.

- **Fill = genotype.** A pure function of the genome. Two creatures with the same genes are the same color, always, regardless of ancestry.
- **Ring = species.** A 1–2px outline drawn in a categorical palette, assigned per `lineageId`, cycling through a fixed high-contrast set.

Provide a toggle for which reads dominant (thick ring / thin ring / ring off). Default to both on.

### The genotype mapping

Do **not** map three genes to raw R, G, B. sRGB is not perceptually uniform: the green channel dominates perceived lightness, blue variation is nearly invisible on small dots, and equal gene distance produces wildly unequal visual distance. A big divergence on the blue-mapped gene would look like nothing at all. RYB has the same problem plus a nonlinear conversion step and muddy browns wherever all three mix.

Use **OkLCh**, which is perceptually uniform. Convert to sRGB at draw time.

| Channel | Source | Rationale |
|---|---|---|
| **Hue** | `atan2(axis2Position, axis1Position)` — angle in the diet × foraging plane | Strategy *combination* becomes a hue angle. Circular and seamless, no wraparound artifact. |
| **Chroma** | normalized genetic distance from the founding ancestor centroid, clamped 0.02–0.20 | Directly implements "the more it diverges, the more it changes." The founding population renders near-gray; derived lineages get vivid. Divergence is legible across the whole map at a glance. |
| **Lightness** | third axis (life history), remapped into a narrow band, ~0.45–0.75 | Kept narrow so dots stay readable against terrain in both directions. |

Expose the channel assignments as dropdowns so any gene can be reassigned to any channel. Someone will want hue on life history eventually.

### Consequences to expect, not fix

Because fill is purely genotypic, two unrelated lineages that converge on the same strategy will render nearly identical despite being distant cousins. That is not a bug — it makes convergent evolution visible, which is one of the more interesting things this sim can show you. The species ring is what disambiguates them. Expect to be briefly confused by it the first time.

### Contrast constraints

- Render terrain **desaturated** — grayscale shaded relief with at most a faint tint. Creatures own the entire saturation budget of the frame. If terrain is colorful, the genotype encoding becomes unreadable, and terrain is background information.
- Every creature gets a thin dark outline underneath the species ring so light-lightness individuals don't vanish over pale ground.
- Food keeps a fixed, distinct visual language — small squares, fixed R/B colors — so it never competes with the creature hue scale.
- Offer a **deuteranopia-safe mode** that restricts hue to the blue↔orange arc instead of the full wheel. Red-green deficiency affects roughly 8% of men, and if diet maps to a red/green hue split, the primary axis is invisible to them.

### The legend is the gene-space scatter

Do not draw a separate legend widget. Color the gene-space scatter plot with the exact same function, and it becomes a live legend: every point sits at its own genome position wearing its own color, so the mapping explains itself and updates as the population moves. Label the axes and you're done.

### Use the same colors everywhere

Same fill function in the world view, the scatter, the Muller plot bands, and the phylogenetic tree branches. Cross-view color identity is what lets you look at a branch in the tree and immediately find those creatures on the map. Each tree node card shows its founding color as a swatch next to its current one — that pair *is* the visual record of how far that lineage has traveled.

---

## Terrain — promote this to a core system

Terrain is not decoration and not a god-mode toy. It is the **primary species-creation mechanism** in this app, and it should be built before the fine-tuning work in Phase 3.

There are three ways a lineage splits, and the app should support and distinguish all three:

- **Allopatric** — a physical barrier cuts the population in two, gene flow stops, the halves drift and adapt apart. Reliable, fast, easy to see, easy to cause on purpose.
- **Sympatric** — disruptive selection splits a population sharing one space (the three trade-off axes above). Real but finicky; needs well-tuned parameters and often just doesn't fire.
- **Founder effect** — a small group gets isolated and diverges mostly by drift, not selection. Very likely at populations of 100 or fewer.

The original spec leaned entirely on sympatric speciation, which is the hardest of the three. Adding terrain barriers means the app has a mechanism that works on demand.

### Terrain layer

A per-cell grid parallel to the food grid:

- `elevation` (0..1) — rendered as a shaded relief.
- `passability` (0..1), derived from elevation — movement cost multiplier. **Not a binary wall.** A ridge at passability 0.15 lets a trickle of migrants through; at 0.0 it's absolute. The partial-barrier case is the interesting one, because you get to watch a lineage split slowly with gene flow fighting divergence.
- `fertility` (0..1) — multiplies local food regrowth. Mountains are barren; valleys are rich. This makes terrain shape selection, not just block movement.

Terrain must be part of the serialized world state and part of the determinism hash.

## God-mode tools

Interactive brushes over the world view. Each one is an **event**, not a mutation of hidden state.

- **Raise / lower terrain** — brush with adjustable radius and strength. The headline tool.
- **Drop food** — place a patch of type R or B, with density and radius.
- **Drought / bloom** — scale regrowth in the brushed region.
- **Meteor** — instant kill of everything in a radius, plus a crater: elevation drop, fertility zeroed locally, then recovering over `craterRecoveryTicks`.
- **Seed founders** — drop N creatures with a chosen genome anywhere. Lets you run controlled invasion experiments.
- **Barrier stamp** — draw an impassable line directly, for clean allopatric experiments without sculpting.

### Interventions must be logged as replayable events

This is the requirement most likely to be skipped and it will cost you the whole project's reproducibility.

Every god action appends `{ tick, tool, params }` to an intervention log stored with the run. `runSimulation(seed, params, interventionLog)` must reproduce the run exactly, headlessly, with no user present. Without this, the first time you sculpt a mountain that produces a beautiful four-way radiation, that run is gone forever and cannot be re-examined, exported, or shown to anyone.

Corollary: the intervention log is also a saved "scenario." Ship two or three — a barrier-split scenario, a meteor-radiation scenario — as JSON files that load and play.

### On the meteor specifically

Its value is not spectacle. A mass extinction empties niches, and the survivors radiate into them — that is the single bushiest tree-producing event available. Strike, then watch a handful of survivor lineages fan out. Give the meteor a preview ring and an undo-to-last-checkpoint, because it's the one tool that can end a run you cared about.

## Tag every speciation event with its mechanism

Since the goal is understanding *how* species get created, each speciation event should record why, inferred from the state at that tick:

- `allopatric` — the two sub-clusters were spatially separated by a low-passability region at the time of divergence.
- `sympatric` — sub-clusters overlapped spatially; divergence tracked a trade-off axis.
- `founder` — the new lineage started from fewer than `founderCountThreshold` individuals and its divergence is spread across genes with no single dominant axis (drift signature).

Render the mechanism as branch color or icon in the tree, and let the tree be filtered by it. Also emit a plain-language event feed: "Tick 22,400 — allopatric split; population of 34 isolated west of the ridge; sense radius diverging." That feed, scrolling next to the map, is the thing that actually explains speciation to you.

### Gene-flow meter

One chart, and it's the instrument that makes the mechanism visible: **migration rate between defined regions over time**, and for the sexual-reproduction variant, cross-region breeding rate. Speciation *is* the moment that line goes to zero. Watching it decay after you raise a mountain is the clearest possible answer to "how are species created."

---

## Stack

- Vite + TypeScript, vanilla DOM for controls. No React in v1 — the sim loop must not be tied to a render framework.
- Rendering: Canvas 2D. One canvas for the world, separate canvases for charts.
- Zero runtime dependencies. If a chart genuinely needs a library, use `uPlot`; do not pull in D3 or Chart.js.
- The simulation core must be a **pure, headless TypeScript module** with no DOM or canvas imports, runnable from Node for tests and batch runs.
- Vitest for tests.

## Architecture

```
src/
  sim/
    rng.ts          # seeded PRNG
    genome.ts       # gene definitions, mutation
    world.ts        # patches, food spawning, regrowth cycles
    creature.ts     # sensing, movement, metabolism, reproduction
    sim.ts          # tick()
    taxonomy.ts     # lineage tracking + species assignment
    recorder.ts     # time-series + speciation event log + consumption grid
  render/
    worldView.ts
    overlays.ts     # competition heatmap, territory
    treeView.ts
    mullerView.ts
    scatterView.ts
  ui/
    controls.ts
    params.ts       # ALL tunables in one place
  worker/
    sim.worker.ts
  main.ts
```

### Hard requirements

1. **Determinism.** One seeded PRNG (xorshift128+ or PCG32) passed explicitly into the sim. `Math.random()` is banned in `src/sim/`. Same seed + same params ⇒ identical state at tick N. Write a test asserting this.
2. **Fixed timestep.** Integer ticks. Nothing in the sim reads wall-clock time or `requestAnimationFrame`.
3. **Sim rate decoupled from render rate.** The UI runs N ticks per frame; fast-forward changes N, never the mechanics.
4. **All tunable constants live in `params.ts`** and every one is exposed in the UI.

---

## Full genome

| Gene | Range | Axis | Effect |
|---|---|---|---|
| `dietPref` | 0..1 | 1 | Which food type yields energy |
| `speed` | 0.2..3.0 | 2 | Distance per tick; cost scales with speed² |
| `senseRadius` | 0..20 | 2 | Food detection range; linear cost |
| `wanderPersistence` | 0..1 | 2 | Heading inertia when nothing is sensed |
| `size` | 0.5..2.0 | — | Energy capacity; scales all costs |
| `reproThreshold` | 0.4..0.95 | 3 | Energy fraction at which it reproduces |
| `offspringInvestment` | 0..1 | 3 | Energy per child vs number of children |
| `mutationRate` | 0.001..0.2 | meta | Per-gene mutation sigma for its offspring — evolvable, deliberately |

Metabolic cost per tick:

```
cost = baseCost * size
     + moveCost * speed^2 * size
     + senseCost * senseRadius
```

Tune coefficients so a mid-range creature roughly breaks even at moderate food density. The sim is uninteresting if any trait is free or unaffordable.

## Behavior policy (v1, no neural net)

Per tick: scan within `senseRadius`; if food found, steer toward the best `expectedGain / (distance + 1)`; else wander with heading blended by `wanderPersistence`; move, pay cost, eat on overlap; reproduce if over threshold; die at zero energy or past `maxAge`.

Creatures deliberately do **not** move purely randomly. Pure random walk gives selection nothing to grip except metabolic cost, so every behavioral gene drifts to noise and the tree never branches. Sensing is what makes `senseRadius`, `speed`, and `dietPref` pay off. The randomness you want is still there — it lives in mutation and in wandering when nothing is in range.

## World

- Continuous 2D toroidal plane. Uniform spatial hash grid for neighbor queries — never O(n²).
- Two food types, R and B.
- Patches, not uniform scatter. Two patch classes controlled by `patchBimodality` (see Axis 2). Patch type-mix controlled by mode: `patchy` (R clusters and B clusters at fixed centers) or `gradient` (R/B probability varies with x).
- Regrowth capped at carrying capacity, oscillating per `regrowthCyclePeriod` / `regrowthCycleAmplitude` (see Axis 3).

---

## Taxonomy — how the tree gets built

Every creature has a `lineageId`; every birth records `(parentId, childId, tick)`. The individual-level graph is a true tree with millions of nodes — **never try to render it.** Instead:

- Each species keeps a running centroid of its members' genomes.
- On each birth, compute the child's normalized distance to its species centroid across weighted genes. Weight the axis-defining genes heavily; drift in `size` shouldn't found a species.
- If distance > `speciationThreshold` **and** at least `minFounders` recent births cluster in the same region of gene-space, declare a new species: fresh `lineageId`, record `{ parentSpecies, tick, foundingCentroid, dominantDivergentGene }`.
- Record extinction ticks too.

That event log is the entire input to the tree view. It's small; make it exportable as JSON.

**Species here is a threshold you chose, not a fact.** In an asexual sim there is no natural species boundary — you are drawing lines through a continuous cloud, and the tree is partly a picture of `speciationThreshold`. Consequences: make the threshold live-adjustable, and make species reassignment re-runnable from recorded genome samples *without* re-running the sim, so you can see how the tree changes as you move the line. If the tree's topology is unstable under small threshold changes, the branches aren't real.

### Optional: make species real (v1.5)

Switch reproduction from asexual splitting to sexual, with mate choice gated on genetic distance: a creature will only breed with a partner within `matingDistance` in gene-space. Assortative mating turns reproductive isolation into an *emergent* property, and then a branch means something biologically defensible instead of being a clustering artifact.

Cost: you need mate-finding (nontrivial at low density), diploid or averaged genomes, and careful tuning — too tight a `matingDistance` and reproduction stalls to extinction. Worth doing, but only after the asexual version produces a stable tree.

---

## Views

1. World view + competition heatmap + territory overlay (above).
2. **Phylogenetic tree** — species-level, multi-root capable. Time on x, species as horizontal lines branching at speciation ticks, terminating at extinction. Branch labeled with `dominantDivergentGene`. Click a branch to filter every other view to that lineage.
3. **Muller plot** — stacked area of relative species abundance over time. Most legible view of a takeover or split; prioritize it.
4. **Gene-space scatter** — selectable gene on each axis, one point per living creature, colored by species. Watch one blob become two. This is where speciation is visible *as it happens*.
5. **Trait time-series** — population mean ± std per gene.
6. **Gene-flow meter** — migration rate between user-defined regions over time. The instrument for watching isolation happen.
7. **Event feed** — scrolling plain-language log of speciations, extinctions, and interventions, timestamped by tick and clickable to jump the tree and map to that moment.

## Controls

- Play / pause / step-one-tick.
- Speed 1×, 10×, 100×, 1000×, max.
- Seed input + restart-with-seed.
- Every `params.ts` value as a labeled input, with live vs deferred toggle. Mid-run intervention is a feature: halve food regrowth at tick 50k and watch which branch survives.
- Save/load run config as JSON; export time-series and speciation log as JSON.

## Performance

- Sim runs in a **Web Worker**; post compact snapshots via transferable `Float32Array` containing only render-relevant fields. Do not structured-clone the creature array every frame.
- Move to struct-of-arrays typed storage once the naive version works — not before.
- Target 500–1,000 creatures at 1,000+ ticks/sec. The design intent is a legible map of tens to hundreds of visible icons, not a swarm — so this is comfortably achievable on the main thread. **Defer the worker and typed arrays until profiling says you need them.** Small populations also mean drift is strong and speciation happens fast in wall-clock terms, which is what you want for watching.

**Baseline** (run `npm run benchmark`; deterministic, fixed seed — numbers are comparable across
runs but will shift with hardware). This was still comfortably meeting target at the point profiling
was last checked, well before the point a worker/typed-arrays would need to be seriously considered:

| founding population | ticks/sec | updateTaxonomy ms/call | decayConsumption ms/call |
|---|---|---|---|
| 100 | ~2,300 | ~0.43 | ~0.004 |
| 500 | ~1,900 | ~0.57 | ~0.002 |
| 1,000 | ~1,400 | ~0.66 | ~0.002 |
| 5,000 | ~440 | ~1.3 | ~0.002 |

500–1,000 (the actual design target) clears the 1,000+ ticks/sec bar; 5,000 (well beyond the
intended "legible map" scale) does not, which is expected and not a regression — nobody is meant
to run that large. `updateTaxonomy` scales roughly with population as expected (a near-linear pass
per species); `decayConsumption`'s cost is dominated by tracked-species count, not population, and
stays flat since it's already batched (see sim/consumption.ts) rather than run every tick. ~52 MB
heap after a 20,000-tick run at founding=1,000 — bounded, not growing without limit (see
sim/historyRetention.ts for why observation history specifically doesn't grow forever).

---

## Build order

Each phase runs and is committed before the next.

1. **Phase 1** — Headless sim: RNG, patched world, terrain grid, creatures, metabolism, reproduction, death. Node script running 10,000 ticks printing population and mean genes every 500. Determinism test passing.
2. **Phase 2** — Canvas world view with shaded terrain, play/pause/speed, creature inspector.
3. **Phase 3** — God-mode brushes + intervention event log + replay. Verify that a logged run replays headlessly to an identical hash. Doing this early means every later experiment is reproducible; doing it late means re-instrumenting everything.
4. **Phase 4** — Taxonomy, species assignment, mechanism tagging, event feed, gene-flow meter. **Milestone: raise a barrier by hand and watch an allopatric split get detected and logged.** This is the first end-to-end proof the app does what it's for, and it does not depend on any delicate tuning.
5. **Phase 5** — Phylogenetic tree view with branch labels, mechanism coloring, lineage filtering. Muller plot.
6. **Phase 6** — Recorder charts, gene-space scatter, competition heatmap, and **now** the sympatric tuning: get each of the three trade-off axes to independently produce bimodality with no barrier present. Verify one axis at a time by flattening the other two. This is the hardest and least predictable work, which is exactly why it is no longer blocking everything else.
7. **Phase 7** — Full parameter UI, scenario save/load, JSON export. Worker and typed arrays only if profiling demands them.
8. **Phase 8 (optional)** — Sexual reproduction with assortative mating; predation axis.

## Testing

- **Determinism:** same seed, 5,000 ticks, hashed state identical across runs.
- **Energy conservation:** food consumed in = metabolism + death losses out. No leaks.
- **Zero-mutation control:** `mutationRate` forced to 0 ⇒ gene means must not drift.
- **Neutral control:** `specializationExponent = 0`, `patchBimodality = 0`, `regrowthCycleAmplitude = 0` ⇒ assert no bimodality and no speciation events. If you detect species in a run with no disruptive pressure, the detector is finding noise and every result after that is meaningless.
- **Single-axis isolation:** three runs, each with exactly one axis active, each asserting bimodality on that axis and only that axis.

---

## Addendum — post-Phase 2 direction check

Feedback after Phase 1/2 landed confirmed the core interaction model (click a creature, see its
species/stats — StarCraft-style unit inspection) is right, and surfaced two deliberate deviations
from a strict reading of the phases above. Recorded here so the intent survives past the chat that
produced it.

### Visual style: parchment map, not a dashboard
The long-term look is a fantasy map in the LOTR sense — black-and-white / sepia, ink-on-parchment
terrain — with a StarCraft-minimap-style overlay for creatures and resources, rather than the flat
dark-UI dashboard Phase 2 shipped with. This is a *reskin*, not a contradiction of the color-encoding
rules above: terrain is already required to be desaturated so creatures own the saturation budget,
and a parchment/ink treatment satisfies that constraint at least as well as flat gray cells do. The
OkLCh genotype-color math and the species-ring/inspector model stay as designed; only the terrain
rendering and UI chrome are in scope for the reskin. **Sequencing: after Phase 3**, once god-mode
terrain tools give the map something worth re-styling around, rather than reskinning a screen that's
about to gain new elements anyway.

### New mechanic: ongoing parental care ("nursing")
Currently reproduction is a single instant transaction: a lump of energy is handed to the child at
birth (`offspringInvestment`, `offspringEnergyFraction{Min,Max}`), and the parent/child relationship
ends there. The requested addition is real, sustained parental care: a parent continues spending its
own energy on a specific, still-immature offspring for some evolvable duration before that offspring
matures and becomes independent. This is genuine r/K selection theory — the tradeoff between many
cheap, fast-maturing offspring (favored by scarcity, competition, instability) and few offspring with
heavy sustained investment (favored by abundance and stability) — and the specific question driving
it is whether resource abundance/competition level in a region evolves the local population toward
one strategy or the other.

This is a core-sim change, not a UI feature: it needs an evolvable duration gene, an ongoing
parent→child energy transfer each tick (not just at birth), tracking of which offspring are still
dependent, and a decision for what happens to a dependent offspring if its parent dies mid-nursing
(likely: it dies too, or matures early and independent — needs a decision when this is designed).
**Sequencing: fold into Phase 6**, which is already where the spec schedules deep tuning of the
life-history axis (`reproThreshold`/`offspringInvestment`) — extending that axis to model ongoing
care fits there naturally, after terrain barriers (Phase 3) and taxonomy/speciation detection
(Phase 4) exist to actually observe the effect on divergence.

---

## Addendum 2 — food density fix, and two more direction checks

After the visual-style/nursing discussion above, the live app surfaced a real bug: food looked like
it covered nearly every cell (fixed — see git history around "Make food genuinely sparse"; the short
version is drawFood was sizing squares by *local* fill fraction instead of *true abundance*, and an
ambient floor plus an untruncated Gaussian falloff meant almost every cell had some nonzero food).

One useful side effect of that fix, worth recording: once patches had real gaps between them, the
population visibly clustered into distinct, differently-colored groups around separate patches —
using only the sensing/foraging behavior that already existed. No new mechanic was needed for
*resource-driven* clustering.

That prompted two more feature requests, both deliberately deferred:

- **Predation ("hunting")** — this is Optional Axis 4, already in the spec above with an explicit
  warning not to add it before Phase 5. Confirmed: stays deferred, no change to the plan.
- **"Homing" gene (kin-based site fidelity)** — distinct from the resource-driven clustering above:
  the idea is offspring staying near their birthplace/each other *independent* of current food
  location, which is what would let "does site fidelity correlate with parenting strategy" (tying
  into the nursing mechanic) be asked cleanly. **Decision: hold off for now** — see how far
  resource-driven clustering alone goes once Phase 3/4 land before deciding whether this still adds
  something new. Revisit then; don't design it preemptively.

---

## Addendum 3 — Phase 6 axis-isolation findings

Per-axis isolation runs (see `scripts/explore-axis.ts`, `src/sim/axisIsolation.test.ts`) confirmed
the neutral control (all three axes flat) never false-positives, and diet/foraging both produce a
genuine detected speciation event when run in isolation for long enough — diet needs ~18,000 ticks
of drift under `specializationExponent: 3` before the split clears both the gap-detection and
aggregate-distance thresholds (close to this doc's own worked-example estimate of "~15,000"),
foraging is faster and more reliable under `patchBimodality: 1.0` (first split by ~19,000 ticks,
second by ~20,000).

Life history behaved differently, and it's a real finding rather than a tuning miss: run in
isolation (spatially uniform population, no diet/foraging structure), `regrowthCycleAmplitude` at
any tested amplitude/period never produced bimodal `reproThreshold`/`offspringInvestment` — instead
it produced large, cycle-synchronized population swings (3-10x peak-to-trough) with the whole
population's mean trait dragged back and forth each half-cycle. This makes sense mechanistically: a
synchronized *global* cycle applies identical selective pressure to every individual at once, so
there's no spatial refuge for a "losing" strategy to persist in — unlike diet/foraging, which are
disruptive (frequency- or space-dependent) by construction. The doc's own worked example (the
tick-~55,000 bust) has the life-history branch arrive as a *second*, asymmetric split inside an
already-diverged lineage, not as a standalone founder-population split — i.e. it's meant to prune
within existing spatial structure the other two axes provide, not create bimodal structure alone.
`axisIsolation.test.ts` tests this axis accordingly: population-size-swing amplitude vs. a flat
control, and confirms no spurious species split is reported for what is genuinely directional (not
disruptive) selection.

---

## Addendum 4 — the nursing ("ongoing parental care") mechanic

Implements the mechanic scoped into Phase 6 back in Addendum 1: real sustained parental care, not
just the one-time birth endowment `offspringInvestment` already controlled, so the r/K
selection question ("does resource abundance favor slow-maturation/heavy-investment vs.
fast/cheap/many") has an axis that can actually answer it.

**Design, as built:**

- New gene `nursingDuration` (range 0-600 ticks) — how long a parent keeps actively feeding a
  given child after birth, on top of that child's one-time birth energy. 0 is a fully valid value
  (no ongoing care), matching every scenario that predates this gene.
- A parent's *own* `nursingDuration` gene decides how long it nurses *each* of its children —
  set once, at birth, as `child.nursingUntilTick = birthTick + parent.genome.nursingDuration`
  (`creature.ts`'s `reproduce()`). The child's own `nursingDuration` gene only matters later, once
  *it* becomes a parent.
- Each tick, every still-dependent child (`nursingUntilTick` not yet reached) receives a fixed
  `nursingRatePerTick` (a biological constant, not itself evolvable — `nursingDuration` is the
  evolvable "how long" axis) transferred from its parent, capped by the parent's available energy
  (`sim/nursing.ts`). This is a genuine zero-sum cost to the parent, not free energy.
- `nursingDuration` also folds into the life-history color axis (`render/color.ts`'s
  `lifeHistoryAxisPosition`) alongside `reproThreshold`/`offspringInvestment`, and into taxonomy's
  genetic-distance metric at a deliberately low weight (0.1, matching `mutationRate`) — a full
  weight comparable to the other life-history genes measurably diluted the taxonomy detector's
  already-tuned sensitivity (see below).

**Decision: what happens if the parent dies mid-nursing?** The child simply stops receiving care
and continues on its own — it does not die with the parent. A hard "dependent dies too" rule would
stack a second, harsher death mechanic on top of ordinary starvation, and losing a parent's subsidy
early is already a real cost (a lost energy stream) without needing to also be a death sentence.

**A real tuning cost, worth recording:** adding a 9th gene to a taxonomy detector calibrated
around 8 diluted every other gene's relative contribution to genetic distance enough to break the
Phase 4 milestone test and both the diet and foraging axis-isolation tests (see their calibration
history above) — fixed by the low weight noted above, plus a gentler `nursingRatePerTick` (0.004,
down from an initial 0.015 that was enough of an energy-economy shock on its own to shift
population dynamics) and, for the axis-isolation tests specifically, explicitly flattening
`nursingRatePerTick: 0` in their shared `NEUTRAL` baseline — a true single-axis isolation test
needs every *other* mechanism flattened, and nursing is very much another mechanism relative to
whichever axis is under test.

## Addendum 5 — Milestone 2 design note: SpeciesProfile + CapabilityClassifier

This is a **design note, written before implementation**, per the game roadmap's own process
(Milestone 1's exit gate passed 2026-08-12 — graphics flagged as wanting but not blocking, deferred
to Milestone 7 — and Dan greenlit starting Milestone 2). It documents the plan Dan signed off on so
implementation can be checked against it afterward, the same way Addenda 1-4 record decisions before
or alongside the code that implements them.

**The core rule this milestone exists to enforce: Genome != Capability.** Today a `Species` (
`sim/taxonomy.ts`) carries exactly one behavioral aggregate — `centroid`, a running mean of its
living members' *genomes*. Milestone 1's objectives (`game/objectives/standardObjectives.ts`) used
`centroid.dietPref` as a diet-specialization stand-in, with an explicit code comment deferring real
calorie-share tracking to this milestone. A `CapabilityClassifier` must describe *demonstrated
ecological behavior* — what a species actually eats, where it actually lives, how far it actually
moves — not a re-labeling of its genes. A species whose `dietPref` gene sits at 0.5 but that has, in
practice, only ever found food type R growing near it is a dietary specialist in every way that
matters to the player, and the classifier needs to say so.

**Why most of this needs new `sim/` instrumentation, not just `game/`-layer aggregation:** the
`Creature` type (`sim/creature.ts`) retains no history — position, energy, and age are overwritten
every tick, nothing about *what happened* survives past the tick it happened in. The one exception
is `ConsumptionGrid` (`sim/consumption.ts`, built for Phase 6's competition heatmap), which already
tracks per-species cumulative food consumed per cell, decayed every `consumptionDecayIntervalTicks`
— but it sums food types R and B together, so it can't answer a diet-*composition* question, only a
diet-*volume* one.

**SpeciesProfile — one running aggregate object per species, not a time series.** Modeled on how
`centroid` itself already works: continuously updated in place at the existing taxonomy pass
(`updateTaxonomy`, every `taxonomyIntervalTicks`, default 100), decayed the same way
`ConsumptionGrid` decays, so the profile reflects a species' *recent* demonstrated behavior and can
visibly shift if a species' realized ecology changes after a split — rather than an ever-growing
history (that's what `populationHistory`/`traitHistory` are already for, and `historyRetention.ts`'s
generic `compactHistory<T>` remains the tool of choice if a bounded history is ever needed here).

All five dimensions, approved for a single first pass rather than a narrower slice:

| Dimension | New `sim/` instrumentation | What it measures |
|---|---|---|
| Diet | Split `recordConsumption` into separate R/B running totals per species (same cadence/decay as today's combined total) | realized food-type share, replacing the `dietPref` genotype proxy |
| Habitat | None — sample each live creature's terrain elevation band (lowland/hill/mountain, the bands `render/terrainPalette.ts` already defines) during `updateTaxonomy`'s existing per-species iteration | terrain-band occupancy histogram |
| Movement | Add a `distanceTraveled` accumulator to `Creature`, incremented in `stepCreature`'s move step | realized movement per tick vs. population baseline, not the `speed` gene |
| Reproduction | Tally births and deaths (+ sum of age-at-death) per species per sampling window, incremented at creature creation/removal | births-per-capita, average realized lifespan — the observable half of the r/K question the nursing mechanic (Addendum 4) exists to let evolve |
| Survival | None — already available | reuses `populationHistory` volatility/recovery, the same logic `standardObjectives.ts`'s disaster-recovery objective already computes |

All four new counters are pure, deterministic tallies keyed off existing tick/event points — no new
randomness, no new genes, no change to any existing gene's meaning or weight. This keeps them within
the rigor bar the roadmap's team model sets for anything touching the core tick loop, and mirrors
`consumption.ts`'s existing pattern closely enough that it's an extension of a precedent, not a new
one.

**CapabilityClassifier** reads a `SpeciesProfile` and emits labels, each with a confidence (scaled
by the species' `memberCount` — small populations yield low-confidence labels, matching how a real
field biologist would hedge on a thin sample) and evidence (the specific aggregate values that
produced the label, for a UI tooltip). Initial label set, one pair per dimension above: Dietary
Generalist / Specialist(R) / Specialist(B); Highland-Adapted / Lowland-Adapted; Fast-mover /
Sedentary; r-strategist / K-strategist; Resilient / Fragile. This set is expected to grow — nothing
about the classifier's shape is specific to these five pairs — but it is not meant to anticipate
Milestone 6's amphibious speciation or Milestone 9's flight; those get their own labels once the
underlying phenotype/performance layers (Milestones 3-5) that would make them meaningful actually
exist.

**Where the code lives:** `SpeciesProfile` and `CapabilityClassifier` themselves belong in
`src/game/` (a new `observability/` subdirectory, alongside the existing `objectives/`) — they only
need read access to sim-exposed types (`Species`, the extended `ConsumptionGrid`, `populationHistory`
), matching `objective.ts`'s own existing comment anticipating a "future SpeciesProfile/capability
layer" objectives would eventually read from. Only the four new counters themselves are `sim/`
changes, since they must be written from inside the tick loop; everything that aggregates or
classifies from them stays on the `game/` side of the boundary, so `sim/` still never imports from
`game/`.

## Addendum 6 — food system redesign, part A: persistent fruit trees replace the R/B grid

Design note, written before implementation, same process as Addendum 5. Motivation (Dan, after
playtesting M2): reduce two food types the player has to spread around down to one, and set up
predation as a real population-control mechanism (part B, sequenced separately — deliberately, "one
system at a time" the same way every other milestone here has been). This addendum is part A only:
fruit trees. Predation/meat is its own follow-up addendum once this lands and plays well.

**This removes Axis 1 (diet) entirely, for as long as part A stands alone.** With only one food
type, `dietPref` has nothing left to trade off against — the gene, `gainPerUnit`'s specialization
curve, its `GENE_WEIGHTS` entry, the diet axis-isolation calibration, `standardObjectives.ts`'s
`createDietarySpecialistObjective`/`createDietaryGeneralistObjective` (and the "Picky Eaters"
challenge built entirely on the specialist one), and M2's `SpeciesProfile.diet`/dietary capability
labels are all removed in part A, not left around half-working. Dan chose "trees first, then
predation" knowing this gap exists; part B reinstates a diet axis reshaped around fruit vs. meat
preference, on the genes that are actually meaningful again at that point.

**Tree lifecycle**, per Dan's own description: a tree is planted (sapling), takes
`treeMaturityTicks` to mature, then produces fruit; each tick a mature tree has a chance to die,
scaled by local crowdedness (nearby tree density — self-thinning, a real forest-ecology effect);
eating a tree's fruit has a small chance (`saplingChance`) of planting a new sapling nearby
(`saplingSpreadRadius`) — seed dispersal via feeding.

**Architecture:**
- `World.fruit: Float64Array` replaces `r`/`b`/`capacityR`/`capacityB` — one dense per-cell channel,
  so `creature.ts`'s hot per-tick sense/eat loop stays close to its current shape (one array instead
  of two, no `rGain`/`bGain` branch — intake is just `min(world.fruit[idx], intakeRate)`, always
  eaten, no specialization curve since there's nothing to specialize between).
- New `sim/trees.ts`: `FruitTree { id, x, y, plantedTick, maturedTick: number | null }` (an array,
  parallel in spirit to `Creature[]`) + `stepTrees(trees, world, terrain, rng, params, tick)` —
  advances maturity, regrows each mature tree's fruit into its own `world.fruit` cell (replacing
  today's uniform `regrowFood`) up to a per-tree capacity, and applies crowdedness-scaled death.
  `trySeedSapling(trees, x, y, rng, params, allocateId, tick)` is called from creature.ts's eat step.
- Crowdedness death is the one real performance risk (naive all-pairs distance is O(trees²) every
  tick) — bucket trees by the existing `gridCellSize` grid (same spatial resolution `World`/
  `TerrainGrid` already use) so a neighbor count is a small local scan, not a full pass, and only
  run the death check on a coarser cadence (a new `treeCrowdingCheckIntervalTicks`, same pattern as
  `consumptionDecayIntervalTicks`) rather than every tick for every tree.
- **Correction, caught during implementation:** an earlier draft of this addendum had world
  generation seed one uniform population of trees. That silently collapses Axis 2 (foraging
  strategy) too — its commuter-vs-camper trade-off needs "a few large, rich, widely-separated
  patches and many small, poor, densely scattered ones" (SPEC.md's own Axis 2 section), which was
  never actually about the R/B food-TYPE split, just food-patch geometry that happened to live in
  the same generation code. World generation now seeds two groups —`richTreeCount` (few,
  full-capacity, individually placed) and `poorTreeCount` (more numerous, capacity scaled down by
  `patchBimodality`) — both via independent uniform-random placement rather than explicit spatial
  clustering, specifically so `patchBimodality=0` makes the two groups genuinely statistically
  indistinguishable (same capacity, same placement distribution) for the neutral-control
  axis-isolation test. `foodMode: "gradient"` (the other existing generation mode) has no obvious
  tree analog and is dropped along with `FoodMode` — flag this to Dan if he was relying on it, but
  nothing in the current UI/scenarios exposes switching it.
- New `TreeParams` params group replaces the food-patch fields of `WorldParams`
  (`richPatchCount/Radius/Capacity`, `poorPatchCount/Radius/Capacity`, `baseCapacity`,
  `ambientFoodFraction`, `foodMode`): `richTreeCount`, `poorTreeCount`, `patchBimodality` (kept,
  same meaning as before), `treeMaturityTicks`, `treeFruitCapacity`, `treeFruitRegrowthRate`,
  `saplingChance`, `saplingSpreadRadius`, `crowdingRadius`, `baseDeathChancePerCheck`,
  `crowdingDeathMultiplier`,
  `treeCrowdingCheckIntervalTicks`.
- God-mode: "Drop food R"/"Drop food B" brushes collapse into one "Plant tree" brush
  (`intervention.ts`'s `DropFoodParams` loses `foodType`).
- Determinism unchanged in kind: tree lifecycle (which sapling attempts succeed, which mature trees
  die) is driven by the same shared `RNG` everything else uses.

**Predation groundwork, documented now per Dan's request but NOT implemented until part B:** a
predation attempt's success will start as odds weighted by the predator's and prey's relative size
and speed — no new gene needed initially, reusing genes that already exist. But Dan wants room to
later split this into dedicated `attackPower` and `escapePower` genes that only *correlate* with
size/speed rather than being identical to them (e.g. a small creature could evolve low attack but
very high escape). So the combat resolution function should be written now, when part B starts,
against named seams — `effectiveAttackPower(genome)` / `effectiveEvasionPower(genome)` — that are
thin wrappers over size/speed at first, so swapping their internals for real genes later doesn't
touch any call site. Outcomes: kill, or escape (prey evades, no kill) — a third "outsmarting"
dimension was floated and explicitly deferred, per Dan: "introduces more dimensions I'm not ready to
deal with." Also worth carrying into part B's own design note: the original SPEC.md already warned
predation "destabilizes population dynamics badly and can collapse a run to zero" (Optional Axis 4) —
part B's design should address that directly, not discover it by watching a run collapse.

**Implementation status (2026-08-12): built, real bugs found and fixed, one known gap left open
deliberately rather than declared fixed.** Three real bugs surfaced during implementation, not
just design refinements:
1. Uncapped sapling growth trivially outpaced death pressure, growing the tree population without
   bound and blowing a 5,000-tick determinism test's runtime from seconds to a 60s+ timeout. Fixed
   with a hard `maxTreeCount` cap — the actual population-control backstop; crowding death is
   flavor on top of it, not a substitute.
2. `stepTrees` regrew every tree toward one shared `treeFruitCapacity` ceiling regardless of
   whether it was planted rich or poor, silently erasing the bimodal capacity split after the
   first regrowth tick. Fixed by giving `FruitTree` its own `capacity` field.
3. Poor-tree cluster placement sampled a uniform *distance* with a uniform *angle*, which is
   inherently radially peaked at the cluster center no matter how large the radius — so scaling
   radius toward "collapsed" at `patchBimodality=0` never actually converged to uniform placement,
   and the neutral-control test started detecting phantom speciation events. Fixed by making
   `patchBimodality` a per-tree mixing *probability* (clustered vs. a fresh independent uniform
   draw) instead of a continuously-scaled radius — this collapses exactly at 0, not asymptotically.

**Gap since resolved (2026-08-12, same day as Addendum 7's predation work) — recorded here for
history, not left open.** Point-source trees are a genuinely weaker disruptive-selection geometry
for Axis 2 (foraging) than the old Gaussian patches were — a single tree, however "rich," has no
footprint the way a patch spanning dozens of cells did. `axisIsolation.test.ts`'s "foraging axis in
isolation" (and two golden scenarios depending on the same mechanism) didn't reliably reproduce a
clean split within reasonable ticks under the *isolated* single-axis test conditions, even after
real tuning attempts scoped to this addendum alone (richTreeCount swept 40→8→4, rich/poor capacity
contrast sharpened, cluster tightness increased). What actually fixed it turned out to live outside
this addendum entirely: Addendum 7's `attackCooldownTicks` fix (built for predation population
stability, an unrelated bug) also stabilized population dynamics broadly enough for this axis's
comparatively weak signal to reliably surface again. All three tests un-skipped and passing; a
third golden scenario ("extinction and radiation") needed its own fix on top — seed 42 never
speciated at all under the new geometry even by tick 12,000 (confirmed directly), so it was
switched to seed 1 (reliably speciates by ~tick 6,000) with the meteor moved from tick 3,000 to
7,000, giving the split time to establish before the meteor needs a regional lineage to wipe out.

## Addendum 7 — food redesign part B: predation and meat

Design note, written before implementation, same process as Addenda 5 and 6. Sequenced after part
A per Dan's own explicit choice ("one system at a time"). Two decisions confirmed with Dan before
writing this: **cannibalism is allowed** (a creature can attack another of its own species — opens
the real possibility of one ancestral population splitting into predator and prey sub-lineages of
itself, which is more interesting than it is dangerous); and **no artificial population-collapse
safeguard** — the original SPEC.md's own warning that predation "destabilizes population dynamics
badly and can collapse a run to zero" is accepted as a real, expected risk to tune against via
playtesting, not something to mechanically prevent up front. Population control via predation was
literally Dan's stated motivation for this whole food redesign.

**Reinstates Axis 1 (diet), reshaped around fruit vs. meat instead of R vs. B.** New gene
`carnivory` (0 = pure herbivore, 1 = pure carnivore), same weight (1.0) and the exact same
specialization-curve shape `gainPerUnit` had before part A removed it —
`gain = maxGain * (1 - abs(carnivory - foodType))^specializationExponent`, foodType 0 = fruit, 1 =
meat — just with new labels. `specializationExponent` is reintroduced; `maxGain` is what part A's
`fruitGainPerUnit` reverts to being called, now the shared ceiling both curves reference.

**Sensing and targeting extend the existing mechanism, not a parallel one.** `senseFood` already
picks between food sources by comparing `amount * gain / (dist + 1)` scores (that's how R vs. B
competed before, and how fruit alone works now) — prey becomes a third candidate in the same
comparison, scored `preyEnergy * meatGain(carnivory) / (dist + 1)`. A herbivore's `meatGain` is
near zero, so it naturally never finds attacking prey worthwhile — no explicit
"carnivory > threshold" gate needed, the existing scoring mechanism already produces that behavior
for free, the same way it already made R-specialists ignore B food without a gate.

**Combat resolution — the seam Dan specifically asked for.** `effectiveAttackPower(genome) =
genome.size`, `effectiveEvasionPower(genome) = genome.speed`: thin wrapper functions, not inlined
math, so a later `attackPower`/`escapePower` gene pair can replace their internals without
touching any call site. Success probability is a standard contest-success function,
`attackPower / (attackPower + evasionPower)` — bounded (0, 1), and since every gene's range keeps
size and speed strictly positive, never exactly 0 or 1. Two outcomes only: kill (prey removed,
predator gains the prey's energy-at-death scaled by the predator's own `meatGain(carnivory)`) or
escape (no kill, no extra cost beyond the metabolism both sides already paid this tick) — a third
"outsmarting" dimension was floated and explicitly deferred back in Addendum 6's groundwork notes,
per Dan: "introduces more dimensions I'm not ready to deal with."

**Architecture — attempts are recorded during the existing per-creature pass, resolved in a
separate pass after.** Resolving a kill synchronously mid-loop (directly zeroing a not-yet-visited
prey's energy) would need every other piece of per-tick logic — reproduction eligibility, the
survival check that builds `nextGeneration` — to defensively re-check "am I already dead" in ways
they don't today, and a creature already pushed into `nextGeneration` earlier in the loop wouldn't
get removed by a later kill without an explicit final filter anyway. Cleaner: `stepCreature`
records a `{predatorId, preyId}` attempt (if it ends its move within `attackRange` of a valid prey
target) into a list, unchanged otherwise; a new `resolvePredation` pass runs after
`nextGeneration` is finalized, rolling each attempt in order and removing/crediting energy — a
second attempt whose prey a first attempt already killed this tick is a genuine no-op, re-checked
at resolution time, not just queue time. Prey-sensing needs a spatial index of creatures (bucketed
by grid cell, same pattern `trees.ts`'s crowding-neighbor lookup already uses) built once per tick
before the main loop — O(n) instead of an O(n²) all-pairs scan against a population that can run
into the thousands.

**Deliberately out of scope for this pass, flagged as natural follow-ups, not forgotten:** M2's
`SpeciesProfile`/`CapabilityClassifier` diet dimension and `standardObjectives.ts`'s dietary
objectives (removed in Addendum 6) are not being reinstated here — Dan asked for the core mechanic,
not the observability layer on top of it. Revisit once the mechanic itself has been played with.

**Implementation status (2026-08-12): built, one real bug found and fixed, two test fixtures
repaired.** Built as designed above — `carnivory` gene, prey-sensing folded into the existing
sense/score/steer mechanism, `effectiveAttackPower`/`effectiveEvasionPower` seam functions,
deferred-queue attack resolution, cannibalism allowed, no artificial safeguard.

The one real bug: a predator that caught up to prey got a fresh attack roll **every tick** it
stayed in range, with no cost for a miss. Even modest per-attempt odds compound to near-certain
death within a handful of ticks under sustained proximity — this produced a real, measured
collapse (100 → 15 population within 200 ticks, most seeds ending near-total extinction by tick
3000) under plain `DEFAULT_PARAMS`, not an edge case. Fixed with `Creature.attackCooldownUntilTick`
+ a new `attackCooldownTicks` param (20): a recovery window after every attack attempt, hit or
miss. This is standard predator-prey-model pacing, not the artificial anti-collapse safeguard Dan
declined — it doesn't prevent collapse, it just stops attacks from being free and infinite. After
the fix, all 8 seeds checked (1-8) settled into healthy, stable populations (140-330) by tick 3000,
instead of 6 of 8 collapsing to near-zero.

Two pre-existing scripted-scenario tests (`taxonomy.test.ts`'s Phase 4 barrier milestone,
`goldenScenarios.test.ts`'s barrier/allopatric split) broke not because of a mechanic bug, but
because their fixed-seed base genome helper happened to draw a high incidental `carnivory` (~0.79)
for a gene the tests were never trying to isolate — carnivory didn't exist when those tests were
written, so that draw was silently inert until now. Fixed the same way those tests already pin
`speed` to avoid movement confounds: pinned `carnivory: 0` explicitly alongside it.

Full test suite green (243 passed, 3 pre-existing skips from Addendum 6 unrelated to this work),
typecheck clean, no performance regression, live-verified in-browser across 25,000+ ticks with real
speciation/extinction events and zero console errors.

## Addendum 8 — closing the open threads before Milestone 3

Before moving on to Milestone 3, Dan asked for a "creative director + engineering director" pass:
step back, audit the codebase for everything the food redesign (Addenda 6-7) left unfinished or
inconsistent, prioritize it, and clear the list — rather than carrying staleness forward into a new
milestone. Eight items were identified and all were completed, in the agreed order:

**Tier 1 — infra/consistency (staleness that would mislead, not break anything today):**
`README.md`'s tick lifecycle rewritten for the actual 12-step `tick()` (trees, creature spatial
index, predation queue/resolve phases); `public/scenarios/*.json` example scenarios regenerated
against current `DEFAULT_PARAMS` via a new permanent `scripts/regen-examples.ts` (they still loaded
under the old patch-based economy via `mergeRunParams`'s graceful fallback, but silently no longer
demonstrated their own premise); `distanceTraveled`/`attackCooldownUntilTick` added to
`testHash.ts`'s determinism snapshot (previously invisible to divergence detection);
`scripts/explore-axis.ts` updated with a `predation` axis-isolation entry and a stale comment fix.

**Tier 2 — the foraging-axis tuning gap:** Addendum 6 left `axisIsolation.test.ts`'s
foraging-in-isolation diagnostic `it.skip`, unresolved after several rounds of patch-geometry
tuning. Turned out not to be a foraging-tuning problem at all — it was the same population
instability the Addendum 7 attack-cooldown bug caused, just manifesting as noise in a different
test. Fixing that bug (already done for Addendum 7) fixed this for free; removed the skips.

**Tier 3 — reinstating what Addendum 7 explicitly deferred:** M2's diet dimension is back in
`SpeciesProfile`/`CapabilityClassifier` (`DietProfile.meatShare`, `omnivore`/`herbivore`/`carnivore`
labels at the same thresholds the old R/B version used); predation's death/diet events already flow
into the existing generic species-card/event-feed UI with no new code needed (verified, not
assumed); `createDietarySpecialistObjective`/`createDietaryGeneralistObjective` reinstated reading
**real demonstrated diet share** from `SpeciesProfile` (not the old genotype-centroid proxy — a
deliberate upgrade, consistent with the "Genome != Capability" principle that layer was built
around) and the **Picky Eaters** challenge came back with them; a new
`createApexPredatorObjective(minPopulation, meatShareThreshold)` and matching **Apex Predator**
challenge were added — both gated by `MIN_DIET_EVIDENCE` so a species with no recorded intake yet
can't false-positive complete an objective. Test coverage added in
`standardObjectives.test.ts` for all three objectives, including the population and evidence gates.

**Verification:** typecheck clean, full suite green (262 passed), benchmark unchanged, and a live
in-browser run confirmed the full pipeline end-to-end — selected the Picky Eaters challenge, ran an
era, watched the objective flip to complete as the founder population's carnivory swung sharply
toward one diet extreme, zero console errors.

## Addendum 9 — Milestone 3 design note: sea level and a minimal Phenotype layer

Design note, written before implementation, same process as Addenda 5-7 — this is flagged in the
game roadmap as "the first real simulation-model milestone," so it gets the same rigor. Two product
decisions were confirmed with Dan before writing this:

1. **Sea level is player-controllable mid-run, not just baked in at world generation.** A new
   Raise/Lower Sea Level god-tool sits alongside the existing Raise/Lower Terrain tools. This is the
   highest-narrative-payoff terraforming action in the whole roadmap — flood a land bridge, watch an
   allopatric split happen from a single click, no new detection code needed (see below).
2. **Water is a severe, near-barrier penalty for every creature in M3, uniformly.** No new gene, no
   differentiation by genotype. M4 is explicitly titled "Water as a real niche" *because* M3 doesn't
   make it one — M3 only needs to establish that water exists and matters, not that anyone can
   exploit it. That payoff is deliberately left for M4/M6.

### Why "sea level" isn't a trivial threshold on today's terrain

`generateTerrain` currently sums positive-only Gaussian hills over a flat elevation-0 baseline, then
normalizes so the *positive* peak equals `terrainRoughness`. Almost the entire map sits at or near
elevation 0 (flat baseline, far from any hill). Naively adding `seaLevel > 0` on top of that terrain
would flood nearly the whole map except hill slopes — not "natural islands and continents," a
degenerate near-total ocean that would starve every fresh run of land by default.

**Fix, part 1: hills get signed amplitude** (roughly half raise the land, half carve basins), **and
normalization becomes symmetric** (`elevation[i] / max(|elevation|)`, not `/ max(elevation)`),
producing a landscape with real troughs, not just an all-positive one. `raiseTerrain`/`lowerTerrain`/
the meteor crater's elevation clamp changes from `clamp(elevation, 0, 3)` to `clamp(elevation, -3, 3)`
— today `lowerTerrain` literally cannot carve new water at all (floored at 0); it needs to be able to,
both for the new Lower Sea Level tool's *interaction* with hand-lowered terrain and because "carve a
sea with your own hands" is exactly the kind of terraforming Dan's north star describes.

**Fix, part 2 (found empirically, not anticipated in the first draft of this note): a fixed
`seaLevel` threshold is still broken even after part 1.** With only `terrainHillCount = 5` bumps
summed, which side (the tallest peak or the deepest trough) happens to be bigger is pure luck of
that seed's random draw — measured directly: at a fixed `seaLevel = 0`, water coverage ranged from
33% on one seed to 100% (total ocean) on another, across 5 seeds checked. No single fixed elevation
threshold can be a sane default when the underlying distribution itself swings that wildly seed to
seed. **Fix: `seaLevel` is chosen per-map, not read from a flat param** — `TerrainParams.seaLevel`
becomes `seaLevelTargetWaterFraction` (default 0.18), and `sim/terrain.ts`'s new
`seaLevelForTargetWaterFraction(elevation, targetFraction)` sorts that map's own elevation values
and picks the one at the target percentile, so the *actual* resulting water coverage is exactly the
target regardless of how the random hill draw happened to skew. Re-measured after the fix: exactly
18.0% water on every one of 8 seeds checked. This only runs once at generation time — from then on
`TerrainGrid.seaLevel` is a normal elevation-space scalar the Raise/Lower Sea Level tool nudges
additively, same as before.

### Where sea level lives: `TerrainParams.seaLevelTargetWaterFraction` (generation-time target) vs. `TerrainGrid.seaLevel` (live, mutable elevation-space value)

Same split already established for tree capacity (`params.treeFruitCapacity` vs. `FruitTree.capacity`,
Addendum 6): a scalar `TerrainGrid.seaLevel`, computed once from `params.seaLevelTargetWaterFraction`
at `generateTerrain` time (see "fix, part 2" above), then directly mutated by the new intervention —
not re-derived from params every tick. Raising/lowering it triggers one full-grid recompute of
`passability`/`fertility` (a rare, deliberate player action, not a per-tick cost).

### Derived fields become sea-level-relative, and get a real shared helper

`passability`/`fertility` are today computed from raw elevation in three separate places
(`generateTerrain`, `applyRaiseLowerTerrain`, `applyMeteor`'s crater recovery) with the same
duplicated formula. Touching every one of them for sea-level-awareness is the natural moment to
collapse them into one `terrainDerivedFields(elevation, seaLevel, params)` helper in `terrain.ts`:

- **Land** (`elevation >= seaLevel`): same shape as today, just measured relative to sea level
  instead of absolute 0 — `passability = clamp01(1 - passabilitySteepness * (elevation - seaLevel))`,
  same for fertility. A hill barely above the waterline gets full passability now, not a head start
  penalty from the old absolute-zero baseline — a strictly more physically sensible formulation.
- **Water** (`elevation < seaLevel`): `depth = seaLevel - elevation`. `fertility = 0` — flatly, no
  aquatic food source exists until M4. `passability = clamp01(1 - waterPassabilitySteepness * depth)`,
  a new, much steeper constant than `passabilitySteepness` (per decision 2 above) — even modest depth
  should already read as "near-impassable," the natural analog of a player-placed Barrier stamp.

This also means `taxonomy.ts`'s existing allopatric-barrier path-sampling (already reads
`terrain.passability` to detect the "was there a barrier between these two clusters" signal, see
Addendum 3/Phase 4) picks up natural sea barriers for free — no new detection code, the exact same
pathway that already tags a hand-placed Barrier stamp as allopatric now does the same for a strait or
an ocean, because passability is the shared signal both funnel through.

### A minimal `Phenotype` layer, exactly as minimal as the roadmap says

New `sim/phenotype.ts`: `Phenotype { speed, size }`, `derivePhenotype(genome)` — today a pure
pass-through, deliberately not doing anything clever yet. `movementEfficiency(phenotype, environment:
{ passability })` replaces the two-step `genome.speed * passability` multiplication that used to live
inline in `creature.ts`'s move step. Behaviorally identical to today for land movement; the payoff is
architectural, not behavioral — a single named seam M4/M5/M6 can extend (a `swimEfficiency` phenotype
trait multiplying specifically in water, then the real genotype→phenotype→performance pipeline M5
promises) without touching `stepCreature`'s call site again. `size` rides along in `Phenotype` unused
by `movementEfficiency` for now, same as it's unused by movement today — not migrating predation's
`effectiveAttackPower`/`effectiveEvasionPower` seam functions onto `Phenotype` in this pass; that
consolidation is explicitly M5's job ("full genotype→phenotype→performance→behavior pipeline"), not
M3's, and doing it now would be scope creep past what this milestone asks for.

### Trees don't grow in the sea

`trees.ts`'s `initTrees`/`trySeedSapling` reject candidate cells where `elevation < terrain.seaLevel`
outright (resample), rather than relying on `fertility = 0` alone to make them pointless — placing a
tree entity in open water and letting it just sit there forever at zero fruit wastes crowding-pass
iteration for no gameplay payoff. An *existing* tree that finds itself underwater after a player
raises sea level mid-run is not force-deleted — its fertility ceiling drops to 0 and it starves out
through the ordinary crowding-death mechanism already in place. No special-case code needed there,
which is the kind of thing that happens when state and derived-field computation are cleanly separated.

### Rendering: water needs to be visually legible, not just mechanically real

`render/terrainPalette.ts`'s `elevationBand`/`terrainCellColor` currently normalize elevation against
`[0, terrainRoughness]` and `clamp01` — negative (underwater) elevation would silently clamp into
"lowland," rendering identically to dry flat ground. A mechanic a player can't see isn't a mechanic
they can react to, so this needs a fourth band, `"water"`, with its own ink-on-parchment-consistent
tone (a cool desaturated blue-gray, keeping the existing "terrain is background, creature hue is the
loud layer" rule) — otherwise sea-level terraforming is invisible feedback, which defeats the entire
point of adding a player-facing god-tool for it.

### Deliberately out of scope for this pass

No new gene, no swim-specific phenotype trait, no aquatic food source, no amphibious anything — all
explicitly M4/M6's job per the roadmap's own sequencing. `SpeciesProfile`'s habitat-band observability
(`lowlandShare`/`hillShare`/`mountainShare`) is left untouched in this pass' scope discussion but will
need a `waterShare`/`aquaticShare` counterpart once `elevationBand` grows the fourth band, since a
creature can now legitimately be standing in shallow water. Predation's seam functions are not being
migrated onto `Phenotype` (see above, that's M5's job).

**Implementation status (2026-08-12): built as designed above (including the percentile-based
seaLevel fix), `waterShare` added to `HabitatProfile` after all, three real test regressions found
and fixed, one known gap left open — not hidden.**

Built exactly as designed, including the mid-implementation percentile fix described above.
`SpeciesProfile.habitat` did in fact get its `waterShare` counterpart in this same pass rather than
being deferred — small enough (mirroring the existing three-band pattern exactly) that splitting it
into a separate future pass would have been pure overhead. Full suite green (279 passed, 1
documented skip — see below), typecheck clean, benchmark unaffected (no regression across any
population size). Live-verified in-browser with direct pixel measurement, not just eyeballing:
sampled the World-view canvas and classified pixels by hue (cool/blue vs. warm/tan) rather than
trusting a screenshot — a fresh default map measured 18.0% cool-toned pixels, an exact match for the
tuned `seaLevelTargetWaterFraction` default; clicking Raise Sea Level ten times pushed that to 84.6%,
Lower Sea Level twenty-five times drained it to 0.4% — confirming the full pipeline (click → tool
mapping → intervention → live `TerrainGrid.seaLevel` → full-grid passability/fertility recompute →
render) end to end, in both directions, not just that *something* changed. Stepped the sim 50 ticks
afterward with zero console errors, and both regenerated example scenarios (`barrier-split.json`,
`meteor-radiation.json`) load cleanly with zero console errors. Natural water acting as a real
allopatric barrier through the existing detection pathway is exercised by the automated suite
(`axisIsolation.test.ts`'s neutral-control finding below is direct evidence of it) rather than
separately re-checked live in this pass.

Three real regressions, found by running the full suite after the terrain change, not anticipated
up front:

1. **Natural water is a real geographic barrier, and the isolated-axis diagnostic tests didn't
   account for a THIRD disruptive force existing by default.** `axisIsolation.test.ts`'s neutral
   control (zero trade-off pressure should mean zero speciation) started failing — correctly,
   because it was true: default terrain now always has ~18% water, itself capable of driving real
   allopatric splits via isolation-by-distance, independent of any gene-level axis. This is the
   *feature working as designed* (geography-driven speciation was the whole point of sea level),
   but it meant every axis-isolation test needed geography flattened too, same reasoning already
   applied to `nursingRatePerTick`. The fix is `waterPassabilitySteepness: 0` in each test's
   `NEUTRAL` override (water still exists topologically — same fertility/food statistics as normal
   play — just fully passable, no barrier effect) — deliberately NOT
   `seaLevelTargetWaterFraction: 0`, which was tried first and rejected: it pins `seaLevel` to the
   map's single lowest cell, measurably dragging down average land fertility/passability compared to
   normal play (checked directly: 0.85/0.63 vs. the default 0.88/0.70), an unrepresentative
   distortion the isolation tests shouldn't be testing against either.
2. **Even with geography flattened, a single-snapshot bimodality check has a real false-positive
   mode of its own, unrelated to water.** The same neutral-control test, once geography was properly
   flattened, still failed once (seed 3, tick 4000, gene `offspringInvestment`) — traced directly:
   the population's mean was climbing monotonically (0.82 → 0.98 over the run, ordinary directional
   drift under a static environment, not disruptive selection) and transiently *looked* bimodal to
   the raw bump-hunting statistic while passing through a skewed distribution shape mid-climb, then
   resolved back to unimodal by the next checkpoint — confirmed not a real split: taxonomy itself
   never promoted a species the entire run. The test was holding a cruder raw-gene check to a lower
   bar than the real taxonomy pipeline it's meant to sanity-check (which already requires
   `speciationConfirmationPasses` re-detection before promoting a candidate). Fixed by requiring 2
   *consecutive* 500-tick-apart bimodal readings on the same gene to fail, not one snapshot.
3. **The foraging-axis-in-isolation diagnostic's tuned seed stopped working.** `generateTerrain` now
   draws one extra random number per hill (the sign), shifting every downstream RNG draw for the
   rest of the run — seed 2, previously reliable from ~tick 7,000, now only barely qualifies near
   the end of a much longer window. Re-swept (seeds 1-8): seed 1 reliably produces a persistent
   2-species split from tick 500 through at least tick 10,000, with foraging-gene bimodality
   co-occurring — switched both `axisIsolation.test.ts` and its `goldenScenarios.test.ts`
   counterpart to it.

**Known open gap, deliberately not hidden:** `goldenScenarios.test.ts`'s "extinction and radiation"
scenario used to demonstrate both a meteor-driven extinction of a regional lineage AND the survivors
later radiating into a brand-new lineage filling the vacated niche, in one 27,000-tick run (seed 1).
That seed no longer speciates at all under the new terrain (same RNG-shift cause as finding 3 above).
Re-swept seeds 1-12 specifically for the "extinction, then a LATER new speciation" sequence: several
seeds (6, 9, 12) produce real, clean extinctions reliably, but none produced a qualifying
post-extinction speciation within 27,000 ticks. Pushing seed 9 to a 90,000-tick horizon eventually
produced both an extinction and a later speciation event — but the run's *last* extinction (tick
70,800) still landed after its only post-meteor speciation (tick 68,900), so the sequencing this test
wants never actually lined up, and one run at that horizon already takes 100+ seconds — impractical
for a fast suite. Split into two tests: the extinction half is kept and re-tuned (seed 6, meteor at
the minority sub-lineage's actual tick-7,000 centroid) and passes reliably; the radiation half is
`it.skip`'d with a tracking comment, not deleted or faked. Recolonizing a vacated niche and then
differentiating there enough to register as a new species looks like it needs either a much larger
seed/tick search budget than fits a fast test suite, or a genuine tuning pass — the same category of
gap Addendum 3's original axis-isolation calibration and Addendum 6's foraging-axis gap both were,
not a quick seed swap. Revisit if the game layer ever depends on demonstrating this capability
specifically (an objective built on it, say).

## Addendum 10 — Milestone 4 design note: water as a real niche

Design note, written before implementation, same process as every milestone since M2. The roadmap
lists M4 as "shallow-water food, Island Hopper challenge — problem specified, solution NOT
prescribed," so unlike M3 there's no existing mechanic being extended, just a problem statement.
One product decision confirmed with Dan before writing this: **shallow-water food is a modest bonus
in this pass, not a strong incentive.** Real, meaningful selective pressure toward water specialists
is deliberately left for M5 (the real genotype→phenotype→performance pipeline) and M6 (amphibious
speciation, the roadmap's flagship payoff for this whole arc) — M4 only needs water to become a real,
reachable food source, not yet a mechanic worth building a whole strategy around.

### Why this doesn't need a new gene, a new food type, or new instrumentation

M3 already built every seam this needs:
- **Passability near shore is already nonzero.** `terrainDerivedFields`'s water branch
  (`clamp01(1 - waterPassabilitySteepness * depth)`) is a continuous falloff, not a step function —
  very shallow water is already meaningfully reachable today, just discounted. M4 doesn't need to
  loosen movement at all, only give a creature a reason to spend it wading in.
- **The diet system is food-*type*-based, not location-based.** `gainPerUnit(carnivory, foodType,
  params)` doesn't know or care where a unit of fruit grew — a herbivore eating shallow-water fruit
  gets exactly the specialization curve it already gets from land fruit. The niche this milestone
  creates is entirely about *access cost*, not a different nutrient profile — deliberately, so M5/M6
  have a real, undiluted "can you afford to go there" question to build phenotype differentiation on
  top of, instead of this pass accidentally answering it early with a nutrient shortcut.
- **`SpeciesProfile.habitat.waterShare`** (added in M3, previously unused by anything) already
  tracks what fraction of a species is observed standing in water. M4's own challenge objective reads
  directly off it — no new observability plumbing needed.

### Concrete design

**Shallow vs. deep water is a depth threshold, not a new terrain concept.** A new
`TerrainParams.shallowWaterMaxDepth`: depth ≤ this counts as shallow, deeper stays exactly as
punishing as M3 already made it (hard-zero fertility). `terrainDerivedFields`'s water branch grows a
second case: shallow-water fertility tapers from a new, deliberately low
`shallowWaterFertilityCeiling` down to 0 at the shallow/deep boundary — "modest," per the decision
above — instead of the flat hard-zero every underwater cell gets today. Passability is untouched;
the existing continuous depth falloff already does the "some effort required" job.

**Trees grow in shallow water too, using the exact same `FruitTree` entity and the exact same
`capacity × terrain.fertility` yield formula rich/poor land trees already use** — no new entity
type, no new capacity concept. A new `WorldParams.shallowWaterTreeCount` seeds a dedicated,
shallow-water-only population at generation time (land tree placement stays land-only, unchanged);
the low `shallowWaterFertilityCeiling` alone is what keeps their realized yield modest, the same way
"poor" land trees are already just rich trees with a lower ceiling. `trySeedSapling`'s dispersal
check changes from "reject all water" to "reject only water deeper than `shallowWaterMaxDepth`" —
inherited capacity still comes from whichever tree owns the source cell, same rule as always, so a
sapling from a land tree that happens to wash into the shallows just carries its parent's capacity
in, no special-casing needed.

**Rendering:** shallow water already reads slightly lighter than deep water (M3's depth-based
darken), which happens to be exactly the right visual cue to lean on. `terrainCellColor`'s water branch
gains the same fertility tint land cells already get — a faint green cast wherever shallow water
actually has real fertility, so "this patch of coastline has food" is legible without a new visual
language.

**New challenge, per the roadmap's own naming — "Island Hopper."** A new
`createAquaticForagerObjective(minPopulation, waterShareThreshold)`, structurally identical to
`createApexPredatorObjective`, reading `profile.habitat.waterShare` instead of diet share: get a
species of real size to spend a meaningful share of its time observed in water. This is a geography/
habitat objective, not a diet-source objective — tracking *where* a unit of fruit was eaten (as
opposed to merely what type) doesn't exist and isn't being added in this pass, consistent with the
"modest bonus, not a whole new instrumentation surface" scope.

### Deliberately out of scope for this pass

No swim-specific phenotype trait, no differentiated access cost by genotype, no aquatic-only food
type, no new gene, no location-aware diet tracking. All of that is M5 (the pipeline that would
actually consume a phenotype trait like this) or M6 (the speciation payoff) — building any of it now
would front-load a payoff this milestone was explicitly scoped not to deliver yet.

**Implementation status (2026-08-13): built exactly as designed above, tuning verified empirically
before locking defaults, two golden-scenario/example seeds re-swept, zero design surprises.**

Tuning was checked directly rather than guessed, same discipline as every prior milestone's
numbers: at the shipped defaults (`shallowWaterMaxDepth: 0.04`, `shallowWaterFertilityCeiling: 0.35`,
`shallowWaterTreeCount: 30`), shallow water covers ~7-9% of the map (a real coastal band, not a
sliver), every shallow-water tree placed successfully on every seed checked, and average shallow
fertility (~0.18) landed almost exactly between land's poor and rich tiers — genuinely "modest," not
degenerate or overpowered. In aggregate, shallow water's total food supply came out to roughly 18%
of land's — a real secondary source without threatening to overshadow land, matching the confirmed
product decision.

**One thing that was NOT a surprise, worth naming anyway:** M4's shallow-water food shifted
population dynamics enough that both `barrier-split.json`/`meteor-radiation.json`'s bundled example
seeds and `goldenScenarios.test.ts`'s extinction scenario (previously re-tuned for Addendum 9) broke
again and needed a fresh seed sweep — same category of churn M3 caused for M2's tuning, M2 caused
for the food-redesign's, and so on back through this project's history. This is now an expected,
budgeted cost of any milestone that touches core population dynamics, not a regression to be
alarmed by; `scripts/regen-examples.ts`'s own verification step exists specifically to catch it
before it ships silently broken. New seeds: `barrier-split.json` seed 8 (was 12), `meteor-radiation.
json` seed 10 (was 6), `goldenScenarios.test.ts`'s extinction test seed 10 (was 6).

**Verification:** typecheck clean, full suite green (289 passed, 1 pre-existing documented skip —
unrelated, see Addendum 9), benchmark shows no regression, and live in-browser verification used
direct pixel measurement rather than eyeballing: default water coverage measured 18.05% (matches
target), and — the most direct proof the mechanic actually works end to end, not just in the data
model — sampling fruit-colored pixels on the rendered canvas and checking their immediate
surroundings found real fruit squares sitting directly adjacent to water-toned terrain (11 of 40
sampled fruit clusters had water-toned neighbors). The Island Hopper challenge loads with correct
budget (180) and objective text, and an era advanced cleanly under it with zero console errors.

## Addendum 11 — Milestone 5 design note: the real genotype→phenotype→performance pipeline

Design note, written before implementation. Unlike M2-M4, this milestone has no player-visible
gameplay change at all — the roadmap's own ticket ("full genotype → phenotype → performance →
behavior → SpeciesProfile → Capability pipeline") describes an architecture to consolidate, not a
new mechanic to design, and there's no real product fork here for Dan to weigh in on: every value
this milestone computes is byte-identical to what the code already computed before it, just
relocated to one seam instead of two. Confirmed by re-reading Addenda 9/10's own deferral notes
before starting — both explicitly named this as "the pipeline that would actually consume a
phenotype trait like [swimEfficiency]" (M6's job), not a milestone that adds one itself.

### What's actually inconsistent today

M3 gave movement a real seam: `movementEfficiency(phenotype, environment)`, phenotype from
`derivePhenotype(genome)`. Predation never got the same treatment — `sim/predation.ts` still has its
own `effectiveAttackPower(genome) = genome.size` / `effectiveEvasionPower(genome) = genome.speed`,
reading `Genome` directly, with `resolvePredation` computing the contest formula
(`attackPower / (attackPower + evasionPower)`) inline rather than through a named performance
function. Two "how good am I at X" computations, one seam, one still ad hoc — exactly the gap
Addendum 9's Phenotype doc comment flagged when it said M5 would "grow this... without touching
movementEfficiency's call site again."

### Concrete design

**`Phenotype` grows two fields**: `attackPower`, `evasionPower`, alongside the existing `speed`,
`size`. `derivePhenotype(genome)` computes all four — still a pure pass-through
(`attackPower: genome.size, evasionPower: genome.speed`), same values as today's separate
functions, just consolidated into the one seam everything reads from.

**A second named performance function joins `movementEfficiency`**: `combatSuccessProbability
(attacker: Phenotype, defender: Phenotype): number`, extracting the contest-success formula that
already lived inline in `resolvePredation`. Same shape as `movementEfficiency` — pure, phenotype-in
probability/distance-out, no RNG inside it (the roll itself stays where it already was, at the
behavior layer in `resolvePredation`, exactly like `movementEfficiency`'s caller is the one that
turns a rate into an actual position update).

**`predation.ts`'s `effectiveAttackPower`/`effectiveEvasionPower` are removed**, not deprecated —
`resolvePredation` calls `derivePhenotype(predator.genome)`/`derivePhenotype(prey.genome)` and reads
`.attackPower`/`.evasionPower` off the result, same as `creature.ts`'s move step already does for
`.speed`. No caching added — `derivePhenotype` is a handful of property reads, and profiling
concerns here would be premature optimization for a function this cheap; if that ever changes it's
a call-site detail, not a reason to complicate the seam's contract now.

### Deliberately out of scope for this pass

No new genes, no environmental/developmental modifiers on phenotype (genotype still maps to
phenotype deterministically and 1:1 — Phenotype is not yet doing anything Genome couldn't already
tell you), no swim-specific trait. `SpeciesProfile`/`CapabilityClassifier` are untouched — they
already read real demonstrated behavior off decayed accumulators and live creature state, never off
Genome or Phenotype directly, which is the exact "Genome != Capability" principle they were built
around in M2; this milestone doesn't change that relationship, it just makes the layer BELOW
behavior (phenotype → performance) as consistent as the layer above it already is. The actual new
derived trait this pipeline exists to eventually carry (a real `swimEfficiency` or similar) is M6's
job, once amphibious speciation gives it something to select on.

**Implementation status (2026-08-13): built exactly as designed, confirmed genuinely
behavior-neutral — the one milestone this session where that was the actual success criterion.**

`Phenotype` gained `attackPower`/`evasionPower`; `derivePhenotype` computes all four fields;
`combatSuccessProbability(attacker, defender)` replaced the inline contest formula in
`resolvePredation`; `predation.ts`'s standalone `effectiveAttackPower`/`effectiveEvasionPower` were
deleted outright, not deprecated. Full suite green (292 passed, up from 289 — 3 new phenotype tests,
zero other test needed touching, since every other test that exercises predation was already
asserting on OUTCOMES, not on which function computed them). Typecheck clean. Benchmark run under
the identical seed (12345) produced the EXACT SAME final population at every founding size checked
(27/119/122/104) as the pre-M5 benchmark run — about as strong a confirmation of byte-identical
behavior as a benchmark can give, since population trajectories are extremely sensitive to any
change in the RNG-consuming combat math. Live-verified in browser: Apex Predator challenge loaded
with correct budget and objective text, an era advanced cleanly under active predation with zero
console errors. Unlike every other milestone this session, no scenario seeds needed re-tuning —
expected, since nothing about population dynamics actually changed.

## Addendum 12 — Milestone 6 design note: amphibious speciation

Design note, written before implementation, given the same rigor as M3/M4 — the roadmap flags this
one as "the first flagship emergent capability," and unlike M5 there's real product surface here for
Dan to weigh in on. Two decisions confirmed via AskUserQuestion before writing this (both
"Recommended" chosen): (1) a fully water-adapted creature should be able to cross deep, open water
nearly as easily as land — a strong, dramatic effect, real access to territory a land specialist
fundamentally cannot reach, not a modest discount; (2) this pass touches movement only, mirroring
exactly how `carnivory` started scoped to diet alone before predation became its own later
milestone — no combat interaction with the new trait yet.

### The core mechanic: a new gene, mirroring the diet axis's proven shape exactly

New `Genome.aquaticAdaptation` ∈ [0, 1] (0 = land specialist, 1 = water specialist), same weight
(1.0) as `carnivory` — a primary trade-off axis, not a minor one. Deliberately NOT a one-directional
"swim bonus with no cost," which was considered and rejected: SPEC.md's own foundational premise is
that the tree only branches where a population faces a real trade-off, and a strictly beneficial
trait just drifts the whole population toward it with no fork — the exact failure mode a bare bonus
would produce. Instead this mirrors `carnivory`'s already-proven "specialist beats generalist at
either extreme" shape: better in water AND worse on land as the gene moves toward 1, better on land
AND worse in water as it moves toward 0, an aquaticAdaptation=0.5 generalist doing worse at both than
either specialist. That's what makes this a genuine disruptive-selection axis instead of a slow
population-wide drift.

### Where the mechanic lives: a phenotype-aware passability, not a flat scalar anymore

Today's `movementEfficiency(phenotype, environment: { passability })` takes a single precomputed,
genotype-blind `passability` number — that number can't answer "how passable is this FOR ME," only
"how passable is this in general," because `terrain.passability` is one shared array every creature
reads identically. Making the aquatic trade-off real requires computing passability per-creature, not
per-cell.

**Fix: `terrain.ts`'s land/water passability formula is generalized into a shared low-level helper**
(`passabilityFromSteepness(relative, landSteepness, waterSteepness)`) that both the existing
genotype-blind `terrainDerivedFields` (used for taxonomy's barrier detection, rendering, fertility —
deliberately still genotype-blind, since "how objectively difficult is this terrain" needs to stay a
property of the terrain, not of whoever's asking) and a new phenotype-aware caller in `phenotype.ts`
can both call, just with different steepness constants. `movementEfficiency` changes shape: it now
takes raw `{ elevation, seaLevel }` instead of a precomputed `passability`, plus `params`, and
interpolates the land/water steepness constants by `phenotype.aquaticAdaptation` before calling the
shared helper:

- Land steepness interpolates from `passabilitySteepness` (aquaticAdaptation=0, unchanged from
  today) toward a new, deliberately harsher `aquaticLandPassabilitySteepness` (aquaticAdaptation=1)
  — a fully aquatic creature is genuinely awkward on land, fins over legs.
- Water steepness interpolates from `waterPassabilitySteepness` (aquaticAdaptation=0, unchanged —
  a land specialist finds water exactly as punishing as it always has) toward a new, deliberately
  gentle `aquaticWaterPassabilitySteepness` (aquaticAdaptation=1) — gentle enough that a full
  specialist crosses even substantial depth with real mobility, per the "strong, opens deep water"
  decision above.

`terrain.passability` itself (the shared, genotype-blind array) is untouched — taxonomy's allopatric
barrier detection, rendering, and fertility all keep reading it exactly as before. Only movement gets
the personalized version, computed fresh per creature per tick (cheap arithmetic, same "don't cache,
it's not worth the complexity" call M5 already made for `derivePhenotype`).

### Closing the observability loop this milestone's own name implies

`SpeciesProfile.habitat.waterShare` already exists (M3) and already feeds the Island Hopper objective
(M4) — but `CapabilityClassifier` never grew a label for it. A new `"aquatic-adapted"` capability
(mirroring `"highland-adapted"`/`"lowland-adapted"` exactly, same threshold pattern) closes that gap:
once a species' demonstrated behavior shows it really is spending real time in water, the Capability
layer should be able to say so — this is literally "SpeciesProfile → Capability" from the roadmap's
own pipeline description, applied to this milestone's new trait's actual behavioral consequence, not
scope creep.

**New challenge: "Amphibian's Fork."** A new `createAmphibiousSpeciationObjective`, structurally
identical to `createGeographicSpeciationObjective` (which already checks `taxonomyEvents` for a
speciation event with a specific `mechanism`) — this one checks for a speciation event whose
`dominantDivergentGene` is `"aquaticAdaptation"`. Existing, unmodified machinery: taxonomy's
bimodality detector picks up the new gene automatically (it's just another entry in `GENE_WEIGHTS`),
and `dominantDivergentGene` is already recorded on every promoted split — nothing new to build there,
just a new objective reading a field that already exists.

### Deliberately out of scope for this pass

No effect on combat (attackPower/evasionPower untouched, per the confirmed decision — a water-
specialist predator or prey is no better or worse in a fight, only at getting there). No dedicated
visual encoding — `render/color.ts`'s hue already spends its one 2D angle on diet+foraging and
lightness on life-history; OkLCh has no fourth channel to spend on this without touching an
already-tuned system. `aquaticAdaptation` still contributes to `geneticDistance` (it's in
`GENE_WEIGHTS`), so real divergence on this axis still shows up as increased chroma — just not as
its own recognizable hue. A dedicated visual language for a demonstrated new capability (watching a
lineage visibly grow fins) is explicitly M7's job ("procedural creature appearance... watching a
lineage visibly sprout new features as it evolves") — this milestone deliberately doesn't front-load
that payoff, consistent with every other "defer to the milestone that actually owns this" call made
throughout this arc.

**Implementation status (2026-08-13): built exactly as designed, empirically confirmed to produce
the "strong, opens deep water" effect and a genuine amphibious speciation event under default
params, no artificial isolation needed.**

`Genome.aquaticAdaptation` added (weight 1.0, alongside `carnivory`); `terrain.ts`'s
`passabilityFromSteepness(relative, landSteepness, waterSteepness)` extracted as a shared helper,
called by both the unchanged genotype-blind `terrainDerivedFields` and a new phenotype-aware caller;
`movementEfficiency` reworked to take raw `{ elevation, seaLevel }` + `params` and interpolate land/
water steepness by `phenotype.aquaticAdaptation` before calling the shared helper.
`aquaticLandPassabilitySteepness`/`aquaticWaterPassabilitySteepness` defaults (5.0 / 0.8) tuned via a
throwaway probe script checking exact multiplier values at various elevations/depths, then confirmed
against a live simulation (a second probe found seed 6 produces a genuine amphibious speciation event
under fully default params — the same seed later reused for `goldenScenarios.test.ts`'s extinction
scenario, since it happens to split on the `aquaticAdaptation` axis specifically). New
`"aquatic-adapted"` capability label (mirroring `highland-adapted`/`lowland-adapted`, threshold 30%
water-share, checked independently rather than else-if chained so it can co-occur with elevation
capabilities). New `createAmphibiousSpeciationObjective` + "Amphibian's Fork" challenge (budget 220),
structurally identical to the existing geographic-speciation objective.

Adding a new major-weight gene shifted `geneticDistance`'s weightSum and the RNG-consumption sequence
for every downstream draw — the same expected, budgeted churn every major-gene addition this session
has caused. Six tests broke, split across two distinct root causes (confirmed by probing each rather
than assuming): two (`axisIsolation.test.ts`, `goldenScenarios.test.ts`'s neutral control) had a
genuine confound — the existing `waterPassabilitySteepness: 0` NEUTRAL override only flattened
`aquaticAdaptation`'s water-side benefit, leaving its land-side cost un-neutralized; fixed by adding
`aquaticLandPassabilitySteepness: DEFAULT_PARAMS.passabilitySteepness,
aquaticWaterPassabilitySteepness: 0` to both files' NEUTRAL constants. The other four (one
`taxonomy.test.ts` Phase 4 test, three `goldenScenarios.test.ts` tests: barrier/allopatric-split,
extinction-and-radiation, and the two bundled example scenarios in `scripts/regen-examples.ts`) were
pure RNG-sequence-shift, unrelated to any design flaw — confirmed by checking that pinning
`aquaticAdaptation: 0` alone did NOT restore the old behavior, then fixed by sweeping seeds and
picking the first reliable one (taxonomy: seed 10; golden barrier: seed 2; golden
extinction-and-radiation + bundled meteor-radiation: seed 6, tick 7600, x=76/y=92 — the minority
sub-lineage's actual centroid, found via the established two-step approach; bundled barrier-split:
seed 3, the first of five reliable seeds found in a 17-seed sweep).

Full suite green (308 passed, 1 skipped, up from 292 — new coverage in `phenotype.test.ts`,
`terrain.test.ts`, `capabilityClassifier.test.ts`, `standardObjectives.test.ts`). Typecheck clean.
Benchmark run with no regression (6638/2397/1610/321 ticks/sec at founding 100/500/1000/5000).
Live-verified in browser: Amphibian's Fork challenge loaded with correct budget (220) and objective
text, an era advanced cleanly from tick 0 to 2000 with zero console errors, population grew 100→228,
and `aquaticAdaptation` showed up as a +44% major trait change in the era summary — direct evidence
the gene is under real selection pressure during play, not just present in the genome.

## Addendum 13 — era pacing: ramped animation speed + equilibrium-aware early-end/fast-forward

Design note, written before implementation. Not a numbered roadmap milestone — this closes a
player-feedback item flagged mid-M6 (2026-08-13): in Game Mode, an era's first ~10+ ticks feel
eventful, then action visibly tapers off well before the era's full tick budget is spent, because
the population/ecosystem settles into equilibrium quickly and the rest of the budget just grinds out
a visually static remainder. Dan floated two ideas in the same breath — detect low-change
equilibrium and end the era early, and/or slow the animated pacing so the eventful opening doesn't
blow by — and said the real ask was probably both together, not one or the other. Three decisions
confirmed via AskUserQuestion before writing this: (1) equilibrium early-end is automatic, gated by a
minimum-fraction floor, no player toggle; (2) pacing uses a ramp (slow start, speeds up), not a flat
slower default; (3) scope is Game Mode **and** Classic Sandbox, not Game Mode alone.

### The two mechanisms, and why they're separate rather than one combined system

**A reusable equilibrium detector** (`sim/equilibrium.ts`, `isEcosystemStable`): reads the existing
`populationHistory`/`traitHistory` (already sampled every `taxonomyIntervalTicks`, no new
instrumentation needed) and returns true when total population, every gene's mean, AND the absence
of any recent taxonomy event have all stayed flat across a rolling window of samples. The
worst-drifting gene decides — one axis still actively diverging blocks "stable" even if every other
gene has settled — and a fresh split/extinction always counts as eventful regardless of what the
population/trait numbers say. Lives in `sim/` (pure, reads only existing observation state) rather
than `game/`, since it's a general "has this run gone quiet" question, not a game-specific concept —
both `app/gameRunner.ts` and `app/simRunner.ts` consume it directly.

**A reusable ramp helper** (`app/pacing.ts`, `rampedTicksPerFrame`): ticks-per-frame for a numeric
speed setting, linearly ramping from a slow floor (1) up to the target over a fixed number of
ticks-since-the-last-eventful-moment. Deliberately takes a raw tick count, not a fraction of some
"total," so the same function serves both callers: GameRunner ramps from era-start, SimRunner ramps
from whatever it last considered eventful (construction, restart, scenario load, or any applied
intervention — including scripted ones). "max" speed bypasses the ramp entirely in both callers — a
player who picked max has already opted out of watching anything slowly.

**Why these live in `app/`, not `params.ts`:** despite affecting how many ticks actually get
simulated (a real state difference, not just a rendering choice), none of this needs to be part of
the sim's own reproducibility contract. `tick()` itself never calls the equilibrium detector or the
ramp — they're purely an app-layer decision about *when to stop calling tick*, exactly like
`GAME_ERA_CONFIG.ticksPerEra` itself already lives outside `params.ts` as a local const in
`gameRunner.ts`. A recorded scenario/intervention log still replays identically regardless of what
tolerances a *live* session used to decide when to stop watching.

### GameRunner: ramp the opening, early-end the tail

`stepEraAdvance()`'s per-frame tick count for numeric speeds now comes from `rampedTicksPerFrame`,
ramping from era-start. Once at least `EQUILIBRIUM_MIN_ERA_FRACTION` (0.25) of the era's ticks have
run — checked regardless of speed, including "max" — `isEcosystemStable` is checked every frame; if
stable, `finalizeEraAdvance(true)` ends the era there instead of grinding to the full target.
`EraSummary` gains `endedEarly: boolean` and `plannedTick: number` so the discovery-phase UI can say
what happened ("Ended early — the ecosystem settled into equilibrium (1,400 of 2,000 planned
ticks)"), rather than silently shipping a shorter era with no explanation. The floor fraction exists
for safety (never end trivially early) but empirically never binds in practice — see the tuning note
below.

### SimRunner: ramp the opening, fast-forward the quiet stretches

SimRunner has no era boundary, so "early-end" doesn't translate directly — instead, a new opt-in
`autoPace` flag (**default off**, so Classic Sandbox's established, fully-manual speed controls stay
byte-for-byte unchanged unless a player turns it on) makes `advance()` ramp from the last eventful
moment, then — once past the ramp window AND `isEcosystemStable` — reroutes through the exact same
time-boxed budget loop `speed: "max"` already uses (proven safe at any population size, rather than
inventing a new large-multiplier tick count that could stall a frame at high population). A new
`isFastForwarding()` query drives a status-line note ("auto-pacing…") so the sudden speed change
doesn't read as the player's chosen speed being ignored.

### Tuning, confirmed empirically before locking defaults (scripts/probe-equilibrium.ts, since deleted)

Three candidate configs run against 3 seeds × 6 real GameRunner eras each (18 era-runs per config,
`DEFAULT_PARAMS`, `EQUILIBRIUM_MIN_ERA_FRACTION` floor applied): a tight tolerance (0.06 population /
0.01 trait) fired in only 2 of 18; a wider sample window (8 samples) with tighter tolerances never
fired at all, because requiring 8 consecutive quiet samples is a harder bar than loosening the
per-sample tolerance; the shipped values (windowSamples=5, populationTolerance=0.08,
traitTolerance=0.015) fired in about a quarter of tested era-seed combinations, ALWAYS well past the
25% floor (typically 50-70% through the era, never at the edge), and NEVER in eras 1-3 of any seed —
population is still visibly climbing from founding size that early, so the detector correctly never
calls it stable. That last point matters: the mechanism does nothing to a fresh session's first few
eras (exactly where a player's attention is highest anyway) and only engages once a later era has
genuinely gone quiet.

### Deliberately out of scope for this pass

No player-facing toggle for GameRunner's early-end (per the confirmed decision). No dynamic
mid-era speed changes beyond the opening ramp (e.g. no automatic slow-down when something *new*
starts happening again after equilibrium, only the reverse). No application to headless/scripted
runs (`game/era.ts`'s synchronous `advanceEra`, used by tests and `advanceGameEra`) — that path
always runs its full configured tick budget by design (`endedEarly: false` always), since a
headless caller isn't "watching" anything for pacing to matter to.

**Implementation status (2026-08-13): built as designed, tuned empirically, verified live.**

`sim/equilibrium.ts` (`isEcosystemStable`) and `app/pacing.ts` (`rampedTicksPerFrame`) added as
planned. `GameRunner.stepEraAdvance`/`finalizeEraAdvance` updated for the ramp + early-end;
`EraSummary` gained `endedEarly`/`plannedTick` (the headless `game/game.ts` `advanceGameEra` path
sets `endedEarly: false` unconditionally, per its own doc comment, since it never animates or checks
equilibrium). `SimRunner` gained `autoPace`/`setAutoPace`/`isFastForwarding`, a `lastEventfulTick`
tracked through `restart`/`loadScenario`/`apply`/scripted scenario interventions/checkpoint restore
(an undo is itself a fresh eventful moment, restarting the ramp rather than leaving it mid-ramp
against a tick count that just jumped backward). `ui/controls.ts` gained the "Ended early" era-summary
line, a Classic Sandbox "Auto-pace" checkbox (off by default, same row style as the existing
deuteranopia/heatmap toggles), and a fast-forwarding status-line note; wired through `main.ts`.

Two existing `gameRunner.test.ts` assertions encoded the old flat-speed behavior as a hard tick count
per frame — updated deliberately (matching this project's established pattern for intentional
behavior changes) rather than left broken, plus new tests added for: the ramp reaching full speed
past its window, a normal era running its full budget (`endedEarly: false`), and a later era actually
ending early for a concrete seed (the same empirical finding the tuning note above is based on). New
`sim/equilibrium.test.ts` and `app/pacing.test.ts` cover the two pure functions directly. New
`SimRunner autoPace` tests cover the off-by-default guarantee, the ramp restarting after a fresh
intervention, and fast-forwarding actually engaging once a concrete seed's ecosystem goes stable.

Full suite green (327 passed — up from 308 — 1 pre-existing documented skip). Typecheck clean.
Benchmark unaffected (this feature never touches `sim/`'s `tick()` hot path — the detector and ramp
are purely app-layer decisions about how many times to call an unmodified `tick()`), confirmed by an
unchanged benchmark run. Live-verified in browser: a full 6-era Game Mode session (seed 12345) ran
cleanly with zero console errors, era summaries rendered correctly across every era including the
new trait-shift/population lines; the "Ended early" line didn't happen to fire for this particular
seed within 6 eras, consistent with the ~25% empirical firing rate found during tuning (the mechanism
is unit-tested directly against a seed where it does fire, rather than relying on catching it live).
Classic Sandbox's new Auto-pace checkbox toggled correctly and played forward with zero console
errors.

## Addendum 14 — the carnivory fix: a real hunting threshold + carnivory-coupled combat

Design note, written before implementation. Closes a player-reported symptom flagged mid-M6
(2026-08-13, same day as the era-pacing item above): carnivores weren't manifesting in play —
creatures walked around without visibly converting to predation in a way that read as working.
Root-caused via a throwaway probe script (since deleted) before any fix was proposed, per this
project's own discipline: two seeds, 30k ticks each, plain `DEFAULT_PARAMS`. Mean carnivory crashed
from its initial ~0.5 to ~0.01-0.05 within the first 1-2k ticks and never recovered —
`fracHigh(carnivory>0.6)` (real specialists) stayed at 0.000 the entire run, both seeds — while
predation deaths were still a large and growing share of total deaths (up to ~40% late-game),
smeared across nearly the whole population rather than concentrated in a specialist lineage. Two
compounding mechanical causes, both found by measurement, not guessed:

1. The prey-sensing gate in `creature.ts`'s `senseFoodOrPrey` (`meatGain > 1e-6`) was essentially a
   no-op — since `meatGain = maxGain × carnivory²`, it opened at carnivory ≈ 0.0007, so virtually
   the entire post-selection population (sitting at 0.01-0.1) sensed and opportunistically attacked
   nearby creatures regardless of any real specialization.
2. `combatSuccessProbability` (predation.ts, now phenotype.ts per Addendum 11) depended only on
   size/speed, never on carnivory — carnivory only gated energy YIELD from a kill, never access to
   the kill itself. Zero cost to attacking with near-zero carnivory (free removal of a competitor)
   while a real specialist only bought a small quadratic bonus, killing the incentive gradient that
   would otherwise push carnivory up toward 1.

Two decisions confirmed via AskUserQuestion before writing this (both "Recommended" chosen, one
combined): (1) fix both causes together rather than one alone, since they compound — the gate stops
free-riding, the combat coupling gives a real reason to keep specializing past the gate; (2) the
goal is genuine predator/prey speciation (mirroring `aquaticAdaptation`'s proven pattern), not just
quieting the background noise — this pass is held to the same bar Addendum 12 held amphibious
speciation to: a real fork under ordinary, non-isolated `DEFAULT_PARAMS` play.

### The fix

**A real hunting floor.** New `Params.carnivoryHuntingThreshold` (default 0.4): `senseFoodOrPrey`
now gates prey-sensing on `genome.carnivory >= params.carnivoryHuntingThreshold` directly, not on
the derived `meatGain` epsilon. Below the floor, a creature never senses or attempts prey at all,
full stop — predation becomes a genuine specialist behavior instead of near-universal background
noise.

**Combat success coupled to carnivory.** `sim/phenotype.ts`'s `derivePhenotype` gains a `params`
argument (previously genome-only) and `attackPower` is no longer a pure pass-through of size: it's
`size × lerp(carnivoryAttackMultiplierMin, carnivoryAttackMultiplierMax, carnivory)`. `evasionPower`
stays a pure pass-through of speed — being hunted doesn't depend on your OWN carnivory, only your
speed relative to whoever's chasing you. This is the actual incentive fix: a full specialist now
genuinely outfights a barely-qualifying opportunist of the same size, not just extracting more
energy from the same odds of a kill.

Both levers now scale with carnivory independently and compound: attack SUCCESS (via the new
`attackPower` multiplier) and kill ENERGY YIELD (via the existing, unchanged `specializationFactor`
curve) both reward pushing carnivory higher once past the hunting floor.

### Tuning, confirmed empirically before locking defaults (scripts/probe-carnivory-fix.ts, since
deleted)

Swept `carnivoryHuntingThreshold`/`carnivoryAttackMultiplierMin`/`Max` against 6 seeds × 30k ticks
each, plain `DEFAULT_PARAMS`, checking for real specialization (`fracHigh(carnivory>0.6)`) and an
actual confirmed taxonomy split with `dominantDivergentGene === "carnivory"`:

- **threshold=0.4, min=0.4, max=3.0 (shipped):** 4 of 6 seeds developed real specialization
  (`fracHigh` reaching 0.38-0.80), and **3 of 6 produced a genuine carnivory-dominant speciation
  event** (tick 6,700 / 4,800 / 11,200) — under plain, non-isolated `DEFAULT_PARAMS`, no artificial
  isolation needed. A 50% real-speciation rate across 6 seeds is a stronger empirical result than
  Addendum 12's own bar for amphibious speciation ("seed 6 produces a genuine event").
- **threshold=0.35, min=0.4, max=4.0:** worse — lower success rate, AND one seed (5) went fully
  extinct at tick 2,713. A lower hunting floor combined with a stronger attack multiplier makes
  attacks both more frequent (more of the population qualifies) and more lethal (bigger multiplier),
  which can compound into a real population collapse — the same class of risk Addendum 7's
  `attackCooldownTicks` was originally tuned against, now showing up again from a different lever.
- **threshold=0.3, min=0.3, max=4.0:** also worse than the shipped config, no extinctions but a
  lower real-speciation rate and later, less reliable timing.

The two "no split" seeds under the shipped config aren't a bug — matches the established pattern
(Addendum 3's life-history finding, Addendum 9's water-coverage variance) that not every seed is
expected to produce every possible outcome; carnivory has to first survive an initial population-wide
crash toward 0 (fruit is cheap and reliable, meat has to pay for itself) before the attack-power
incentive can pull a sub-population back up past the hunting floor, and whether that survival happens
is genuinely stochastic per seed.

### Deliberately out of scope for this pass

No change to the meat energy-yield curve itself (`specializationFactor`/`gainPerUnit`, unchanged) —
only the two new levers (sensing gate, attack power) needed fixing. No dedicated visual encoding for
carnivore lineages beyond what already exists (hue already encodes diet+foraging via
`render/color.ts`). No player-facing tuning UI for the three new params — same "Phase 7 exposes all
of `params.ts`" deferral every other tunable already lives under.

**Implementation status (2026-08-13, same session as the era-pacing item above): built exactly as
designed, tuned empirically, live-verified.**

`Params` gained `carnivoryHuntingThreshold`/`carnivoryAttackMultiplierMin`/
`carnivoryAttackMultiplierMax` (grouped under `EvolutionParams`, alongside `attackRange`/
`attackCooldownTicks`). `creature.ts`'s `senseFoodOrPrey` gate rewritten to check
`genome.carnivory >= params.carnivoryHuntingThreshold` directly (meatGain computation moved inside
the gated branch, since it's now only needed there). `phenotype.ts`'s `derivePhenotype` gained a
`params` argument and the carnivory-scaled `attackPower` formula; all three call sites
(`creature.ts`, `predation.ts`, and `phenotype.test.ts`) updated.

Adding a real gate + a real combat incentive is the kind of population-dynamics change that reliably
reshuffles RNG-consumption order (same "expected, budgeted churn" every major axis addition this
project has caused — Addenda 6/9/12 all note the same pattern). Found and fixed one **real
pre-existing confound**, not just RNG churn: `axisIsolation.test.ts`/`goldenScenarios.test.ts`'s
shared `NEUTRAL` constant never flattened predation, so any founder's incidental carnivory above
~0.0007 (the OLD gate) meant predation was quietly active and unflattened in tests meant to isolate
OTHER axes — the same class of bug Addendum 12's `aquaticLandPassabilitySteepness` fix already
covers for water. Fixed by adding `carnivoryHuntingThreshold: 1.01` to both files' `NEUTRAL`
(carnivory's range is [0,1], so a threshold just above 1 makes the gate never pass, regardless of
incidental draws). That fix itself shifted RNG sequences enough to need reseeding: the
foraging-axis-isolation test (both the `axisIsolation.test.ts` and `goldenScenarios.test.ts`
copies) moved from seed 1 to seed 2 (found via a 20-seed sweep); the life-history-isolation test
needed no reseed once NEUTRAL was corrected. Two of era-pacing's own new tests (Addendum 13,
built the same session, just before this fix) also needed reseeding since they ran under plain
`DEFAULT_PARAMS` and the carnivory fix genuinely changes population dynamics there: GameRunner's
early-end test moved from seed 1 to seed 7 (era 3 of 3, tick 6,000 planned); SimRunner's
fast-forward test moved from seed 1 to seed 7, absolute tick 5,700 (both found via fresh probe
sweeps, not guessed). A new golden-scenario test (`goldenScenarios.test.ts`, "carnivory-axis
disruption") was added — deliberately NOT axis-isolated, proving the actual goal (a real
herbivore/carnivore fork under ordinary `DEFAULT_PARAMS` play) the same way Addendum 12's milestone
was held to, using seed 3 (split confirmed by tick 6,700).

Full suite green (328 passed — up from 327 — 1 pre-existing documented skip). Typecheck clean.
Benchmark within normal run-to-run variance (no consistent directional regression; population
dynamics genuinely differ now so an exact before/after comparison isn't meaningful, same caveat
every prior population-dynamics-affecting change has noted). Live-verified in browser: Classic
Sandbox run to 64,000+ ticks at max speed with the new desktop sidebar grid active, zero console
errors throughout, trait chart correctly selectable to carnivory.
