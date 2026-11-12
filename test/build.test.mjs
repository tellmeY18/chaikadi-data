import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { buildDist, jsonLd, v1Place } from '../scripts/lib/build-core.mjs';
import { freshness, FRESHNESS, flattenItems } from '../scripts/lib/place.mjs';
import { staleReport } from '../scripts/stale-report.mjs';
import { place, withItems, tempRepo, sampleRepo } from './helpers.mjs';

const out = () => mkdtempSync(join(tmpdir(), 'chaikadi-dist-'));
const hash = text => createHash('sha256').update(text).digest('hex');
function snapshot(dir) {
  const files = {};
  const walk = d => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = hash(readFileSync(p)); } };
  walk(dir); return files;
}
const SFK = 'places/in/kl/ernakulam/smart-foodie-kitchen-cyber-green';

test('freshness thresholds: <=90 fresh, <=365 stale, otherwise unverified', () => {
  assert.deepEqual(FRESHNESS, { freshDays: 90, staleDays: 365 });
  assert.equal(freshness('2026-11-12', '2026-11-12'), 'fresh');
  assert.equal(freshness('2026-08-14', '2026-11-12'), 'fresh');
  assert.equal(freshness('2026-08-13', '2026-11-12'), 'stale');
  assert.equal(freshness('2025-11-12', '2026-11-12'), 'stale');
  assert.equal(freshness('2025-11-11', '2026-11-12'), 'unverified');
});

test('v2 output: manifest, full rich bundle, permalinks, JSON-LD, headers', () => {
  const dir = out();
  const manifest = buildDist({ root: sampleRepo(), outDir: dir, date: '2026-11-12', commit: 'abc1234' });
  assert.equal(manifest.schemaVersion, 2);
  const [city] = manifest.cities;
  assert.deepEqual(city, { ...city, id: 'in/kl/ernakulam', name: 'Ernakulam', placeCount: 4, url: 'index/in-kl-ernakulam.json' });
  const text = readFileSync(join(dir, 'v2', city.url), 'utf8');
  assert.equal(hash(text), city.sha256);
  assert.equal(Buffer.byteLength(text), city.bytes);
  const bundle = JSON.parse(text);
  assert.equal(bundle.schemaVersion, 2);
  const sfk = bundle.places.find(p => p.id === 'smart-foodie-kitchen-cyber-green');
  assert.deepEqual(sfk.osm, { type: 'way', id: 1292036173, relation: 'inside' });
  assert.equal(sfk.location.building, 'Prestige Cyber Green, Phase 1');
  assert.equal(sfk.tax.included, false);
  assert.equal(sfk.sections[0].hours[0].open, '08:00');
  assert.equal(sfk.itemCount, 98);
  assert.equal(sfk.status, 'fresh');
  assert.equal(sfk.city, undefined, 'city is implied by the bundle');
  assert.deepEqual(bundle.places.map(p => [p.id, p.status]).filter(([id]) => id.startsWith('sample')),
    [['sample-chai-corner-kaloor', 'fresh'], ['sample-meals-hotel-fort-kochi', 'unverified'], ['sample-snack-counter-edappally', 'stale']]);
  assert.ok(existsSync(join(dir, `${SFK}.json`)));
  const ld = JSON.parse(readFileSync(join(dir, `${SFK}.jsonld`), 'utf8'));
  assert.equal(ld['@type'], 'Menu');
  const breakfast = ld.hasMenuSection[0];
  assert.equal(breakfast.hasMenuSection[0]['@type'], 'MenuSection');
  const lunch = ld.hasMenuSection.find(s => s.name === 'Lunch').hasMenuSection[0].hasMenuItem[0];
  assert.deepEqual(lunch.offers.map(o => [o.name, o.price]), [['Full', '200.00'], ['Half', '160.00']]);
  assert.equal(readFileSync(join(dir, 'CNAME'), 'utf8'), 'data.chaikadi.fyi\n');
  assert.match(readFileSync(join(dir, '_headers'), 'utf8'), /Access-Control-Allow-Origin: \*/);
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /v2\/manifest\.json/);
});

test('v1 compatibility output: flat priced items, only places that ARE an OSM object', () => {
  const dir = out();
  buildDist({ root: sampleRepo(), outDir: dir, date: '2026-11-12', commit: 'abc1234' });
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  const text = readFileSync(join(dir, manifest.cities[0].url), 'utf8');
  assert.equal(hash(text), manifest.cities[0].sha256);
  const bundle = JSON.parse(text);
  assert.deepEqual(bundle.places.map(p => p.id), ['node/9000000000001', 'node/9000000000002', 'way/9000000000003'], 'the restaurant "inside" a building is v2-only');
  const hotel = bundle.places[2];
  assert.ok(hotel.menu.some(i => i.name === 'Omelette (Double)' && i.price === 50));
  assert.ok(!hotel.menu.some(i => i.name === 'Fish Fry'), 'unpriced items are left out');
  assert.ok(bundle.places.flatMap(p => p.menu).every(i => ['Tea', 'Coffee', 'Snacks', 'Meal', 'Other'].includes(i.category)));
  assert.equal(v1Place(place({ osm: { type: 'way', id: 5, relation: 'inside' } }), '2026-11-12'), null);
});

test('flattened items name duplicates by their section and variants by size', () => {
  const names = flattenItems(JSON.parse(readFileSync(new URL(`../${SFK}.json`, import.meta.url)))).map(i => i.name);
  for (const n of ['Chicken Curry (Breakfast)', 'Chicken Curry (Lunch)', 'Chicken Biriyani (Half)', 'Gheerice Combo (Chicken / Beef)', 'Chicken Roll (Snacks)']) assert.ok(names.includes(n), n);
  assert.equal(new Set(names).size, names.length, 'flattened names are unique');
});

test('build is deterministic: identical inputs give identical bytes', () => {
  const root = sampleRepo();
  const a = out(), b = out(), c = out();
  buildDist({ root, outDir: a, date: '2026-11-12', commit: 'abc1234' });
  buildDist({ root, outDir: b, date: '2026-11-12', commit: 'abc1234' });
  assert.deepEqual(snapshot(a), snapshot(b));
  buildDist({ root, outDir: c, date: '2026-11-12', commit: 'def5678' });
  assert.equal(snapshot(a)['v2/index/in-kl-ernakulam.json'], snapshot(c)['v2/index/in-kl-ernakulam.json'], 'commit does not affect bundle hashes');
});

test('build refuses invalid data and bundles over the 300 KB budget', () => {
  assert.throws(() => buildDist({ root: tempRepo([{ place: place({ last_confirmed: '2030-01-01' }) }]), outDir: out(), date: '2026-11-12' }), /Validation failed/);
  const big = Array.from({ length: 12 }, (_, n) => ({ place: withItems(Array.from({ length: 150 }, (_, i) => ({ id: `item-${i}`, name: `A rather long menu item name number ${i}`,
    category: 'Meal', price: 100, diet: 'veg', description: 'A long description that makes the bundle grow quickly.' })), { id: `big-${n}`, name: `Big ${n}`, osm: undefined }) }));
  assert.throws(() => buildDist({ root: tempRepo(big), outDir: out(), date: '2026-11-12' }), /Split the city by locality/);
});

test('JSON-LD marks vegetarian and unavailable items', () => {
  const ld = jsonLd(withItems([{ id: 'a', name: 'A', category: 'Tea', price: 5, diet: 'veg', available: false }]));
  const item = ld.hasMenuSection[0].hasMenuItem[0];
  assert.equal(item.suitableForDiet, 'https://schema.org/VegetarianDiet');
  assert.equal(item.offers.availability, 'https://schema.org/OutOfStock');
});

test('stale report lists only menus older than the threshold, escaped, with full ids', () => {
  const report = staleReport([place({ name: 'Pipe | Stall', last_confirmed: '2026-01-01' }), place({ id: 'new', last_confirmed: '2026-11-01' })], { days: 180, date: '2026-11-12' });
  assert.match(report, /Pipe \\\| Stall/);
  assert.match(report, /`in\/kl\/ernakulam\/test-stall`/);
  assert.doesNotMatch(report, /\/new`/);
  assert.match(staleReport([], { date: '2026-11-12' }), /Nothing stale/);
});
