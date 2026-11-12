import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRepo, validatePlace } from '../scripts/lib/validate-core.mjs';
import { formatPlace } from '../scripts/lib/place.mjs';
import { place, tempRepo, sampleRepo } from './helpers.mjs';

const TODAY = '2026-11-12';
const messages = (p, relPath = 'places/in/kl/ernakulam/node-9000000000101.json') => validatePlace(p, { relPath, today: TODAY }).join('\n');

test('the bundled sample places are valid and canonical', () => {
  const result = validateRepo(sampleRepo(), { today: TODAY });
  assert.deepEqual(result.errors, []);
  assert.equal(result.total, 3);
  assert.ok(result.places.every(p => p.sample === true));
});

test('schema: required fields, unknown fields, enums, limits', () => {
  assert.equal(messages(place()), '');
  assert.match(messages({ ...place(), name: undefined }), /required property 'name'/);
  assert.match(messages(place({ lat: 9.98 })), /unknown field "lat"/);
  assert.match(messages(place({ menu: [{ id: 'x', name: 'X', category: 'Juice', price: 1 }] })), /must be one of Tea, Coffee/);
  assert.match(messages(place({ menu: [{ id: 'x', name: 'X', category: 'Tea', price: 10001 }] })), /<= 10000/);
  assert.match(messages(place({ menu: [{ id: 'x', name: 'X', category: 'Tea', price: -1 }] })), />= 0/);
  assert.match(messages(place({ menu: [{ id: 'x', name: 'X', category: 'Tea', price: 1.234 }] })), /2 decimals|multiple of/);
  assert.equal(messages(place({ menu: [{ id: 'x', name: 'X', category: 'Tea', price: 12.35 }] })), '');
  assert.match(messages(place({ menu: [{ id: 'Bad Id', name: 'X', category: 'Tea', price: 1 }] })), /pattern/);
  assert.match(messages(place({ name: 'x'.repeat(81) })), /more than 80/);
  assert.match(messages(place({ menu: Array.from({ length: 151 }, (_, i) => ({ id: `i${i}`, name: `Item ${i}`, category: 'Tea', price: 1 })) })), /more than 150/);
  assert.match(messages(place({ menu: [] })), /fewer than 1/);
  assert.match(messages(place({ wikidata: 'Q0' })), /pattern/);
  assert.match(messages(place({ sample: false })), /constant/);
  assert.match(messages(place({ currency: 'inr' })), /pattern/);
});

test('rules: file/id/city consistency, future dates, duplicate item ids', () => {
  assert.match(messages(place(), 'places/in/kl/ernakulam/node-1.json'), /must match the file name/);
  assert.match(messages(place(), 'places/in/kl/kochi/node-9000000000101.json'), /must match the folder/);
  assert.match(messages(place(), 'places/in/ernakulam/node-9000000000101.json'), /must be at places/);
  assert.match(messages(place({ last_confirmed: '2026-11-13' })), /in the future/);
  assert.match(messages(place({ last_confirmed: '2026-02-30' })), /not a real date|format/);
  assert.match(messages(place({ menu: [{ id: 'chai', name: 'Chai', category: 'Tea', price: 1 }, { id: 'chai', name: 'Chai 2', category: 'Tea', price: 2 }] })), /duplicate item id/);
});

test('rules: no URLs, emails, phone numbers, coordinates, HTML or control characters', () => {
  for (const [name, why] of [
    ['Chai https://example.com', /URL/], ['Visit www.example', /URL/], ['Order on stall.in', /URL/],
    ['Mail a@b.co', /email/], ['Call +91 98765 43210', /phone/], ['At 9.9816, 76.2999', /coordinates/],
    ['<b>Chai</b>', /HTML/], ['Chai &amp; Vada', /HTML/], ['Tab\there', /control/], [' Chai', /spaces/],
  ]) assert.match(messages(place({ name })), why, name);
  assert.match(messages(place({ menu: [{ id: 'x', name: 'Ring 0484 2345678', category: 'Tea', price: 1 }] })), /phone/);
  assert.equal(messages(place({ name: 'Chai & Vada, Stall No. 12 (Kaloor)' })), '');
});

test('repo: duplicate place ids across cities, non-canonical files, invalid JSON', () => {
  const a = place(), b = place({ city: 'in/kl/thrissur' });
  const root = tempRepo([{ place: a }, { place: b },
    { path: 'places/in/kl/ernakulam/node-9000000000102.json', text: JSON.stringify(place({ id: 'node/9000000000102' })) },
    { path: 'places/in/kl/ernakulam/node-9000000000103.json', text: '{ broken' }]);
  const errors = validateRepo(root, { today: TODAY }).errors;
  assert.equal(errors.filter(e => /Duplicate place id/.test(e.message)).length, 2);
  assert.ok(errors.some(e => e.file.endsWith('102.json') && /npm run format/.test(e.message)));
  assert.ok(errors.some(e => e.file.endsWith('103.json') && /Invalid JSON/.test(e.message)));
});

test('changed mode validates only listed files but still detects repo-wide duplicates', () => {
  const root = tempRepo([{ place: place() }, { place: place({ city: 'in/kl/thrissur' }) },
    { place: place({ id: 'node/9000000000104', last_confirmed: '2030-01-01' }) }]);
  const result = validateRepo(root, { today: TODAY, files: ['places/in/kl/thrissur/node-9000000000101.json'] });
  assert.equal(result.checked, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /Duplicate place id/);
});

test('formatter puts keys in canonical order and keeps unknown keys for the validator to report', () => {
  const messy = { menu: [{ price: 1, name: 'Chai', id: 'chai', category: 'Tea' }], last_confirmed: '2026-11-01', id: 'node/1', zzz: 1, schemaVersion: 1, currency: 'INR', city: 'in/kl/ernakulam', name: 'X' };
  const text = formatPlace(messy);
  assert.deepEqual(Object.keys(JSON.parse(text)), ['schemaVersion', 'id', 'name', 'city', 'currency', 'menu', 'last_confirmed', 'zzz']);
  assert.deepEqual(Object.keys(JSON.parse(text).menu[0]), ['id', 'name', 'category', 'price']);
  assert.ok(text.endsWith('}\n') && text.includes('\n  "id"'));
});
