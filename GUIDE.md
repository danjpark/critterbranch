# Critterbranch — Player's Guide

*A guide to what the game is, what you're looking at, and what's real today vs. what's still on the drawing board. Written from the actual code, not the wishlist — every "✅ Built" claim below you can go click on right now.*

---

## 1. What is this, in one paragraph

Critterbranch drops a population of simple digital creatures onto a 2D map and lets them live: eat, move, reproduce, mutate, hunt, and die, tick by tick, thousands of times. Nobody designs the species — they emerge on their own from a handful of heritable genes and whatever pressure the environment puts on them. Your job isn't to control the creatures directly. **You reshape the world** — raise a mountain, flood a valley, drop a meteor, plant a forest — and watch the population evolve to survive what you did to it. The payoff is a **phylogenetic tree**: a branching diagram of every lineage that ever split off, why it split (a mountain range? a competition for food? just random drift?), and whether it's still alive.

Everything is **deterministic**: the same starting seed plus the same sequence of your actions always produces the exact same outcome, down to the tick. That's what makes "export this run and send it to a friend" a real feature, not a rough approximation.

---

## 2. Two ways to play

| Mode | What it is | Status |
|---|---|---|
| **Classic Sandbox** | Free play. No goals, no budget, no eras — just press Play and terraform whenever you want, for as long as you want. | ✅ Built |
| **Game Mode** | A structured loop: **Terraform → Evolution → Discovery**, repeated era after era, with a points budget for your terraforming actions and (in Challenge mode) win conditions to hit. | ✅ Built |

Switch between them with the **Classic Sandbox / Game** tabs at the top of the screen.

### The Game Mode loop
1. **Terraform** — the sim is paused. Spend Terraform Points on god-mode tools (below). In Sandbox sub-mode points are unlimited; in a Challenge they're capped per the challenge's budget.
2. **Advance Era** — the sim runs forward a stretch of ticks, visibly (you can watch it happen at 1x–1000x speed, not just jump to the result). The opening stretch always animates at a gentler pace regardless of your chosen speed, so the eventful early ticks are actually watchable; if the ecosystem settles into equilibrium (population, every gene's mean, and no new splits/extinctions all gone flat) well before the era's tick budget is spent, the era ends there instead of grinding out a dead tail — the Era Summary says so when it happens.
3. **Discovery** — the era stops, and an **Era Summary** tells you what changed: population before/after, species gained/lost, and which genes moved the most.
4. Back to Terraform, or **Continue** straight into the next era if you don't need to act.

**Checkpoints** let you save a named point in time and jump back to it later — like a git branch, not an undo stack. Restoring one never deletes the others.

---

## 3. The World view — what you're actually looking at

The main map is a **toroidal** 2D grid (it wraps at the edges — walk off the right side, you appear on the left). It's rendered in a hand-drawn, ink-on-parchment style deliberately, so the loud thing on screen is always the creatures, not the ground.

### Terrain (the ground)
The ground is shaded into four bands by elevation, with thin ink contour lines at every boundary:

| Band | Look | Meaning |
|---|---|---|
| **Water** 🌊 | Cool desaturated blue-gray, darker in deeper spots, with a faint green cast where it has real food | Elevation below sea level. Deep water is barren and near-impassable to a land specialist, while a creature with high `aquaticAdaptation` can cross it almost as easily as land. **Shallow water near shore is different** — it can grow fruit trees, giving aquatic lineages a modest food source of their own. |
| **Lowland** | Warm tan/parchment | Flat, easy ground. |
| **Hill** | Darker tan-brown | Moderate elevation — some movement penalty. |
| **Mountain** | Dark brown, lightening toward a pale "snow-cap" near the very peak | High elevation — a real movement/food penalty. |

Shading within a band also darkens slightly wherever passability is reduced (e.g. a hand-placed barrier) and tints slightly with fertility — so a barrier or a drought is visible on the map even if it didn't change the elevation band.

### Fruit trees
Fruit is shown as a small procedural tree glyph, with a trunk and an irregular leafy canopy, rather than the old green square. **Canopy size shows development and potential yield**: a new sapling starts at a visible minimum and grows until the exact tick it becomes fruit-producing, while naturally poorer trees stay smaller than rich ones even when mature. **Canopy color shows how much fruit is available right now**: a depleted tree fades toward pale olive and a full tree becomes vivid green.

These aren't decorative markers over a static food grid. Fruit trees are living, spatial entities: a sapling matures over time, produces fruit, can spread new saplings nearby when eaten from, and can die off if crowded by neighbors. Trees grow on land and in shallow coastal water alike; they never take root in the deep.

### Creatures
Colored dots. **Every part of the color is computed straight from the creature's genes** — nothing is arbitrary:

- **Hue** (the color itself, red/green/blue/etc.) — a mix of two things: how carnivorous vs. herbivorous the creature is, and its foraging style (fast/wide-ranging "commuter" vs. slow/local "camper"). Two creatures that eat totally differently, or forage totally differently, will look like different colors even from the same ancestor.
- **Chroma** (how saturated/vivid the color is) — how far this creature has genetically drifted from its **founding ancestor**. A pale, washed-out dot is still close to the original population; a vivid, saturated one has diverged a lot.
- **Lightness** (how light/dark) — its life-history strategy: darker = fast-and-cheap reproduction (many small investments), lighter = slow-and-expensive (few, heavily-invested offspring).

There's a **"Deuteranopia-safe hues"** toggle that restricts the color wheel to a blue-orange axis for colorblind-safe viewing, and a **competition heatmap** overlay that shows per-species food-consumption pressure across the map.

Classic Sandbox also has an **"Auto-pace"** toggle (off by default, so nothing changes unless you opt in): when on, playback ramps to a gentler pace right after you start, restart, load a scenario, or use a god-mode tool, then fast-forwards once the ecosystem has gone quiet for a while — the status line notes when it's fast-forwarding so it's clear that's what's happening, not your chosen speed being ignored.

Click any creature to open the **Inspector**: its id, parent, birth tick, age, energy, and the exact numeric value of every one of its 10 genes.

---

## 4. What makes a creature — the genes

Every creature has exactly 10 heritable numbers. A child's genes are its parent's genes plus a small random mutation (the size of the mutation is itself controlled by one of those genes, so "how mutable I am" is itself evolvable).

| Gene | Range | What it does |
|---|---|---|
| `carnivory` | 0 (herbivore) – 1 (carnivore) | How much of its diet comes from meat vs. fruit. A generalist (0.5) is actually **worse** at both than a specialist at either extreme — that penalty is what makes diet a real evolutionary fork, not a free choice. Only a creature well past the herbivore end (a real hunting threshold, not "any nonzero value") ever senses or attempts prey at all, and a committed specialist genuinely fights better, not just eats better on a kill — so half-measures don't pay off. |
| `speed` | 0.2 – 3.0 | How far it moves per tick (modulated by terrain passability). |
| `senseRadius` | 0 – 20 | How far it can detect food or prey. |
| `wanderPersistence` | 0 – 1 | How much it keeps heading the same direction vs. changing course randomly. |
| `size` | 0.5 – 2.0 | Bigger = more energy capacity and higher attack power in a fight, but costs more to move and metabolize. |
| `reproThreshold` | 0.4 – 0.95 | What fraction of max energy it needs before it can reproduce. |
| `offspringInvestment` | 0 – 1 | How much energy it hands each child at birth — the one-time half of the "cheap-and-many vs. expensive-and-few" (r/K) trade-off. |
| `nursingDuration` | 0 – 600 ticks | How long a parent keeps *actively feeding* each child after birth, on top of the birth endowment above — the ongoing half of that same r/K trade-off. |
| `mutationRate` | 0.001 – 0.2 | How much a creature's own children's genes are allowed to drift from its own. |
| `aquaticAdaptation` | 0 (land specialist) – 1 (water specialist) | Same "specialist beats generalist" shape as `carnivory`: pushes toward 1 and land gets harder while deep water opens up almost freely; pushes toward 0 and the reverse. A 0.5 generalist is worse at both than a specialist at either extreme — the fork that makes amphibious speciation possible. |

### How creatures actually behave, per tick
Sense nearby fruit *and* nearby creatures-as-potential-prey (scored by the same mechanism — a herbivore naturally never finds attacking worth it, no special-casing needed) → steer toward whichever scored best → move (slowed by terrain) → pay metabolism → either eat fruit where it landed, or, if it ended within attack range of prey and isn't on attack cooldown, roll a contest (`attack power / (attack power + evasion power)`) to try to kill and eat it. A successful kill removes the prey and feeds the predator, scaled by how specialized it actually is toward meat.

---

## 5. How the tree forms — speciation

Every so often the simulation looks at each living population and asks: *is this actually one genetically-cohesive group, or has it quietly split into two?* It looks for a real statistical gap between two clusters (not just "any two creatures differ somewhat," which is true of every population ever) — and a candidate split has to show up on **two consecutive checks** before it's promoted to a real, permanent species. Once promoted, every split is tagged with **why** it happened:

| Icon | Mechanism | Meaning |
|---|---|---|
| ● | **Founding population** | The original population you started with — not a split, the root(s) of the tree. |
| ▲ | **Allopatric** | A geography barrier (low-passability terrain — a mountain range, a strait, a hand-placed wall) physically separated two groups until they drifted apart. |
| ◆ | **Sympatric** | No barrier at all — the population split anyway, purely from disruptive selection (e.g. a resource too good to share, so specializing one way or the other beats staying a generalist). |
| ○ | **Founder effect** | A small breakaway group drifted apart by chance (genetic drift), not selection or geography. |

Every split and every extinction is logged in the **Event feed**, with the tick it happened, which genes diverged most, and how many founders were involved.

---

## 6. Every other panel, and what it's for

| Panel | What it shows |
|---|---|
| **Tree view** | The actual phylogenetic tree — branches colored by genotype, tick on the x-axis, mechanism icons at every fork. Click a branch to open the **species card**: status (alive/extinct), lifespan, peak/current population, mechanism, and — once there's enough evidence — its **demonstrated capabilities** (below). |
| **Muller plot** | Population share of every living lineage, stacked over time — good for seeing which branch is winning at a glance. |
| **Gene-space scatter** | Every creature plotted by two genes you pick (any of the 10). Doubles as its own color legend — no separate key needed, since every dot is already colored by the same rule as the World view. |
| **Gene flow chart** | Migrations between the west and east halves of the map, per time window. Watching this drop to zero *is* speciation happening in real time. |
| **Trait over time chart** | Population mean ± standard deviation of one selected gene, over the whole run. |
| **Event feed** | Chronological log of every speciation and extinction. |
| **Inspector** | Full gene readout of whichever single creature you last clicked. |

### Species capabilities (what the species card can tell you)
Once a species has enough living members to be confident about, the game infers labels about it from its **actual observed behavior** — not from reading its genes directly (a creature could theoretically have carnivory genes and never once successfully hunt). Possible labels: **Omnivore / Herbivore / Carnivore**, **Highland-Adapted / Lowland-Adapted**, **Aquatic-Adapted**, **Fast-mover / Sedentary**, **r-strategist / K-strategist**, **Resilient / Fragile** — each with a confidence score and a plain-English reason ("Draws 82% of intake from meat," "63% of members observed in mountain terrain," "30% of members observed in water").

---

## 7. God Mode — the terraforming tools

Select a tool, then click the map. Every action costs Terraform Points in Game Mode (unlimited in Classic Sandbox).

| Tool | What it does |
|---|---|
| **None (inspect)** | Just click creatures to inspect them — no terraforming. |
| **Raise / Lower terrain** | Reshape elevation in a radius around your click — carves hills, valleys, and (now) can dig all the way down into new water or push land back up out of it. |
| **Barrier** | Click twice to draw a wall of near-zero passability between two points — the most direct way to force an allopatric split by hand. Can form instantly or ramp up gradually over time. |
| **Plant tree** | Scatter new, already-mature fruit trees in a radius. |
| **Drought / Bloom** | Temporarily suppress or boost regrowth in a region. |
| **Meteor** | Strikes a location: kills everything in range and craters the ground (fertility drops to zero, recovers gradually). The single most destructive tool — has its own **Undo** button for exactly this reason. |
| **Seed founders** | Drop a fresh batch of creatures with random genomes at a point. |
| **Raise / Lower sea level** | Global, not local — one click shifts the waterline **everywhere on the map at once**, not just near where you clicked. Flood a land bridge to split a population, or drain a strait to reunite two that a natural sea once separated. |

**Scenarios**: any run (seed + every terraforming action, timestamped) can be exported as a `.json` file and reloaded later — including by someone else, since it's fully deterministic. Two bundled examples ship with the app: a scripted **barrier split** and a **meteor extinction**.

---

## 8. Challenges (Game Mode)

| Challenge | Goal |
|---|---|
| **Fork the Family** | Get four living species coexisting from one founding population. |
| **Picky Eaters** | Produce a species whose diet leans hard toward one food source (fruit or meat). |
| **After the Fall** | Trigger a real population collapse, then recover biodiversity afterward. |
| **Apex Predator** | Sustain a population of real size that draws most of its diet from hunting, not scavenging. |
| **Island Hopper** | Produce a species that spends a real share of its time in water — you'll likely need to terraform for it (raise sea level, carve straits) since the starting map won't just hand it to you. |
| **Amphibian's Fork** | Cause a speciation event driven by the land/water trade-off — watch one population split into a land branch and a water branch. |

*(These are explicitly first-pass content to exercise the objective/budget system end to end, not final tuned difficulty — expect them to get reworked.)*

---

## 9. What's built vs. what's still on the drawing board

Critterbranch is being built in milestones. Everything above this line is real and playable today. Here's the honest state of the roadmap:

### ✅ Built
- **Core simulation**: deterministic tick loop, 10-gene creatures, mutation, reproduction, metabolism, energy.
- **Persistent fruit-tree food economy**: trees mature, spread, and die on their own — not a static grid.
- **Procedural fruit-tree glyphs**: each tree has a stable hand-drawn silhouette; saplings visibly grow, rich trees mature larger than poor ones, and canopy color tracks current fruit supply.
- **Predation**: carnivory as a real trade-off, with a genuine hunting threshold (only creatures with real carnivory investment sense/attempt prey at all — no more diffuse background attacking) and a combat contest where a real specialist actually outfights a barely-qualifying opportunist, not just earning more meat per kill. Meat as a second food source, cannibalism allowed.
- **Speciation detection**: gap-based bimodality test, confirmation passes, allopatric/sympatric/founder-effect classification with evidence.
- **Terrain as a real force**: elevation, movement/food penalties, procedurally-generated natural water at world-gen, and a player-facing Raise/Lower Sea Level tool.
- **Water as a real niche with a genetic edge**: shallow coastal water grows real fruit trees using the exact same mechanics as land. A creature's `aquaticAdaptation` gene now makes water passability personal — a water specialist can cross deep, open water nearly as easily as land, at the cost of being genuinely awkward on land, mirroring `carnivory`'s "specialist beats generalist" shape.
- **Full genotype→phenotype→performance pipeline**: one consistent seam (`Phenotype`, `derivePhenotype`, `movementEfficiency`, `combatSuccessProbability`) that movement and combat both read from — no more ad hoc per-system gene reads.
- **Amphibious speciation**: a population can genuinely fork into a land branch and a water branch, driven purely by the land/water trade-off, with its own capability label and challenge.
- **Full god-mode toolkit**: terrain, barriers, trees, drought/bloom, meteors (with undo), founder-seeding, sea level.
- **Observability layer**: SpeciesProfile (real demonstrated diet/habitat/movement/reproduction/survival stats) and the Capability classifier built on top of it — never reads genes directly, only actual behavior.
- **Game Mode**: Terraform → Evolution → Discovery loop, Terraform Points budget, Era Summaries, checkpoints, 6 prototype challenges, and adaptive era pacing that animates eventful opening ticks before ending settled eras early.
- **Classic Sandbox auto-pacing**: an opt-in mode that eases into eventful stretches and fast-forwards once the ecosystem is quiet, without changing the player's selected speed setting.
- **Visualization**: World map (parchment terrain style), phylogenetic Tree view, Muller plot, gene-space scatter, gene-flow chart, trait-over-time chart, event feed.
- **Scenario export/import/replay**, deterministic headless replay verified to match live play exactly.
- **Desktop layout**: the sidebar's panels flow into a multi-column grid on a wide screen instead of one long stacked list, so a real monitor reads landscape instead of a narrow phone-width column. Component styling (buttons, panel chrome) is unchanged — this is a layout-shape fix only.

### 🔭 Planned, not yet built (in rough order)
| Milestone | What it adds |
|---|---|
| **M7 — Procedural creature appearance** | Species get real visual bodies derived from phenotype (species cards, not per-dot rendering) — including watching a lineage visibly sprout new features (fins, wings) as it evolves toward a new capability. Also where the "2.5D" visual upgrade lands. |
| **M8 — 10-20 handcrafted challenges** | Real, tuned challenge content (today's 6 are first-pass scaffolding). |
| **M9 — Flight** | Another emergent capability from morphology × environment, same pattern as amphibious speciation. |
| **M10 — Ecosystem expansion** | Climate, seasons, migration, and any other systems layered on top once the core loop is proven. |

### Known, honestly-documented gaps (not hidden, not silently broken)
- **Post-extinction "radiation"** (survivors re-diversifying into a brand-new lineage after a meteor wipes one out) isn't reliably reproducible within a practical simulation length yet — the extinction half works fine and is tested; the radiation half is marked as a known open question in the code, not faked.
- The **foraging-axis-in-isolation** diagnostic and a couple of other deep-internals test scenarios are seed-sensitive by nature of how young this particular mechanic still is — none of this affects normal play, only the project's own internal calibration tests.

---

## 10. Quick-start: your first five minutes

1. Open the app, stay on **Classic Sandbox**.
2. Hit **Play**. Watch dots move and eat for a bit — notice the fruit squares shrink where creatures cluster.
3. Pick **Raise terrain** under God Mode, click a spot to build a hill. Watch the color band change and creatures start avoiding the steeper slope.
4. Pick **Barrier**, click two points across the middle of the map to wall it off. Let it run a few thousand ticks at high speed (try `1000x`).
5. Switch to the **Tree** view. If the wall held long enough, you should eventually see a fork appear with a ▲ icon — an allopatric split, caused entirely by the wall you drew.
6. Try **Raise sea level** a few times and watch the World view — a visible portion of the map should turn blue-gray as it floods.
7. When you're ready for goals instead of free play, switch to **Game** mode and pick a Challenge from the dropdown.

---

*Last reconciled with commit `475f5dd` (procedural fruit-tree glyphs), including Milestones 5–6, adaptive era pacing, the carnivory fix, and desktop layout. If something here doesn't match what you see on screen, the code is the source of truth.*
