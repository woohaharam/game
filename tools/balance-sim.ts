/**
 * Headless balance simulation.
 *
 * Runs the real game — the same `World`, the same rules — thousands of times
 * with a scripted player, and reports where runs actually end. Balance was
 * otherwise tuned by feel, which is fine for the first pass and useless for
 * answering "did that change make floor 4 harder, or did I just play worse?".
 *
 * This is only possible because the simulation never touches the DOM: a run
 * that takes four minutes to play takes milliseconds to simulate, so a
 * thousand of them fit in a few seconds.
 *
 * Everything here is **observational**. The tool reads public world state each
 * tick and infers the rest — time-to-kill from when an enemy first appears and
 * when it stops being alive, damage taken from health dropping. No measurement
 * hook was added to the simulation, so the thing being measured is exactly the
 * thing that ships.
 *
 * Usage:
 *   npm run balance                    # 300 runs, default settings
 *   npm run balance -- --runs 2000     # more samples, tighter intervals
 *   npm run balance -- --write         # also update docs/BALANCE.md
 *   npm run balance -- --trace 42      # narrate a single run
 *   npm run balance -- --experiments   # A/B candidate tuning changes
 */
import { writeFileSync } from 'node:fs';
import { AudioBus } from '@engine/audio';
import { Camera } from '@engine/camera';
import { Rng } from '@engine/rng';
import { World } from '@game/world';
import { rollChoices } from '@game/progression/upgrades';
import type { EnemyKind } from '@game/config';
import type { Enemy } from '@game/entities/enemy';
import { Bot, DEFAULT_BOT } from './bot';
import { VARIANTS, restore, snapshot } from './experiments';

const TICK = 1 / 60;
/** Hard ceiling per run so a stuck bot cannot hang the sweep. */
const MAX_TICKS = 60 * 60 * 12; // 12 simulated minutes
/** Runs are abandoned as "stalled" if nothing happens for this long. */
const STALL_TICKS = 60 * 60;

interface RunResult {
  seed: number;
  depth: number;
  score: number;
  kills: number;
  roomsCleared: number;
  ticks: number;
  /**
   * Continuous progress: completed floors plus the fraction of the current
   * floor cleared.
   *
   * Integer floor count is far too coarse to compare tuning changes — it tied
   * on roughly 60% of paired seeds, discarding most of the signal. Dying two
   * rooms into floor 3 and dying one room short of its boss are very different
   * outcomes that "reached floor 3" cannot tell apart.
   */
  progress: number;
  died: boolean;
  stalled: boolean;
  /** Why the run was abandoned, when it was. */
  stallReason: string;
  upgrades: string[];
  /** Hits taken, by the floor they happened on. */
  hitsByFloor: Map<number, number>;
  /** Ticks each enemy stayed alive, by archetype. */
  ttk: Map<EnemyKind, number[]>;
}

function simulateRun(seed: number, trace = false): RunResult {
  const rng = new Rng(seed);
  const world = new World(seed, new AudioBus(), new Camera(1024, 576, new Rng(seed)));
  const bot = new Bot(new Rng(seed ^ 0x5bf03635), DEFAULT_BOT);

  const result: RunResult = {
    seed,
    depth: 1,
    score: 0,
    kills: 0,
    roomsCleared: 0,
    ticks: 0,
    progress: 0,
    died: false,
    stalled: false,
    stallReason: '',
    upgrades: [],
    hitsByFloor: new Map(),
    ttk: new Map(),
  };

  let finished = false;

  const grantReward = (luck: number): void => {
    const choices = rollChoices(rng, world.run.upgrades, world.run.depth, 3, luck);
    const preferred = Bot.preferUpgrade(choices.map((c) => c.id));
    const chosen = choices.find((c) => c.id === preferred) ?? choices[0];
    if (chosen !== undefined) world.grantUpgrade(chosen);
  };

  world.events = {
    onRoomCleared: (room) => {
      if (room.type === 'elite') grantReward(1);
    },
    onFloorCleared: () => {
      world.run.advanceFloor();
      world.startFloor(world.run.depth);
      grantReward(1.6);
    },
    onPlayerDied: () => {
      finished = true;
      result.died = true;
    },
  };

  world.startRun(seed);

  // Observational bookkeeping.
  const firstSeen = new Map<Enemy, number>();
  let lastHealth = world.player.health;
  let lastProgress = 0;
  let lastKills = 0;
  let lastRooms = 0;

  for (let tick = 0; tick < MAX_TICKS && !finished; tick++) {
    world.update(TICK, bot.think(world, TICK));
    result.ticks = tick;

    if (trace && tick % 300 === 0) {
      const room = world.dungeon.rooms[world.currentRoom];
      process.stdout.write(
        `  t=${(tick / 60).toFixed(0)}s floor=${world.run.depth} room=${world.currentRoom}` +
          `(${room?.type},${room?.cleared ? 'C' : '-'}) pos=(${world.player.x.toFixed(0)},${world.player.y.toFixed(0)})` +
          ` hp=${world.player.health} kills=${world.run.kills} rooms=${world.run.roomsCleared}` +
          ` alive=${world.enemies.filter((e) => e.alive).length} locked=${world.doorsLocked}` +
          ` goal=${bot.debug().goal} wp=${bot.debug().waypoints}` +
          ` unvisited=[${world.dungeon.rooms
            .filter((r) => !r.visited)
            .map((r) => r.index)
            .join(',')}]\n`,
      );
    }

    for (const enemy of world.enemies) {
      if (enemy.alive && enemy.spawnTimer <= 0 && !firstSeen.has(enemy)) {
        firstSeen.set(enemy, tick);
      } else if (!enemy.alive && firstSeen.has(enemy)) {
        const born = firstSeen.get(enemy)!;
        const list = result.ttk.get(enemy.kind) ?? [];
        list.push(tick - born);
        result.ttk.set(enemy.kind, list);
        firstSeen.delete(enemy);
      }
    }

    if (world.player.health < lastHealth) {
      const floor = world.run.depth;
      result.hitsByFloor.set(floor, (result.hitsByFloor.get(floor) ?? 0) + 1);
    }
    lastHealth = world.player.health;

    // A run that stops killing things and stops clearing rooms is stuck on
    // geometry, not playing badly — count it separately rather than letting it
    // pollute the survival numbers.
    if (world.run.kills !== lastKills || world.run.roomsCleared !== lastRooms) {
      lastKills = world.run.kills;
      lastRooms = world.run.roomsCleared;
      lastProgress = tick;
    } else if (tick - lastProgress > STALL_TICKS) {
      result.stalled = true;
      result.stallReason = classifyStall(world);
      break;
    }
  }

  const rooms = world.dungeon.rooms;
  const clearedFraction =
    rooms.length === 0 ? 0 : rooms.filter((r) => r.cleared).length / rooms.length;
  result.progress = world.run.depth - 1 + clearedFraction;

  result.depth = world.run.depth;
  result.score = world.run.score;
  result.kills = world.run.kills;
  result.roomsCleared = world.run.roomsCleared;
  result.upgrades = [...world.run.upgrades];
  return result;
}

/**
 * Explains why a run stopped progressing.
 *
 * A stall is a measurement failure, not a result, so the report needs to say
 * which kind it was: a bot that cannot reach the rest of the floor is a pathing
 * problem, while a bot standing next to an open portal is a bug in the bot's
 * goal selection. Lumping them together hides both.
 */
function classifyStall(world: World): string {
  const rooms = world.dungeon.rooms;
  const uncleared = rooms.filter((r) => !r.cleared);
  const unvisited = rooms.filter((r) => !r.visited);
  const boss = rooms[world.dungeon.bossRoom];
  const alive = world.enemies.filter((e) => e.alive);

  if (world.exitPortal.active) return 'portal open, not taken';
  if (uncleared.length === 0) return 'floor complete, no portal';

  // Doors stay shut until a room is clear, so a bot sealed in with something
  // it cannot finish is not a pathing failure — it is a fight that does not
  // resolve, and a human would be stuck on it too.
  if (world.doorsLocked && alive.length > 0) {
    const kinds = [...new Set(alive.map((e) => e.kind))].sort().join('+');
    return `locked in an unresolved fight (${kinds})`;
  }

  if (boss !== undefined && !boss.cleared && boss.visited) return 'boss fight unresolved';
  if (unvisited.length > 0) return `cannot path to ${unvisited.length} rooms`;
  return `${uncleared.length} rooms visited but uncleared`;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** Wilson score interval — honest at the small counts deep floors produce. */
function wilson(successes: number, total: number): [number, number] {
  if (total === 0) return [0, 0];
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return [
    Math.max(0, (centre - spread) / denominator),
    Math.min(1, (centre + spread) / denominator),
  ];
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function buildReport(results: RunResult[], runs: number, elapsedMs: number): string {
  const valid = results.filter((r) => !r.stalled);
  const stalledCount = results.length - valid.length;
  const maxDepth = Math.max(...valid.map((r) => r.depth), 1);

  const lines: string[] = [];
  lines.push('# Balance report');
  lines.push('');
  lines.push(
    `Generated by \`npm run balance\` — ${runs} simulated runs in ` +
      `${(elapsedMs / 1000).toFixed(1)}s. Do not edit by hand.`,
  );
  lines.push('');
  lines.push(
    'Numbers come from a scripted bot, not from players. It kites at a fixed ' +
      'range, strafes, and dashes out of incoming fire with a reaction delay — ' +
      'competent, not optimal. Treat the survival rates as a **lower bound** on ' +
      'human performance and, more usefully, as a baseline that only moves when ' +
      'the game changes.',
  );
  lines.push('');

  // --- Floor progression ---------------------------------------------------
  lines.push('## How far runs get');
  lines.push('');
  lines.push('| Floor | Runs reaching it | Cleared it | 95% CI | Median hits taken |');
  lines.push('| ---: | ---: | ---: | :--- | ---: |');

  for (let floor = 1; floor <= maxDepth; floor++) {
    const reached = valid.filter((r) => r.depth >= floor);
    if (reached.length === 0) continue;
    const cleared = reached.filter((r) => r.depth > floor).length;
    const [low, high] = wilson(cleared, reached.length);
    const hits = reached.map((r) => r.hitsByFloor.get(floor) ?? 0);
    lines.push(
      `| ${floor} | ${reached.length} | ${percent(cleared / reached.length)} | ` +
        `${percent(low)} – ${percent(high)} | ${median(hits).toFixed(1)} |`,
    );
  }
  lines.push('');

  const depths = valid.map((r) => r.depth);
  lines.push(
    `Median floor reached: **${median(depths).toFixed(1)}** · ` +
      `mean ${mean(depths).toFixed(2)} ± ${stdev(depths).toFixed(2)}`,
  );
  if (stalledCount > 0) {
    const reasons = new Map<string, number>();
    for (const run of results) {
      if (!run.stalled) continue;
      reasons.set(run.stallReason, (reasons.get(run.stallReason) ?? 0) + 1);
    }
    lines.push('');
    lines.push(
      `> **${stalledCount} of ${results.length} runs stalled** and are excluded ` +
        'above. A stall is a measurement failure, not a result — the bot stopped ' +
        'making progress and was abandoned.',
    );
    lines.push('>');
    for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
      lines.push(`> - ${count}× ${reason}`);
    }
  }
  lines.push('');

  // --- Time to kill --------------------------------------------------------
  lines.push('## Time to kill, by archetype');
  lines.push('');
  lines.push('Seconds from an enemy becoming active to its death.');
  lines.push('');
  lines.push('| Enemy | Samples | Median | Mean | p90 |');
  lines.push('| :--- | ---: | ---: | ---: | ---: |');

  const merged = new Map<EnemyKind, number[]>();
  for (const run of valid) {
    for (const [kind, list] of run.ttk) {
      const all = merged.get(kind) ?? [];
      all.push(...list);
      merged.set(kind, all);
    }
  }
  for (const [kind, ticks] of [...merged].sort((a, b) => median(b[1]) - median(a[1]))) {
    const seconds = ticks.map((t) => t / 60);
    const sorted = [...seconds].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    lines.push(
      `| ${kind} | ${seconds.length} | ${median(seconds).toFixed(2)}s | ` +
        `${mean(seconds).toFixed(2)}s | ${p90.toFixed(2)}s |`,
    );
  }
  lines.push('');

  // --- Upgrades ------------------------------------------------------------
  lines.push('## Upgrade uptake');
  lines.push('');
  lines.push(
    'How often each upgrade was taken, and how deep those runs got. The bot ' +
      'picks from a fixed preference list, so this measures *offer rate* and ' +
      'correlation — not which upgrade is strongest.',
  );
  lines.push('');
  lines.push('| Upgrade | Taken | Mean floor of runs holding it |');
  lines.push('| :--- | ---: | ---: |');

  const uptake = new Map<string, { count: number; depths: number[] }>();
  for (const run of valid) {
    for (const id of new Set(run.upgrades)) {
      const entry = uptake.get(id) ?? { count: 0, depths: [] };
      entry.count++;
      entry.depths.push(run.depth);
      uptake.set(id, entry);
    }
  }
  for (const [id, entry] of [...uptake].sort((a, b) => b[1].count - a[1].count)) {
    lines.push(`| ${id} | ${entry.count} | ${mean(entry.depths).toFixed(2)} |`);
  }
  lines.push('');

  // --- Run shape -----------------------------------------------------------
  const durations = valid.map((r) => r.ticks / 60);
  const scores = valid.map((r) => r.score);
  lines.push('## Run shape');
  lines.push('');
  lines.push('| Metric | Median | Mean | Std dev |');
  lines.push('| :--- | ---: | ---: | ---: |');
  lines.push(
    `| Duration (s) | ${median(durations).toFixed(0)} | ${mean(durations).toFixed(0)} | ` +
      `${stdev(durations).toFixed(0)} |`,
  );
  lines.push(
    `| Score | ${median(scores).toFixed(0)} | ${mean(scores).toFixed(0)} | ` +
      `${stdev(scores).toFixed(0)} |`,
  );
  const kills = valid.map((r) => r.kills);
  lines.push(
    `| Kills | ${median(kills).toFixed(0)} | ${mean(kills).toFixed(0)} | ` +
      `${stdev(kills).toFixed(0)} |`,
  );
  const rooms = valid.map((r) => r.roomsCleared);
  lines.push(
    `| Rooms cleared | ${median(rooms).toFixed(0)} | ${mean(rooms).toFixed(0)} | ` +
      `${stdev(rooms).toFixed(0)} |`,
  );
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------

function parseArgs(argv: readonly string[]): {
  runs: number;
  write: boolean;
  seed: number;
  trace: number | null;
  experiments: boolean;
  only: string | null;
} {
  let runs = 300;
  let write = false;
  let seed = 1;
  let trace: number | null = null;
  let experiments = false;
  let only: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs') runs = Number(argv[++i]) || runs;
    else if (arg === '--seed') seed = Number(argv[++i]) || seed;
    else if (arg === '--trace') trace = Number(argv[++i]);
    else if (arg === '--write') write = true;
    else if (arg === '--experiments') experiments = true;
    else if (arg === '--only') only = argv[++i] ?? null;
  }
  return { runs, write, seed, trace, experiments, only };
}

/**
 * Runs each candidate tuning change over the same seeds and compares them
 * **pairwise** against the baseline.
 *
 * The first version of this compared aggregate clear rates, which was
 * underpowered to the point of uselessness: with ~90 runs reaching floor 2, the
 * 95% interval on a 40% rate is about ±10 points, so the largest observed
 * difference (+7 points) could not be told from noise.
 *
 * Because every variant runs the identical seed list, the runs are *paired* —
 * same dungeon, same spawns, same bot decisions, one rule changed. Comparing
 * seed against itself removes the variance between dungeons, which was
 * swamping the effect being measured. The same data then answers the question
 * several times more precisely.
 */
function runExperiments(runs: number, seed: number, only: string | null): void {
  const saved = snapshot();
  // `--only` narrows the sweep to one variant plus the baseline, so a specific
  // question can be answered with many more seeds in the same wall-clock time.
  const selected = VARIANTS.filter((v) => only === null || v.name === only || v.name === 'baseline');

  // depth reached per seed, per variant
  const byVariant = new Map<string, Map<number, RunResult>>();

  for (const variant of selected) {
    restore(saved);
    variant.apply();
    const results = new Map<number, RunResult>();
    for (let i = 0; i < runs; i++) {
      const runSeed = seed + i;
      results.set(runSeed, simulateRun(runSeed));
    }
    byVariant.set(variant.name, results);
    process.stdout.write(`  ${variant.name} done\n`);
  }
  restore(saved);

  const baseline = byVariant.get('baseline');
  if (baseline === undefined) return;

  const lines: string[] = [];
  lines.push('# Balance experiments');
  lines.push('');
  lines.push(
    `${runs} seeds per variant, identical across variants. Every comparison is ` +
      'paired — same dungeon, same spawns, one rule changed — and scored on ' +
      'continuous progress (floors completed plus the fraction of the current ' +
      'floor cleared) rather than on integer floor count, which tied too often ' +
      'to be informative.',
  );
  lines.push('');
  lines.push(
    '| Variant | Paired seeds | Better | Worse | Tied | Mean Δprogress | 95% CI | Verdict |',
  );
  lines.push('| :--- | ---: | ---: | ---: | ---: | ---: | :--- | :--- |');

  for (const variant of selected) {
    if (variant.name === 'baseline') continue;
    const results = byVariant.get(variant.name);
    if (results === undefined) continue;

    const deltas: number[] = [];
    let deeper = 0;
    let shallower = 0;
    let same = 0;

    for (const [runSeed, base] of baseline) {
      const other = results.get(runSeed);
      // Only seeds where *both* arms produced a usable run can be paired.
      if (other === undefined || base.stalled || other.stalled) continue;
      const delta = other.progress - base.progress;
      deltas.push(delta);
      if (delta > 0) deeper++;
      else if (delta < 0) shallower++;
      else same++;
    }

    const n = deltas.length;
    const m = mean(deltas);
    // Standard error of the paired mean difference.
    const se = n > 1 ? stdev(deltas) / Math.sqrt(n) : 0;
    const low = m - 1.96 * se;
    const high = m + 1.96 * se;
    const significant = low > 0 || high < 0;
    const verdict = !significant ? 'no detectable effect' : m > 0 ? '**easier**' : '**harder**';

    lines.push(
      `| ${variant.name} | ${n} | ${deeper} | ${shallower} | ${same} | ` +
        `${m >= 0 ? '+' : ''}${m.toFixed(3)} | ` +
        `${low >= 0 ? '+' : ''}${low.toFixed(3)} to ${high >= 0 ? '+' : ''}${high.toFixed(3)} | ${verdict} |`,
    );
  }

  lines.push('');
  lines.push('A confidence interval spanning zero means the data cannot tell the');
  lines.push('variant apart from the baseline — not that the change does nothing.');
  lines.push('');
  for (const variant of selected) {
    lines.push(`- **${variant.name}** — ${variant.rationale}`);
  }
  lines.push('');

  process.stdout.write(`\n${lines.join('\n')}\n`);
}

function main(): void {
  const { runs, write, seed, trace, experiments, only } = parseArgs(process.argv.slice(2));

  if (experiments) {
    runExperiments(runs, seed, only);
    return;
  }

  // `--trace <seed>` narrates a single run. Balance questions are usually
  // "why did this one end like that", and a table cannot answer it.
  if (trace !== null) {
    process.stdout.write(`Tracing seed ${trace}\n`);
    const result = simulateRun(trace, true);
    process.stdout.write(
      `\nfloor=${result.depth} score=${result.score} kills=${result.kills} ` +
        `rooms=${result.roomsCleared} died=${result.died} ` +
        `stalled=${result.stalled}${result.stalled ? ` (${result.stallReason})` : ''}\n`,
    );
    return;
  }

  process.stdout.write(`Simulating ${runs} runs...\n`);

  const started = Date.now();
  const results: RunResult[] = [];
  for (let i = 0; i < runs; i++) {
    results.push(simulateRun(seed + i));
    if ((i + 1) % 50 === 0) {
      process.stdout.write(`  ${i + 1}/${runs}\n`);
    }
  }
  const elapsed = Date.now() - started;

  const report = buildReport(results, runs, elapsed);
  process.stdout.write(`\n${report}\n`);

  if (write) {
    writeFileSync('docs/BALANCE.md', `${report}\n`);
    process.stdout.write('Wrote docs/BALANCE.md\n');
  }
}

main();
