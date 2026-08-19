import type { Renderer } from '@engine/renderer';
import type { World } from '@game/world';
import { UI, paletteForDepth } from '@game/render/theme';
import type { RoomType } from '@game/dungeon/types';

/**
 * Minimap.
 *
 * Drawn from the room *graph*, not the tile map: one small box per room laid
 * out on its grid cell. A scaled-down tile render would be unreadable at this
 * size, whereas the graph is exactly the information the player wants — where
 * have I been, what is next, and where is the boss.
 *
 * Rooms are revealed by adjacency: a room you have stood in shows its type,
 * its neighbours show as unexplored outlines. That keeps the fog-of-war
 * tension without ever leaving the player genuinely lost.
 */
const CELL = 15;
const GAP = 5;

const ROOM_MARKS: Partial<Record<RoomType, { glyph: string; color: string }>> = {
  boss: { glyph: '✦', color: UI.danger },
  treasure: { glyph: '★', color: UI.coin },
  shop: { glyph: '⬥', color: '#7ee787' },
  elite: { glyph: '✚', color: UI.rarity.epic },
};

export class Minimap {
  render(renderer: Renderer, world: World): void {
    const { ctx } = renderer;
    const rooms = world.dungeon.rooms;
    if (rooms.length === 0) return;

    const palette = paletteForDepth(world.run.depth);
    const minX = Math.min(...rooms.map((r) => r.cellX));
    const minY = Math.min(...rooms.map((r) => r.cellY));
    const maxX = Math.max(...rooms.map((r) => r.cellX));
    const maxY = Math.max(...rooms.map((r) => r.cellY));

    const width = (maxX - minX + 1) * (CELL + GAP) - GAP;
    const height = (maxY - minY + 1) * (CELL + GAP) - GAP;
    const padding = 10;
    const originX = renderer.width - width - padding - 14;
    const originY = 92;

    ctx.save();
    ctx.globalAlpha = 0.9;
    renderer.rect(
      originX - padding,
      originY - padding,
      width + padding * 2,
      height + padding * 2,
      UI.panel,
    );
    renderer.strokeRect(
      originX - padding,
      originY - padding,
      width + padding * 2,
      height + padding * 2,
      UI.panelBorder,
      1,
    );

    // Revealed = visited, or adjacent to something visited.
    const revealed = new Set<number>();
    for (const room of rooms) {
      if (!room.visited) continue;
      revealed.add(room.index);
      for (const door of room.doors) revealed.add(door.to);
    }

    for (const room of rooms) {
      if (!revealed.has(room.index)) continue;
      const x = originX + (room.cellX - minX) * (CELL + GAP);
      const y = originY + (room.cellY - minY) * (CELL + GAP);
      const isCurrent = room.index === world.currentRoom;

      // Connectors are drawn first so room boxes sit on top of them.
      for (const door of room.doors) {
        const other = rooms[door.to];
        if (other === undefined || !revealed.has(other.index)) continue;
        const ox = originX + (other.cellX - minX) * (CELL + GAP);
        const oy = originY + (other.cellY - minY) * (CELL + GAP);
        renderer.line(
          x + CELL / 2,
          y + CELL / 2,
          ox + CELL / 2,
          oy + CELL / 2,
          'rgba(120, 160, 200, 0.28)',
          2,
        );
      }

      if (!room.visited) {
        // Known-of but unentered: outline only.
        renderer.strokeRect(x, y, CELL, CELL, 'rgba(140, 170, 210, 0.35)', 1);
        continue;
      }

      renderer.rect(x, y, CELL, CELL, room.cleared ? '#1d2c42' : '#3a2030');
      renderer.strokeRect(
        x,
        y,
        CELL,
        CELL,
        isCurrent ? palette.accent : 'rgba(150,180,220,0.4)',
        isCurrent ? 2 : 1,
      );

      const mark = ROOM_MARKS[room.type];
      if (mark !== undefined) {
        renderer.text(mark.glyph, x + CELL / 2, y + CELL - 3.5, {
          size: 11,
          color: mark.color,
          align: 'center',
        });
      } else if (isCurrent) {
        renderer.circle(x + CELL / 2, y + CELL / 2, 3, palette.accent, 6);
      }
    }

    ctx.restore();
  }
}
