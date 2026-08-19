# Security policy

## Scope

Neon Depths is a static, client-side game. It has no backend, no accounts, no
network requests at runtime, and no telemetry. The only data it stores is a
local high score and your display preferences, kept in `localStorage` on your
own device and never transmitted.

That narrows the realistic attack surface to two things:

- a vulnerability in a build dependency that could reach the published bundle
- a flaw in the deploy workflow that could let someone publish to the site

Both are in scope.

## Reporting a vulnerability

Please report privately through
[GitHub Security Advisories](https://github.com/woohaharam/game/security/advisories/new)
rather than opening a public issue.

Include what you found, how to reproduce it, and what an attacker could do with
it. You can expect an initial response within a week.

## Supported versions

Only the current `main` branch, which is what is deployed to GitHub Pages.
