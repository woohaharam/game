# Changelog

Notable changes to this project. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Balance simulation** (`npm run balance`). Runs the real game headlessly
  with a scripted bot and reports floor survival with confidence intervals,
  time-to-kill per enemy archetype, upgrade uptake and run shape. Output is
  committed at `docs/BALANCE.md`. First finding: floor 2 is a difficulty cliff
  — 74% of runs clear floor 1, 36% clear floor 2.
- **Grid pathfinding for the bot** (`tools/pathfinder.ts`), after measuring
  that the straight line between adjacent room centres is blocked 21% of the
  time by interior cover.
- **Replays.** A run is recorded as its seed plus the quantised intent stream
  and re-simulates on playback, so a full run is a few kilobytes rather than a
  video. Watchable from the title screen or the death screen, and copyable to
  the clipboard as text. A 23-second run measures 2.85 KB; a synthetic
  worst-case five-minute run, 36.5 KB (11.1 KB gzipped).

- ESLint (type-aware) and Prettier, wired into CI and a single `npm run verify`.
- Contributor workflow: PR template, structured issue forms, contributing guide,
  code of conduct, and security policy.
- Dependabot for npm and GitHub Actions updates.
- `SpatialHash.collectInto()`, a scratch-buffer broadphase query for hot paths.

### Changed

- **Simulation numerics changed slightly.** `Math.hypot` was replaced with
  `sqrt(x*x + y*y)`, which is exactly specified and 13.6× faster but not
  bit-identical. A given seed therefore plays out slightly differently than in
  1.0.0, and replays recorded before this change are rejected rather than
  replayed incorrectly (`REPLAY_VERSION` is now 2).

- `PlayerIntent` now carries an aim **angle** rather than a screen point. The
  simulation only ever needed the direction, and an angle is the same shape
  whether it came from a mouse, a thumbstick or a recording — which is what
  makes an intent finitely quantisable.
- `tools/` is now type-checked and linted. It had been outside `tsconfig`'s
  `include`, which let the bot set a field the world did not read and produce
  `NaN` positions in silence.
- Pinned TypeScript to 5.9. TypeScript 7 compiles the project, but
  `typescript-eslint` does not yet support it, and a toolchain where the linter
  cannot run is not worth the newer compiler.
- Projectile collision and homing now iterate a reused buffer instead of a
  callback. Mutating locals inside a synchronous callback defeats TypeScript's
  control-flow analysis, which forced a cast to silence it; the loop removes
  both the cast and the per-bullet closure.

### Fixed

- Replay playback could diverge from the run it recorded. `Math.hypot`,
  `Math.pow` and `Math.exp` have implementation-defined precision and V8
  evaluates them differently in optimised code, so a run recorded before a
  function tiered up could replay differently after. All three are now avoided
  in the simulation, which took exact reproduction from occasionally-wrong to
  56–60 of every 60 trials, with the run's _outcome_ identical in 180 of 180.
  Caught by the Node 20 leg of the CI matrix, which is the reason it exists.

- `paletteForDepth()` returned `undefined` for a depth of 0 or less, because
  JavaScript's `%` keeps the sign of the dividend and produced a negative index.
  Unreachable from normal play, but the fallback was hiding it.
- `AudioContext` feature detection type-checked as dead code, since lib.dom
  declares the constructor as always present when older WebKit only ships the
  prefixed one.

## [1.0.0] - 2026-08-19

Initial release.

### Added

- Custom TypeScript game engine: fixed-timestep loop with rendering
  interpolation, seeded RNG, object pooling, spatial-hash broadphase,
  intent-based input, Canvas 2D renderer, procedural Web Audio, scene stack.
- Two-stage procedural dungeon generation with a flood-fill reachability
  guarantee.
- Six enemy archetypes on a shared state machine, plus a three-phase boss.
- Data-driven upgrade system with order-independent stat resolution.
- Game feel layer: hit-stop, trauma-based screen shake, input buffering, dash
  invulnerability, slow motion on damage.
- Keyboard, mouse and touch controls, with a portrait rotate prompt.
- 881 tests, including generator seed sweeps and headless simulation runs.
- CI and automated GitHub Pages deployment.

[Unreleased]: https://github.com/woohaharam/game/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/woohaharam/game/releases/tag/v1.0.0
