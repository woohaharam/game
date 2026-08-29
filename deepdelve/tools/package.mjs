/**
 * Packages a build for a destination that wants a zip.
 *
 * itch.io and most portal submission forms take an archive with `index.html` at
 * the *root* — not inside a folder. Getting that wrong is the single most common
 * upload failure, and the symptom is an unhelpful "index.html not found" after
 * the upload has already finished, so the check happens here rather than there.
 *
 *   npm run package            plain build, for itch.io
 *   npm run package:crazygames CrazyGames build, SDK included
 *   npm run package:poki       Poki build, SDK included
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const portal = process.argv[2];
const label = portal ?? 'plain';
const outDir = resolve('packages');
const outFile = resolve(outDir, `deepdelve-${label}.zip`);

const build = portal === undefined ? 'build' : `build:${portal}`;
console.log(`building (${build})…`);
execFileSync('npm', ['run', build], { stdio: 'inherit' });

if (!existsSync('dist/index.html')) {
  throw new Error('dist/index.html is missing; the build did not produce a page');
}

// Source maps are a quarter of the archive and are only useful to us. Shipping
// them to a portal inflates the upload and hands over readable source for no
// benefit to anyone.
for (const file of ['dist/assets']) {
  execFileSync('bash', ['-c', `rm -f ${file}/*.map`]);
}

const html = readFileSync('dist/index.html', 'utf8');
const hasSdk = /sdk|poki-sdk/.test(html);
if (portal !== undefined && !hasSdk) {
  throw new Error(`the ${portal} build contains no SDK script tag`);
}
if (portal === undefined && hasSdk) {
  throw new Error('the plain build should carry no portal SDK');
}

mkdirSync(outDir, { recursive: true });
rmSync(outFile, { force: true });

// `-r . ` from inside dist, so index.html lands at the archive root.
execFileSync('bash', ['-c', `cd dist && zip -q -r "${outFile}" .`]);

const listing = execFileSync('bash', ['-c', `unzip -l "${outFile}"`], { encoding: 'utf8' });
const rootIndex = /\n\s*\d+\s+\S+\s+\S+\s+index\.html\s*\n/.test(listing);
if (!rootIndex) throw new Error('index.html is not at the archive root');

const bytes = execFileSync('bash', ['-c', `stat -c %s "${outFile}"`], {
  encoding: 'utf8',
}).trim();
console.log(`\n${outFile}`);
console.log(
  `${(Number(bytes) / 1024).toFixed(0)} KB · index.html at root · SDK: ${hasSdk ? portal : 'none'}`,
);
