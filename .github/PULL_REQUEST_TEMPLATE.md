## What & why

<!-- What does this change, and what problem does it solve? Link the issue if there is one. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Balance / tuning
- [ ] Refactor (no behaviour change)
- [ ] Docs / tooling

## How this was verified

<!--
`npm run verify` is the baseline. Anything touching the simulation needs more
than a green suite — say what you actually played, and on what.
-->

- [ ] `npm run verify` passes (format, lint, typecheck, tests)
- [ ] Played the change in a browser
- [ ] Checked frame time in the pause overlay / `__neon.loop.stats` if the hot path changed

Seeds used for testing:

## Gameplay impact

<!-- Delete if this is a docs or tooling change. -->

- **Feel:** does this change how the game responds to input?
- **Balance:** does this shift difficulty on any floor?
- **Determinism:** does this add or reorder a draw from the gameplay RNG?
  Cosmetic randomness must come from `cosmeticRng` so seeds stay reproducible.

## Screenshots / recordings

<!-- Required for anything visible on screen. Before/after if you changed existing visuals. -->
