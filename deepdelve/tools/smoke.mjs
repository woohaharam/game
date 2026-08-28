/**
 * End-to-end smoke check against a real browser.
 *
 * Unit tests cover the simulation, but they cannot see a panel that is set to
 * `hidden` and rendered anyway, or a first ten seconds in which nothing visibly
 * happens. Both of those shipped past a green suite and were caught here, so
 * every assertion below is written against *rendered* state — measured
 * geometry and visible text — rather than against DOM properties.
 *
 * Run `npm run build` first, then `npm run smoke`.
 */

import { chromium } from 'playwright';

const url = (process.argv[2] ?? 'http://localhost:4173/') + '?ads=debug';
const SAVE_KEY = 'deepdelve.save.v1';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

const errors = [];
context.on('page', (p) => {
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
});

const page = await context.newPage();
const read = async (p = page) => ({
  gold: await p.textContent('.purse strong'),
  depth: await p.textContent('.depth'),
  enemy: await p.textContent('.enemy-name'),
  hp: await p.textContent('.bartext'),
  kills: await p.textContent('.killtext'),
  dps: await p.textContent('.readout strong'),
});

await page.goto(url, { waitUntil: 'networkidle' });
for (const t of [1, 3, 6, 12, 30]) {
  await page.waitForTimeout(t * 1000 - (t === 1 ? 0 : 0));
  console.log(`t≈${t}s`.padEnd(8), JSON.stringify(await read()));
}

for (let i = 0; i < 8; i += 1) {
  const buttons = await page.$$(
    '.panel:not([hidden]) .rows .row:not([hidden]) button.buy:not([disabled])',
  );
  if (buttons.length === 0) { await page.waitForTimeout(1500); continue; }
  await buttons[0].click();
  await page.waitForTimeout(200);
}
console.log('bought  ', JSON.stringify(await read()));

await page.click('.qty-select button:text-is("MAX")');
await page.waitForTimeout(2500);
const maxLabel = await page.textContent('.panel:not([hidden]) .rows .row:not([hidden]) button.buy');
console.log('MAX button label:', maxLabel.trim());

console.log('boosts visible:', await page.isVisible('.boosts'));
await page.click('.boosts .ad:first-child');
await page.waitForTimeout(400);
console.log('blessing:', (await page.textContent('.readout')).trim());

const goldBefore = await page.textContent('.purse strong');
await page.click('.boosts .ad:last-child');
await page.waitForTimeout(600);
console.log('chest gold:', goldBefore, '->', await page.textContent('.purse strong'));

// Rendered visibility, not the DOM property: `hidden` can be set and still lose
// to a CSS `display` rule, which is how all three panels once showed at once.
const renderedPanels = () =>
  page.$$eval('.panel', (ps) => ps.filter((p) => p.getBoundingClientRect().height > 0).length);
const renderedRows = () =>
  page.$$eval('.rows .row', (rs) => rs.filter((r) => r.getBoundingClientRect().height > 0).length);


for (const tab of ['Party', 'Descend', 'Upgrades']) {
  await page.click(`nav.tabs button:text-is("${tab}")`);
  await page.waitForTimeout(250);
  console.log(`tab ${tab}: panels rendered = ${await renderedPanels()}, rows = ${await renderedRows()}`);
}

await page.click('nav.tabs button:text-is("Descend")');
await page.waitForTimeout(300);
console.log('descend hint:', (await page.textContent('.panel:not([hidden]) .lock')).trim());
console.log('stat values:', (await page.$$eval('.stats-card dd', (n) => n.map((x) => x.textContent))).join(' | '));

await page.waitForTimeout(5000);
const before = await read();
await page.close(); // fires pagehide, which stamps the save

// A fresh page in the same context, patched before the app boots — a reload
// would save over lastSeen on its own pagehide first.
const returning = await context.newPage();
await returning.addInitScript((key) => {
  const raw = localStorage.getItem(key);
  if (raw === null) return;
  const parsed = JSON.parse(raw);
  parsed.lastSeen = Date.now() - 3 * 60 * 60 * 1000;
  localStorage.setItem(key, JSON.stringify(parsed));
}, SAVE_KEY);
await returning.goto(url, { waitUntil: 'networkidle' });
await returning.waitForTimeout(1500);

console.log('offline modal:', await returning.isVisible('.modal-backdrop'));
console.log('offline away :', (await returning.textContent('.away')).trim());
const dd = await returning.$$eval('.modal .stats dd', (n) => n.map((x) => x.textContent));
console.log('offline gold/kills/floors:', dd.join(' | '));
await returning.click('.modal .ad');
await returning.waitForTimeout(500);
await returning.click('.modal .primary');
await returning.waitForTimeout(300);
console.log('modal dismissed:', !(await returning.isVisible('.modal-backdrop')));
console.log('before close ', JSON.stringify(before));
console.log('after return ', JSON.stringify(await read(returning)));

await returning.screenshot({ path: 'smoke.png', fullPage: true });
console.log(errors.length === 0 ? 'NO PAGE ERRORS' : 'ERRORS:\n' + errors.join('\n'));
await browser.close();
