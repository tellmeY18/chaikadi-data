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
import { ADD_PLACE, UPDATE_MENU, CONSENT_TEXT, RELATIONS, KINDS, TAXES, SOURCES, parseIssueBody, isChecked, parseOsmId, parsePlaceRef, unfence } from './lib/issue-form.mjs';
import { fromMenuJson, fromMenuText, parseItemLine } from './lib/convert.mjs';
import { CITY_ID, formatPlace, relPathFor, slugify, todayUTC, uniqueSlug, walkItems } from './lib/place.mjs';
import { listPlaceFiles, validatePlace } from './lib/validate-core.mjs';

const sameName = (a, b) => a.normalize('NFKC').toLowerCase() === b.normalize('NFKC').toLowerCase();
const pick = (map, value, label, errors) => {
  const v = String(value || '').trim();
  if (!v) return undefined;
  if (!(v in map)) { errors.push(`${label}: choose one of the listed options.`); return undefined; }
  return map[v];
};

function addPlace(s, root, today) {
  const f = key => s[ADD_PLACE.fields[key]] ?? '';
  const errors = [];
  const city = f('city').trim().toLowerCase();
  if (!CITY_ID.test(city)) errors.push('City must look like in/kl/ernakulam (country/state/city).');
  const relation = pick(RELATIONS, f('relation'), 'How the OpenStreetMap object relates', errors);
  const osmRef = f('osm').trim() ? parseOsmId(f('osm')) : null;
  if (f('osm').trim() && !osmRef) errors.push('OpenStreetMap link or ID must look like node/123456 or https://www.openstreetmap.org/way/123456.');
  if (osmRef && relation === undefined) errors.push('Say how the OpenStreetMap object relates to the place.');
  if (!osmRef && relation) errors.push('Give the OpenStreetMap link or ID, or choose "No OpenStreetMap object yet".');
  const included = pick(TAXES, f('tax'), 'Taxes', errors);
  const meta = {
    name: f('name').trim(), localName: f('localName').trim() || undefined, city,
    kind: pick(KINDS, f('kind'), 'Kind of place', errors),
    osm: osmRef && relation ? { ...osmRef, relation } : undefined,
    location: Object.fromEntries([['building', f('building')], ['floor', f('floor')], ['area', f('area')], ['postcode', f('postcode').toUpperCase()]]
      .map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)),
    wikidata: f('wikidata').trim() || undefined,
    source: pick(SOURCES, f('source'), 'How you saw the prices', errors),
    tax: included === undefined || included === null ? undefined : { included },
    last_confirmed: f('seen').trim(),
  };
  const exists = id => existsSync(join(root, 'places', city, `${id}.json`));
  let id = slugify(meta.name || 'place', 50);
  if (exists(id) && meta.location.area) id = slugify(`${meta.name} ${meta.location.area}`, 60);
  if (exists(id)) errors.push(`A place with id "${id}" already exists in ${city}. Use the "Update a menu" form, or make the name more specific.`);
  if (meta.osm?.relation === 'is') {
    const taken = listPlaceFiles(root).find(file => {
      try { const p = JSON.parse(readFileSync(join(root, file), 'utf8')); return p.osm?.relation === 'is' && p.osm.type === meta.osm.type && p.osm.id === meta.osm.id; } catch { return false; }
    });
    if (taken) errors.push(`${meta.osm.type}/${meta.osm.id} is already used by ${taken}. Use the "Update a menu" form, or choose "inside" / "nearest landmark" if this is a different place in the same building.`);
  }
  meta.id = id;
  const json = unfence(f('menuJson'));
  let converted;
  if (json) {
    let parsed;
    try { parsed = JSON.parse(json); } catch (e) { return { ok: false, errors: [...errors, `Menu JSON is not valid JSON: ${e.message}`] }; }
    if (f('items').trim()) errors.push('Fill in either Menu or Menu JSON, not both.');
    converted = fromMenuJson(parsed, meta);
  } else converted = fromMenuText(f('items'), meta);
  errors.push(...converted.errors);
  if (!walkItems(converted.place || {}).length && !converted.errors.length) errors.push('Add at least one menu item.');
  if (errors.length) return { ok: false, errors };
  const place = converted.place;
  const relPath = relPathFor(place);
  const problems = validatePlace(place, { relPath, today });
  return problems.length ? { ok: false, errors: problems } : { ok: true, action: 'add', place, relPath };
}

function updatePlace(s, root, today) {
  const f = key => s[UPDATE_MENU.fields[key]] ?? '';
  const errors = [];
  const ref = parsePlaceRef(f('placeId'));
  if (!ref) return { ok: false, errors: ['Place ID must look like in/kl/ernakulam/place-id (shown in the app and the file path).'] };
  const relPath = `places/${ref.city}/${ref.id}.json`;
  if (!existsSync(join(root, relPath))) return { ok: false, errors: [`${ref.city}/${ref.id} is not in the library. Use the "Add a place" form instead.`] };
  const place = JSON.parse(readFileSync(join(root, relPath), 'utf8'));
  if (place.sample) return { ok: false, errors: [`${ref.city}/${ref.id} is fictional sample data and cannot be updated. Add the real place with the "Add a place" form.`] };
  const seen = f('seen').trim();
  if (seen < place.last_confirmed) return { ok: false, errors: [`Prices were last confirmed on ${place.last_confirmed}; this report (${seen}) is older.`] };
  const source = pick(SOURCES, f('source'), 'How you saw the prices', errors);
  const used = new Set(walkItems(place).map(x => x.item.id));
  const sectionIds = new Set(place.sections.flatMap(x => [x.id, ...(x.sections || []).map(y => y.id)]));
  let target = null;
  const sectionNamed = name => place.sections.find(x => sameName(x.name, name) && x.items) ||
    place.sections.flatMap(x => x.sections || []).find(x => sameName(x.name, name));
  const lines = String(f('changes')).split('\n').map(l => l.replace(/^```.*$/, '').trim()).filter(Boolean);
  if (!lines.length) errors.push('Add at least one change line.');
  for (const [i, line] of lines.slice(0, 300).entries()) {
    if (/^##+ /.test(line)) {
      const name = line.replace(/^##+ /, '').trim();
      target = sectionNamed(name);
      if (!target) { target = { id: uniqueSlug(name, sectionIds), name, items: [] }; place.sections.push(target); }
      continue;
    }
    const cells = line.split('|').map(c => c.trim());
    const existing = walkItems(place).find(x => sameName(x.item.name, cells[0]));
    if (cells.length === 2 && /^remove$/i.test(cells[1])) {
      if (!existing) { errors.push(`Line ${i + 1}: cannot remove "${cells[0]}": no such item.`); continue; }
      for (const x of [existing.subsection, existing.section].filter(Boolean)) if (x.items) x.items = x.items.filter(it => it !== existing.item);
      continue;
    }
    const { item, error } = parseItemLine(line);
    if (error) { errors.push(`Line ${i + 1} ("${line.slice(0, 60)}"): ${error}.`); continue; }
    if (item.variants) { const ids = new Set(); for (const v of item.variants) v.id = uniqueSlug(v.name, ids, 40); }
    if (existing) {
      const keep = existing.item;
      delete keep.price; delete keep.variants; delete keep.priceStatus;
      Object.assign(keep, item, { name: keep.name });
    } else {
      target = target || sectionNamed('Other items') || (() => { const s = { id: uniqueSlug('Other items', sectionIds), name: 'Other items', items: [] }; place.sections.push(s); return s; })();
      target.items.push({ id: uniqueSlug(item.name, used, 60), ...item });
    }
  }
  if (errors.length) return { ok: false, errors };
  for (const s of place.sections) { if (s.items && !s.items.length && !s.sections) s._empty = true; for (const sub of s.sections || []) if (!sub.items.length) sub._empty = true; }
  place.sections = place.sections.filter(s => !s._empty).map(s => (s.sections ? { ...s, sections: s.sections.filter(x => !x._empty) } : s)).filter(s => !s.sections || s.sections.length || s.items);
  place.last_confirmed = seen;
  if (source) place.source = source;
  const problems = validatePlace(place, { relPath, today });
  return problems.length ? { ok: false, errors: problems } : { ok: true, action: 'update', place, relPath };
}

// Returns { ok, action, place, relPath, errors }.
export function convertIssue(issue, { root, today = todayUTC() }) {
  const labels = (issue.labels || []).map(l => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
  const form = labels.includes(ADD_PLACE.label) ? ADD_PLACE : labels.includes(UPDATE_MENU.label) ? UPDATE_MENU : null;
  if (!form) return { ok: false, errors: ['This issue was not created from the "Add a place" or "Update a menu" form.'] };
  const s = parseIssueBody(issue.body, Object.values(form.fields));
  const errors = [];
  if (!isChecked(s[form.fields.consent], CONSENT_TEXT)) errors.push(`The licence box must be ticked: "${CONSENT_TEXT}".`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s[form.fields.seen] || '').trim())) errors.push('Date the prices were seen must be YYYY-MM-DD.');
  if (errors.length) return { ok: false, errors };
  return form === ADD_PLACE ? addPlace(s, root, today) : updatePlace(s, root, today);
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
      ...result.errors.slice(0, 50).map(e => `- ${md(e)}`), '',
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
  writeFileSync(join(work, 'pr-title.txt'), `${verb} ${result.place.name} (${result.place.city}/${result.place.id})`.replace(/[\r\n]+/g, ' ').slice(0, 200));
  writeFileSync(join(work, 'pr-body.md'), [
    `${verb}s \`${result.relPath}\` from issue #${number}.`, '',
    `- Place: ${md(result.place.name)} (\`${result.place.city}/${result.place.id}\`)`,
    `- Sections: ${result.place.sections.length}, items: ${walkItems(result.place).length}`,
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
