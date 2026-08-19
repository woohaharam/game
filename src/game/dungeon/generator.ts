import { Rng } from '@engine/rng';
import {
  DIRECTIONS,
  DIRECTION_VECTORS,
  OPPOSITE,
  Tile,
  type Direction,
  type Dungeon,
  type Room,
  type RoomType,
} from './types';

/**
 * Procedural dungeon generation.
 *
 * Two stages, deliberately separated:
 *
 *   1. **Graph** — rooms are laid out as cells on an abstract grid via a
 *      randomised growth walk. A candidate cell is rejected when it already
 *      touches more than one placed room, which is what turns a shapeless blob
 *      into a branching tree with dead ends. Dead ends are then the natural
 *      home for treasure, shop and boss rooms: the player has to commit to a
 *      detour to reach them.
 *   2. **Tiles** — each cell is carved into a shared tile grid. Rooms sit
 *      centred inside their cell, so the corridor that runs along the cell's
 *      centre line always meets the room's wall midpoint. That single
 *      invariant is what lets rooms vary in size while doors still line up
 *      without any per-pair fixups.
 *
 * Everything is driven by the injected `Rng`, so the same seed always yields
 * the same dungeon — which is what makes the generator unit-testable and runs
 * shareable.
 */

/** Cell footprint in tiles. Must exceed the largest room plus corridor. */
const CELL_WIDTH = 34;
const CELL_HEIGHT = 26;
/** Corridor width in tiles; odd so it centres on the cell's middle line. */
const CORRIDOR_WIDTH = 3;
/** Padding around the whole map so edge walls always have room. */
const MAP_PADDING = 2;

interface Cell {
  x: number;
  y: number;
  links: Set<Direction>;
  depth: number;
  type: RoomType;
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Room count grows with depth so floors get meatier as the run goes on. */
export function roomCountForDepth(depth: number): number {
  return Math.min(16, 7 + depth * 2);
}

export interface GenerateOptions {
  seed: number;
  /** 1-based floor number. */
  depth: number;
  roomCount?: number;
}

export function generateDungeon(options: GenerateOptions): Dungeon {
  const rng = new Rng(options.seed);
  const targetRooms = options.roomCount ?? roomCountForDepth(options.depth);

  const cells = growGraph(rng, targetRooms);
  assignDepths(cells);
  assignRoomTypes(rng, cells);

  return carve(rng, cells, options);
}

// ---------------------------------------------------------------------------
// Stage 1: room graph
// ---------------------------------------------------------------------------

function growGraph(rng: Rng, targetRooms: number): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const start: Cell = { x: 0, y: 0, links: new Set(), depth: 0, type: 'start' };
  cells.set(cellKey(0, 0), start);

  /** Cells still eligible to sprout a neighbour. */
  const frontier: Cell[] = [start];
  let guard = targetRooms * 200;

  while (cells.size < targetRooms && frontier.length > 0 && guard-- > 0) {
    const from = rng.pick(frontier);
    const direction = rng.pick(DIRECTIONS);
    const vector = DIRECTION_VECTORS[direction];
    const nx = from.x + vector.x;
    const ny = from.y + vector.y;
    const key = cellKey(nx, ny);
    if (cells.has(key)) continue;

    // Reject cells that would touch more than the parent: this is what keeps
    // the layout tree-shaped instead of collapsing into a solid rectangle.
    let neighbours = 0;
    for (const dir of DIRECTIONS) {
      const v = DIRECTION_VECTORS[dir];
      if (cells.has(cellKey(nx + v.x, ny + v.y))) neighbours++;
    }
    if (neighbours > 1) continue;

    const cell: Cell = { x: nx, y: ny, links: new Set(), depth: 0, type: 'combat' };
    cell.links.add(OPPOSITE[direction]);
    from.links.add(direction);
    cells.set(key, cell);
    frontier.push(cell);

    // Cells with three links are full enough; drop them from the frontier so
    // growth keeps spreading outward instead of clustering near the start.
    if (from.links.size >= 3) {
      const at = frontier.indexOf(from);
      if (at >= 0) frontier.splice(at, 1);
    }
  }

  // A couple of extra connections turn the tree into a graph with one or two
  // loops, so backtracking through a cleared floor is less tedious.
  addLoops(rng, cells);
  return cells;
}

function addLoops(rng: Rng, cells: Map<string, Cell>): void {
  const candidates: Array<{ cell: Cell; direction: Direction; other: Cell }> = [];
  for (const cell of cells.values()) {
    for (const direction of DIRECTIONS) {
      if (cell.links.has(direction)) continue;
      const v = DIRECTION_VECTORS[direction];
      const other = cells.get(cellKey(cell.x + v.x, cell.y + v.y));
      if (other === undefined) continue;
      candidates.push({ cell, direction, other });
    }
  }
  const loops = Math.min(candidates.length, rng.int(0, 2));
  for (const candidate of rng.sample(candidates, loops)) {
    candidate.cell.links.add(candidate.direction);
    candidate.other.links.add(OPPOSITE[candidate.direction]);
  }
}

function assignDepths(cells: Map<string, Cell>): void {
  for (const cell of cells.values()) cell.depth = Number.POSITIVE_INFINITY;
  const start = cells.get(cellKey(0, 0));
  if (start === undefined) return;

  start.depth = 0;
  const queue: Cell[] = [start];
  while (queue.length > 0) {
    const cell = queue.shift() as Cell;
    for (const direction of cell.links) {
      const v = DIRECTION_VECTORS[direction];
      const next = cells.get(cellKey(cell.x + v.x, cell.y + v.y));
      if (next === undefined || next.depth <= cell.depth + 1) continue;
      next.depth = cell.depth + 1;
      queue.push(next);
    }
  }
}

function assignRoomTypes(rng: Rng, cells: Map<string, Cell>): void {
  const all = [...cells.values()].filter((c) => c.type !== 'start');
  // Dead ends (single link) are the reward slots — reaching one always costs
  // a detour, which is what makes the reward feel earned.
  const deadEnds = all
    .filter((c) => c.links.size === 1)
    .sort((a, b) => b.depth - a.depth);
  const pool = deadEnds.length > 0 ? deadEnds : [...all].sort((a, b) => b.depth - a.depth);

  const take = (): Cell | undefined => pool.shift();

  const boss = take();
  if (boss !== undefined) boss.type = 'boss';
  const treasure = take();
  if (treasure !== undefined) treasure.type = 'treasure';
  const shop = take();
  if (shop !== undefined) shop.type = 'shop';

  // Deeper combat rooms have a chance to be elite: harder mix, better drop.
  for (const cell of all) {
    if (cell.type !== 'combat') continue;
    if (cell.depth >= 2 && rng.chance(0.18)) cell.type = 'elite';
  }

  // A floor with no boss (degenerate tiny graph) is unwinnable — force one.
  if (boss === undefined && all.length > 0) {
    const farthest = all.reduce((a, b) => (b.depth > a.depth ? b : a));
    farthest.type = 'boss';
  }
}

// ---------------------------------------------------------------------------
// Stage 2: tile carving
// ---------------------------------------------------------------------------

/** Room interior size in tiles, per room type. Both dimensions stay odd. */
function roomSizeFor(type: RoomType, rng: Rng): { width: number; height: number } {
  switch (type) {
    case 'boss':
      return { width: 25, height: 19 };
    case 'treasure':
    case 'shop':
      return { width: 13, height: 11 };
    case 'start':
      return { width: 15, height: 11 };
    default: {
      const width = rng.pick([15, 17, 19, 21, 23]);
      const height = rng.pick([11, 13, 15]);
      return { width, height };
    }
  }
}

function carve(rng: Rng, cells: Map<string, Cell>, options: GenerateOptions): Dungeon {
  const list = [...cells.values()];
  const minCellX = Math.min(...list.map((c) => c.x));
  const minCellY = Math.min(...list.map((c) => c.y));
  const maxCellX = Math.max(...list.map((c) => c.x));
  const maxCellY = Math.max(...list.map((c) => c.y));

  const gridWidth = maxCellX - minCellX + 1;
  const gridHeight = maxCellY - minCellY + 1;
  const width = gridWidth * CELL_WIDTH + MAP_PADDING * 2;
  const height = gridHeight * CELL_HEIGHT + MAP_PADDING * 2;
  const tiles = new Uint8Array(width * height); // zero-filled = Tile.Void

  const dungeon: Dungeon = {
    seed: options.seed,
    depth: options.depth,
    rooms: [],
    startRoom: 0,
    bossRoom: 0,
    tiles,
    width,
    height,
  };

  const set = (x: number, y: number, tile: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    tiles[y * width + x] = tile;
  };

  // Sort for stable room indices regardless of Map iteration order.
  list.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  const roomByKey = new Map<string, Room>();

  for (const cell of list) {
    const size = roomSizeFor(cell.type, rng);
    // Cell origin in tiles, then centre the room inside it. Rounding to even
    // offsets keeps the room's centre line on the cell's centre line, which is
    // the invariant corridors rely on.
    const cellOriginX = (cell.x - minCellX) * CELL_WIDTH + MAP_PADDING;
    const cellOriginY = (cell.y - minCellY) * CELL_HEIGHT + MAP_PADDING;
    const tileX = cellOriginX + Math.floor((CELL_WIDTH - size.width) / 2);
    const tileY = cellOriginY + Math.floor((CELL_HEIGHT - size.height) / 2);

    for (let y = tileY; y < tileY + size.height; y++) {
      for (let x = tileX; x < tileX + size.width; x++) set(x, y, Tile.Floor);
    }

    const room: Room = {
      index: dungeon.rooms.length,
      type: cell.type,
      cellX: cell.x,
      cellY: cell.y,
      tileX,
      tileY,
      tileWidth: size.width,
      tileHeight: size.height,
      doors: [],
      depth: Number.isFinite(cell.depth) ? cell.depth : 0,
      cleared: cell.type === 'start' || cell.type === 'treasure' || cell.type === 'shop',
      visited: false,
      spawnPoints: [],
    };
    dungeon.rooms.push(room);
    roomByKey.set(cellKey(cell.x, cell.y), room);
    if (cell.type === 'start') dungeon.startRoom = room.index;
    if (cell.type === 'boss') dungeon.bossRoom = room.index;
  }

  carveCorridors(cells, roomByKey, minCellX, minCellY, set, dungeon);
  for (const room of dungeon.rooms) carveObstacles(rng, room, dungeon, set);
  sealUnreachable(dungeon);
  buildWalls(dungeon);
  for (const room of dungeon.rooms) collectSpawnPoints(room, dungeon);

  return dungeon;
}

type SetTile = (x: number, y: number, tile: number) => void;

function carveCorridors(
  cells: Map<string, Cell>,
  roomByKey: Map<string, Room>,
  minCellX: number,
  minCellY: number,
  set: SetTile,
  dungeon: Dungeon,
): void {
  const half = Math.floor(CORRIDOR_WIDTH / 2);

  for (const cell of cells.values()) {
    const room = roomByKey.get(cellKey(cell.x, cell.y));
    if (room === undefined) continue;

    // The cell's centre line, which every corridor from this cell runs along.
    const centreX = (cell.x - minCellX) * CELL_WIDTH + MAP_PADDING + Math.floor(CELL_WIDTH / 2);
    const centreY = (cell.y - minCellY) * CELL_HEIGHT + MAP_PADDING + Math.floor(CELL_HEIGHT / 2);

    for (const direction of cell.links) {
      const v = DIRECTION_VECTORS[direction];
      const neighbourKey = cellKey(cell.x + v.x, cell.y + v.y);
      const neighbour = roomByKey.get(neighbourKey);
      if (neighbour === undefined) continue;
      // Each pair is carved once, from the lower index, so overlapping writes
      // cannot produce two doors on the same threshold.
      if (neighbour.index < room.index) continue;

      const isVertical = direction === 'north' || direction === 'south';
      const step = isVertical ? v.y : v.x;

      // Walk from the room wall out to the neighbour's wall along the centre line.
      const fromEdge = isVertical
        ? step < 0
          ? room.tileY - 1
          : room.tileY + room.tileHeight
        : step < 0
          ? room.tileX - 1
          : room.tileX + room.tileWidth;
      const toEdge = isVertical
        ? step < 0
          ? neighbour.tileY + neighbour.tileHeight
          : neighbour.tileY - 1
        : step < 0
          ? neighbour.tileX + neighbour.tileWidth
          : neighbour.tileX - 1;

      for (let p = fromEdge; step > 0 ? p <= toEdge : p >= toEdge; p += step) {
        for (let o = -half; o <= half; o++) {
          if (isVertical) set(centreX + o, p, Tile.Corridor);
          else set(p, centreY + o, Tile.Corridor);
        }
      }

      // Door thresholds sit on each room's own wall line.
      const doorA = isVertical
        ? { x: centreX, y: fromEdge }
        : { x: fromEdge, y: centreY };
      const doorB = isVertical
        ? { x: centreX, y: toEdge }
        : { x: toEdge, y: centreY };

      for (let o = -half; o <= half; o++) {
        if (isVertical) {
          set(doorA.x + o, doorA.y, Tile.Door);
          set(doorB.x + o, doorB.y, Tile.Door);
        } else {
          set(doorA.x, doorA.y + o, Tile.Door);
          set(doorB.x, doorB.y + o, Tile.Door);
        }
      }

      room.doors.push({
        direction,
        tileX: doorA.x,
        tileY: doorA.y,
        to: neighbour.index,
      });
      neighbour.doors.push({
        direction: OPPOSITE[direction],
        tileX: doorB.x,
        tileY: doorB.y,
        to: room.index,
      });
      void dungeon;
    }
  }
}

/**
 * Interior cover. Obstacles exist to break line of sight and give the player
 * something to strafe around; the patterns are symmetric so no arena reads as
 * accidentally unfair, and the centre plus every door approach is always left
 * clear so a room can never generate itself shut.
 */
function carveObstacles(rng: Rng, room: Room, dungeon: Dungeon, set: SetTile): void {
  if (room.type === 'boss' || room.type === 'shop' || room.type === 'treasure') return;
  if (room.type === 'start') return;

  const pattern = rng.pick(['none', 'corners', 'pillars', 'cross', 'diamond'] as const);
  if (pattern === 'none') return;

  const { tileX: x0, tileY: y0, tileWidth: w, tileHeight: h } = room;
  const cx = x0 + Math.floor(w / 2);
  const cy = y0 + Math.floor(h / 2);

  const blocked: Array<{ x: number; y: number }> = [];
  const add = (x: number, y: number): void => {
    blocked.push({ x, y });
  };

  switch (pattern) {
    case 'corners': {
      const inset = 3;
      const size = 2;
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          add(x0 + inset + dx, y0 + inset + dy);
          add(x0 + w - 1 - inset - dx, y0 + inset + dy);
          add(x0 + inset + dx, y0 + h - 1 - inset - dy);
          add(x0 + w - 1 - inset - dx, y0 + h - 1 - inset - dy);
        }
      }
      break;
    }
    case 'pillars': {
      for (let y = y0 + 3; y < y0 + h - 3; y += 4) {
        for (let x = x0 + 3; x < x0 + w - 3; x += 4) add(x, y);
      }
      break;
    }
    case 'cross': {
      const arm = Math.floor(Math.min(w, h) / 4);
      for (let i = -arm; i <= arm; i++) {
        if (Math.abs(i) <= 1) continue; // leave the middle open
        add(cx + i, cy);
        add(cx, cy + i);
      }
      break;
    }
    case 'diamond': {
      const radius = Math.floor(Math.min(w, h) / 3);
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const manhattan = Math.abs(dx) + Math.abs(dy);
          if (manhattan !== radius) continue;
          // Gap the four cardinal tips. An unbroken ring would seal the
          // centre of the room off from the rest of the arena.
          if (dx === 0 || dy === 0) continue;
          add(cx + dx, cy + dy);
        }
      }
      break;
    }
  }

  // Never place cover in a door's approach lane or dead centre.
  const doorLanes = new Set<string>();
  for (const door of room.doors) {
    for (let d = -2; d <= 4; d++) {
      for (let o = -2; o <= 2; o++) {
        if (door.direction === 'north') doorLanes.add(`${door.tileX + o},${door.tileY + d}`);
        else if (door.direction === 'south') doorLanes.add(`${door.tileX + o},${door.tileY - d}`);
        else if (door.direction === 'west') doorLanes.add(`${door.tileX + d},${door.tileY + o}`);
        else doorLanes.add(`${door.tileX - d},${door.tileY + o}`);
      }
    }
  }

  for (const tile of blocked) {
    if (tile.x <= x0 || tile.y <= y0 || tile.x >= x0 + w - 1 || tile.y >= y0 + h - 1) continue;
    if (doorLanes.has(`${tile.x},${tile.y}`)) continue;
    if (Math.abs(tile.x - cx) <= 1 && Math.abs(tile.y - cy) <= 1) continue;
    set(tile.x, tile.y, Tile.Void);
  }
  void dungeon;
}

/**
 * Generate-then-validate safety net.
 *
 * Obstacle patterns are designed not to seal anything off, but "designed not
 * to" is not a guarantee across every seed and every room size. So the carved
 * map is flood filled from the start room, and anything the flood cannot reach
 * is turned back into solid rock. The player can then never be shown a pocket
 * of floor they have no way into, whatever the obstacle roll produced.
 */
function sealUnreachable(dungeon: Dungeon): void {
  const { width, height, tiles } = dungeon;
  const start = dungeon.rooms[dungeon.startRoom];
  if (start === undefined) return;

  const sx = start.tileX + Math.floor(start.tileWidth / 2);
  const sy = start.tileY + Math.floor(start.tileHeight / 2);
  const reached = new Uint8Array(width * height);
  const stack: number[] = [sy * width + sx];
  reached[stack[0] as number] = 1;

  while (stack.length > 0) {
    const index = stack.pop() as number;
    const x = index % width;
    const y = (index - x) / width;
    const neighbours = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const;
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (reached[next] === 1 || tiles[next] === Tile.Void) continue;
      reached[next] = 1;
      stack.push(next);
    }
  }

  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== Tile.Void && reached[i] !== 1) tiles[i] = Tile.Void;
  }
}

/** Any void tile touching walkable floor becomes a wall — the rest stays void. */
function buildWalls(dungeon: Dungeon): void {
  const { width, height, tiles } = dungeon;
  const source = Uint8Array.from(tiles);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (source[index] !== Tile.Void) continue;
      let touchesFloor = false;
      for (let dy = -1; dy <= 1 && !touchesFloor; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = source[ny * width + nx];
          if (neighbour !== undefined && neighbour !== Tile.Void) {
            touchesFloor = true;
            break;
          }
        }
      }
      if (touchesFloor) tiles[index] = Tile.Wall;
    }
  }
}

/**
 * Pre-computes enemy spawn positions once at generation time: open floor,
 * away from walls and doors so nothing can spawn inside geometry or ambush the
 * player the instant they step through a threshold.
 */
function collectSpawnPoints(room: Room, dungeon: Dungeon): void {
  const { tiles, width } = dungeon;
  const margin = 2;
  for (let y = room.tileY + margin; y < room.tileY + room.tileHeight - margin; y++) {
    for (let x = room.tileX + margin; x < room.tileX + room.tileWidth - margin; x++) {
      if (tiles[y * width + x] !== Tile.Floor) continue;

      let open = true;
      for (let dy = -1; dy <= 1 && open; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (tiles[(y + dy) * width + (x + dx)] !== Tile.Floor) {
            open = false;
            break;
          }
        }
      }
      if (!open) continue;

      let nearDoor = false;
      for (const door of room.doors) {
        if (Math.abs(door.tileX - x) + Math.abs(door.tileY - y) < 5) {
          nearDoor = true;
          break;
        }
      }
      if (nearDoor) continue;

      room.spawnPoints.push({ x, y });
    }
  }
}
