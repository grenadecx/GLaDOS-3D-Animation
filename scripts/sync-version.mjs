#!/usr/bin/env node
/**
 * sync-version.mjs — keep one version across the three places that need it.
 *
 *   package.json                            the npm project
 *   custom_components/glados_3d/manifest.json   what HACS reads to decide an update is available
 *   custom_components/glados_3d/const.py        what stamps the ?v= on the served URLs
 *
 * The third is the one that matters at runtime: it is what invalidates a
 * browser's cached copy of the card, so a drift here ships an update that
 * nobody's browser ever picks up.
 *
 *   node scripts/sync-version.mjs 1.2.3   set all three
 *   node scripts/sync-version.mjs         copy package.json's version to the others
 */

import fs from 'fs/promises';

const root = new URL('../', import.meta.url);
const pkgPath = new URL('package.json', root);
const manifestPath = new URL('custom_components/glados_3d/manifest.json', root);
const constPath = new URL('custom_components/glados_3d/const.py', root);

const readJson = async (path) => JSON.parse(await fs.readFile(path, 'utf8'));

const pkg = await readJson(pkgPath);
const version = process.argv[2] ?? pkg.version;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`sync-version: "${version}" is not a MAJOR.MINOR.PATCH version`);
  process.exit(1);
}

pkg.version = version;
await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const manifest = await readJson(manifestPath);
manifest.version = version;
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const source = await fs.readFile(constPath, 'utf8');
const pattern = /^(INTEGRATION_VERSION:\s*Final\[str\]\s*=\s*")[^"]*(")/m;
if (!pattern.test(source)) {
  console.error('sync-version: INTEGRATION_VERSION not found in const.py');
  process.exit(1);
}
await fs.writeFile(constPath, source.replace(pattern, `$1${version}$2`));

console.log(`sync-version: set ${version}`);
