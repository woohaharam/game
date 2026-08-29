# DeepDelve

An idle fantasy dungeon RPG for the browser. A hero descends floor by floor,
fights without being told to, and keeps fighting while the tab is closed. When
the run stalls — and every run stalls — you surrender it for relics that make
the next one faster.

Built to be published on web game portals (CrazyGames, Poki, itch.io), where the
revenue model is the portal's ad share. That constraint shapes the whole build:
no backend, no accounts, no payments, a bundle small enough to load over a phone
connection, and a game that is complete for someone who never watches an ad.

```bash
npm install
npm run dev       # development server
npm run verify    # typecheck + unit tests
npm run build     # production bundle
npm run smoke     # end-to-end browser check (needs `npm run preview` running)
```

## The decisions worth explaining

**One simulation, used twice.** `advance(state, seconds)` is the only thing that
moves the game forward. The frame loop calls it with ~0.016; the offline
catch-up calls it with up to eight hours. That is not tidiness — it is the only
way the two can be guaranteed not to disagree. Idle games that estimate offline
progress separately end up with a discrepancy, and the discrepancy is always an
exploit: players work out whether it pays to close the tab, and the honest way
to play stops being the best way to play.

Serving both from one function means it has to be O(events), not O(ticks). Eight
hours at sixty ticks a second is 1.7 million iterations; eight hours of _events_
is a few thousand, because kills at a constant rate can be counted with a
division. Criticals are folded into DPS as an expectation rather than rolled,
since a dice roll would make eight hours away disagree with eight hours watched
by variance alone. The test suite asserts that one 7,200-second step and 28,800
frame-sized steps produce identical kill counts and gold within 1e-9.

**Numbers that do not run out.** Idle progression passes 2^53 within hours and
1.8e308 within days. Both failures are silent until a save is already ruined, so
every quantity is a normalised mantissa and a base-10 exponent — about fifteen
significant digits across a range of roughly 1e±1e308.

**The relic curve was measured, not chosen.** Reachable depth goes as
`log(multiplier)/log(healthGrowth)`, and the multiplier goes as
`relicGrowth^depth`, so one descent maps to the next roughly linearly and the
ratio of those two growth rates decides everything. Below the health growth the
map is a contraction: it has a fixed point, runs converge on a single depth, and
the game ends without saying so — at 1.36 a simulated player crawls from floor
213 to floor 228 across twenty descents and stops. At 1.75 the gains multiply
and floor 4,000 arrives inside two days. At 1.58 the gain climbs steadily from
+19 floors to +170 across 24 descents and never plateaus. `tests/save.test.ts`
asserts the _ratio_ rather than the payout, because the payout can be retuned
freely and the ratio cannot.

**Advertising rules live in one place.** Portals largely agree: rewarded ads
opt-in, interstitials infrequent, audio stopped while an ad runs, and the game
completable without any of it. Those are enforced in a decorator wrapped around
every provider rather than at each call site — a rule enforced at the call site
is one that gets forgotten at the next call site. Each portal SDK is a small
structurally-typed adapter; nothing outside `src/platform` names a portal. The
SDKs arrive as globals injected around the build, so every method is
feature-detected, and an SDK that is missing, half-built, or throwing degrades
to "no ads available" — never to "reward granted".

## What the browser caught that the tests did not

Two bugs shipped past a green suite and were found by
[`tools/smoke.mjs`](tools/smoke.mjs), which is why that script asserts against
rendered geometry rather than DOM properties:

- Every panel rendered at once. `hidden` is only a UA-stylesheet `display:none`,
  so the explicit `display: grid` on `.panel` silently beat it. Setting
  `.hidden = true` appeared to work and changed nothing.
- The first nine and a half seconds of the game showed a health bar moving and
  nothing else — no kill, no gold, no reason to stay. A portal player decides in
  less time than that.

## Korean, and what localisation actually costs

The game ships in Korean and English, detected from `?lang=`, then the browser,
with a toggle that persists outside the save — erasing a run should not drop a
player back into a language they cannot read.

The interesting part is not the string table. It is that **Korean groups large
numbers in fours, not threes**: 만 is 10^4, 억 is 10^8, 조 is 10^12. Rendering
12,345 as `12.34K` asks a Korean reader to stop and convert; `1.234만` is simply
read. Within a Korean unit the magnitude spans three orders rather than two, so
the formatter holds four _significant digits_ instead of a fixed decimal count —
1.234만, 12.34만, 123.4만, 1234만 — and names units as deep as Korean actually
names them, through 극 (10^48) and the Buddhist series to 무량대수 (10^68),
before falling back to an exponent.

Two smaller things that are easy to miss: `word-break: keep-all`, because Korean
otherwise breaks mid-word and a two-word phrase splits down its middle; and
`system-ui` first in the font stack, so each platform reaches for its own Hangul
face rather than a Latin font falling back to whatever has coverage.

Content is translated rather than transliterated — 무덤쥐 and 잉걸불 심층, not
phonetic renderings of "Crypt Rat" and "Ember Deep", which read as noise. Tests
assert that the two key sets match exactly, that no Korean value passes English
through, and that every `{placeholder}` survives translation, since a dropped
one shows the player a sentence with a hole in it.

## Layout

```
src/core/      Decimal, formatting, i18n, storage — no game knowledge
src/game/      simulation, state, content tables, saves, prestige
src/platform/  ad providers and portal adapters
src/ui/        the view: built once, updated in place
tools/         balance probe and the browser smoke check
```

## Publishing to a portal

The build is fully relative (`base: './'`), so it runs from any subdirectory.
Portals inject their SDK with a script tag around the build; `detectAdProvider`
picks it up at boot and falls back to no ads when there is nothing there.
`?ads=debug` grants rewards instantly for local testing and is never selected
automatically.
