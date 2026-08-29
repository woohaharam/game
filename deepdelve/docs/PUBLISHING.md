# Publishing and revenue

How money actually reaches you from a browser game, what to expect, and what to
do before submitting.

> Rates, revenue splits and submission rules change, and vary by deal and by
> region. Everything specific below is an order of magnitude to reason with, not
> a quote. Check each portal's current documentation before you rely on a
> number.

## Where the money comes from

You do not sell ads. The portal does, and pays you a share. Your revenue is:

```
revenue = ad impressions × eCPM ÷ 1000 × your share
```

**eCPM** is what an advertiser pays for a thousand impressions. Three things
move it, in decreasing order of importance:

1. **Where the players are.** This dominates everything else. Traffic from the
   US, Canada, UK, Germany, Australia or Japan can be worth five to ten times
   the same number of impressions from most of South and Southeast Asia or Latin
   America. You do not choose this — the portal's audience does.
2. **Ad format.** Rewarded video pays far more than an interstitial, which pays
   far more than a banner. A player who _chose_ to watch is worth much more than
   one who was interrupted.
3. **Season.** Q4 is the high point of the advertising year; January is the
   trough. A game's first month can mislead you in either direction.

For HTML5 portal traffic, rewarded video eCPMs are commonly in the low single
digits of US dollars for tier-1 countries and well under a dollar for tier-3.
Portals typically keep roughly half, though the split varies and better terms
come with a track record.

### What that means in practice

Put your own numbers in, but as an illustration: 10,000 sessions in a month,
1.5 rewarded views per session, a blended $2 eCPM, a 50% share:

```
10,000 × 1.5 = 15,000 impressions
15,000 ÷ 1000 × $2 = $30
× 50% = $15
```

That is the honest shape of it. **One unknown game on one portal earns very
little.** Revenue at a level worth noticing comes from one of two places: a game
that gets featured on a portal's front page, which is a step change rather than
a gradient; or a catalogue of many games, where the portfolio averages out.

Treat the first release as a way to learn the pipeline and to have something
live with real players in it. Anything it earns is a bonus, and the honest
version of that expectation is worth holding onto — it is what stops you making
the game worse chasing an amount of money that was never going to arrive.

### Why an idle game is a reasonable choice here

The genre's economics are unusually good for ad revenue, for reasons that are
structural rather than lucky:

- **Sessions repeat.** A player who comes back four times a day sees four times
  the ad opportunities of one who plays once. Retention is the multiplier that
  matters, and idle games are built around returning.
- **The rewards are native.** Doubling an offline haul, a timed boost, a chest —
  these are things a player genuinely wants at a moment when they are already
  looking at a summary screen. Nobody has to be interrupted.
- **There is a natural break.** Descending ends a run. That is the one place an
  interstitial belongs, and it is why this game shows one there and nowhere else.

The trap is the mirror image: an idle game can be made to demand ads to
progress, and portals and players both punish that. This one is completable
without watching a single one, deliberately.

## Where to publish, in order

**1. GitHub Pages — now, free, no review.**
Already wired up: pushing to `main` publishes both games. This is the link for a
portfolio or a CV. No revenue, and that is fine; that is not what it is for.

**2. itch.io — days, no gatekeeping.**
Upload the plain `npm run build` output as a zip. No ad revenue (itch is a
storefront, not an ad network) but it gets the game in front of people who leave
feedback, and a page you control. Good place to find out whether the first five
minutes work on someone who is not you.

**3. CrazyGames — the first real revenue.**
Self-serve developer portal, review turnaround measured in days to a couple of
weeks. Submit `npm run build:crazygames`. Requires their SDK, which that build
target injects.

**4. Poki — later, once there is data.**
More curated, and they tend to engage with developers whose games already show
retention. Worth approaching with numbers from step 3 rather than cold. Submit
`npm run build:poki`.

Distribution aggregators (GameDistribution, GamePix and similar) push one build
to many small portals at a lower share each. Reasonable for reach once the game
is finished; not worth splitting attention over at the start.

## Before you submit

Things portals actually reject for, and where this game stands:

| Requirement                          | Status                                                                |
| ------------------------------------ | --------------------------------------------------------------------- |
| Loads fast on a phone connection     | ~21 KB gzipped, no downloaded assets. CI fails above 150 KB           |
| Works inside a cross-origin iframe   | Relative asset base; storage failures fall back to memory             |
| Playable on a touch screen           | Phone-first single column, 44 px targets                              |
| No external links out of the game    | None                                                                  |
| Audio stops during ads               | Enforced in `PacedAdProvider`, not at call sites                      |
| Interstitials infrequent             | One, on descent, capped at one per three minutes                      |
| Rewarded ads opt-in and never gating | All three rewards are bonuses; the game completes without any of them |
| No crash when the SDK fails          | Every method feature-detected; failure degrades to "no ads"           |
| Correct SDK for that portal          | `npm run build:crazygames` / `build:poki`                             |

Do these by hand before each submission:

1. `npm run verify` and `npm run smoke`.
2. Build the portal target and **check the network tab** — confirm the SDK
   script actually loads. A 404 there costs all of your revenue and nothing
   else will tell you: the game is written to treat a missing SDK as "no ads",
   so it will look perfectly healthy.
3. Play through a rewarded ad on the portal's own test environment. `?ads=debug`
   exercises the reward path locally but does not exercise their SDK.
4. Check the offline modal by editing `lastSeen` in the save, since it is the
   screen most players will see most often and the one with an ad on it.

## Getting paid

Portals pay monthly, usually with a minimum threshold in the tens of dollars, by
bank transfer or PayPal. You will need tax details on file; a Korean resident
publishing to a US or EU company will typically be asked for a tax residency
form so that treaty withholding rates apply rather than the default. Sort this
out when you sign up, not when the first payment is due.

## What to watch after launch

Two numbers tell you more than the revenue figure does, because revenue is
mostly traffic and traffic is mostly the portal:

- **Day-1 and day-7 retention.** For an idle game this is the whole game. If
  players do not come back, no amount of ad tuning matters.
- **Rewarded views per session.** If it is near zero, the rewards are not
  attractive or not visible enough. If it is high but retention is falling, the
  game is leaning on them too hard.

Change one thing at a time and give it a week. Portal traffic is noisy enough
that two changes at once tells you nothing.
