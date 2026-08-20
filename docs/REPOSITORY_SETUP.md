# Repository setup

Two things cannot be committed — they are repository settings, applied once in
the GitHub UI. This file records them so the configuration is reviewable and
reproducible rather than living only in one person's memory.

## 1. GitHub Pages

`deploy.yml` passes `enablement: true` to `actions/configure-pages`, so the
Pages site is created on the first run rather than having to be switched on by
hand. Nothing to do here in the normal case — the workflow configures itself.

**Repository visibility matters more than the toggle.** Pages on a _private_
repository is a paid feature (Pro, Team or Enterprise). On the Free plan the
repository has to be public for the site to publish at all — which is also what
you want for a portfolio piece, since the whole point is that someone can open
the link and play.

Once published, the site is live at `https://woohaharam.github.io/game/`, and
the play link in the README starts working.

If Pages ever needs to be set by hand — for example after being disabled —
the setting is **Settings → Pages → Build and deployment → Source → GitHub
Actions**.

The build sets `PUBLIC_BASE_PATH` to `/<repo>/` because a GitHub Pages _project_
site is served from a subpath. Without it every asset URL resolves to the domain
root and the page loads blank.

## 2. The default branch must be `main`

**Settings → General → Default branch**

This one is easy to miss and produces a failure that looks like nothing at all.

When GitHub first creates the `github-pages` environment it attaches a
deployment branch policy limited to the repository's **default branch**. If the
default is still some other branch, a deploy triggered from `main` is rejected
_before the job starts_ — no runner is assigned, no step runs, and there are no
logs to download. The run simply shows:

```
build    ✅  (verify, build, configure-pages, upload-pages-artifact all green)
deploy   ❌  failed in ~1s
```

The build half succeeding is what makes this confusing: Pages is enabled, the
artifact is uploaded, and nothing in the workflow is wrong. The deployment is
refused on policy grounds.

If a deploy fails this way, check the default branch before anything else.
`git remote show origin | head -3` prints it without opening the browser.

## 3. Branch protection on `main`

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

## 4. Dependabot

Configured in [`.github/dependabot.yml`](../.github/dependabot.yml); no UI
setup needed. It opens PRs against `main` weekly for npm and monthly for
Actions, with the dev toolchain grouped into a single PR.

Those PRs run the same CI as any other. Major-version bumps of Actions or of
the build toolchain deserve a real look before merging — the grouping exists to
make that one review instead of five, not to make it automatic.
