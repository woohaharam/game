/**
 * What each form of the stone looks like.
 *
 * Data, not drawing. This module says a boulder is grey, rough and cratered and
 * that a star glows; `src/ui/stone-canvas.ts` decides how to put that on a
 * canvas. Keeping them apart means the ladder can be re-tuned — a colour, a
 * rougher silhouette, rings two forms earlier — without touching rendering
 * code, and it keeps the content tables in one place.
 *
 * The progression is deliberate rather than a gradient of random values. Early
 * forms are irregular and dull: a pebble is a lump. They round out as they gain
 * mass, which is what gravity actually does, so the silhouette becoming a
 * circle *is* the story of the game. Light arrives late — atmosphere, then a
 * corona, then arms — because it is the payoff and payoffs should be scarce.
 */

export interface FormAppearance {
  /** Base body colour. */
  readonly core: string;
  /** Lit side, towards the light source. */
  readonly highlight: string;
  /** Unlit side. */
  readonly shadow: string;
  /** 0 = a perfect circle, 1 = a jagged lump. */
  readonly roughness: number;
  /** How many surface craters to scatter. */
  readonly craters: number;
  /** Surface patches — continents, seas, storm bands. Empty for bare rock. */
  readonly patches: readonly string[];
  /** Rim light strength, 0 to 1. An atmosphere seen edge-on. */
  readonly atmosphere: number;
  /** Outer glow strength, 0 to 1. */
  readonly glow: string | null;
  readonly rings: boolean;
  /**
   * Drawn as a galaxy rather than as a body: a bright core and sweeping arms,
   * with no solid silhouette at all.
   *
   * A flag rather than a shape parameter because it is a different *kind* of
   * thing, not a rounder one. Everything below a galaxy is an object with a lit
   * side and an unlit side; a galaxy has neither, and drawing a sphere over the
   * arms — which is what happened first — hides the only part worth seeing.
   */
  readonly spiral: boolean;
}

const ROCK: Pick<FormAppearance, 'patches' | 'atmosphere' | 'glow' | 'rings' | 'spiral'> = {
  patches: [],
  atmosphere: 0,
  glow: null,
  rings: false,
  spiral: false,
};

/**
 * One entry per named form, in ladder order.
 *
 * Indexed by the same form index `formName` uses, so the two can never drift
 * apart — a form with a name and no appearance would be a blank circle.
 *
 * Typed as a non-empty tuple so the first entry is known to exist. That removes
 * the need for either a cast or a `!` in the lookup below, and the lookup is the
 * only place a mistake here would surface — as a blank canvas, silently.
 */
export const FORM_APPEARANCE: readonly [FormAppearance, ...FormAppearance[]] = [
  // 모래알 — barely there, and almost all silhouette.
  {
    ...ROCK,
    core: '#8d8579',
    highlight: '#b8b1a3',
    shadow: '#4a463f',
    roughness: 0.95,
    craters: 0,
  },
  // 자갈
  {
    ...ROCK,
    core: '#8a8175',
    highlight: '#b5ac9c',
    shadow: '#46423b',
    roughness: 0.8,
    craters: 1,
  },
  // 돌멩이
  {
    ...ROCK,
    core: '#87806f',
    highlight: '#b0a894',
    shadow: '#433f38',
    roughness: 0.68,
    craters: 2,
  },
  // 조약돌 — water-worn, so noticeably smoother than the gravel before it.
  {
    ...ROCK,
    core: '#918878',
    highlight: '#bcb3a1',
    shadow: '#474338',
    roughness: 0.45,
    craters: 2,
  },
  // 바위
  {
    ...ROCK,
    core: '#7d7468',
    highlight: '#a89e8e',
    shadow: '#3d3933',
    roughness: 0.6,
    craters: 4,
  },
  // 거석
  {
    ...ROCK,
    core: '#736a5f',
    highlight: '#9e9484',
    shadow: '#37342e',
    roughness: 0.55,
    craters: 5,
  },
  // 암반
  {
    ...ROCK,
    core: '#6b6358',
    highlight: '#948a7a',
    shadow: '#332f2a',
    roughness: 0.48,
    craters: 7,
  },
  // 언덕 — the first green.
  {
    ...ROCK,
    core: '#6d6a54',
    highlight: '#8f9470',
    shadow: '#32302a',
    roughness: 0.42,
    craters: 5,
    patches: ['#5c7345', '#4a5f38'],
  },
  // 산
  {
    ...ROCK,
    core: '#6a6a58',
    highlight: '#8d9375',
    shadow: '#2f2e2a',
    roughness: 0.36,
    craters: 4,
    patches: ['#55703f', '#8d8a7a'],
  },
  // 산맥
  {
    ...ROCK,
    core: '#67685a',
    highlight: '#8e9478',
    shadow: '#2c2c28',
    roughness: 0.3,
    craters: 3,
    patches: ['#4f6b3c', '#a8a596'],
  },
  // 대륙 — round enough to read as a world, with sea and cloud.
  {
    core: '#2f5d86',
    highlight: '#5a93bd',
    shadow: '#16283a',
    roughness: 0.14,
    craters: 0,
    patches: ['#4a7a45', '#3d6b3a', '#d7e3ea'],
    atmosphere: 0.35,
    glow: null,
    rings: false,
    spiral: false,
  },
  // 운석 — scorched, and the first thing that emits light of its own.
  {
    core: '#7a5340',
    highlight: '#d4823f',
    shadow: '#2e1a10',
    roughness: 0.5,
    craters: 6,
    patches: ['#c25a24'],
    atmosphere: 0.2,
    glow: 'rgb(226 120 45 / 45%)',
    rings: false,
    spiral: false,
  },
  // 소행성
  {
    ...ROCK,
    core: '#6f665c',
    highlight: '#a49889',
    shadow: '#332e29',
    roughness: 0.44,
    craters: 9,
  },
  // 위성 — the cratered, colourless one.
  {
    ...ROCK,
    core: '#8f8d88',
    highlight: '#cfcdc7',
    shadow: '#3f3e3b',
    roughness: 0.1,
    craters: 12,
  },
  // 행성
  {
    core: '#2d6a8f',
    highlight: '#63a8cd',
    shadow: '#14283a',
    roughness: 0.05,
    craters: 0,
    patches: ['#4c8a4a', '#e2ecf2'],
    atmosphere: 0.6,
    glow: 'rgb(90 160 210 / 30%)',
    rings: false,
    spiral: false,
  },
  // 거대행성 — banded, and the first with rings.
  {
    core: '#b08a5c',
    highlight: '#e0bd8c',
    shadow: '#4d3a25',
    roughness: 0.02,
    craters: 0,
    patches: ['#d9b483', '#8e6a44', '#c99b66'],
    atmosphere: 0.5,
    glow: 'rgb(220 180 120 / 26%)',
    rings: true,
    spiral: false,
  },
  // 갈색왜성 — not quite a star, and it looks like it knows.
  {
    core: '#8a3f2c',
    highlight: '#d5703f',
    shadow: '#38160f',
    roughness: 0.02,
    craters: 0,
    patches: ['#b8532e'],
    atmosphere: 0.7,
    glow: 'rgb(220 110 60 / 55%)',
    rings: false,
    spiral: false,
  },
  // 항성
  {
    core: '#f6c453',
    highlight: '#fff3c4',
    shadow: '#c07a1e',
    roughness: 0,
    craters: 0,
    patches: ['#ffe08a'],
    atmosphere: 0.9,
    glow: 'rgb(255 200 90 / 85%)',
    rings: false,
    spiral: false,
  },
  // 초신성
  {
    core: '#ffffff',
    highlight: '#ffffff',
    shadow: '#9fd8ff',
    roughness: 0,
    craters: 0,
    patches: ['#cfe9ff'],
    atmosphere: 1,
    glow: 'rgb(190 230 255 / 95%)',
    rings: false,
    spiral: false,
  },
  // 은하 — no body, no lit side. Just a core and arms.
  {
    core: '#6d5bc4',
    highlight: '#dcd2ff',
    shadow: '#160f2c',
    roughness: 0,
    craters: 0,
    patches: [],
    atmosphere: 0,
    glow: 'rgb(140 110 225 / 55%)',
    rings: false,
    spiral: true,
  },
];

export function appearanceForForm(formIndex: number): FormAppearance {
  const count = FORM_APPEARANCE.length;
  // Double modulo: JavaScript's `%` keeps the dividend's sign, so a negative
  // index would otherwise reach past the start of the array. That exact bug
  // shipped once before, in a palette lookup, and was hidden by an assertion.
  const wrapped = ((formIndex % count) + count) % count;
  return FORM_APPEARANCE[wrapped] ?? FORM_APPEARANCE[0];
}
