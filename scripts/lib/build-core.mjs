// Deterministic static build. Same inputs (data + date + commit) => identical bytes.
//
// Output:
//   v2/manifest.json, v2/index/<city>.json   full schemaVersion 2 data (current apps)
//   manifest.json,    index/<city>.json      schemaVersion 1 compatibility for apps
//                                            released before v2: flat priced items,
//                                            only places that ARE an OSM object
//   places/<city>/<id>.json(+.jsonld)        permalinks and schema.org export
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validateRepo } from './validate-core.mjs';
import { SCHEMA_VERSION, FRESHNESS, MAX_BUNDLE_BYTES, V1_CATEGORIES, canonicalPlace, formatPlace, flattenItems, freshness,
  osmRef, titleCase, todayUTC, walkItems } from './place.mjs';

export const DATA_HOST = 'data.chaikadi.fyi';
export const REPO_URL = 'https://github.com/tellmeY18/chaikadi-data';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const cityFile = city => `index/${city.replace(/\//g, '-')}.json`;
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function bundlePlace(place, asOf) {
  const { city, schemaVersion, ...rest } = canonicalPlace(place);
  return { ...rest, status: freshness(place.last_confirmed, asOf), itemCount: walkItems(place).length };
}

// Old apps: schemaVersion 1 place shape (id = OSM ref, flat menu, 5 categories).
export function v1Place(place, asOf) {
  if (place.osm?.relation !== 'is') return null;
  const menu = flattenItems(place).slice(0, 150).map(i => ({ id: i.id.slice(0, 60), name: i.name.slice(0, 80), category: V1_CATEGORIES[i.category], price: i.price,
    ...(i.veg === undefined ? {} : { veg: i.veg }), available: i.available }));
  if (!menu.length || menu.some(i => i.price > 10000)) return null;
  const out = { id: osmRef(place.osm), name: place.name, currency: place.currency, last_confirmed: place.last_confirmed,
    status: freshness(place.last_confirmed, asOf), itemCount: menu.length, menu };
  if (place.sample) out.sample = true;
  if (place.wikidata) out.wikidata = place.wikidata;
  return out;
}

// schema.org Menu export (data only; no links to the place or third parties).
export function jsonLd(place) {
  const offer = (price, name) => ({ '@type': 'Offer', ...(name ? { name } : {}), price: price.toFixed(2), priceCurrency: place.currency });
  const menuItem = item => {
    const out = { '@type': 'MenuItem', name: item.name };
    if (item.description) out.description = item.description;
    if (item.variants) out.offers = item.variants.map(v => offer(v.price, v.name));
    else if (typeof item.price === 'number') out.offers = offer(item.price);
    const diet = { veg: 'VegetarianDiet', vegan: 'VeganDiet' }[item.diet];
    if (diet) out.suitableForDiet = `https://schema.org/${diet}`;
    if (item.available === false) out.offers = { '@type': 'Offer', availability: 'https://schema.org/OutOfStock' };
    return out;
  };
  const section = s => ({ '@type': 'MenuSection', name: s.name, ...(s.note ? { description: s.note } : {}),
    ...(s.items ? { hasMenuItem: s.items.map(menuItem) } : {}), ...(s.sections ? { hasMenuSection: s.sections.map(section) } : {}) });
  return { '@context': 'https://schema.org', '@type': 'Menu', name: place.name, identifier: place.id,
    dateModified: place.last_confirmed, license: 'https://creativecommons.org/publicdomain/zero/1.0/',
    hasMenuSection: place.sections.map(section) };
}

export function buildDist({ root, outDir, date = todayUTC(), commit = 'unknown' }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid build date: ${date}`);
  if (!/^[0-9a-f]{7,40}$|^unknown$/.test(commit)) throw new Error(`Invalid commit: ${commit}`);
  const result = validateRepo(root, { today: date });
  if (result.errors.length) {
    const error = new Error(`Validation failed with ${result.errors.length} problem(s). Run npm run validate.`);
    error.details = result.errors; throw error;
  }
  rmSync(outDir, { recursive: true, force: true });
  const write = (rel, text) => { const path = join(outDir, rel); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
  const generatedAt = `${date}T00:00:00Z`;
  const cities = new Map();
  for (const place of result.places) cities.set(place.city, [...(cities.get(place.city) || []), place]);

  const v2Cities = [], v1Cities = [], tooLarge = [];
  const budget = (label, bytes) => { if (bytes > MAX_BUNDLE_BYTES) tooLarge.push(`${label} bundle is ${(bytes / 1024).toFixed(1)} KB (limit ${MAX_BUNDLE_BYTES / 1024} KB). Split the city by locality, e.g. places/in/kl/ernakulam-kaloor/.`); };
  for (const city of [...cities.keys()].sort()) {
    const places = cities.get(city).sort((a, b) => a.id.localeCompare(b.id));
    for (const place of places) {
      write(`places/${city}/${place.id}.json`, formatPlace(place));
      write(`places/${city}/${place.id}.jsonld`, `${JSON.stringify(jsonLd(canonicalPlace(place)), null, 2)}\n`);
    }
    const name = titleCase(city.split('/')[2]);
    const v2 = JSON.stringify({ schemaVersion: SCHEMA_VERSION, city, generatedAt, places: places.map(p => bundlePlace(p, date)) });
    budget(city, Buffer.byteLength(v2));
    write(`v2/${cityFile(city)}`, v2);
    v2Cities.push({ id: city, name, placeCount: places.length, url: cityFile(city), sha256: sha256(v2), bytes: Buffer.byteLength(v2) });
    const legacy = places.map(p => v1Place(p, date)).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
    if (legacy.length) {
      const v1 = JSON.stringify({ schemaVersion: 1, city, generatedAt, places: legacy });
      write(cityFile(city), v1);
      v1Cities.push({ id: city, name, placeCount: legacy.length, url: cityFile(city), sha256: sha256(v1), bytes: Buffer.byteLength(v1) });
    }
  }
  if (tooLarge.length) { rmSync(outDir, { recursive: true, force: true }); throw new Error(tooLarge.join('\n')); }

  const manifest = { schemaVersion: SCHEMA_VERSION, generatedAt, commit, freshness: { ...FRESHNESS }, cities: v2Cities };
  write('v2/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  write('manifest.json', `${JSON.stringify({ schemaVersion: 1, generatedAt, commit, freshness: { ...FRESHNESS }, cities: v1Cities }, null, 2)}\n`);
  write('CNAME', `${DATA_HOST}\n`);
  write('.nojekyll', '');
  // Cloudflare Pages headers (ignored by GitHub Pages, which already sends
  // ACAO: *). CORS for the app; short caching so updates reach apps quickly;
  // no-transform stops proxies from injecting scripts (e.g. analytics beacons).
  write('_headers', [
    '/*', '  Access-Control-Allow-Origin: *', '  X-Content-Type-Options: nosniff', '  Cache-Control: public, max-age=300, no-transform',
    '/manifest.json', '  ! Cache-Control', '  Cache-Control: public, max-age=60, no-transform',
    '/v2/manifest.json', '  ! Cache-Control', '  Cache-Control: public, max-age=60, no-transform', '',
  ].join('\n'));
  write('index.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chaikadi menu library data</title>
<style>body{font:16px/1.5 ui-monospace,"Courier New",monospace;max-width:560px;margin:32px auto;padding:0 16px;color:#111;background:#F7F7F7}a{color:#111}h1{border-bottom:2px solid #111;padding-bottom:12px}</style></head>
<body><h1>Chaikadi menu library</h1>
<p>Volunteer-maintained tea stall and restaurant menus, dedicated to the public domain (CC0-1.0). Used by <a href="https://chaikadi.fyi">chaikadi.fyi</a>.</p>
<p><a href="v2/manifest.json">v2/manifest.json</a> (current) · <a href="manifest.json">manifest.json</a> (v1, simplified) · <a href="${REPO_URL}#readme">Contribute or read the README</a></p>
<p>Data built ${escapeHtml(date)}${commit === 'unknown' ? '' : ` from commit ${escapeHtml(commit.slice(0, 7))}`}.</p>
<ul>${v2Cities.map(c => `<li><a href="v2/${escapeHtml(c.url)}">${escapeHtml(c.name)}</a> (${escapeHtml(c.id)}): ${c.placeCount} place${c.placeCount === 1 ? '' : 's'}</li>`).join('')}</ul>
</body></html>
`);
  return manifest;
}
