import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { buildDist, jsonLd } from '../scripts/lib/build-core.mjs';
import { freshness, FRESHNESS } from '../scripts/lib/place.mjs';
import { staleReport } from '../scripts/stale-report.mjs';
import { place, tempRepo, sampleRepo } from './helpers.mjs';

const out = () => mkdtempSync(join(tmpdir(), 'chaikadi-dist-'));
function snapshot(dir) {
  const files = {};
  const walk = d => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex'); } };
  walk(dir); return files;
}

test('freshness thresholds: <=90 fresh, <=365 stale, otherwise unverified', () => {
  assert.deepEqual(FRESHNESS, { freshDays: 90, staleDays: 365 });
  assert.equal(freshness('2026-11-12', '2026-11-12'), 'fresh');
  assert.equal(freshness('2026-08-14', '2026-11-12'), 'fresh');      // 90 days
  assert.equal(freshness('2026-08-13', '2026-11-12'), 'stale');      // 91 days
  assert.equal(freshness('2025-11-12', '2026-11-12'), 'stale');      // 365 days
  assert.equal(freshness('2025-11-11', '2026-11-12'), 'unverified'); // 366 days
});

test('build output: manifest, bundle, permalinks, JSON-LD, CNAME, landing page', () => {
  const dir = out();
  const manifest = buildDist({ root: sampleRepo(), outDir: dir, date: '2026-11-12', commit: 'abc1234' });
  assert.deepEqual(Object.keys(manifest), ['schemaVersion', 'generatedAt', 'commit', 'freshness', 'cities']);
  const [city] = manifest.cities;
  assert.deepEqual(city, { ...city, id: 'in/kl/ernakulam', name: 'Ernakulam', placeCount: 3, url: 'index/in-kl-ernakulam.json' });
  const bundleText = readFileSync(join(dir, city.url), 'utf8');
  assert.equal(createHash('sha256').update(bundleText).digest('hex'), city.sha256);
  assert.equal(Buffer.byteLength(bundleText), city.bytes);
  const bundle = JSON.parse(bundleText);
  assert.deepEqual(bundle.places.map(p => [p.id, p.status, p.sample]), [
    ['node/9000000000001', 'fresh', true], ['node/9000000000002', 'stale', true], ['way/9000000000003', 'unverified', true]]);
  assert.equal(bundle.places[0].itemCount, bundle.places[0].menu.length);
  assert.equal(readFileSync(join(dir, 'CNAME'), 'utf8'), 'data.chaikadi.fyi\n');
  assert.ok(existsSync(join(dir, '.nojekyll')));
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /manifest\.json/);
  const ld = JSON.parse(readFileSync(join(dir, 'places/in/kl/ernakulam/node-9000000000001.jsonld'), 'utf8'));
  assert.equal(ld['@type'], 'Menu');
  assert.ok(ld.hasMenuSection.every(s => s['@type'] === 'MenuSection' && s.hasMenuItem.every(i => i['@type'] === 'MenuItem' && i.offers['@type'] === 'Offer')));
  assert.ok(existsSync(join(dir, 'places/in/kl/ernakulam/way-9000000000003.json')));
});

test('build is deterministic: identical inputs give identical bytes', () => {
  const root = sampleRepo();
  const a = out(), b = out();
  buildDist({ root, outDir: a, date: '2026-11-12', commit: 'abc1234' });
  buildDist({ root, outDir: b, date: '2026-11-12', commit: 'abc1234' });
  assert.deepEqual(snapshot(a), snapshot(b));
  const c = out();
  const manifest = buildDist({ root, outDir: c, date: '2026-11-12', commit: 'def5678' });
  assert.equal(snapshot(a)['index/in-kl-ernakulam.json'], snapshot(c)['index/in-kl-ernakulam.json'], 'commit does not affect bundle hashes');
  assert.equal(manifest.cities[0].sha256, snapshot(c)['index/in-kl-ernakulam.json']);
});

test('build refuses invalid data and bundles over the 300 KB budget', () => {
  assert.throws(() => buildDist({ root: tempRepo([{ place: place({ last_confirmed: '2030-01-01' }) }]), outDir: out(), date: '2026-11-12' }), /Validation failed/);
  const big = Array.from({ length: 40 }, (_, n) => ({ place: place({ id: `node/${9000000001000 + n}`, name: `Big Stall ${n}`,
    menu: Array.from({ length: 150 }, (_, i) => ({ id: `item-${i}`, name: `A rather long menu item name number ${i}`, category: 'Meal', price: 100, veg: true, available: true })) }) }));
  assert.throws(() => buildDist({ root: tempRepo(big), outDir: out(), date: '2026-11-12' }), /Split the city by locality/);
});

test('JSON-LD marks vegetarian and unavailable items', () => {
  const ld = jsonLd(place({ menu: [{ id: 'a', name: 'A', category: 'Tea', price: 5, veg: true, available: false }] }));
  const item = ld.hasMenuSection[0].hasMenuItem[0];
  assert.equal(item.suitableForDiet, 'https://schema.org/VegetarianDiet');
  assert.equal(item.offers.availability, 'https://schema.org/OutOfStock');
  assert.equal(item.offers.price, '5.00');
});

test('stale report lists only menus older than the threshold, escaped', () => {
  const report = staleReport([place({ name: 'Pipe | Stall', last_confirmed: '2026-01-01' }), place({ id: 'node/2', last_confirmed: '2026-11-01' })], { days: 180, date: '2026-11-12' });
  assert.match(report, /Pipe \\\| Stall/);
  assert.doesNotMatch(report, /node\/2/);
  assert.match(staleReport([], { date: '2026-11-12' }), /Nothing stale/);
});
