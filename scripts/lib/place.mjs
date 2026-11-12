// Shared rules for place files (schemaVersion 2). Used by every script and test.
import { readFileSync } from 'node:fs';

export const SCHEMA_VERSION = 2;
export const CATEGORIES = ['Tea', 'Coffee', 'Drinks', 'Snacks', 'Meal', 'Dessert', 'Other'];
// The published v1 compatibility files only know these.
export const V1_CATEGORIES = { Tea: 'Tea', Coffee: 'Coffee', Drinks: 'Other', Snacks: 'Snacks', Meal: 'Meal', Dessert: 'Snacks', Other: 'Other' };
export const FRESHNESS = Object.freeze({ freshDays: 90, staleDays: 365 });
export const MAX_ITEMS = 300;
export const MAX_BUNDLE_BYTES = 300 * 1024;
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CITY_ID = /^[a-z]{2}\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const OSM_ID = /^(node|way|relation)\/[1-9][0-9]{0,14}$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const KEYS = {
  place: ['schemaVersion', 'id', 'name', 'localName', 'city', 'kind', 'osm', 'wikidata', 'location', 'currency', 'tax', 'hours', 'note', 'sample', 'source', 'sections', 'last_confirmed'],
  osm: ['type', 'id', 'relation'],
  location: ['building', 'floor', 'area', 'postcode'],
  tax: ['included', 'note'],
  hours: ['days', 'open', 'close'],
  section: ['id', 'name', 'hours', 'note', 'items', 'sections'],
  item: ['id', 'name', 'localName', 'description', 'category', 'price', 'priceStatus', 'variants', 'portion', 'diet', 'spice', 'addOn', 'available', 'uncertain', 'note'],
  variant: ['id', 'name', 'price', 'portion'],
};

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
const list = (value, fn) => (Array.isArray(value) ? value.map(fn) : value);
function canonicalItem(item) {
  const out = ordered(item, KEYS.item);
  if (out && typeof out === 'object') out.variants = list(out.variants, v => ordered(v, KEYS.variant));
  if (out && out.variants === undefined) delete out.variants;
  return out;
}
function canonicalSection(section) {
  const out = ordered(section, KEYS.section);
  if (!out || typeof out !== 'object') return out;
  for (const [key, fn] of [['hours', h => ordered(h, KEYS.hours)], ['items', canonicalItem], ['sections', canonicalSection]]) {
    if (out[key] !== undefined) out[key] = list(out[key], fn);
  }
  return out;
}
export function canonicalPlace(place) {
  const out = ordered(place, KEYS.place);
  if (!out || typeof out !== 'object') return out;
  for (const [key, keys] of [['osm', KEYS.osm], ['location', KEYS.location], ['tax', KEYS.tax]]) if (out[key] !== undefined) out[key] = ordered(out[key], keys);
  if (out.hours !== undefined) out.hours = list(out.hours, h => ordered(h, KEYS.hours));
  if (out.sections !== undefined) out.sections = list(out.sections, canonicalSection);
  return out;
}
export const formatPlace = place => `${JSON.stringify(canonicalPlace(place), null, 2)}\n`;

export const relPathFor = place => `places/${place.city}/${place.id}.json`;
export function parseRelPath(relPath) {
  const m = relPath.replace(/\\/g, '/').match(/^places\/([a-z]{2}\/[^/]+\/[^/]+)\/([^/]+)\.json$/);
  return m ? { city: m[1], id: m[2] } : null;
}
export const osmRef = osm => (osm ? `${osm.type}/${osm.id}` : null);

export function slugify(text, max = 50) {
  const slug = String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
  return slug || 'item';
}
// "Kaloor Tea Stall" + "in/kl/ernakulam" helpers for unique ids.
export function uniqueSlug(base, used, max = 50) {
  const root = slugify(base, max);
  let id = root, n = 2;
  while (used.has(id)) id = `${root.slice(0, max - String(n).length - 1).replace(/-+$/, '')}-${n++}`;
  used.add(id);
  return id;
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

// Every item with its section path, in menu order.
export function walkItems(place) {
  const out = [];
  for (const section of Array.isArray(place?.sections) ? place.sections : []) {
    for (const item of Array.isArray(section?.items) ? section.items : []) out.push({ item, section, subsection: null });
    for (const sub of Array.isArray(section?.sections) ? section.sections : []) {
      for (const item of Array.isArray(sub?.items) ? sub.items : []) out.push({ item, section, subsection: sub });
    }
  }
  return out;
}

// Distinguishes same-named items: the subsection or section name that adds
// information ("Gheerice Combo" -> "Chicken / Beef"; "Fish Curry" in
// Breakfast > Curry -> "Breakfast").
export function contextLabel(itemName, section, subsection) {
  const words = new Set(String(itemName).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(w => w.replace(/s$/, '')));
  const adds = name => String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).some(w => !words.has(w.replace(/s$/, '')));
  if (subsection && adds(subsection.name)) return subsection.name;
  return section.name;
}

// One orderable line per priced item / variant: used for the v1 compatibility
// bundle and by apps that need a flat list. Unpriced items are left out.
export function flattenItems(place) {
  const entries = walkItems(place);
  const names = new Map();
  for (const { item } of entries) names.set(item.name.toLowerCase(), (names.get(item.name.toLowerCase()) || 0) + 1);
  const out = [];
  for (const { item, section, subsection } of entries) {
    const base = names.get(item.name.toLowerCase()) > 1 ? `${item.name} (${contextLabel(item.name, section, subsection)})` : item.name;
    const extra = { ...(item.diet ? { veg: ['veg', 'vegan'].includes(item.diet) } : {}), available: item.available !== false };
    if (Array.isArray(item.variants)) {
      for (const v of item.variants) out.push({ id: `${item.id}-${v.id}`, name: `${base} (${v.name})`, category: item.category, price: v.price, ...extra });
    } else if (typeof item.price === 'number') out.push({ id: item.id, name: base, category: item.category, price: item.price, ...extra });
  }
  return out;
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
const PATTERNED = new Set(['id', 'city', 'currency', 'wikidata', 'last_confirmed', 'open', 'close', 'postcode', 'type', 'relation', 'kind', 'source', 'category', 'priceStatus', 'diet']);
function textErrors(value, path, errors) {
  if (typeof value === 'string') { const problem = textProblem(value); if (problem && !PATTERNED.has(path.split('.').at(-1).replace(/\[\d+\]$/, ''))) errors.push(`${path} ${problem}.`); return; }
  if (Array.isArray(value)) value.forEach((v, i) => textErrors(v, `${path}[${i}]`, errors));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) textErrors(v, path ? `${path}.${k}` : k, errors);
}
const twoDecimals = n => typeof n !== 'number' || Math.round(n * 100) / 100 === n;

// Rules the JSON schema cannot express. Returns readable messages.
export function ruleErrors(place, { relPath, today = todayUTC() } = {}) {
  const errors = [];
  if (!place || typeof place !== 'object' || Array.isArray(place)) return ['File must contain one JSON object.'];
  if (relPath) {
    const expected = parseRelPath(relPath);
    if (!expected) errors.push('File must be at places/<country>/<state>/<city>/<place-id>.json');
    else {
      if (place.id !== expected.id) errors.push(`id "${place.id}" must match the file name (${expected.id}).`);
      if (place.city !== expected.city) errors.push(`city "${place.city}" must match the folder (${expected.city}).`);
    }
  }
  if (typeof place.last_confirmed === 'string') {
    if (!isRealDate(place.last_confirmed)) errors.push(`last_confirmed "${place.last_confirmed}" is not a real date.`);
    else if (place.last_confirmed > today) errors.push(`last_confirmed ${place.last_confirmed} is in the future.`);
  }
  textErrors(place, '', errors);
  const checkHours = (hours, where) => (Array.isArray(hours) ? hours : []).forEach((h, i) => {
    if (h?.open && h.open === h.close) errors.push(`${where}hours[${i}]: open and close are the same.`);
  });
  checkHours(place.hours, '');
  const sectionIds = new Set();
  (Array.isArray(place.sections) ? place.sections : []).forEach((section, i) => {
    if (!section || typeof section !== 'object') return;
    const where = `sections[${i}] (${section.id})`;
    if (sectionIds.has(section.id)) errors.push(`${where}: duplicate section id.`);
    sectionIds.add(section.id);
    const hasItems = Array.isArray(section.items), hasSubs = Array.isArray(section.sections);
    if (hasItems === hasSubs) errors.push(`${where}: needs either items or sections (subsections), not both or neither.`);
    checkHours(section.hours, `${where}.`);
    (hasSubs ? section.sections : []).forEach(sub => {
      if (sectionIds.has(sub?.id)) errors.push(`${where}: duplicate section id "${sub.id}".`);
      sectionIds.add(sub?.id);
      checkHours(sub?.hours, `${where} > ${sub?.id}.`);
    });
  });
  const items = walkItems(place);
  if (items.length > MAX_ITEMS) errors.push(`A place can list at most ${MAX_ITEMS} items (has ${items.length}).`);
  if (Array.isArray(place.sections) && !items.length) errors.push('Add at least one menu item.');
  const itemIds = new Set();
  for (const { item, section, subsection } of items) {
    if (!item || typeof item !== 'object') continue;
    const where = `item "${item.id}" in ${subsection ? `${section.id} > ${subsection.id}` : section.id}`;
    if (itemIds.has(item.id)) errors.push(`${where}: duplicate item id (ids are unique per place).`);
    itemIds.add(item.id);
    const hasVariants = Array.isArray(item.variants);
    if (hasVariants && item.price !== undefined) errors.push(`${where}: use either price or variants, not both.`);
    if (!hasVariants && item.price === undefined && !item.priceStatus) errors.push(`${where}: needs a price, variants, or priceStatus (market, seasonal, ask).`);
    if (!twoDecimals(item.price)) errors.push(`${where}: price must have at most 2 decimals.`);
    if (item.uncertain && !item.note) errors.push(`${where}: explain the uncertainty in note.`);
    if (hasVariants) {
      const ids = new Set();
      for (const v of item.variants) {
        if (ids.has(v?.id)) errors.push(`${where}: duplicate variant id "${v.id}".`);
        ids.add(v?.id);
        if (!twoDecimals(v?.price)) errors.push(`${where}: variant ${v?.id} price must have at most 2 decimals.`);
      }
    }
  }
  return errors;
}
