import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRepo, validatePlace } from '../scripts/lib/validate-core.mjs';
import { formatPlace } from '../scripts/lib/place.mjs';
import { place, withItems, tempRepo, sampleRepo } from './helpers.mjs';

const TODAY = '2026-11-12';
const REL = 'places/in/kl/ernakulam/test-stall.json';
const messages = (p, relPath = REL) => validatePlace(p, { relPath, today: TODAY }).join('\n');
const item = extra => ({ id: 'x', name: 'X', category: 'Meal', price: 10, ...extra });

test('the repository places are valid and canonical (samples + real places)', () => {
  const result = validateRepo(sampleRepo(), { today: TODAY });
  assert.deepEqual(result.errors, []);
  assert.ok(result.total >= 4);
  assert.equal(result.places.filter(p => p.sample).length, 3);
});

test('schema: required fields, unknown fields, enums, limits', () => {
  assert.equal(messages(place()), '');
  assert.match(messages({ ...place(), name: undefined }), /required property 'name'/);
  assert.match(messages(place({ lat: 9.98 })), /unknown field "lat"/);
  assert.match(messages(place({ schemaVersion: 1 })), /constant/);
  assert.match(messages(withItems([item({ category: 'Juice' })])), /must be one of Tea, Coffee, Drinks/);
  assert.match(messages(withItems([item({ price: 100001 })])), /<= 100000/);
  assert.match(messages(withItems([item({ price: -1 })])), />= 0/);
  assert.match(messages(withItems([item({ price: 1.234 })])), /2 decimals|multiple of/);
  assert.match(messages(withItems([item({ id: 'Bad Id' })])), /pattern/);
  assert.match(messages(place({ name: 'x'.repeat(81) })), /more than 80/);
  assert.match(messages(place({ osm: { type: 'node', id: 1, relation: 'within' } })), /must be one of is, inside, near/);
  assert.match(messages(place({ kind: 'bar' })), /must be one of/);
  assert.match(messages(place({ location: {} })), /fewer than 1/);
  assert.match(messages(place({ location: { postcode: 'abc' } })), /pattern/);
  assert.match(messages(place({ hours: [{ open: '8:00', close: '12:00' }] })), /pattern/);
  assert.match(messages(withItems([item({ spice: 4 })])), /<= 3/);
  assert.match(messages(withItems([item({ diet: 'jain' })])), /must be one of/);
  assert.match(messages(place({ sections: [] })), /fewer than 1/);
});

test('rich fields validate: variants, priceStatus, portions, add-ons, local names, hours, tax', () => {
  const rich = place({
    localName: 'ചായക്കട', kind: 'tea-stall', location: { building: 'Prestige Cyber Green, Phase 1', floor: 'Ground floor', area: 'Kakkanad', postcode: '682042' },
    tax: { included: false, note: 'GST extra.' }, hours: [{ days: ['mo', 'tu'], open: '06:00', close: '22:30' }, { days: ['su'], open: '08:00', close: '24:00' }],
    source: 'printed-menu', note: 'Cash and UPI.',
    sections: [{ id: 'lunch', name: 'Lunch', hours: [{ open: '12:00', close: '16:00' }], sections: [
      { id: 'main', name: 'Main', note: 'Served till stock lasts.', items: [
        { id: 'biriyani', name: 'Chicken Biriyani', localName: 'ചിക്കൻ ബിരിയാണി', description: 'With raita and pickle.', category: 'Meal', diet: 'non-veg', spice: 2,
          variants: [{ id: 'half', name: 'Half', price: 160 }, { id: 'full', name: 'Full', price: 200, portion: '1 plate' }] },
        { id: 'fish-fry', name: 'Fish Fry', category: 'Meal', priceStatus: 'seasonal' },
        { id: 'paneer', name: 'Grilled Paneer', category: 'Meal', price: 50, addOn: true, portion: '100 g' },
        { id: 'upma', name: 'Upma', category: 'Meal', price: 60, uncertain: true, note: 'Name partly illegible.' },
        { id: 'puttu', name: 'Puttu', category: 'Meal', price: 20, available: false }] }] }],
  });
  assert.equal(messages(rich), '');
});

test('rules: path consistency, future dates, sections, prices, ids', () => {
  assert.match(messages(place(), 'places/in/kl/ernakulam/other.json'), /must match the file name/);
  assert.match(messages(place(), 'places/in/kl/kochi/test-stall.json'), /must match the folder/);
  assert.match(messages(place(), 'places/in/ernakulam/test-stall.json'), /must be at places/);
  assert.match(messages(place({ last_confirmed: '2026-11-13' })), /in the future/);
  assert.match(messages(place({ last_confirmed: '2026-02-30' })), /not a real date|format/);
  assert.match(messages(withItems([item(), item({ name: 'Y' })])), /duplicate item id/);
  assert.match(messages(withItems([{ id: 'x', name: 'X', category: 'Meal' }])), /needs a price, variants, or priceStatus/);
  assert.match(messages(withItems([item({ variants: [{ id: 'a', name: 'A', price: 1 }, { id: 'b', name: 'B', price: 2 }] })])), /either price or variants/);
  assert.match(messages(withItems([{ id: 'x', name: 'X', category: 'Meal', variants: [{ id: 'a', name: 'A', price: 1 }, { id: 'a', name: 'B', price: 2 }] }])), /duplicate variant id/);
  assert.match(messages(withItems([item({ uncertain: true })])), /explain the uncertainty/);
  assert.match(messages(place({ sections: [{ id: 'a', name: 'A', items: [item()], sections: [{ id: 'b', name: 'B', items: [item({ id: 'y' })] }] }] })), /either items or sections/);
  assert.match(messages(place({ sections: [{ id: 'a', name: 'A', items: [item()] }, { id: 'a', name: 'B', items: [item({ id: 'y' })] }] })), /duplicate section id/);
  assert.match(messages(place({ hours: [{ open: '10:00', close: '10:00' }] })), /open and close are the same/);
  const many = Array.from({ length: 20 }, (_, s) => ({ id: `s${s}`, name: `S${s}`, items: Array.from({ length: 16 }, (_, i) => item({ id: `i${s}-${i}`, name: `Item ${i}` })) }));
  assert.match(messages(place({ sections: many })), /at most 300 items/);
});

test('rules: no URLs, emails, phone numbers, coordinates, HTML or control characters, in any text field', () => {
  for (const [name, why] of [
    ['Chai https://example.com', /URL/], ['Visit www.example', /URL/], ['Order on stall.in', /URL/],
    ['Mail a@b.co', /email/], ['Call +91 98765 43210', /phone/], ['At 9.9816, 76.2999', /coordinates/],
    ['<b>Chai</b>', /HTML/], ['Chai &amp; Vada', /HTML/], ['Tab\there', /control/], [' Chai', /spaces/],
  ]) assert.match(messages(place({ name })), why, name);
  assert.match(messages(withItems([item({ note: 'Ring 0484 2345678' })])), /note contains a phone number/);
  assert.match(messages(withItems([item({ description: 'See www.menu.example' })])), /description contains a URL/);
  assert.match(messages(place({ location: { building: 'Tower at 10.0093, 76.3674' } })), /coordinates/);
  assert.equal(messages(place({ name: 'Chai & Vada, Stall No. 12 (Kaloor)', location: { postcode: '682042' } })), '');
});

test('repo: one place may BE an OSM object; others may be inside it; formatting and JSON errors', () => {
  const a = place(), b = place({ id: 'other', city: 'in/kl/thrissur' });
  const c = place({ id: 'food-court-stall', osm: { type: 'node', id: 9000000000101, relation: 'inside' } });
  const root = tempRepo([{ place: a }, { place: b }, { place: c },
    { path: 'places/in/kl/ernakulam/messy.json', text: JSON.stringify(place({ id: 'messy', osm: undefined })) },
    { path: 'places/in/kl/ernakulam/broken.json', text: '{ broken' }]);
  const errors = validateRepo(root, { today: TODAY }).errors;
  assert.equal(errors.filter(e => /already used as "is"/.test(e.message)).length, 2);
  assert.ok(!errors.some(e => e.file.endsWith('food-court-stall.json')));
  assert.ok(errors.some(e => e.file.endsWith('messy.json') && /npm run format/.test(e.message)));
  assert.ok(errors.some(e => e.file.endsWith('broken.json') && /Invalid JSON/.test(e.message)));
});

test('changed mode validates only listed files but still detects repo-wide OSM conflicts', () => {
  const root = tempRepo([{ place: place() }, { place: place({ id: 'other', city: 'in/kl/thrissur' }) },
    { place: place({ id: 'future', osm: undefined, last_confirmed: '2030-01-01' }) }]);
  const result = validateRepo(root, { today: TODAY, files: ['places/in/kl/thrissur/other.json'] });
  assert.equal(result.checked, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /already used as "is"/);
});

test('formatter orders keys canonically at every level and keeps unknown keys for the validator', () => {
  const messy = { sections: [{ items: [{ price: 1, name: 'Chai', id: 'chai', category: 'Tea' }], name: 'Tea', id: 'tea' }], last_confirmed: '2026-11-01',
    id: 'x', zzz: 1, schemaVersion: 2, currency: 'INR', city: 'in/kl/ernakulam', name: 'X', osm: { relation: 'is', id: 1, type: 'node' } };
  const parsed = JSON.parse(formatPlace(messy));
  assert.deepEqual(Object.keys(parsed), ['schemaVersion', 'id', 'name', 'city', 'osm', 'currency', 'sections', 'last_confirmed', 'zzz']);
  assert.deepEqual(Object.keys(parsed.osm), ['type', 'id', 'relation']);
  assert.deepEqual(Object.keys(parsed.sections[0]), ['id', 'name', 'items']);
  assert.deepEqual(Object.keys(parsed.sections[0].items[0]), ['id', 'name', 'category', 'price']);
});
