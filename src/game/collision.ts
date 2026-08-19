import { TILE_SIZE, Tile, type Dungeon, type TileId } from '@game/dungeon/types';

/**
 * Circle-vs-tilemap collision.
 *
 * The map is a uniform grid, so there is no reason to run a general polygon
 * solver: only the handful of tiles under the entity's bounding box can
 * possibly collide, and each is an axis-aligned box. Resolution pushes the
 * circle out along the axis of least penetration, which is what lets a player
 * slide along a wall instead of catching on it.
 *
 * Doors are solid or not depending on `doorsLocked`, so combat lockdown is a
 * property of the collision query rather than a separate set of wall entities.
 */

export interface CollisionResult {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
}

export function isSolidTile(tile: TileId, doorsLocked: boolean): boolean {
  if (tile === Tile.Void || tile === Tile.Wall) return true;
  if (tile === Tile.Door) return doorsLocked;
  return false;
}

export function isSolidAt(
  dungeon: Dungeon,
  worldX: number,
  worldY: number,
  doorsLocked: boolean,
): boolean {
  const tx = Math.floor(worldX / TILE_SIZE);
  const ty = Math.floor(worldY / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= dungeon.width || ty >= dungeon.height) return true;
  return isSolidTile(
    (dungeon.tiles[ty * dungeon.width + tx] ?? Tile.Void) as TileId,
    doorsLocked,
  );
}

/**
 * Pushes a circle out of any solid tile it overlaps.
 *
 * Runs a couple of relaxation passes: resolving one tile can push the circle
 * into another (inside corners), and a single pass leaves the entity visibly
 * embedded in geometry for a frame.
 */
export function resolveCircle(
  dungeon: Dungeon,
  x: number,
  y: number,
  radius: number,
  doorsLocked: boolean,
  result: CollisionResult,
): CollisionResult {
  result.x = x;
  result.y = y;
  result.hitX = false;
  result.hitY = false;

  for (let pass = 0; pass < 2; pass++) {
    let corrected = false;
    const minX = Math.floor((result.x - radius) / TILE_SIZE);
    const maxX = Math.floor((result.x + radius) / TILE_SIZE);
    const minY = Math.floor((result.y - radius) / TILE_SIZE);
    const maxY = Math.floor((result.y + radius) / TILE_SIZE);

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const outside = tx < 0 || ty < 0 || tx >= dungeon.width || ty >= dungeon.height;
        const tile = outside
          ? Tile.Void
          : ((dungeon.tiles[ty * dungeon.width + tx] ?? Tile.Void) as TileId);
        if (!isSolidTile(tile, doorsLocked)) continue;

        const left = tx * TILE_SIZE;
        const top = ty * TILE_SIZE;
        // Closest point on the tile box to the circle centre.
        const nearestX = Math.max(left, Math.min(result.x, left + TILE_SIZE));
        const nearestY = Math.max(top, Math.min(result.y, top + TILE_SIZE));
        const dx = result.x - nearestX;
        const dy = result.y - nearestY;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq >= radius * radius) continue;

        if (distanceSq > 1e-6) {
          // Face or corner contact: push straight out along the contact normal.
          const distance = Math.sqrt(distanceSq);
          const push = radius - distance;
          result.x += (dx / distance) * push;
          result.y += (dy / distance) * push;
          if (Math.abs(dx) > Math.abs(dy)) result.hitX = true;
          else result.hitY = true;
        } else {
          // Centre is inside the tile — eject along the shallowest axis.
          const overlapLeft = result.x - left;
          const overlapRight = left + TILE_SIZE - result.x;
          const overlapTop = result.y - top;
          const overlapBottom = top + TILE_SIZE - result.y;
          const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
          if (minOverlap === overlapLeft) {
            result.x = left - radius;
            result.hitX = true;
          } else if (minOverlap === overlapRight) {
            result.x = left + TILE_SIZE + radius;
            result.hitX = true;
          } else if (minOverlap === overlapTop) {
            result.y = top - radius;
            result.hitY = true;
          } else {
            result.y = top + TILE_SIZE + radius;
            result.hitY = true;
          }
        }
        corrected = true;
      }
    }
    if (!corrected) break;
  }

  return result;
}

/**
 * Bresenham-style line of sight over the tile grid.
 *
 * Ranged enemies use this so they do not shoot into a pillar they are hiding
 * behind, which is the difference between an arena that reads as tactical and
 * one that reads as random.
 */
export function hasLineOfSight(
  dungeon: Dungeon,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return true;

  // Half-tile steps: fine enough not to skip a one-tile pillar, coarse enough
  // to stay cheap when a dozen enemies test sight every tick.
  const steps = Math.ceil(distance / (TILE_SIZE * 0.5));
  const stepX = dx / steps;
  const stepY = dy / steps;

  for (let i = 1; i < steps; i++) {
    const x = fromX + stepX * i;
    const y = fromY + stepY * i;
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= dungeon.width || ty >= dungeon.height) return false;
    const tile = (dungeon.tiles[ty * dungeon.width + tx] ?? Tile.Void) as TileId;
    if (tile === Tile.Void || tile === Tile.Wall) return false;
  }
  return true;
}
