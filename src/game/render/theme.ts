/**
 * Visual identity in one place.
 *
 * The game draws no sprites: every shape is generated at runtime from these
 * values. That is what keeps the build asset-free and lets a floor re-skin
 * itself with a palette swap instead of an art pass — each depth pulls a
 * different accent, so descending visibly changes the mood.
 */
export interface Palette {
  name: string;
  background: string;
  floor: string;
  floorAlt: string;
  corridor: string;
  wall: string;
  wallEdge: string;
  accent: string;
  accentSoft: string;
}

// Typed as a non-empty tuple so the compiler knows index 0 always exists —
// that is what lets the depth lookup fall back without a non-null assertion.
export const PALETTES: readonly [Palette, ...Palette[]] = [
  {
    name: 'Cobalt Vault',
    background: '#05070f',
    floor: '#152036',
    floorAlt: '#101a2c',
    corridor: '#0b1120',
    wall: '#1b2a45',
    wallEdge: '#2f4a78',
    accent: '#4cc9ff',
    accentSoft: '#1d4f75',
  },
  {
    name: 'Ember Works',
    background: '#0d0508',
    floor: '#2b141e',
    floorAlt: '#221019',
    corridor: '#180a10',
    wall: '#3b1a26',
    wallEdge: '#6d2c3f',
    accent: '#ff8a4c',
    accentSoft: '#7a3a22',
  },
  {
    name: 'Verdant Decay',
    background: '#040b08',
    floor: '#14291f',
    floorAlt: '#0f2018',
    corridor: '#091610',
    wall: '#173427',
    wallEdge: '#2a5a41',
    accent: '#4dffa8',
    accentSoft: '#1d6b47',
  },
  {
    name: 'Violet Reach',
    background: '#08050f',
    floor: '#1f1434',
    floorAlt: '#181029',
    corridor: '#110a1c',
    wall: '#2a1b45',
    wallEdge: '#4a2f78',
    accent: '#c78bff',
    accentSoft: '#523080',
  },
];

/**
 * Palettes cycle with depth, so floor 5 looks like floor 1 again.
 *
 * The double modulo keeps the index non-negative: JavaScript's `%` preserves
 * the sign of the dividend, so a plain `(depth - 1) % length` returns -1 for
 * depth 0 and reads off the end of the array.
 */
export function paletteForDepth(depth: number): Palette {
  const count = PALETTES.length;
  const index = (((depth - 1) % count) + count) % count;
  return PALETTES[index] ?? PALETTES[0];
}

export const UI = {
  text: '#e8f4ff',
  textDim: '#7f93ad',
  health: '#ff4d6d',
  healthEmpty: '#2a1420',
  coin: '#ffd166',
  combo: '#6ef2ff',
  danger: '#ff2d6f',
  panel: 'rgba(8, 12, 22, 0.92)',
  panelBorder: 'rgba(76, 201, 255, 0.35)',
  rarity: {
    common: '#9fb3c8',
    rare: '#4cc9ff',
    epic: '#ffb86b',
  },
} as const;
