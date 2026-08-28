# Architecture & design notes

This document covers the decisions that were not obvious, and the trade-offs
behind them. It is aimed at someone reading the code with a critical eye —
"why is it done this way and not the simpler way" — rather than at a player.

---

## 1. Why no engine

Unity, Godot and Phaser would all have got a playable roguelike out faster. The
project exists to show the layer underneath: the loop, the collision broadphase,
the pooling strategy, the audio graph. Using an engine would have hidden exactly
the parts worth showing.

The cost is real and worth naming: no editor, no physics solver, no asset
pipeline, and every piece of tooling is hand-rolled. That is an acceptable trade
for a portfolio piece and a bad one for a commercial project on a deadline.

The engine layer under `src/engine/` is deliberately game-agnostic — it knows
about loops, input and rendering, never about dungeons or upgrades — so it could
be lifted into another project unchanged.

## 2. Fixed timestep, interpolated rendering

`src/engine/loop.ts`

Simulating with a variable delta makes behaviour depend on frame rate. Bullets
tunnel through walls at low frame rates; acceleration curves differ between a
60 Hz laptop and a 144 Hz monitor; and worst of all, bugs stop reproducing
because they only appear at one particular frame time.

So the simulation always advances in exact 1/60 s slices, and the renderer
interpolates between the two most recent states using the leftover accumulator
as `alpha`. Every drawable entity keeps `px`/`py` alongside `x`/`y` for this.

Two guards matter:

- **Elapsed time is clamped to 250 ms.** A backgrounded tab or a paused debugger
  would otherwise hand the loop ten seconds of arrears.
- **At most five ticks per frame**, and any remainder is dropped rather than
  carried. Under sustained overload the game runs briefly in slow motion instead
  of entering a death spiral where catching up costs more than it recovers.

## 3. Determinism, and why there are two RNG streams

`src/engine/rng.ts`, `src/game/world.ts`

The whole run derives from one 32-bit seed. Each floor's seed is derived from
the run seed and its depth (`seed + depth * 0x9e3779b1`) rather than being drawn
fresh, so a run replays end to end from a single number.

The generator is **mulberry32** — small, fast, and statistically fine for
gameplay. It is explicitly not cryptographic and is documented as such at the
definition.

The subtle part is that the world keeps **two** streams:

- `rng` — gameplay: layout, spawn tables, damage rolls, loot.
- `cosmeticRng` — particles, screen-shake jitter, pitch variation.

If both drew from one stream, adding a particle effect would silently reshuffle
every subsequent loot roll, and any change to the visuals would break seed
reproducibility. Splitting them means the presentation layer can be reworked
freely without touching what a seed produces.

## 4. Dungeon generation: graph first, tiles second

`src/game/dungeon/generator.ts`

**Stage one** grows an abstract graph of cells. A candidate cell is rejected if
it already touches more than one placed room, which is what turns a shapeless
blob into a branching tree with genuine dead ends. One or two extra links are
then added to create loops, so backtracking across a cleared floor is not
tedious. Dead ends become the treasure, shop and boss rooms — reaching a reward
should cost a detour.

**Stage two** carves that graph into a tile grid. Rooms vary in size but are
always centred in their cell, and corridors always run along the cell's centre
line. That single invariant means door alignment falls out for free: no
per-pair fixups, no special cases, regardless of how differently sized two
adjacent rooms are.

### The validation pass

Obstacle patterns (pillars, crosses, diamonds) are designed not to seal
anything off. During development, one of them did anyway: an unbroken diamond
ring enclosed the centre of the room, and 67 of 200 test seeds produced a pocket
of floor with no way in.

The pattern was fixed — but "the patterns are careful" is not a guarantee across
every seed and every room size. So generation now ends with a flood fill from
the start room, and any tile the flood cannot reach is turned back into solid
rock. The invariant is enforced by construction rather than by care, and the
seed sweep in `tests/dungeon.test.ts` proves it holds.

This is the general shape of the approach used throughout: prefer a cheap
structural guarantee over a promise that the inputs will always be well-behaved.

## 5. Collision

`src/game/collision.ts`, `src/engine/spatial-hash.ts`

Two separate problems, solved separately:

**Entity vs. world** is circle-vs-tilemap. The map is a uniform grid, so only
the tiles under an entity's bounding box can collide, and each is an
axis-aligned box. Resolution pushes the circle out along the contact normal,
which is what lets the player slide along a wall instead of catching on it. Two
relaxation passes run because resolving one tile can push the entity into
another at an inside corner.

Doors are handled _inside the collision query_ via a `doorsLocked` flag rather
than as separate wall entities. Combat lockdown then costs one boolean instead
of a set of spawned and despawned colliders.

**Entity vs. entity** is a uniform-grid spatial hash. With ~40 enemies and ~200
projectiles live, the naive all-pairs test is 8,000 checks per frame for
bullet-vs-enemy alone. Bucketing by cell brings it down to roughly linear. Cell
coordinates are packed into a single integer key so the `Map` hashes a number
rather than an allocated `"x,y"` string, and the grid is rebuilt from scratch
each frame — everything moves anyway, so clearing reusable buckets beats
maintaining them incrementally.

The hash is a _broadphase_: it may over-report, never under-report. The test
suite asserts exactly that property against brute force on random data.

## 6. Object pooling

`src/engine/pool.ts`

Projectiles, particles, pickups and damage numbers are created and destroyed by
the hundred every second. Allocating them per frame hands the GC a steady stream
of garbage, which surfaces as periodic frame-time spikes — the kind of stutter
players feel without being able to name.

Every such entity comes from a fixed-capacity pool. The important design choice
is what happens when a pool is exhausted: `acquire()` returns `null`, and every
caller treats that as "skip this spawn". A dropped particle is invisible; a
mid-combat allocation spike is not. Pools never grow.

## 7. Enemy AI

`src/engine/fsm.ts`, `src/game/entities/enemy.ts`

All six archetypes share one entity struct and differ only in which state
machine drives them. The update loop stays uniform — no per-type branching in
the hot path — while behaviour reads as named states rather than nested
conditionals.

The FSM tracks `timeInState` centrally because nearly every behaviour needs it
(wind-up length, burst duration, recovery), and hand-rolling that timer per
state is where desync bugs come from.

Every aggressive behaviour follows the same rule: **telegraph, then commit**.

- The shooter has a 0.42 s aim state with a visible sight line, then locks its
  aim at the instant the burst starts — so sidestepping after the telegraph
  dodges the whole volley.
- The brute winds up for 0.55 s, then charges ballistically with no steering.
- The bomber fuses for 0.62 s while drifting slowly, so standing still is
  punished and walking away works.
- The boss telegraphs each of four attacks and picks between them with a
  distance-biased weighted roll — it charges when you are far and sprays when
  you are close, which stops both "hug the boss" and "run away forever" from
  being free wins.

An attack the player could not have seen coming reads as unfair; an attack that
tracks through its own wind-up makes dodging pointless. The rule addresses both.

Enemies also apply a soft separation force via the spatial hash, so a pack of
chasers spreads into a ring around the player instead of collapsing into one
overlapping blob.

## 8. Stats as derived data

`src/game/progression/stats.ts`, `src/game/progression/upgrades.ts`

Upgrades are pure data — a list of stat modifiers plus presentation. Nothing in
the pool executes gameplay code. A build is therefore fully described by the
list of ids the player picked: trivial to log, to show on the death screen, and
to test.

`RunState.refresh()` recomputes the entire stat block from `(base, upgrades)`
rather than mutating stats in place. Recomputation avoids the classic roguelike
bug where removing a buff leaves part of its effect behind.

Modifier application has one rule that matters: **all additive terms land
before any multiplicative one**. Without a fixed order, "+5 damage then ×2" and
"×2 then +5 damage" give different results, and a build's power would depend on
the order upgrades happened to be offered — which players quite reasonably
report as a bug. Floors and ceilings are applied afterwards, and stats that must
be whole numbers are rounded last.

## 9. Simulation / presentation split

`src/game/world.ts` never imports a renderer, a scene, or anything DOM-shaped.
Its entire public surface for advancing time is:

```ts
world.update(step: number, intent: PlayerIntent): void
```

`PlayerIntent` is a direction, an aim point, and two booleans — deliberately
input-agnostic, so keyboard, mouse and touch all produce the same thing.

The payoff is in `tests/world.test.ts`: full runs are simulated headlessly, with
a scripted bot clearing a combat room, thousands of ticks at a time, in under a
second of CI. Asserting "no entity ever ends a tick inside solid geometry" over
20 simulated seconds is only practical because no canvas is involved.

Enemy AI gets an even narrower view — the `CombatContext` interface — rather
than the whole `World`. Behaviour code can shoot, explode and damage the player,
but cannot reach into rendering, run state or the scene stack. It also breaks
the import cycle between the world and its entities.

## 10. Input as intent, and one place that clears it

`src/engine/input.ts`

Gameplay code never reads key codes. It asks whether an _action_ is held or was
pressed this tick. That indirection is what lets keyboard, mouse and touch drive
the same code path, and makes rebinding a data change.

Edge state (`wasPressed`) is latched on the DOM event and consumed once per
simulation tick, so a key tapped between two ticks is never swallowed.

Originally each scene cleared the edges at the end of its own update. That
produced a genuine bug: pressing `Esc` in the pause menu popped the scene
_without_ clearing the edge, so the game scene underneath saw the same press on
the next tick and immediately re-opened the menu. Edge clearing now happens once
per tick in the loop, after the whole scene stack has run — a class of bug
removed rather than an instance fixed.

## 11. Procedural audio

`src/engine/audio.ts`

Every sound is synthesised at runtime from an oscillator, an envelope, and
optionally a filtered noise burst. No `.wav` files, no asset pipeline, and pitch
and length become gameplay parameters — a larger enemy dying is the same routine
at a lower frequency.

Background music is generative: an arpeggio over a pentatonic minor scale whose
tempo and filter cutoff follow a `tension` value the world exposes (0 while
exploring, 1 during a boss fight). Cheaper and more responsive than crossfading
pre-rendered stems.

Browsers refuse to create an `AudioContext` before a user gesture, so the bus is
created lazily on first interaction and every call is a silent no-op until then.
That is also why `AudioBus` is safe to construct in a Node test.

## 12. Replays

`src/game/replay/`

The simulation is deterministic from a seed, so a run is fully described by
that seed plus the sequence of intents the player fed it. A replay is therefore
a recording of _decisions_, not of frames: it re-simulates rather than plays
back, which means it stays correct at any resolution and is a few kilobytes
instead of a video.

It also turns the determinism claim into something demonstrable. "The RNG is
seeded" is a sentence; "here is your run, re-derived from 2.8 KB" is a
demonstration.

### The ordering that makes it work

Intents are quantised **before** the simulation sees them:

```
input → quantise → world.update()
              ↘ recorder
```

The world only ever consumes values that survive a round-trip through the
recording format, so a replay cannot drift from the run it recorded. Quantising
afterwards would be lossy and the two would diverge — slowly at first, then
completely.

Aim is stored at 1/1024 of a turn (0.35°), chosen against the weapon rather
than the display: base spread is ±2.6°, so a third of a degree is already below
the noise floor of the shot itself.

### Size

Three things keep it small, in order of how much they buy:

1. **Change-only frames.** Input is held far more often than it changes, so only
   ticks where the quantised intent differs are stored.
2. **A packed header byte.** Four flag bits plus four bits of tick delta, since
   consecutive frames are the overwhelmingly common case. This removed roughly a
   byte from every frame.
3. **Delta-coded aim.** A mouse moves in small increments; the change in angle
   fits in one byte where the absolute value needs two.

Measured on synthetic worst-case input — keyboard movement plus continuously
moving mouse aim, so nearly every tick stores a frame:

| Run length |  Ticks | Frames | Encoded | Gzipped |
| ---------- | -----: | -----: | ------: | ------: |
| 1 min      |  3,600 |  3,578 |  7.3 KB |  2.6 KB |
| 3 min      | 10,800 | 10,741 | 21.9 KB |  7.0 KB |
| 5 min      | 18,000 | 17,899 | 36.5 KB | 11.1 KB |

A real 23-second run recorded in the browser came to 2.85 KB.

### What had to be recorded beyond movement

Upgrade picks. Everything else a player does reaches the world through the
intent stream, but choosing one of three cards is a decision made in an overlay
while the simulation is paused, so choices are stored as `(tick, upgradeId)`
events and applied during playback in place of showing the picker.

The roll itself still happens in both modes. It draws from the gameplay RNG, so
skipping it during playback would desynchronise every later draw — only the
_picking_ differs.

### How deterministic is it, really

Not absolutely, and the CI matrix is what proved it.

The strict test — record a run, replay it, compare the entire end state — passed
locally and on Node 22, and failed on **Node 20**. Discrete state matched
exactly (score, kills, health, rooms cleared) while position had drifted 147
pixels, with velocity differing in the eighth significant figure.

That is not a logic bug. ECMAScript pins `+`, `-`, `*`, `/` and `Math.sqrt` to
exactly-rounded IEEE-754, but leaves `Math.hypot`, `Math.pow`, `Math.sin` and
friends to the implementation — and V8 may evaluate them differently once a
function tiers up from interpreted to optimised. The record loop runs before
the playback loop, so playback runs against hotter code. In a chaotic system a
difference in the last bit becomes a different room a minute later.

Two of the three worst offenders were removable, so they were:

- `Math.hypot` → `sqrt(x*x + y*y)`, which is exactly specified. It is also
  **13.6× faster** in a 20M-iteration benchmark, which is its own reason.
- `rate ** (step * 60)` → a memoised per-step constant. At a fixed timestep the
  exponent never varies, so the `Math.pow` call was pure overhead.

`Math.sin`, `Math.cos` and `Math.atan2` remain, and cannot be removed without a
fixed-point or software-float math layer. That is exactly why lockstep
multiplayer games use fixed-point arithmetic, and it is out of scope here.

So the honest claim is: **a replay reproduces its run exactly on the engine
that recorded it.** Across engine versions it may diverge. Replays therefore
carry a version that is bumped when the _simulation_ changes, not only when the
format does — a stale replay that plays back plausibly and wrongly is worse
than one that is refused.

### Testing it

`tests/replay.test.ts` records a scripted run, replays the recording into a
fresh world, and compares a fingerprint of the entire end state — player
position and velocity to six decimals, every live enemy's health, position and
FSM state, score, coins, and the upgrade list. Across five seeds, and again
after a binary and a base64 round-trip.

Verified in a real browser too, driving the actual mouse and keyboard path
rather than synthetic intents. The first attempt reported a divergence of
exactly one aim quantum, which turned out to be the harness: the live
fingerprint and the tick counter were read while the loop was still running, so
they described different ticks. Freezing the loop before reading made them
identical. Worth recording because a one-quantum difference looks exactly like
a real quantisation bug.

## 13. Balance simulation

`tools/`, `npm run balance`

Balance was tuned by feel, which is fine for a first pass and useless for
answering "did that change make floor 4 harder, or did I just play worse?".
The simulator runs the real game — same `World`, same rules — hundreds of times
with a scripted player and reports where runs actually end.

This is only possible because the simulation never touches the DOM. A run that
takes three minutes to play takes ~200 ms to simulate, so 500 of them fit in
100 seconds.

Everything the tool measures is **observational**. It reads public world state
each tick and infers the rest — time-to-kill from when an enemy first becomes
active and when it stops being alive, damage taken from health dropping. No
measurement hook was added to the simulation, so what is measured is exactly
what ships.

### The bot is the instrument, so it is written to be boring

It kites at a fixed range, strafes rather than charging, dashes out of incoming
fire after a reaction delay, and takes upgrades in a fixed preference order.
Deliberately _competent, not optimal_: an optimal bot measures a ceiling nobody
plays at. What matters is that it plays the same way every time, so when a
tuning change moves floor-2 survival from 44% to 30%, the change did that.

Its numbers are a lower bound on human performance, not a prediction of it. It
does not lead moving targets, use cover, or bait attacks.

### The assumption that cost the most

The bot first navigated by walking from room centre to room centre, on the
reasoning that rooms sit centred in their cells and corridors run along the
cell centre line — so the straight line between adjacent room centres should
pass through the door joining them.

Measured across 1,416 adjacent room pairs on 60 seeds, that line is blocked
**21% of the time**. Interior cover sits in the way. A one-in-five per-hop
failure compounds: over half of all runs were being abandoned as stalled, which
meant the survival numbers were measuring pathing rather than difficulty.

Four attempted fixes — holding a destination, adding a centre waypoint,
committing to a goal room, suppressing replans in corridors — each moved the
stall rate by a few points and none addressed the cause, because the premise
itself was wrong. Measuring the premise directly took five minutes and settled
it. `tools/pathfinder.ts` now does breadth-first search over the tile grid with
line-of-sight smoothing, and `tests/pathfinder.test.ts` pins both the routine
and the 21% measurement that justified it.

### Stalls are reported, not hidden

A run the bot abandons is a measurement failure, not a result, so the report
excludes it _and_ says which kind it was — a route it could not find, versus a
fight it could not finish behind locked doors. Those have different causes and
one of them is a statement about the game rather than the bot.

Roughly 45% of runs still stall. That is the harness's main limitation and it
is stated at the top of every report.

### What it found, and what it cost to believe it

The generated report lives at [`BALANCE.md`](BALANCE.md). The first thing it
surfaced was that **floor 2 is where runs end**: about three quarters of runs
cleared floor 1 and about 40% cleared floor 2 — a much sharper step than any
other transition, and not visible from playing.

Finding the _cause_ took three attempts, each thrown out by its own data.

**Attempt 1 — unpaired comparison. Wrong answer.** Candidate changes were
compared on aggregate clear rate. With ~90 runs reaching floor 2, the 95%
interval on a 40% rate is about ±10 points, so nothing was distinguishable.
Worse, it pointed backwards: softening the room budget looked _worse_ (37.0%
against 39.1%).

**Attempt 2 — pairing. Readable, but the wrong conclusion.** Every variant
already ran the identical seed list, so the runs were paired all along.
Comparing each seed against itself removes the variance between dungeons, which
had been swamping the effect. Suddenly the budget change was the one
"significant" result — the exact opposite of the unpaired reading, from the same
data.

That should have been suspicious, and a dose-response check made it so: the
response was not monotonic (1.35 → +0.153, 1.15 → +0.094, 0.9 → +0.211). A real
lever does not behave that way.

**Attempt 3 — a metric that can see.** Integer floor reached tied on roughly
60% of paired seeds. Dying two rooms into floor 3 and dying one room short of
its boss are very different outcomes that "reached floor 3" cannot separate.
Scoring on completed floors _plus the fraction of the current floor cleared_
recovered that discarded signal — and the budget effect vanished entirely, all
three doses indistinguishable from zero. It had been an artefact of the coarse
metric the whole time.

What survived, over 500 paired seeds:

| Variant                      |   Mean Δprogress | 95% CI           |                |
| :--------------------------- | ---------------: | :--------------- | :------------- |
| stagger archetype unlocks    |           +0.159 | +0.022 to +0.296 | **detectable** |
| soften enemy health          |           +0.130 | +0.006 to +0.253 | **detectable** |
| soften boss health           |           +0.114 | -0.025 to +0.254 | —              |
| soften room budget (3 doses) | -0.025 to +0.071 | all span zero    | —              |

**No single number was mis-tuned.** Four things escalate at once on the floor-1
to floor-2 transition — room budget up 46%, enemy health up 22%, boss health up
35%, and _two_ new archetypes unlocking simultaneously — and each contributes
about a tenth of a floor.

The change that shipped is the one with both a measurable effect and a reason
rather than a number: bomber, turret and brute now unlock on floors 2, 3 and 4
instead of 2, 2 and 3, so a player meets one new enemy per floor. Floor-2 clear
rate moved from 40.9% to 49.8%, and the step softened without displacing to
floor 3, which also improved.

It did not _eliminate_ the step — floor 1 still clears at 76% against floor 2's
50%. That is an honest result, not a solved problem.

## 14. Game feel

`src/game/config.ts` (the `FEEL` block)

The mechanical difference between a game that works and one that feels good:

- **Hit-stop.** The whole simulation freezes for 35 ms on a normal hit and 90 ms
  on a critical. The single cheapest way to make a hit land.
- **Trauma-based screen shake.** Hits add trauma; offset scales with trauma²
  and decays per second. Many small hits accumulate; light feedback stays
  subtle while a boss slam is unmistakable.
- **Input buffering.** A dash pressed slightly before the cooldown clears still
  fires. Players do not perceive their own early presses as errors.
- **Generous invulnerability.** Dash i-frames outlast the dash itself, so a
  dodge that is a frame late still works.
- **Slow motion on damage**, which reads as "that hurt" without a UI element.
- **Camera lead** toward the crosshair, so the player can see what they are
  aiming at without the camera drifting off them.

All of it is centralised in the config file, so the game's entire feel is
reviewable as a single diff.

## Known limitations

Being straight about what is not here:

- **Canvas 2D, not WebGL.** Glow via `shadowBlur` is the main per-draw cost and
  is why there is a low-quality toggle. WebGL would allow far more on screen —
  but Canvas 2D keeps the renderer readable, which suits the purpose here.
- **No gamepad support.** The input layer is built for it; it is simply not
  wired up.
- **The balance bot stalls on roughly 45% of runs**, mostly by failing to
  navigate. Those runs are excluded and classified, but a lower stall rate
  would tighten every interval in the report.
- **The boss is one archetype re-skinned by depth**, with scaling health and an
  extra spiral arm per phase. Distinct bosses per floor would be better.
- **No leaderboard.** Replays are kept locally — the last run and the best-scoring one — and can be copied out as text, but there is nowhere to submit them.
