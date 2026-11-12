// Deterministic static build. Same inputs (data + date + commit) => identical bytes.
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validateRepo } from './validate-core.mjs';
import { SCHEMA_VERSION, FRESHNESS, MAX_BUNDLE_BYTES, canonicalPlace, formatPlace, freshness, titleCase, todayUTC } from './place.mjs';

export const DATA_HOST = 'data.chaikadi.fyi';
export const REPO_URL = 'https://github.com/tellmeY18/chaikadi-data';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const cityFile = city => `index/${city.replace(/\//g, '-')}.json`;
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function bundlePlace(place, asOf) {
  const p = canonicalPlace(place);
  const out = { id: p.id, name: p.name, currency: p.currency, last_confirmed: p.last_confirmed,
    status: freshness(p.last_confirmed, asOf), itemCount: p.menu.length, menu: p.menu };
  if (p.sample) out.sample = true;
  if (p.wikidata) out.wikidata = p.wikidata;
  return out;
}

// schema.org Menu export. Plain data; no URLs to the place or third parties.
export function jsonLd(place) {
  const sections = new Map();
  for (const item of place.menu) {
    const entry = { '@type': 'MenuItem', name: item.name,
      offers: { '@type': 'Offer', price: item.price.toFixed(2), priceCurrency: place.currency,
        availability: item.available === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' } };
    if (item.veg === true) entry.suitableForDiet = 'https://schema.org/VegetarianDiet';
    sections.set(item.category, [...(sections.get(item.category) || []), entry]);
  }
  return { '@context': 'https://schema.org', '@type': 'Menu', name: place.name, identifier: `osm:${place.id}`,
    dateModified: place.last_confirmed, license: 'https://creativecommons.org/publicdomain/zero/1.0/',
    hasMenuSection: [...sections].map(([name, items]) => ({ '@type': 'MenuSection', name, hasMenuItem: items })) };
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

  const manifestCities = [];
  const tooLarge = [];
  for (const city of [...cities.keys()].sort()) {
    const places = cities.get(city).sort((a, b) => a.id.localeCompare(b.id));
    for (const place of places) {
      const rel = `places/${place.city}/${place.id.replace('/', '-')}`;
      write(`${rel}.json`, formatPlace(place));
      write(`${rel}.jsonld`, `${JSON.stringify(jsonLd(canonicalPlace(place)), null, 2)}\n`);
    }
    const bundle = JSON.stringify({ schemaVersion: SCHEMA_VERSION, city, generatedAt, places: places.map(p => bundlePlace(p, date)) });
    const bytes = Buffer.byteLength(bundle);
    if (bytes > MAX_BUNDLE_BYTES) tooLarge.push(`${city} bundle is ${(bytes / 1024).toFixed(1)} KB (limit ${MAX_BUNDLE_BYTES / 1024} KB). Split the city by locality, e.g. places/in/kl/ernakulam-kaloor/.`);
    write(cityFile(city), bundle);
    manifestCities.push({ id: city, name: titleCase(city.split('/')[2]), placeCount: places.length, url: cityFile(city), sha256: sha256(bundle), bytes });
  }
  if (tooLarge.length) { rmSync(outDir, { recursive: true, force: true }); throw new Error(tooLarge.join('\n')); }

  const manifest = { schemaVersion: SCHEMA_VERSION, generatedAt, commit, freshness: { ...FRESHNESS }, cities: manifestCities };
  write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  write('CNAME', `${DATA_HOST}\n`);
  write('.nojekyll', '');
  write('index.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chaikadi menu library data</title>
<style>body{font:16px/1.5 ui-monospace,"Courier New",monospace;max-width:560px;margin:32px auto;padding:0 16px;color:#111;background:#F7F7F7}a{color:#111}h1{border-bottom:2px solid #111;padding-bottom:12px}</style></head>
<body><h1>Chaikadi menu library</h1>
<p>Volunteer-maintained tea stall and restaurant menus, dedicated to the public domain (CC0-1.0). Used by <a href="https://chaikadi.fyi">chaikadi.fyi</a>.</p>
<p><a href="manifest.json">manifest.json</a> · <a href="${REPO_URL}#readme">Contribute or read the README</a></p>
<p>Data built ${escapeHtml(date)}${commit === 'unknown' ? '' : ` from commit ${escapeHtml(commit.slice(0, 7))}`}.</p>
<ul>${manifestCities.map(c => `<li><a href="${escapeHtml(c.url)}">${escapeHtml(c.name)}</a> (${escapeHtml(c.id)}): ${c.placeCount} place${c.placeCount === 1 ? '' : 's'}</li>`).join('')}</ul>
</body></html>
`);
  return manifest;
}
