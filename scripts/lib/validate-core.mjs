// Validation engine shared by validate.mjs, build.mjs, format and issue conversion.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { schema, ruleErrors, formatPlace, todayUTC } from './place.mjs';

const ajv = new Ajv({ allErrors: true, strict: true, multipleOfPrecision: 9 });
addFormats(ajv, ['date']);
const validateSchema = ajv.compile(schema);

export function schemaErrors(place) {
  if (validateSchema(place)) return [];
  return validateSchema.errors.map(e => {
    const where = e.instancePath || '(root)';
    if (e.keyword === 'additionalProperties') return `${where}: unknown field "${e.params.additionalProperty}".`;
    if (e.keyword === 'enum') return `${where}: must be one of ${e.params.allowedValues.join(', ')}.`;
    return `${where}: ${e.message}.`;
  });
}

// Validate one place object (schema + rules). Pure: used for issue conversion.
export function validatePlace(place, { relPath, today = todayUTC() } = {}) {
  return [...schemaErrors(place), ...ruleErrors(place, { relPath, today })];
}

export function listPlaceFiles(root) {
  const base = join(root, 'places');
  if (!existsSync(base)) return [];
  const out = [];
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path).split(sep).join('/'));
    }
  };
  walk(base);
  return out;
}

// Parse + check a file's bytes: UTF-8, JSON, canonical formatting, schema, rules.
export function checkFile(root, relPath, { today = todayUTC() } = {}) {
  const errors = [];
  if (!relPath.endsWith('.json')) return { errors: ['Only .json place files are allowed under places/.'], place: null };
  const bytes = readFileSync(join(root, relPath));
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) return { errors: ['File is not valid UTF-8.'], place: null };
  if (text.charCodeAt(0) === 0xfeff) errors.push('Remove the UTF-8 byte-order mark.');
  let place;
  try { place = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch (error) { return { errors: [`Invalid JSON: ${error.message}`], place: null }; }
  errors.push(...validatePlace(place, { relPath, today }));
  if (place && typeof place === 'object' && text !== formatPlace(place)) {
    errors.push('Not canonically formatted (2-space indent, canonical key order, LF, final newline). Run: npm run format');
  }
  return { errors, place };
}

// Full or partial validation. Duplicate-id detection always uses the whole repo.
export function validateRepo(root, { files, today = todayUTC() } = {}) {
  const all = listPlaceFiles(root);
  const targets = files ? files.filter(f => all.includes(f)) : all;
  const results = new Map();
  for (const file of targets) results.set(file, checkFile(root, file, { today }));
  const owners = new Map();
  for (const file of all) {
    let id;
    if (results.has(file)) id = results.get(file).place?.id;
    else { try { id = JSON.parse(readFileSync(join(root, file), 'utf8')).id; } catch { /* reported in full mode */ } }
    if (typeof id !== 'string') continue;
    owners.set(id, [...(owners.get(id) || []), file]);
  }
  for (const [id, paths] of owners) {
    if (paths.length < 2) continue;
    for (const file of paths) {
      if (!results.has(file)) continue;
      results.get(file).errors.push(`Duplicate place id "${id}" also used by ${paths.filter(p => p !== file).join(', ')}.`);
    }
  }
  const errors = [];
  for (const [file, result] of results) for (const message of result.errors) errors.push({ file, message });
  return { checked: targets.length, total: all.length, errors, places: [...results.values()].map(r => r.place).filter(Boolean) };
}
