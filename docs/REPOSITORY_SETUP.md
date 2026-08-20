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

## 2. The `github-pages` environment pins the branch it was created with

This one produced a failure with nothing to debug, and cost several rounds to
find. Worth reading before touching Pages.

When Pages is first enabled, GitHub provisions a `github-pages` **environment**
and attaches a deployment branch policy naming whatever the repository's
default branch is _at that moment_. That policy is a snapshot. Changing the
repository's default branch afterwards does **not** update it.

If the two disagree, the `deploy` job is refused on policy grounds before a
runner is ever assigned:

```
build    ✅  verify · build · configure-pages · upload-pages-artifact
deploy   ❌  failed in ~2s — no runner, no steps, no logs to download
```

Every other signal points the wrong way. Pages is enabled, `configure-pages`
succeeds, the artifact uploads, the workflow is correct, and the run has no
error text to read — the API returns an empty check-run output because the job
never started.

### Fixing it

**Settings → Environments → `github-pages` → Deployment branches and tags**

Either add the branch you actually deploy from, or drop the restriction. If the
environment is carrying a stale branch name, deleting the environment outright
is simplest: the next deploy recreates it against the current default branch.

Two checks worth running first, in this order:

```console
$ git remote show origin | head -3     # is the default branch what you expect?
  HEAD branch: main
```

then compare that against the environment's allowed branches. A mismatch is the
answer; matching values means look elsewhere.

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
