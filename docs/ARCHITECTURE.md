# Architecture

The reasoning behind the decisions that were not obvious, and the invariants
that are easy to break without noticing. Code-level detail lives in the modules;
this is the map and the "why".

## The shape of it

```
src/core/       No game knowledge. Reusable as-is.
  decimal.ts      Mantissa + exponent big number
  format.ts       Display formatting, three notations
  i18n.ts         Locale selection and string lookup
  storage.ts      localStorage with an in-memory fallback

src/game/       The game, with no knowledge of the DOM
  simulation.ts   advance(state, seconds) — the only thing that moves time
  state.ts        The complete mutable state, plain data throughout
  stats.ts        Derives effective numbers from what was bought
  shop.ts         Purchasing, quoting, and a simulated player
  prestige.ts     Descending, and the curve that makes it work
  offline.ts      Crediting time away
  save.ts         Versioned encode/decode with repair
  transfer.ts     Portable save codes
  rewards.ts      What a watched advertisement buys
  content/        Curves and tables: floors, upgrades, companions

src/platform/   The world outside the game
  ads.ts          One ad interface, with the portal rules enforced around it
  portals.ts      CrazyGames / Poki adapters and detection
  audio.ts        Synthesised sound

src/ui/         The view: built once, updated in place
  view.ts         Shell: header, tabs, orchestration
  catalogue.ts    Upgrades and companions behind one shape
  panels/         Combat, shop, descend, offline
```

Dependencies point one way: `ui` → `game` → `core`, with `platform` reachable
from `ui` and `main`. Nothing in `game` imports from `ui` or touches the DOM,
which is what lets the whole simulation — including twenty descents of a
simulated player — run headlessly in a test or a balance probe.

## One function moves time

`advance(state, seconds)` is called by the frame loop with ~0.016 and by the
offline catch-up with up to eight hours. Not for tidiness: it is the only way
the two can be guaranteed not to disagree.

Idle games that model offline progress with a separate estimate always end up
with a discrepancy, and the discrepancy is always an exploit. Players work out
whether it pays to close the tab, and the honest way to play stops being the
best way to play. Sharing the function makes the question meaningless.

Serving both from one function forces it to be **O(events), not O(ticks)**.
Eight hours at sixty ticks a second is 1.7 million iterations; eight hours of
_events_ is a few thousand, because kills that happen at a constant rate can be
counted with a division. A walled hero costs about three iterations per
thirty-second guardian cycle, so an eight-hour catch-up is roughly 2,800.

Randomness is deliberately absent. Criticals are folded into DPS as an
expectation rather than rolled, so eight hours away pays exactly what eight
hours watched would have. A dice roll would make the two disagree by variance
alone, and players would — correctly — call that cheating.

`tests/simulation.test.ts` asserts the property directly: one 7,200-second step
and 28,800 frame-sized steps reach identical kill counts and gold within 1e-9,
across step sizes from 0.25s to two hours.

### Rate, not duration

Kills are capped at one per 50ms. The cap has to be expressed as a **damage
rate**, not as a minimum kill duration — the two look equivalent and are not.

Clamping the duration means a hero who overkills a monster inside a single 16ms
frame has the kill refused by the clamp _and_ the leftover time discarded, and
the fight never resolves. Capping the rate keeps health strictly linear in time,
so a kill lands at the same simulated moment whether it is reached in one step
of an hour or in 216,000 steps of a frame.

## Numbers that do not run out

Idle progression passes 2^53 within hours and 1.8e308 within days. Both failures
are silent until a save is already ruined, which is the worst possible time to
discover them.

Every quantity is a normalised mantissa in [1, 10) plus a base-10 exponent: a
range of roughly 1e±1e308 at a constant ~15 significant digits, trading exact
integer arithmetic the game never needs. Multiplication becomes addition of
exponents, which matters because an idle game multiplies far more than it adds.

Instances are immutable, so a number handed to the view cannot be mutated
underneath it by the next tick — which is also why `cloneState` shares them
rather than copying.

Two traps worth knowing about, both caught by tests:

- Floating point leaves `9.999999999999998` where 10 belongs. Left alone that
  drifts a digit every few thousand operations, so mantissas within an epsilon
  of a power of ten are snapped.
- `mantissa * 10 ** exponent` is not exact: `4.06e3` collapses to
  `4059.9999999999995`, and flooring that loses a whole unit. Values within
  floating-point noise of an integer are snapped rather than floored.

## The relationship the game rests on

Every run walls, structurally rather than through tuning. Upgrades give flat
damage at exponentially rising cost, so damage grows with the _logarithm_ of
gold; monster health grows exponentially with depth. Logarithmic growth cannot
chase exponential growth, so no amount of patience gets a run past its ceiling.
That is the genre working as intended: the run is not the game, the sequence of
runs is.

Descending is what makes the sequence go somewhere, and it works only if

```
log(relicGrowth) / log(healthGrowth) > 1
```

Below 1 the map from one descent to the next is a contraction with a fixed
point: runs converge on a single depth and the game ends without saying so. At
1.36 a simulated player crawls from floor 213 to 228 across twenty descents and
stops. At 1.75 the gains _multiply_ and floor 4,000 arrives in two days. At 1.58
the ratio is 1.044 — measured over twenty descents the gain climbs from +18
floors to +149 and never plateaus.

`tests/save.test.ts` asserts the **ratio**, not the payout, because the payout
can be retuned freely and the ratio cannot. `docs/BALANCE.md` is regenerated by
`npm run balance -- --write` and holds the current measurement.

This was derived analytically first, tuned to a number that looked right, and
measured afterwards — at which point the measurement showed the runs converging.
The derivation had been right about the shape and wrong about which quantity it
applied to. The probe exists because of that.

## The view

Built once, updated in place. Nothing is created, destroyed, or reordered while
the game runs, which keeps a permanently-open tab from leaking nodes and makes
the per-frame cost a handful of guarded string comparisons — every write is
compared against the value already there, because assigning `textContent` the
string it already holds still costs a style recalculation.

There is no framework because there is nothing for one to do: the view is a
fixed tree and updating it is assigning strings to it.

Upgrades and companions are rendered by **one** panel over a common
`ShopEntry` shape. They differ in what they sell and in nothing else, and when
they had separate render paths a fix to one had to be made twice. Buy buttons
are labelled from the same `quote*` functions the click calls, so a button can
never promise a count or a price the purchase would not honour.

A language change rebuilds the tree rather than retranslating it, carrying the
selected tab and buy quantity across — a rare event where rebuilding is exactly
right, and where dropping the player back to the first tab would make changing
language feel like it reset something else.

## Time, and a tab that is not running

A background tab does not run: `requestAnimationFrame` stops, and the first
frame back reports an enormous delta. Applying it raw would let anyone bank
hours by tabbing away; clamping it away would lose the player's progress.

So frame deltas are trusted only below one second, and anything longer is
reconciled through the same capped offline path a page load uses.
`visibilitychange` stamps the save before the tab is frozen, since a tab can be
discarded without warning, and `pagehide` covers the case `beforeunload` does
not — notably iOS.

## Saves

Decoding degrades field by field toward a fresh state rather than rejecting a
bad payload: a save that loads 90% correctly is worth far more than one that
refuses to load. Every field is treated as hostile, values that claim the
impossible are repaired, and a save timestamped in the future is not credited
with offline time.

Transfer codes carry a checksum — that is their point. A code truncated by a
double-click selection or altered in transit must be _rejected_, not loaded as a
plausible-looking ruin of somebody's progress; base64 alone cannot tell the
difference. It is not encryption, and does not pretend to be: in a single-player
game with no leaderboard, the only person a forged code cheats is whoever forged
it, and saves are validated on load regardless.

## Advertising

The portals largely agree on the rules — rewarded ads opt-in, interstitials
infrequent, audio stopped while an ad runs, the game completable without any of
it — and those rules are enforced in a decorator wrapped around every provider
rather than at each call site. A rule enforced at the call site is a rule that
gets forgotten at the next call site.

Each portal SDK is a small structurally-typed adapter, because the SDKs arrive
as globals injected around the build and cannot be imported or checked against a
package. Every method is feature-detected: one that is missing, half-built, or
throwing degrades to "no ads available" — never to "reward granted", never to an
exception. The debug provider that grants instantly is reachable only through an
explicit `?ads=debug`, so a portal whose SDK failed to load falls back to no ads
rather than to free rewards.

## Localisation

Korean groups large numbers in **fours**, not threes: 만 is 10^4, 억 is 10^8.
Rendering 12,345 as `12.34K` asks a Korean reader to convert; `1.234만` is read.
Within a Korean unit the magnitude spans three orders rather than two, so the
formatter holds four _significant digits_ rather than a fixed decimal count.

Two typographic details that are invisible until wrong: `word-break: keep-all`,
because Korean otherwise breaks at any character and a two-word phrase splits
down its middle; and `system-ui` first in the font stack, so each platform
reaches for its own Hangul face instead of a Latin font falling back to whatever
has coverage.

Content is translated rather than transliterated. Names live in the locale
tables, so the content modules own which zone a floor belongs to, not what it is
called, and adding a language never touches the curves.

## What the tests cannot see

Two bugs shipped past a green suite and were caught by `tools/smoke.mjs`, which
is why that script asserts against rendered geometry rather than DOM properties:

- Every panel rendered at once. `hidden` is only a UA-stylesheet `display:none`,
  so the explicit `display: grid` on `.panel` silently beat it. Setting
  `.hidden = true` appeared to work and changed nothing — and a DOM-property
  assertion reported one visible panel throughout.
- The opening nine and a half seconds showed a health bar moving and nothing
  else. A portal player decides in less time than that.

## Invariants worth guarding

1. `advance` is the only function that moves time. Anything else that wants to
   know what a stretch of time is worth runs it on a `cloneState` copy.
2. No randomness in the simulation. Expectations only.
3. Nothing in `src/game` imports from `src/ui` or touches the DOM.
4. `log(relicGrowth) / log(healthGrowth)` stays above 1.
5. Locale tables are complete by construction: each is a `Record` over a finite
   key union, so a missing translation fails the build.
6. Buy buttons are labelled from the same quote the click acts on.
