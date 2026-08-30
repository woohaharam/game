/**
 * Stage curves: how heavy a fragment is and what absorbing it pays.
 *
 * The two growth rates are the whole balance of the game. Fragment mass grows
 * faster than the dust a fragment yields, so absorbing alone always eventually
 * stalls — that gap is what makes compressing (prestige) the only way forward
 * rather than an optional extra. Widen the gap and the game becomes a grind;
 * close it and the player never has a reason to reset.
 *
 * There is deliberately no failure state. A dungeon crawler can push you back a
 * floor; a growing stone cannot un-grow. When a stage becomes too heavy the
 * player simply slows down, which is the genre's honest version of a wall.
 */

import { Decimal } from '@core/decimal';
import { t } from '@core/i18n';

/** Fragments absorbed before the stone reaches the next stage. */
export const FRAGMENTS_PER_STAGE = 10;

/**
 * Stage 1 is tuned so the very first fragment is absorbed in about two seconds.
 *
 * Measured in a browser on the previous version of this game: at ten times this
 * mass against the starting absorption rate, the opening nine and a half
 * seconds showed a bar moving and nothing else — no absorption, no dust, no
 * reason to stay. A portal player decides in less time than that.
 */
const BASE_MASS = 6;
const MASS_GROWTH = 1.55;

const BASE_DUST = 4;
const DUST_GROWTH = 1.47;

/**
 * Absorption is never instant, however dense the stone.
 *
 * Without this the loop can clear unbounded stages in zero simulated time, and
 * the feed becomes an unreadable blur. Twenty fragments per second is already
 * past what anyone can follow.
 */
export const MIN_ABSORB_TIME = 0.05;

/** Mass of a single fragment at `stage`, in grams. */
export function fragmentMass(stage: number): Decimal {
  return Decimal.of(BASE_MASS, 0).multiply(Decimal.of(MASS_GROWTH, 0).pow(stage - 1));
}

/** Dust yielded by absorbing one fragment at `stage`. */
export function fragmentDust(stage: number): Decimal {
  return Decimal.of(BASE_DUST, 0).multiply(Decimal.of(DUST_GROWTH, 0).pow(stage - 1));
}

/**
 * How many stages share one named form.
 *
 * Four is the pacing dial for how often the stone visibly becomes something
 * else. Every stage would make the ladder cheap; every ten would leave long
 * stretches where the only thing changing is a number.
 */
const STAGES_PER_FORM = 4;

/** Named forms, from a grain of sand to a galaxy. */
export const FORM_COUNT = 20;

export function formIndex(stage: number): number {
  return Math.max(0, Math.floor((stage - 1) / STAGES_PER_FORM));
}

/**
 * How far through its current form the stone is, from 0 to 1.
 *
 * Drives the on-screen size within a form, so growth is visible between the
 * moments the shape changes. Without it the stone is static for four stages at
 * a time, which is most of the game.
 */
export function formProgress(stage: number): number {
  return ((stage - 1) % STAGES_PER_FORM) / STAGES_PER_FORM;
}

/** What the stone currently *is*, which is what the player actually watches. */
export function formName(stage: number): string {
  const index = formIndex(stage);
  const key = `form.${(index % FORM_COUNT) as FormOrdinal}` as const;
  const name = t(key);

  const lap = Math.floor(index / FORM_COUNT);
  if (lap === 0) return name;
  // Past a galaxy there is nowhere left to go, so the ladder starts again one
  // universe out rather than inventing names nobody has a picture of.
  return t('form.beyond', { form: name, lap: lap + 1 });
}

type FormOrdinal =
  0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19;

/**
 * Fragment names are generic on purpose.
 *
 * They describe shape, not scale — a lump is a lump whether it weighs a gram or
 * a solar mass — and the displayed mass carries the scale instead. Naming them
 * per form would mean sixty strings per language that say less than the number
 * beside them already does.
 */
const FRAGMENT_COUNT = 5;

export function fragmentName(index: number): string {
  const slot = (Math.abs(index) % FRAGMENT_COUNT) as 0 | 1 | 2 | 3 | 4;
  return t(`fragment.${slot}` as const);
}
