/**
 * Crediting the time a player spent away.
 *
 * Offline progress is the reason the genre exists — the promise is that the
 * game respects your absence. Three things make that promise honest:
 *
 * 1. It runs the *same* simulation as the live loop, so away-time is worth
 *    exactly what watch-time would have been. No estimate, no separate formula.
 * 2. It is capped, so the game still has a reason to be opened. The cap is the
 *    single most commercially consequential number in an idle game: too short
 *    and returning feels pointless, too long and there is no reason to come
 *    back today rather than next week.
 * 3. It refuses to credit time that did not pass. A player who moves their
 *    system clock forward gets nothing, and — more importantly — a player whose
 *    clock drifts backwards is not punished.
 */

import { autoplay } from './autoplay';
import { advance, type AdvanceReport } from './simulation';
import type { GameState } from './state';

/** Eight hours. Long enough to cover a night's sleep or a working day. */
export const OFFLINE_CAP_SECONDS = 8 * 60 * 60;

/** Below this, the absence is not worth interrupting the player to report. */
export const OFFLINE_REPORT_THRESHOLD_SECONDS = 60;

export interface OfflineResult {
  /** Wall-clock seconds since the last save, before the cap. */
  readonly elapsedSeconds: number;
  /** Seconds actually simulated. */
  readonly creditedSeconds: number;
  readonly cappedOut: boolean;
  readonly report: AdvanceReport;
  /** Whether this is worth showing the player a summary for. */
  readonly worthReporting: boolean;
}

/**
 * Simulates the time between `state.lastSeen` and `now`, in place.
 *
 * The blessing does not run while away. It is a reward for watching an
 * advertisement *now*, and letting it burn down offline would mean the correct
 * play is to watch one and immediately close the tab — the exact opposite of
 * what the reward is for. It is suspended for the duration instead.
 */
export function applyOfflineProgress(state: GameState, now = Date.now()): OfflineResult {
  const elapsedSeconds = Math.max(0, (now - state.lastSeen) / 1000);
  const creditedSeconds = Math.min(elapsedSeconds, OFFLINE_CAP_SECONDS);

  const heldBlessing = state.blessingRemaining;
  state.blessingRemaining = 0;

  // With auto-refine on, the stone shops while away, which is the whole reason
  // the unlock is worth having: dust that is never spent stops buying stages.
  // It runs the same interleave the live loop does, at the same interval, so
  // eight hours away still lands where eight hours watched would have.
  const report = state.autoRefine
    ? autoplay(state, creditedSeconds).report
    : advance(state, creditedSeconds);

  state.blessingRemaining = heldBlessing;
  state.lastSeen = now;

  return {
    elapsedSeconds,
    creditedSeconds: report.seconds,
    cappedOut: elapsedSeconds > OFFLINE_CAP_SECONDS,
    report,
    worthReporting:
      elapsedSeconds >= OFFLINE_REPORT_THRESHOLD_SECONDS &&
      (report.fragments > 0 || !report.dustGathered.isZero),
  };
}

/**
 * Pays a second helping of an offline haul, for a watched advertisement.
 *
 * This grants the gold directly rather than re-simulating: the stages were
 * already grown through, and running the simulation twice would advance the
 * stone a second time for a reward that was only ever about the dust.
 */
export function doubleOfflineEarnings(state: GameState, result: OfflineResult): void {
  state.dust = state.dust.add(result.report.dustGathered);
  state.lifetimeDust = state.lifetimeDust.add(result.report.dustGathered);
}
