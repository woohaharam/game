import { createInitialState } from '../src/game/state';
import { autoplay } from '../src/game/autoplay';
import { computeStats } from '../src/game/stats';
import { canDescend, descend, pendingRelics } from '../src/game/prestige';
import { formatDuration, formatNumber } from '../src/core/format';

const SESSION = 60 * 30; // The simulated player checks in for half an hour.

const state = createInitialState(0);
let elapsed = 0;
let run = 1;

console.log('run  wall-clock   depth  relics(total)  multiplier   dps');
for (let i = 0; i < 24; i += 1) {
  // Play until the run stops making progress, then descend.
  let previous = -1;
  let stagnant = 0;
  while (stagnant < 8) {
    autoplay(state, SESSION);
    elapsed += SESSION;
    if (state.highestFloor === previous) stagnant += 1;
    else stagnant = 0;
    previous = state.highestFloor;
  }

  const gain = pendingRelics(state.highestFloor);
  const stats = computeStats(state);
  console.log(
    [
      String(run).padStart(3),
      formatDuration(elapsed).padStart(11),
      String(state.highestFloor).padStart(6),
      `${formatNumber(gain)} (${formatNumber(state.relics.add(gain))})`.padStart(14),
      formatNumber(stats.relicMultiplier).padStart(11),
      formatNumber(stats.damagePerSecond).padStart(10),
    ].join(' '),
  );

  if (!canDescend(state)) break;
  descend(state, 0);
  run += 1;
}
