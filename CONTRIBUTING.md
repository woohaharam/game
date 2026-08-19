# Contributing

Thanks for taking a look. This document covers how to get set up, what the
project expects from a change, and the few conventions that are not obvious.

## Getting started

Node 20 or newer (`.nvmrc` pins the version used in CI).

```bash
npm install
npm run dev      # http://localhost:5173
```

## Before you open a pull request

```bash
npm run verify   # format:check → lint → typecheck → test
```

CI runs exactly this, so a green `verify` locally means a green pipeline. Run
`npm run format` and `npm run lint:fix` to apply the automatic fixes.

**Play your change.** The test suite proves the simulation is correct; it cannot
tell you whether the game still feels good. Anything touching movement, combat
or camera needs a browser and a real run before it is ready for review.

## Branches and commits

Branch from `main`, named `type/short-description`:

```
feat/orbital-blade-scaling
fix/door-lock-softlock
docs/architecture-collision-section
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(upgrades): add Echo Chamber double-volley roll
fix(collision): stop entities catching on inside corners
perf(world): replace broadphase closures with a scratch buffer
docs(architecture): explain the two RNG streams
chore(deps): bump vite to 8.2
test(dungeon): widen the seed sweep to 200 layouts
```

Scopes match the source layout: `engine`, `world`, `dungeon`, `collision`,
`upgrades`, `enemies`, `render`, `ui`, `ci`.

Keep the subject line under 72 characters and in the imperative mood. Explain
_why_ in the body — the diff already shows what changed.

## Conventions that matter here

These are the rules that are easy to break without noticing, and they exist for
reasons documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Determinism.** A run must replay exactly from its seed. Gameplay randomness
comes from `world.rng`; particles, screen shake and pitch variation come from
`world.cosmeticRng`. Adding a draw to the gameplay stream — or reordering
existing ones — changes what every existing seed produces. That is sometimes
the right call, but it is never an accident.

**No DOM in the simulation.** `src/game/world.ts` and everything it imports must
stay free of `document`, `window` and rendering. The headless tests depend on
it, and so does the ability to reason about the game without a browser.

**Balance numbers live in `src/game/config.ts`.** Not inline at the use site.
Tuning is an iterative activity, and a magic number scattered across six files
cannot be tuned.

**Pools never grow.** When `acquire()` returns `null`, skip the spawn. A dropped
particle is invisible; a mid-combat allocation is a frame spike.

**Upgrades are data.** Add an entry to the `UPGRADES` array. If an upgrade needs
new behaviour, add the stat to `PlayerStats` and read it where it applies —
do not special-case an id in gameplay code.

## Testing

- `tests/` runs on Vitest, in Node, with no DOM.
- Pure logic gets unit tests.
- Anything generated across a random space gets a **seed sweep** — assert the
  invariant over a few hundred seeds rather than eyeballing one layout. The
  reachability bug in the dungeon generator only showed up in 67 of 200 seeds.
- Simulation changes get a headless test in `tests/world.test.ts`. The world
  steps without a canvas, so a full floor runs in milliseconds.

## Adding an enemy

1. Add its stats to `ENEMIES` in `config.ts`, including a difficulty `cost`.
2. Add a state array in `entities/enemy.ts` and register it in `MACHINES`.
3. Give it a silhouette in `sidesFor()` in `render/world-renderer.ts`.
4. Add it to the spawn table in `spawn-director.ts` with a `minDepth`.
5. Give every aggressive state a visible telegraph — see the "telegraph, then
   commit" rule in the architecture notes.

## Reporting bugs

Include the seed. The whole run is reproducible from it, which usually turns a
bug report straight into a failing test.
