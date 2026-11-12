#!/usr/bin/env node
// Convert a "simple menu JSON" (categories → subcategories → items with
// name/price/notes, optional hours "08:00-12:00") into a schemaVersion 2 place
// file. For maintainers adding menus from contributors.
//
//   node scripts/import-menu.mjs menu.json --city in/kl/ernakulam --date 2026-11-12 \
//     [--id smart-foodie-kitchen] [--name "…"] [--osm way/1292036173 --relation inside] \
//     [--kind restaurant] [--building "…"] [--floor "…"] [--area "…"] [--postcode 682042] \
//     [--source printed-menu] [--write]
// Without --write the place is printed. Fails on any validation problem.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fromMenuJson } from './lib/convert.mjs';
import { formatPlace, relPathFor, slugify, todayUTC, walkItems } from './lib/place.mjs';
import { parseOsmId, unfence } from './lib/issue-form.mjs';
import { validatePlace } from './lib/validate-core.mjs';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error('Usage: import-menu.mjs menu.json --city in/kl/ernakulam --date YYYY-MM-DD [options] [--write]'); process.exit(2); }
const json = JSON.parse(unfence(readFileSync(file, 'utf8')));
const osm = arg('--osm') ? parseOsmId(arg('--osm')) : null;
if (arg('--osm') && !osm) { console.error('--osm must look like way/123 or an openstreetmap.org link'); process.exit(2); }
const location = Object.fromEntries(['building', 'floor', 'area', 'postcode'].map(k => [k, arg(`--${k}`)]).filter(([, v]) => v));
const name = arg('--name') || json.restaurant || json.name;
const meta = {
  id: arg('--id') || slugify(name || 'place', 50), name, city: arg('--city'), kind: arg('--kind'), source: arg('--source'),
  osm: osm ? { ...osm, relation: arg('--relation') || 'is' } : undefined, location, currency: arg('--currency'),
  last_confirmed: arg('--date') || todayUTC(),
};
const { place, errors } = fromMenuJson(json, meta);
const relPath = place ? relPathFor(place) : '';
const problems = [...errors, ...(place ? validatePlace(place, { relPath }) : [])];
if (problems.length) { console.error(problems.map(p => `- ${p}`).join('\n')); process.exit(1); }
const text = formatPlace(place);
if (!args.includes('--write')) { process.stdout.write(text); process.exit(0); }
const path = join(process.cwd(), relPath);
if (existsSync(path) && !args.includes('--force')) { console.error(`${relPath} exists; pass --force to replace it.`); process.exit(1); }
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, text);
console.log(`${relPath}: ${place.sections.length} sections, ${walkItems(place).length} items`);
