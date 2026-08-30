/**
 * Captures the stone at one stage per form, side by side.
 *
 * The ladder is the game's payoff, and the only way to judge whether it reads
 * as one thing *becoming* another — rather than as twenty unrelated drawings —
 * is to see the whole of it at once. Run against the dev server, which serves
 * the modules unbundled so the renderer can be imported directly:
 *
 *     npm run dev
 *     node tools/ladder.mjs
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const url = (process.argv[2] ?? 'http://localhost:4173/') + '?lang=en';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1120, height: 780 } });
page.on('pageerror', (error) => console.error('pageerror:', error.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const grid = await page.evaluate(async () => {
  const renderers = await import('/src/ui/stone-canvas.ts');
  const stages = await import('/src/game/content/stages.ts');

  const cell = 180;
  const columns = 5;
  const rows = 4;

  const sheet = document.createElement('canvas');
  sheet.width = cell * columns;
  sheet.height = cell * rows;
  const out = sheet.getContext('2d');
  out.fillStyle = '#16151d';
  out.fillRect(0, 0, sheet.width, sheet.height);

  for (let form = 0; form < columns * rows; form += 1) {
    // The first stage of each form, so the size shown is the form's baseline
    // rather than wherever it happens to have grown to.
    const stage = form * 4 + 1;

    const renderer = new renderers.StoneRenderer(true);
    const canvas = renderer.mount();
    canvas.style.width = `${cell}px`;
    canvas.style.height = `${cell}px`;
    document.body.append(canvas);
    renderer.draw(stage, 0);

    const x = (form % columns) * cell;
    const y = Math.floor(form / columns) * cell;
    out.drawImage(canvas, x, y, cell, cell);

    out.fillStyle = '#9b93b3';
    out.font = '12px system-ui, sans-serif';
    out.textAlign = 'center';
    out.fillText(`${form + 1}. ${stages.formName(stage)}`, x + cell / 2, y + cell - 8);

    canvas.remove();
  }

  return sheet.toDataURL('image/png');
});

writeFileSync(
  'ladder.png',
  Buffer.from(grid.replace(/^data:image\/png;base64,/, ''), 'base64'),
);
console.log('wrote ladder.png');

await browser.close();
