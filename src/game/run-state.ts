import { SCORE } from '@game/config';
import { applyModifiers, baseStats, type PlayerStats } from '@game/progression/stats';
import { modifiersFor } from '@game/progression/upgrades';

/**
 * Everything that persists across rooms and floors within a single run.
 *
 * Stats are *derived*, never edited: `refresh()` recomputes them from the base
 * block plus the list of upgrade ids. Any code that wants to change the
 * player's power adds an id, which keeps the build inspectable and means the
 * death screen can show exactly how the player got there.
 *
 * The combo multiplier is the run's rhythm mechanic: it climbs per kill and
 * decays a few seconds after the last one, so playing aggressively is worth
 * more than clearing a room from the safest corner.
 */
export class RunState {
  seed = 0;
  depth = 1;
  score = 0;
  coins = 0;
  kills = 0;
  roomsCleared = 0;
  elapsed = 0;
  /** True while the current floor has been completed without taking a hit. */
  flawlessFloor = true;

  readonly upgrades: string[] = [];
  stats: PlayerStats = baseStats();

  private comboKills = 0;
  private comboTimer = 0;

  reset(seed: number): void {
    this.seed = seed;
    this.depth = 1;
    this.score = 0;
    this.coins = 0;
    this.kills = 0;
    this.roomsCleared = 0;
    this.elapsed = 0;
    this.flawlessFloor = true;
    this.upgrades.length = 0;
    this.comboKills = 0;
    this.comboTimer = 0;
    this.refresh();
  }

  /** Recomputes derived stats from the current upgrade list. */
  refresh(): void {
    this.stats = applyModifiers(baseStats(), modifiersFor(this.upgrades));
  }

  addUpgrade(id: string): void {
    this.upgrades.push(id);
    this.refresh();
  }

  countOf(id: string): number {
    let total = 0;
    for (const taken of this.upgrades) if (taken === id) total++;
    return total;
  }

  get comboMultiplier(): number {
    return Math.min(SCORE.comboMax, 1 + this.comboKills * SCORE.comboStep);
  }

  get comboCount(): number {
    return this.comboKills;
  }

  /** Fraction of the combo window remaining, for the HUD bar. */
  get comboRatio(): number {
    return Math.max(0, this.comboTimer / SCORE.comboWindow);
  }

  registerKill(baseScore: number): number {
    this.kills++;
    this.comboKills++;
    this.comboTimer = SCORE.comboWindow;
    return this.addScore(baseScore);
  }

  /** Adds score through the combo and build multipliers. Returns the gain. */
  addScore(amount: number): number {
    const gained = Math.round(amount * this.comboMultiplier * this.stats.scoreMultiplier);
    this.score += gained;
    return gained;
  }

  tick(step: number): void {
    this.elapsed += step;
    if (this.comboTimer > 0) {
      this.comboTimer -= step;
      if (this.comboTimer <= 0) {
        this.comboTimer = 0;
        this.comboKills = 0;
      }
    }
  }

  advanceFloor(): void {
    this.depth++;
    this.flawlessFloor = true;
  }
}
