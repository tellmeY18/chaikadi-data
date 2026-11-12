import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { convertIssue } from '../scripts/issue-to-place.mjs';
import { ADD_PLACE, UPDATE_MENU, CONSENT_TEXT, parseOsmId, parseIssueBody, parsePlaceRef } from '../scripts/lib/issue-form.mjs';
import { fromMenuJson, fromMenuText, parseItemLine, guessCategory, guessDiet, taxFrom } from '../scripts/lib/convert.mjs';
import { formatPlace, walkItems } from '../scripts/lib/place.mjs';
import { validateRepo, validatePlace } from '../scripts/lib/validate-core.mjs';
import { REPO, tempRepo, sampleRepo, place } from './helpers.mjs';

const TODAY = '2026-11-12';
const fixture = name => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const issue = (body, label) => ({ number: 7, body, labels: [{ name: label }, { name: 'accepted' }] });
const write = (root, result) => { const p = join(root, result.relPath); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, formatPlace(result.place)); };
const items = p => walkItems(p).map(x => x.item);

test('issue form labels in the templates match the parser', () => {
  for (const [file, form] of [['add-place.yml', ADD_PLACE], ['update-menu.yml', UPDATE_MENU]]) {
    const yml = readFileSync(join(REPO, '.github/ISSUE_TEMPLATE', file), 'utf8');
    assert.match(yml, new RegExp(`labels: \\["${form.label}"\\]`));
    for (const label of Object.values(form.fields)) assert.ok(yml.includes(`label: ${label}\n`), `${file} is missing "${label}"`);
    assert.ok(yml.includes(`- label: ${CONSENT_TEXT}`));
  }
  assert.match(readFileSync(join(REPO, '.github/ISSUE_TEMPLATE/config.yml'), 'utf8'), /blank_issues_enabled: false/);
});

test('helpers parse OSM ids, place refs, item lines and categories', () => {
  for (const v of ['node/12', 'node 12', 'n12', 'https://www.openstreetmap.org/node/12', 'https://openstreetmap.org/node/12#map=19/1/2']) assert.deepEqual(parseOsmId(v), { type: 'node', id: 12 }, v);
  assert.deepEqual(parseOsmId('https://www.openstreetmap.org/way/1292036173#map=19/10.009326/76.367493'), { type: 'way', id: 1292036173 });
  assert.equal(parseOsmId('https://evil.example/node/12'), null);
  assert.deepEqual(parsePlaceRef('places/in/kl/ernakulam/x-y.json'), { city: 'in/kl/ernakulam', id: 'x-y' });
  assert.equal(parsePlaceRef('../../etc/passwd'), null);
  assert.deepEqual(parseItemLine('Chicken Biriyani | Meal | Half 160, Full 200 | non-veg').item.variants, [{ name: 'Half', price: 160 }, { name: 'Full', price: 200 }]);
  assert.deepEqual(parseItemLine('Fish Fry | meals | seasonal').item, { name: 'Fish Fry', category: 'Meal', priceStatus: 'seasonal' });
  assert.deepEqual(parseItemLine('Paneer | Meal | Rs. 50/- | add-on | 100 g | note: Grilled').item, { name: 'Paneer', category: 'Meal', price: 50, addOn: true, portion: '100 g', note: 'Grilled' });
  assert.match(parseItemLine('X | Wine | 1').error, /category/);
  assert.match(parseItemLine('X | Tea | 1.234').error, /price/);
  assert.match(parseItemLine('X | Tea | 1 | spicy').error, /unknown flag/);
  assert.equal(guessCategory('Tender Coconut', ['Milk Shake']), 'Drinks');
  assert.equal(guessCategory('Black Coffee', ['Beverages']), 'Coffee');
  assert.equal(guessCategory('Ela Ada', ['Snacks']), 'Snacks');
  assert.equal(guessDiet('Chk Hot Dog Sandwich'), 'non-veg');
  assert.equal(guessDiet('Veg. Stew'), 'veg');
  assert.equal(guessDiet('Kabsa Biriyani'), undefined);
  assert.deepEqual(taxFrom('Prices exclusive of all taxes.'), { tax: { included: false, note: 'Prices exclusive of all taxes.' } });
});

test('simple menu JSON converts to a rich, valid place (hours, subsections, variants, portions, seasonal, uncertain)', () => {
  const json = { restaurant: 'X Kitchen', notes: 'Prices exclusive of all taxes.', categories: [
    { name: 'Breakfast', hours: '08:00-12:00', subcategories: [
      { name: 'Breads', items: [{ name: 'Upma', price: 60, notes: 'name partly illegible ("SAMA")' }, { name: 'Set Dosa', price: 60, notes: '2 pcs' }] },
      { name: 'Curry', items: [{ name: 'Fish Curry', price: null, notes: 'seasonal' }, { name: 'Chicken Curry', price: 160 }] }] },
    { name: 'Lunch', hours: '12:00-16:00', items: [{ name: 'Chicken Biriyani', price: 200, notes: 'full' }, { name: 'Chicken Biriyani', price: 160, notes: 'half' },
      { name: 'Chicken Curry', price: 160 }, { name: 'Grilled Paneer', price: 50, notes: 'add-on' }] }] };
  const { place: p, errors } = fromMenuJson(json, { id: 'x-kitchen', city: 'in/kl/ernakulam', last_confirmed: '2026-11-12' });
  assert.deepEqual(errors, []);
  assert.deepEqual(validatePlace(p, { relPath: 'places/in/kl/ernakulam/x-kitchen.json', today: TODAY }), []);
  assert.equal(p.tax.included, false);
  assert.deepEqual(p.sections[0].hours, [{ open: '08:00', close: '12:00' }]);
  const all = items(p);
  assert.deepEqual(all.find(i => i.name === 'Upma'), { id: 'upma', name: 'Upma', category: 'Meal', price: 60, uncertain: true, note: 'name partly illegible ("SAMA")' });
  assert.equal(all.find(i => i.name === 'Set Dosa').portion, '2 pcs');
  assert.equal(all.find(i => i.name === 'Fish Curry').priceStatus, 'seasonal');
  assert.deepEqual(all.find(i => i.name === 'Chicken Biriyani').variants, [{ id: 'full', name: 'Full', price: 200 }, { id: 'half', name: 'Half', price: 160 }]);
  assert.equal(all.find(i => i.name === 'Grilled Paneer').addOn, true);
  assert.deepEqual(all.filter(i => i.name === 'Chicken Curry').map(i => i.id), ['chicken-curry-breakfast', 'chicken-curry-lunch']);
});

test('menu text with sections, subsections and hours converts to a valid place', () => {
  const { place: p, errors } = fromMenuText('## Breakfast (8:00-12:00)\n### Breads\nAppam | Meal | 20\n## Drinks\nTea | Tea | 15', { id: 'y', name: 'Y', city: 'in/kl/ernakulam', last_confirmed: '2026-11-12' });
  assert.deepEqual(errors, []);
  assert.deepEqual(p.sections.map(s => [s.name, s.hours?.[0]?.open, !!s.sections, !!s.items]), [['Breakfast', '08:00', true, false], ['Drinks', undefined, false, true]]);
});

test('add-place issue (menu lines) becomes a valid canonical place with OSM, location, tax and source', () => {
  const root = sampleRepo();
  const result = convertIssue(issue(fixture('add-place.md'), 'add-place'), { root, today: TODAY });
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.relPath, 'places/in/kl/ernakulam/test-tea-stall.json');
  const p = result.place;
  assert.deepEqual(p.osm, { type: 'node', id: 9000000000201, relation: 'is' });
  assert.deepEqual(p.location, { area: 'Kaloor', postcode: '682017' });
  assert.deepEqual([p.kind, p.source, p.tax.included, p.localName], ['tea-stall', 'menu-board', true, 'ടെസ്റ്റ് ചായക്കട']);
  assert.deepEqual(items(p).map(i => i.id), ['chai-morning', 'filter-coffee', 'pazham-pori', 'fish-curry-meals', 'fish-fry', 'chai-extras']);
  assert.equal(p.sections[1].sections[0].items[0].variants[1].price, 140);
  write(root, result);
  assert.deepEqual(validateRepo(root, { today: TODAY }).errors, []);
  assert.match(convertIssue(issue(fixture('add-place.md'), 'add-place'), { root, today: TODAY }).errors.join('\n'), /already uses|already exists|already used/);
});

test('add-place issue (Menu JSON, inside a building) becomes a valid place', () => {
  const root = sampleRepo();
  const result = convertIssue(issue(fixture('add-place-json.md'), 'add-place'), { root, today: TODAY });
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.deepEqual(result.place.osm, { type: 'way', id: 9000000000301, relation: 'inside' });
  assert.deepEqual(result.place.location, { building: 'Test Tech Park, Block B', floor: 'Ground floor', area: 'Kakkanad', postcode: '682042' });
  assert.equal(result.place.tax.included, false);
  assert.ok(items(result.place).some(i => i.variants?.length === 2));
});

test('update-menu issue merges changes, variants, removals and new sections', () => {
  const root = sampleRepo();
  write(root, convertIssue(issue(fixture('add-place.md'), 'add-place'), { root, today: TODAY }));
  const result = convertIssue(issue(fixture('update-menu.md'), 'update-menu'), { root, today: TODAY });
  assert.equal(result.ok, true, result.errors?.join('\n'));
  const all = items(result.place);
  assert.equal(result.place.last_confirmed, '2026-11-11');
  assert.equal(result.place.source, 'in-person');
  assert.equal(all.find(i => i.id === 'chai-morning').price, 14);
  assert.deepEqual(all.find(i => i.name === 'Fish Curry Meals').variants.map(v => v.price), [95, 150]);
  assert.ok(!all.some(i => i.name === 'Pazham Pori'));
  assert.deepEqual(result.place.sections.at(-1).items.map(i => i.id), ['bun-maska']);
});

test('conversion rejects missing consent, bad data, older dates, samples, wrong forms', () => {
  const root = sampleRepo();
  const reject = (body, label = 'add-place', r = root) => convertIssue(issue(body, label), { root: r, today: TODAY }).errors.join('\n');
  const add = fixture('add-place.md');
  assert.match(reject(add.replace('- [X]', '- [ ]')), /licence box/);
  assert.match(reject(add.replace('2026-11-10', '2026-12-01')), /in the future/);
  assert.match(reject(add.replace('Test Tea Stall', 'Call 98765 43210')), /phone number/);
  assert.match(reject(add.replace('Test Tea Stall', '<script>alert(1)</script>')), /HTML/);
  assert.match(reject(add.replace('in/kl/ernakulam', '../../etc')), /City must look like/);
  assert.match(reject(add.replace('Tea stall', 'Pub')), /choose one of the listed options/);
  assert.match(reject(add.replace('https://www.openstreetmap.org/node/9000000000201', 'https://example.com/node/1')), /OpenStreetMap link or ID/);
  assert.match(reject(add.replace('Kaloor', 'Near 9.9816, 76.2999')), /coordinates/);
  assert.match(reject(fixture('add-place-json.md').replace('"categories"', '"menu"')), /categories/);
  assert.match(reject(fixture('add-place-json.md').replace('_No response_\n\n### Menu JSON', 'Tea | Tea | 1\n\n### Menu JSON')), /either Menu or Menu JSON/);
  assert.match(reject(add, 'question'), /not created from/);
  assert.match(reject(fixture('update-menu.md'), 'update-menu'), /not in the library/);
  assert.match(reject(fixture('update-menu.md').replace('test-tea-stall', 'sample-chai-corner-kaloor'), 'update-menu'), /fictional sample/);
  const existing = tempRepo([{ place: place({ id: 'test-tea-stall' }) }]);
  assert.match(reject(fixture('update-menu.md').replace('2026-11-11', '2026-10-01'), 'update-menu', existing), /older/);
});

test('shell-like text stays inert data and is validated, never evaluated', () => {
  const root = sampleRepo();
  const body = fixture('add-place.md').replace('Test Tea Stall', 'Stall $(touch pwned) `id` ; echo').replace('Chai | Tea | 12 | veg', '$(id) | Tea | 12');
  const result = convertIssue(issue(body, 'add-place'), { root, today: TODAY });
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.place.name, 'Stall $(touch pwned) `id` ; echo');
  assert.equal(items(result.place)[0].name, '$(id)');
  assert.equal(parseIssueBody(fixture('add-place.md'))['Wikidata ID'], '');
});
