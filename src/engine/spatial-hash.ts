/**
 * Uniform-grid spatial hash used as the collision broadphase.
 *
 * Checking every entity against every other is O(n^2) — with ~40 enemies and
 * ~200 bullets on screen that is 8,000 pair tests per frame just for
 * bullet-vs-enemy. Bucketing entities into cells the size of the largest
 * collider means each query only visits the handful of cells it overlaps,
 * which brings the practical cost down to roughly O(n).
 *
 * The grid is rebuilt from scratch every frame: everything moves anyway, and
 * clearing reusable buckets is cheaper than incrementally maintaining them.
 */
export class SpatialHash<T> {
  private readonly buckets = new Map<number, T[]>();
  /** Scratch set that de-duplicates entities spanning several cells. */
  private readonly seen = new Set<T>();

  constructor(readonly cellSize: number) {}

  private key(cx: number, cy: number): number {
    // Pack two signed 16-bit cell coordinates into one integer key so the
    // Map can hash a number instead of an allocated "x,y" string.
    return ((cx & 0xffff) << 16) | (cy & 0xffff);
  }

  clear(): void {
    for (const bucket of this.buckets.values()) bucket.length = 0;
  }

  /** Inserts an entity by its circular bounds. */
  insert(item: T, x: number, y: number, radius: number): void {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);

    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const k = this.key(cx, cy);
        let bucket = this.buckets.get(k);
        if (bucket === undefined) {
          bucket = [];
          this.buckets.set(k, bucket);
        }
        bucket.push(item);
      }
    }
  }

  /**
   * Visits every entity whose cell overlaps the query circle, at most once
   * each. This is a broadphase: candidates still need an exact overlap test.
   */
  query(x: number, y: number, radius: number, visit: (item: T) => void): void {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);

    this.seen.clear();
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.buckets.get(this.key(cx, cy));
        if (bucket === undefined) continue;
        for (const item of bucket) {
          if (this.seen.has(item)) continue;
          this.seen.add(item);
          visit(item);
        }
      }
    }
  }

  /** Collects candidates into an array — convenient in tests. */
  collect(x: number, y: number, radius: number): T[] {
    const out: T[] = [];
    this.query(x, y, radius, (item) => out.push(item));
    return out;
  }
}
