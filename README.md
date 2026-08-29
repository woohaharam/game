# Two games, built from scratch in TypeScript

[![CI](https://github.com/woohaharam/game/actions/workflows/ci.yml/badge.svg)](https://github.com/woohaharam/game/actions/workflows/ci.yml)
[![DeepDelve](https://github.com/woohaharam/game/actions/workflows/deepdelve.yml/badge.svg)](https://github.com/woohaharam/game/actions/workflows/deepdelve.yml)
[![Deploy](https://github.com/woohaharam/game/actions/workflows/deploy.yml/badge.svg)](https://github.com/woohaharam/game/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)

Two complete browser games, sharing a repository and nothing else. Both are
written in strict TypeScript with **no game framework and no downloaded
assets** — every shape is drawn at runtime and every sound is synthesised — and
both are small enough to load over a phone connection.

They are deliberately different problems. One is a real-time action game where
the hard parts are determinism, collision, and frame budget. The other is an
idle game where the hard parts are arithmetic that survives 1e1000, progression
curves that provably do not stall, and a commercial layer that a game portal
will accept.

---

## Neon Depths — a 2D action roguelike

**▶ [Play it](https://woohaharam.github.io/game/)** · [Full README](docs/NEON_DEPTHS.md)
· [Architecture](docs/ARCHITECTURE.md) · [Balance report](docs/BALANCE.md)

Procedurally generated dungeons, twin-stick combat, and a run-scoped upgrade
system on a custom engine. A single 32-bit seed reproduces an entire run
exactly, which is what makes the replay system possible: runs are recorded as
_decisions_, not frames, and re-simulated on playback.

What it demonstrates:

| Area                      | What is in there                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Game loop**             | Fixed timestep with rendering interpolation and a spiral-of-death guard, so hit detection behaves identically at 30, 60 and 144 Hz                                       |
| **Procedural generation** | Room graph grown as a branching tree, then carved into tiles, with a flood-fill pass that guarantees no seed can produce unreachable geometry                            |
| **Determinism**           | Separate gameplay and cosmetic RNG streams, and `Math.hypot`/`pow`/`exp` removed from the simulation after JIT tier differences made replays diverge on one Node version |
| **Performance**           | Object pooling, a uniform-grid spatial hash broadphase, viewport culling on a 200,000-tile map. ~1.1 ms/frame with hundreds of live projectiles                          |
| **Replays**               | Seed plus quantised intents in a binary codec — varints, zig-zag, packed header bits — replayed by re-simulation rather than playback                                    |
| **Balance tooling**       | A headless bot plays hundreds of runs in CI to produce a balance report, rather than tuning by feel                                                                      |

## DeepDelve — an idle fantasy dungeon RPG

[README](deepdelve/README.md) · [Architecture](deepdelve/docs/ARCHITECTURE.md)
· [Balance report](deepdelve/docs/BALANCE.md)

A hero descends floor by floor and keeps fighting while the tab is closed. Built
for web game portals, where the revenue model is the portal's ad share — which
is what shapes the whole build: no backend, no accounts, a relative asset base
so it runs from any subdirectory, and a game that stays complete for someone who
never watches an ad. Ships in Korean and English.

What it demonstrates:

| Area                     | What is in there                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arithmetic**           | A mantissa/exponent big number, because idle progression passes 2^53 in hours and 1.8e308 in days, and both failures are silent until a save is ruined                                 |
| **One simulation**       | The frame loop and the eight-hour offline catch-up call the same function, so they cannot disagree — which forces it to be O(events), not O(ticks)                                     |
| **Provable progression** | Descent gains are governed by `log(relicGrowth)/log(healthGrowth)`; below 1 the runs converge on a fixed depth and the game silently ends. The test asserts the ratio, not the payout  |
| **Monetisation**         | One ad interface with the portals' rules enforced in a decorator around it, and structurally-typed adapters that degrade to "no ads" rather than to "reward granted" when an SDK fails |
| **Localisation**         | Korean groups numbers in fours (만·억·조), not threes, so the formatter holds significant digits rather than decimal places                                                            |
| **Browser verification** | An end-to-end check that asserts rendered geometry, after two bugs shipped past a green unit suite                                                                                     |

---

## Running them

Each is an independent project with its own dependencies. Node 20 or newer.

```bash
# Neon Depths
npm install && npm run dev

# DeepDelve
cd deepdelve && npm install && npm run dev
```

Both expose the same gate, which is exactly what their CI runs:

```bash
npm run verify     # format, lint, typecheck, tests
npm run balance    # simulate progression and print a report
npm run build      # production bundle
```

## How the work is done

Everything lands on `main` through pull requests, with CI as a required signal.
The conventions — commit format, branch naming, and the invariants that are easy
to break silently — are in [`CONTRIBUTING.md`](CONTRIBUTING.md). Repository
settings that cannot live in a commit are written down in
[`docs/REPOSITORY_SETUP.md`](docs/REPOSITORY_SETUP.md).

The two projects have separate CI workflows, scoped by path: a change to one has
no bearing on the other, and neither should wait for the other's suite.

Participation is governed by the [code of conduct](CODE_OF_CONDUCT.md).
Security reports go through [`SECURITY.md`](SECURITY.md), not public issues.

## License

MIT — see [`LICENSE`](LICENSE).
