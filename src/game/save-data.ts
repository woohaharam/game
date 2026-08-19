import { SaveStore } from '@engine/save';

/**
 * Meta-progression: the handful of numbers that outlive a run.
 *
 * Deliberately small. Persistent power-ups would undercut the point of a
 * roguelike whose whole promise is that a run is won by play, not by grind —
 * so what persists is records and preferences, not strength.
 */
export interface Profile {
  bestScore: number;
  bestDepth: number;
  runs: number;
  totalKills: number;
  bossesFelled: number;
  muted: boolean;
  lowQuality: boolean;
  /** Last seed the player typed, so a good one can be replayed. */
  lastSeed: string;
}

export const DEFAULT_PROFILE: Profile = {
  bestScore: 0,
  bestDepth: 0,
  runs: 0,
  totalKills: 0,
  bossesFelled: 0,
  muted: false,
  lowQuality: false,
  lastSeed: '',
};

export const profileStore = new SaveStore<Profile>('neon-depths/profile', 1, DEFAULT_PROFILE);
