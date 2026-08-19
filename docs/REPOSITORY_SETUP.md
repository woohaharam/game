# Repository setup

Two things cannot be committed — they are repository settings, applied once in
the GitHub UI. This file records them so the configuration is reviewable and
reproducible rather than living only in one person's memory.

## 1. GitHub Pages

**Settings → Pages → Build and deployment → Source → GitHub Actions**

Until this is switched on, `deploy.yml` runs on every push to `main` and fails
at the publish step with `Resource not accessible by integration`. The workflow
itself needs no change — Pages just has to be expecting a deployment from
Actions rather than from a branch.

Once enabled, the site is live at `https://woohaharam.github.io/game/`, and the
play link in the README starts working.

The build sets `PUBLIC_BASE_PATH` to `/<repo>/` because a GitHub Pages _project_
site is served from a subpath. Without it every asset URL resolves to the domain
root and the page loads blank.

## 2. Branch protection on `main`

**Settings → Rules → Rulesets → New branch ruleset**, targeting `main`.

The CI gates in this repository are only advisory until this exists — nothing
stops a red commit from being pushed straight to `main`, which is also what
`deploy.yml` publishes.

| Setting                               | Value                                                                                  | Why                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Require a pull request before merging | On                                                                                     | Keeps `main` reviewable; every change arrives with a description     |
| Required approvals                    | 0 (solo) / 1 (team)                                                                    | On a solo project a required approval blocks your own PRs            |
| Dismiss stale approvals on push       | On                                                                                     | An approval describes the diff that was reviewed, not the branch     |
| Require status checks to pass         | On                                                                                     | The point of the exercise                                            |
| Required checks                       | `Format, lint, typecheck`, `Tests (Node 20)`, `Tests (Node 22)`, `Build & size budget` | Each job named individually, so a skipped job cannot pass by absence |
| Require branches to be up to date     | On                                                                                     | Catches semantic conflicts that merge cleanly but break at runtime   |
| Require conversation resolution       | On                                                                                     | No merging over an unanswered review comment                         |
| Require linear history                | On                                                                                     | Squash or rebase merges only; keeps `git log` readable               |
| Block force pushes                    | On                                                                                     | Force-pushing `main` breaks every existing clone                     |
| Restrict deletions                    | On                                                                                     | —                                                                    |

Check names must match the `name:` of each job in `ci.yml` exactly. They only
appear in the picker after a run has reported them at least once, so add them
after the first PR has completed a CI run.

### Merge strategy

**Settings → General → Pull Requests**

Enable **squash merging** only, and set the default squash commit message to
_"Pull request title and description"_. Disable merge commits and rebase
merging.

One commit per pull request on `main` keeps history bisectable and matches the
linear-history rule above. Where a PR's individual commits are worth preserving
— as with the split between the mechanical reformat and the real changes — say
so in the PR description and merge with a rebase instead.

## 3. Dependabot

Configured in [`.github/dependabot.yml`](../.github/dependabot.yml); no UI
setup needed. It opens PRs against `main` weekly for npm and monthly for
Actions, with the dev toolchain grouped into a single PR.

Those PRs run the same CI as any other. Major-version bumps of Actions or of
the build toolchain deserve a real look before merging — the grouping exists to
make that one review instead of five, not to make it automatic.
