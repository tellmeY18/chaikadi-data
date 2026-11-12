// Shared, dependency-light rules for place files. Used by every script and test.
import { readFileSync } from 'node:fs';

export const SCHEMA_VERSION = 1;
export const CATEGORIES = ['Tea', 'Coffee', 'Snacks', 'Meal', 'Other'];
export const FRESHNESS = Object.freeze({ freshDays: 90, staleDays: 365 });
export const MAX_ITEMS = 150;
export const MAX_BUNDLE_BYTES = 300 * 1024;
export const PLACE_KEYS = ['schemaVersion', 'id', 'name', 'city', 'currency', 'wikidata', 'sample', 'menu', 'last_confirmed'];
export const ITEM_KEYS = ['id', 'name', 'category', 'price', 'veg', 'available'];
export const OSM_ID = /^(node|way|relation)\/[1-9][0-9]{0,14}$/;
export const CITY_ID = /^[a-z]{2}\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const schema = JSON.parse(readFileSync(new URL('../../schema/place.schema.json', import.meta.url), 'utf8'));

// Keys in canonical order; unknown keys are kept (sorted, at the end) so the
// formatter never silently drops data. The schema rejects them afterwards.
function ordered(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = {};
  for (const key of keys) if (key in value && value[key] !== undefined) out[key] = value[key];
  for (const key of Object.keys(value).filter(k => !keys.includes(k)).sort()) out[key] = value[key];
  return out;
}
export function canonicalPlace(place) {
  const out = ordered(place, PLACE_KEYS);
  if (Array.isArray(out?.menu)) out.menu = out.menu.map(item => ordered(item, ITEM_KEYS));
  return out;
}
export const formatPlace = place => `${JSON.stringify(canonicalPlace(place), null, 2)}\n`;

export const fileNameFor = id => `${id.replace('/', '-')}.json`;
export const relPathFor = place => `places/${place.city}/${fileNameFor(place.id)}`;
export function parseRelPath(relPath) {
  const m = relPath.replace(/\\/g, '/').match(/^places\/([a-z]{2}\/[^/]+\/[^/]+)\/(node|way|relation)-([0-9]+)\.json$/);
  return m ? { city: m[1], id: `${m[2]}/${m[3]}` } : null;
}

export function slugify(text) {
  const slug = String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/g, '');
  return slug || 'item';
}

export const titleCase = slug => slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
export const todayUTC = (now = new Date()) => now.toISOString().slice(0, 10);

function isRealDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export const daysBetween = (from, to) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

export function freshness(lastConfirmed, asOf, thresholds = FRESHNESS) {
  const age = daysBetween(lastConfirmed, asOf);
  if (age <= thresholds.freshDays) return 'fresh';
  if (age <= thresholds.staleDays) return 'stale';
  return 'unverified';
}

// Free-text safety: no coordinates, links, contact details or markup.
const TEXT_RULES = [
  [/[\u0000-\u001f\u007f\u2028\u2029]/, 'contains control characters'],
  [/<[^>]*>|&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i, 'contains HTML'],
  [/[^\s@]+@[^\s@]+\.[^\s@]+/, 'contains an email address'],
  [/[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|in|org|net|io|co|app|fyi|info|biz|me|xyz|shop)\b/i, 'contains a URL'],
  [/(?:\+?\d[\s().-]*){9,}/, 'contains a phone number'],
  [/-?\d{1,3}\.\d{3,}\s*[,;]\s*-?\d{1,3}\.\d{3,}/, 'contains coordinates'],
];
export function textProblem(value) {
  for (const [pattern, message] of TEXT_RULES) if (pattern.test(value)) return message;
  if (value !== value.trim()) return 'has leading or trailing spaces';
  if (/\s{2,}/.test(value)) return 'has repeated spaces';
  return null;
}

// Rules the JSON schema cannot express. Returns readable messages.
export function ruleErrors(place, { relPath, today = todayUTC() } = {}) {
  const errors = [];
  if (!place || typeof place !== 'object' || Array.isArray(place)) return ['File must contain one JSON object.'];
  if (relPath) {
    const expected = parseRelPath(relPath);
    if (!expected) errors.push('File must be at places/<country>/<state>/<city>/<osm-type>-<osm-id>.json');
    else {
      if (place.id !== expected.id) errors.push(`id "${place.id}" must match the file name (${expected.id}).`);
      if (place.city !== expected.city) errors.push(`city "${place.city}" must match the folder (${expected.city}).`);
    }
  }
  if (typeof place.last_confirmed === 'string') {
    if (!isRealDate(place.last_confirmed)) errors.push(`last_confirmed "${place.last_confirmed}" is not a real date.`);
    else if (place.last_confirmed > today) errors.push(`last_confirmed ${place.last_confirmed} is in the future.`);
  }
  for (const [key, value] of [['name', place.name]]) {
    if (typeof value === 'string' && textProblem(value)) errors.push(`${key} ${textProblem(value)}.`);
  }
  if (Array.isArray(place.menu)) {
    const seen = new Set();
    place.menu.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const where = `menu[${index}]${item.id ? ` (${item.id})` : ''}`;
      if (typeof item.id === 'string') {
        if (seen.has(item.id)) errors.push(`${where}: duplicate item id "${item.id}".`);
        seen.add(item.id);
      }
      if (typeof item.name === 'string' && textProblem(item.name)) errors.push(`${where}: name ${textProblem(item.name)}.`);
      if (typeof item.price === 'number' && Math.round(item.price * 100) / 100 !== item.price) errors.push(`${where}: price must have at most 2 decimals.`);
    });
  }
  return errors;
}
