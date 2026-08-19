/**
 * Fixed-capacity object pool.
 *
 * Bullets, particles and damage numbers spawn and die by the hundred every
 * second. Allocating them each frame hands the GC a steady stream of garbage,
 * which shows up as periodic frame-time spikes. Pooling keeps every instance
 * alive for the lifetime of the run and reuses the dead ones instead.
 */
export class Pool<T> {
  readonly items: T[] = [];
  private readonly free: number[] = [];
  private readonly alive: boolean[] = [];
  private liveCount = 0;

  constructor(
    factory: () => T,
    private readonly reset: (item: T) => void,
    readonly capacity: number,
  ) {
    for (let i = 0; i < capacity; i++) {
      this.items.push(factory());
      this.alive.push(false);
      this.free.push(capacity - 1 - i); // pop() hands out low indices first
    }
  }

  get size(): number {
    return this.liveCount;
  }

  isAlive(index: number): boolean {
    return this.alive[index] === true;
  }

  /**
   * Takes an instance from the pool, or `null` when exhausted.
   * Callers must treat exhaustion as "skip this spawn", never as an error:
   * dropping one particle is always better than stalling the frame.
   */
  acquire(): { index: number; item: T } | null {
    const index = this.free.pop();
    if (index === undefined) return null;
    const item = this.items[index] as T;
    this.reset(item);
    this.alive[index] = true;
    this.liveCount++;
    return { index, item };
  }

  release(index: number): void {
    if (!this.alive[index]) return;
    this.alive[index] = false;
    this.free.push(index);
    this.liveCount--;
  }

  /** Runs `fn` over live entries only. Safe to release from inside `fn`. */
  forEach(fn: (item: T, index: number) => void): void {
    for (let i = 0; i < this.items.length; i++) {
      if (this.alive[i]) fn(this.items[i] as T, i);
    }
  }

  clear(): void {
    for (let i = 0; i < this.items.length; i++) {
      if (this.alive[i]) this.release(i);
    }
  }
}
