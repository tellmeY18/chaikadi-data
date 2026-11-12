import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { convertIssue } from '../scripts/issue-to-place.mjs';
import { ADD_PLACE, UPDATE_MENU, CONSENT_TEXT, parseOsmId, parseItemLines, parseIssueBody } from '../scripts/lib/issue-form.mjs';
import { formatPlace } from '../scripts/lib/place.mjs';
import { validateRepo } from '../scripts/lib/validate-core.mjs';
import { REPO, tempRepo, sampleRepo, place } from './helpers.mjs';

const TODAY = '2026-11-12';
const fixture = name => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const issue = (body, label) => ({ number: 7, body, labels: [{ name: label }, { name: 'accepted' }] });
const write = (root, result) => { const p = join(root, result.relPath); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, formatPlace(result.place)); };

test('issue form labels in the templates match the parser', () => {
  for (const [file, form] of [['add-place.yml', ADD_PLACE], ['update-menu.yml', UPDATE_MENU]]) {
    const yml = readFileSync(join(REPO, '.github/ISSUE_TEMPLATE', file), 'utf8');
    assert.match(yml, new RegExp(`labels: \\["${form.label}"\\]`));
    for (const label of Object.values(form.fields)) assert.ok(yml.includes(`label: ${label}\n`), `${file} is missing "${label}"`);
    assert.ok(yml.includes(`- label: ${CONSENT_TEXT}`));
  }
  assert.match(readFileSync(join(REPO, '.github/ISSUE_TEMPLATE/config.yml'), 'utf8'), /blank_issues_enabled: false/);
});

test('helpers parse OSM ids, item lines and issue sections', () => {
  for (const v of ['node/12', 'node 12', 'n12', 'https://www.openstreetmap.org/node/12', 'https://openstreetmap.org/node/12#map=19/1/2']) assert.equal(parseOsmId(v), 'node/12', v);
  assert.equal(parseOsmId('https://evil.example/node/12'), null);
  assert.equal(parseOsmId('node/0'), null);
  const { items, errors } = parseItemLines('Chai | tea | Rs. 12\n- Vada | Snacks | 10/- | veg\nBad line\nX | Juice | 1\nY | Tea | 1.234');
  assert.deepEqual(items, [{ name: 'Chai', category: 'Tea', price: 12 }, { name: 'Vada', category: 'Snacks', price: 10, veg: true }]);
  assert.equal(errors.length, 3);
  assert.equal(parseIssueBody(fixture('add-place.md'))['Wikidata ID'], '');
});

test('add-place issue becomes a valid canonical place file with unique item ids', () => {
  const root = sampleRepo();
  const result = convertIssue(issue(fixture('add-place.md'), 'add-place'), { root, today: TODAY });
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.relPath, 'places/in/kl/ernakulam/node-9000000000201.json');
  assert.deepEqual(result.place.menu.map(i => i.id), ['chai', 'filter-coffee', 'pazham-pori', 'fish-curry-meals', 'chai-2']);
  assert.equal(result.place.menu[1].price, 18);
  assert.equal(result.place.menu[3].veg, false);
  assert.equal(result.place.wikidata, undefined);
  assert.equal(result.place.sample, undefined);
  write(root, result);
  assert.deepEqual(validateRepo(root, { today: TODAY }).errors, []);
  const again = convertIssue(issue(fixture('add-place.md'), 'add-place'), { root, today: TODAY });
  assert.match(again.errors.join('\n'), /already in the library/);
});

test('update-menu issue merges changes, removes items and refreshes the date', () => {
  const root = sampleRepo();
  write(root, convertIssue(issue(fixture('add-place.md'), 'add-place'), { root, today: TODAY }));
  const result = convertIssue(issue(fixture('update-menu.md'), 'update-menu'), { root, today: TODAY });
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.action, 'update');
  assert.equal(result.place.last_confirmed, '2026-11-11');
  assert.equal(result.place.menu.find(i => i.id === 'chai').price, 14);
  assert.ok(!result.place.menu.some(i => i.name === 'Pazham Pori'));
  assert.equal(result.place.menu.at(-1).id, 'bun-maska');
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
  assert.match(reject(add.replace('https://www.openstreetmap.org/node/9000000000201', 'https://example.com/node/1')), /OpenStreetMap link or ID/);
  assert.match(reject(add, 'question'), /not created from/);
  assert.match(reject(fixture('update-menu.md'), 'update-menu'), /not in the library yet/);
  assert.match(reject(fixture('update-menu.md').replace('node/9000000000201', 'node/9000000000001'), 'update-menu'), /fictional sample/);
  const existing = tempRepo([{ place: place({ id: 'node/9000000000201' }) }]);
  assert.match(reject(fixture('update-menu.md').replace('2026-11-11', '2026-10-01'), 'update-menu', existing), /older/);
});

test('shell-like text stays inert data and is validated, never evaluated', () => {
  const root = sampleRepo();
  const body = fixture('add-place.md').replace('Test Tea Stall', 'Stall $(touch pwned) `id` ; echo').replace('Chai | Tea | 12', '$(id) | Tea | 12');
  const result = convertIssue(issue(body, 'add-place'), { root, today: TODAY });
  assert.equal(result.ok, true);
  assert.equal(result.place.name, 'Stall $(touch pwned) `id` ; echo');
  assert.equal(result.place.menu[0].id, 'id');
});
