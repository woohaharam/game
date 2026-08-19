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

## 12. Game feel

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
- **Balance is tuned by hand**, not by simulation sweeps. The headless test
  harness could drive automated balance runs; that work has not been done.
- **The boss is one archetype re-skinned by depth**, with scaling health and an
  extra spiral arm per phase. Distinct bosses per floor would be better.
- **No run history or leaderboard.** Only a best score persists.
