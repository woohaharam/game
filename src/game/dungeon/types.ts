/** Tile kinds. Kept as a numeric enum so the map is a flat Uint8Array. */
export const Tile = {
  Void: 0,
  Floor: 1,
  Wall: 2,
  /** Corridor floor — same collision as Floor, drawn differently. */
  Corridor: 3,
  /** Door threshold: walkable only while the room is cleared. */
  Door: 4,
} as const;

export type TileId = (typeof Tile)[keyof typeof Tile];

export type RoomType = 'start' | 'combat' | 'elite' | 'treasure' | 'shop' | 'boss';

export type Direction = 'north' | 'south' | 'east' | 'west';

export const DIRECTIONS: readonly Direction[] = ['north', 'east', 'south', 'west'];

export const DIRECTION_VECTORS: Record<Direction, { x: number; y: number }> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

export const OPPOSITE: Record<Direction, Direction> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

export interface Door {
  direction: Direction;
  /** Tile coordinates of the door threshold's centre. */
  tileX: number;
  tileY: number;
  /** Index of the room on the other side. */
  to: number;
}

export interface Room {
  index: number;
  type: RoomType;
  /** Position in the abstract room graph. */
  cellX: number;
  cellY: number;
  /** Interior bounds in tiles, walls excluded. */
  tileX: number;
  tileY: number;
  tileWidth: number;
  tileHeight: number;
  doors: Door[];
  /** BFS distance from the start room, in rooms. */
  depth: number;
  /** Set once every enemy in the room is dead. */
  cleared: boolean;
  /** Whether the player has ever entered — drives minimap reveal. */
  visited: boolean;
  /** Pre-validated spawn positions in tile coordinates. */
  spawnPoints: { x: number; y: number }[];
}

export interface Dungeon {
  seed: number;
  depth: number;
  rooms: Room[];
  startRoom: number;
  bossRoom: number;
  /** Row-major tile grid, `width * height` entries. */
  tiles: Uint8Array;
  width: number;
  height: number;
}

export const TILE_SIZE = 32;

export function tileIndex(dungeon: Dungeon, x: number, y: number): number {
  return y * dungeon.width + x;
}

export function tileAt(dungeon: Dungeon, x: number, y: number): TileId {
  if (x < 0 || y < 0 || x >= dungeon.width || y >= dungeon.height) return Tile.Void;
  return (dungeon.tiles[y * dungeon.width + x] ?? Tile.Void) as TileId;
}

/** True when a tile can be stood on, ignoring door locking. */
export function isWalkable(tile: TileId): boolean {
  return tile === Tile.Floor || tile === Tile.Corridor || tile === Tile.Door;
}

/** Room interior in world pixels. */
export function roomBounds(room: Room): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: room.tileX * TILE_SIZE,
    y: room.tileY * TILE_SIZE,
    width: room.tileWidth * TILE_SIZE,
    height: room.tileHeight * TILE_SIZE,
  };
}

export function roomCenter(room: Room): { x: number; y: number } {
  return {
    x: (room.tileX + room.tileWidth / 2) * TILE_SIZE,
    y: (room.tileY + room.tileHeight / 2) * TILE_SIZE,
  };
}

/** Finds the room containing a world position, or -1. */
export function roomAtPosition(dungeon: Dungeon, worldX: number, worldY: number): number {
  const tx = Math.floor(worldX / TILE_SIZE);
  const ty = Math.floor(worldY / TILE_SIZE);
  for (const room of dungeon.rooms) {
    if (
      tx >= room.tileX - 1 &&
      tx < room.tileX + room.tileWidth + 1 &&
      ty >= room.tileY - 1 &&
      ty < room.tileY + room.tileHeight + 1
    ) {
      return room.index;
    }
  }
  return -1;
}
