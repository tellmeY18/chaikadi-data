#!/usr/bin/env node
// Convert an accepted issue-form submission into a new or updated place file.
// The issue body is untrusted: it is parsed here, validated with the same
// rules as the repo, and rejected on any problem. Nothing reaches a shell.
//
//   node scripts/issue-to-place.mjs --event "$GITHUB_EVENT_PATH" --work "$RUNNER_TEMP/issue"
// Writes the place file into the repo, plus pr-title.txt / pr-body.md or
// comment.md into --work, and ok/path/action/number to $GITHUB_OUTPUT.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ADD_PLACE, UPDATE_MENU, CONSENT_TEXT, parseIssueBody, isChecked, parseOsmId, parseItemLines } from './lib/issue-form.mjs';
import { CITY_ID, OSM_ID, formatPlace, relPathFor, slugify, todayUTC } from './lib/place.mjs';
import { listPlaceFiles, validatePlace } from './lib/validate-core.mjs';

function withIds(items, existing = []) {
  const used = new Set(existing.map(i => i.id));
  return items.map(item => {
    let id = slugify(item.name), n = 2;
    while (used.has(id)) id = `${slugify(item.name).slice(0, 46)}-${n++}`;
    used.add(id);
    return { id, ...item };
  });
}
const sameName = (a, b) => a.normalize('NFKC').toLowerCase() === b.normalize('NFKC').toLowerCase();

export function findPlaceFile(root, id) {
  return listPlaceFiles(root).find(f => {
    try { return JSON.parse(readFileSync(join(root, f), 'utf8')).id === id; } catch { return false; }
  }) || null;
}

// Pure-ish conversion: returns { ok, action, place, relPath, errors }.
export function convertIssue(issue, { root, today = todayUTC() }) {
  const labels = (issue.labels || []).map(l => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
  const form = labels.includes(ADD_PLACE.label) ? ADD_PLACE : labels.includes(UPDATE_MENU.label) ? UPDATE_MENU : null;
  if (!form) return { ok: false, errors: ['This issue was not created from the "Add a place" or "Update a menu" form.'] };
  const s = parseIssueBody(issue.body);
  const f = key => s[form.fields[key]] ?? '';
  const errors = [];
  if (!isChecked(f('consent'), CONSENT_TEXT)) errors.push(`The licence box must be ticked: "${CONSENT_TEXT}".`);
  const seen = f('seen').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(seen)) errors.push('Date the prices were seen must be YYYY-MM-DD.');

  if (form === ADD_PLACE) {
    const id = parseOsmId(f('osm'));
    const city = f('city').trim().toLowerCase();
    if (!id || !OSM_ID.test(id)) errors.push('OpenStreetMap link or ID must look like node/123456 or https://www.openstreetmap.org/node/123456.');
    if (!CITY_ID.test(city)) errors.push('City must look like in/kl/ernakulam (country/state/city).');
    const { items, errors: itemErrors } = parseItemLines(f('items'));
    errors.push(...itemErrors);
    if (!items.length && !itemErrors.length) errors.push('Add at least one menu item line.');
    if (id && findPlaceFile(root, id)) errors.push(`${id} is already in the library. Use the "Update a menu" form instead.`);
    if (errors.length) return { ok: false, errors };
    const place = { schemaVersion: 1, id, name: f('name').trim().replace(/\s+/g, ' '), city, currency: 'INR', menu: withIds(items), last_confirmed: seen };
    const wikidata = f('wikidata').trim();
    if (wikidata) place.wikidata = wikidata;
    const relPath = relPathFor(place);
    const problems = validatePlace(place, { relPath, today });
    return problems.length ? { ok: false, errors: problems } : { ok: true, action: 'add', place, relPath };
  }

  const id = parseOsmId(f('placeId'));
  if (!id) errors.push('Place ID must look like node/123456.');
  const relPath = id ? findPlaceFile(root, id) : null;
  if (id && !relPath) errors.push(`${id} is not in the library yet. Use the "Add a place" form instead.`);
  const { items, removals, errors: itemErrors } = parseItemLines(f('changes'), { allowRemove: true });
  errors.push(...itemErrors);
  if (!items.length && !removals.length && !itemErrors.length) errors.push('Add at least one change line.');
  if (errors.length) return { ok: false, errors };
  const place = JSON.parse(readFileSync(join(root, relPath), 'utf8'));
  if (place.sample) return { ok: false, errors: [`${id} is fictional sample data and cannot be updated. Add the real stall with the "Add a place" form.`] };
  if (seen < place.last_confirmed) return { ok: false, errors: [`Prices were last confirmed on ${place.last_confirmed}; this report (${seen}) is older.`] };
  for (const name of removals) {
    if (!place.menu.some(i => sameName(i.name, name))) return { ok: false, errors: [`Cannot remove "${name}": no such item.`] };
    place.menu = place.menu.filter(i => !sameName(i.name, name));
  }
  const fresh = [];
  for (const item of items) {
    const current = place.menu.find(i => sameName(i.name, item.name));
    if (current) Object.assign(current, item, { name: current.name });
    else fresh.push(item);
  }
  place.menu.push(...withIds(fresh, place.menu));
  place.last_confirmed = seen;
  const problems = validatePlace(place, { relPath, today });
  return problems.length ? { ok: false, errors: problems } : { ok: true, action: 'update', place, relPath };
}

const md = s => String(s).replace(/@/g, '@\u200b').replace(/[<>]/g, c => (c === '<' ? '&lt;' : '&gt;'));

async function main() {
  const args = process.argv.slice(2);
  const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const event = JSON.parse(readFileSync(arg('--event') || process.env.GITHUB_EVENT_PATH, 'utf8'));
  const work = arg('--work') || '.issue-work';
  mkdirSync(work, { recursive: true });
  const issue = event.issue;
  const number = Number(issue?.number);
  if (!Number.isInteger(number) || number < 1) throw new Error('Event has no issue number.');
  const root = process.cwd();
  const result = convertIssue(issue, { root, today: todayUTC() });
  const output = lines => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`); };
  if (!result.ok) {
    writeFileSync(join(work, 'comment.md'), [
      'Thanks for the submission. The menu could not be converted automatically:', '',
      ...result.errors.map(e => `- ${md(e)}`), '',
      'Please edit the issue to fix these, then a maintainer can remove and re-add the `accepted` label.',
    ].join('\n') + '\n');
    output(['ok=false', `number=${number}`]);
    console.log(result.errors.join('\n'));
    return;
  }
  const path = join(root, result.relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatPlace(result.place));
  const verb = result.action === 'add' ? 'Add' : 'Update';
  writeFileSync(join(work, 'pr-title.txt'), `${verb} ${result.place.name} (${result.place.id})`.replace(/[\r\n]+/g, ' ').slice(0, 200));
  writeFileSync(join(work, 'pr-body.md'), [
    `${verb}s \`${result.relPath}\` from issue #${number}.`, '',
    `- Place: ${md(result.place.name)} (\`${result.place.id}\`, ${result.place.city})`,
    `- Items: ${result.place.menu.length}`,
    `- Prices last confirmed: ${result.place.last_confirmed}`, '',
    'Generated by the issue-to-pr workflow from a form a maintainer labelled `accepted`. The contributor ticked the CC0 licence box.', '',
    `Closes #${number}`,
  ].join('\n') + '\n');
  output(['ok=true', `number=${number}`, `path=${result.relPath}`, `action=${result.action}`]);
  console.log(`${result.action}: ${result.relPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}
