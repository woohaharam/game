import { SCALING } from '@game/config';
import { SPAWN_TABLE } from '@game/spawn-director';

/**
 * Balance experiments.
 *
 * Each variant is a reversible mutation of the tuning tables, applied around a
 * simulation sweep so several candidate changes can be compared against the
 * same seeds in one command. Paired seeds matter: identical dungeon layouts and
 * identical bot decisions mean any difference in the results is attributable to
 * the change rather than to luck.
 *
 * The tables are declared `as const`, which is a compile-time promise, not a
 * runtime one — hence the casts. That is acceptable *here* and nowhere else:
 * this file exists to answer "what would happen if", never to ship a value.
 */
export interface Variant {
  name: string;
  /** One line on what is being tested and why it is a plausible cause. */
  rationale: string;
  apply(): void;
}

type MutableScaling = { -readonly [K in keyof typeof SCALING]: number };
const scaling = SCALING as MutableScaling;

/** Snapshot of everything a variant is allowed to touch. */
interface Snapshot {
  scaling: MutableScaling;
  unlocks: number[];
}

export function snapshot(): Snapshot {
  return {
    scaling: { ...scaling },
    unlocks: SPAWN_TABLE.map((entry) => entry.minDepth),
  };
}

export function restore(saved: Snapshot): void {
  Object.assign(scaling, saved.scaling);
  SPAWN_TABLE.forEach((entry, index) => {
    (entry as { minDepth: number }).minDepth = saved.unlocks[index]!;
  });
}

function setUnlock(kind: string, depth: number): void {
  const entry = SPAWN_TABLE.find((candidate) => candidate.kind === kind);
  if (entry !== undefined) (entry as { minDepth: number }).minDepth = depth;
}

/**
 * Floor 2 is where runs end: 74% of runs clear floor 1 and about 40% clear
 * floor 2. Four things escalate at once on that transition, so each variant
 * isolates one of them.
 */
export const VARIANTS: readonly Variant[] = [
  {
    name: 'baseline',
    rationale: 'unchanged, for comparison',
    apply: () => {
      /* nothing */
    },
  },
  {
    // The inverse of the change that shipped, kept so the result stays
    // reproducible: this restores the old simultaneous unlock and should now
    // measure as *harder*.
    name: 'revert-stagger',
    rationale: 'put bomber and turret back on floor 2 together (pre-fix behaviour)',
    apply: () => {
      setUnlock('bomber', 2);
      setUnlock('turret', 2);
      setUnlock('brute', 3);
    },
  },
  // The budget line is a dose-response check. One variant showing an effect
  // could be chance; an effect that grows with the size of the change is much
  // harder to explain away, and it also says where the curve should land.
  {
    name: 'budget-1.35',
    rationale: 'room budget per floor 1.6 → 1.35 (a quarter of the way down)',
    apply: () => {
      scaling.budgetPerDepth = 1.35;
    },
  },
  {
    name: 'budget-1.15',
    rationale: 'room budget per floor 1.6 → 1.15; floor 2 goes 5.1 → 4.65',
    apply: () => {
      scaling.budgetPerDepth = 1.15;
    },
  },
  {
    name: 'budget-0.9',
    rationale: 'room budget per floor 1.6 → 0.9, well past the plausible fix',
    apply: () => {
      scaling.budgetPerDepth = 0.9;
    },
  },
  {
    name: 'softer-health',
    rationale: 'every enemy gains 22% health per floor',
    apply: () => {
      scaling.enemyHealthPerDepth = 0.14;
    },
  },
  {
    // Each lever alone is worth roughly a tenth of a floor, which is inside the
    // noise. If the floor-2 step is the sum of four simultaneous escalations
    // rather than any one of them, only changing all of them should show.
    name: 'combined',
    rationale: 'soften budget and health together, on top of staggered unlocks',
    apply: () => {
      scaling.budgetPerDepth = 1.25;
      scaling.enemyHealthPerDepth = 0.16;
    },
  },
  {
    name: 'softer-boss',
    rationale: 'the boss gains 35% health per floor on top of the 22%',
    apply: () => {
      scaling.bossHealthPerDepth = 0.2;
    },
  },
];
