// Convert contributor-friendly menu formats into schemaVersion 2 place objects.
//   fromMenuJson(json, meta) — the "simple menu JSON" (categories, subcategories,
//                              hours "08:00-12:00", items {name, price, notes})
//   fromMenuText(text, meta) — issue-form lines: "## Section (08:00-12:00)",
//                              "### Subsection", "name | category | price | flags"
// meta: { id?, name?, city, osm?, location?, kind?, currency?, last_confirmed, source?, localName? }
// Inputs are untrusted; every result must still pass validatePlace().
import { CATEGORIES, SCHEMA_VERSION, contextLabel, uniqueSlug } from './place.mjs';

const clean = s => String(s ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const lower = s => clean(s).toLowerCase();

const CATEGORY_WORDS = { tea: 'Tea', chai: 'Tea', coffee: 'Coffee', kaapi: 'Coffee', drink: 'Drinks', drinks: 'Drinks', beverage: 'Drinks', beverages: 'Drinks',
  juice: 'Drinks', shake: 'Drinks', snack: 'Snacks', snacks: 'Snacks', meal: 'Meal', meals: 'Meal', food: 'Meal', dessert: 'Dessert', desserts: 'Dessert', sweet: 'Dessert', other: 'Other' };
export function parseCategory(value) {
  const v = lower(value);
  return CATEGORIES.find(c => c.toLowerCase() === v) || CATEGORY_WORDS[v] || null;
}
// Category from the item and its section, used when none is given.
export function guessCategory(itemName, sectionNames = []) {
  const name = lower(itemName), sections = sectionNames.map(lower).join(' ');
  if (/\b(coffee|kaapi|espresso|latte|cappuccino)\b/.test(name)) return 'Coffee';
  if (/\b(tea|chai|sulaimani)\b/.test(name)) return 'Tea';
  if (/\b(shake|juice|lassi|soda|lime|boost|horlicks|bournvita|milk|water|cooler)\b/.test(name) || /\b(milk ?shake|juice|beverage|drink)s?\b/.test(sections)) return 'Drinks';
  if (/\b(dessert|sweet|payasam|ice cream|halwa|cake)s?\b/.test(`${name} ${sections}`)) return 'Dessert';
  if (/\bsnacks?\b/.test(sections) || /\b(vada|bajji|baji|samosa|puffs?|bonda|pori|ada|cutlet|biscuits?|toast)\b/.test(name)) return 'Snacks';
  return 'Meal';
}
// Only clear keywords; otherwise unknown (omitted).
export function guessDiet(itemName) {
  const n = lower(itemName);
  if (/\b(chicken|chk|beef|mutton|fish|prawns?|meat|erachi|kozhi|duck|pork|crab|squid)\b/.test(n)) return 'non-veg';
  if (/\b(egg|omelette|omelet|bullseye|mutta)\b/.test(n)) return 'egg';
  if (/^veg\b|\bveg\.|\bveg\b|\bpaneer\b|\bgobi\b|\bmushroom\b|\bkadala\b|\bdal\b/.test(n)) return 'veg';
  return undefined;
}
const PORTION = /^\d+(?:\.\d+)?\s*(?:pcs?|pieces?|nos?|ml|l|ltr|g|gm|kg|plates?)$/i;
const VARIANT_WORDS = /^(half|full|small|medium|large|regular|single|double|quarter|mini|jumbo|1\/2|3\/4)$/i;
const titled = s => s.replace(/^(.)/, c => c.toUpperCase());

function hoursFrom(value) {
  const m = clean(value).match(/^(\d{1,2}):?(\d{2})\s*[-–to]+\s*(\d{1,2}):?(\d{2})$/i);
  if (!m) return undefined;
  const t = (h, mm) => `${String(h).padStart(2, '0')}:${mm}`;
  return [{ open: t(m[1], m[2]), close: t(m[3], m[4]) }];
}

function placeShell(meta, extra = {}) {
  return { schemaVersion: SCHEMA_VERSION, id: meta.id, name: clean(meta.name), ...(meta.localName ? { localName: clean(meta.localName) } : {}),
    city: meta.city, ...(meta.kind ? { kind: meta.kind } : {}), ...(meta.osm ? { osm: meta.osm } : {}), ...(meta.wikidata ? { wikidata: meta.wikidata } : {}),
    ...(meta.location && Object.keys(meta.location).length ? { location: meta.location } : {}), currency: meta.currency || 'INR', ...extra,
    ...(meta.source ? { source: meta.source } : {}), sections: [], last_confirmed: meta.last_confirmed };
}
export function taxFrom(note) {
  const n = lower(note);
  if (!n) return {};
  if (/\b(exclusive|excluding|exclude|plus|extra|\+ ?gst)\b/.test(n) && /\b(tax|taxes|gst)\b/.test(n)) return { tax: { included: false, note: clean(note) } };
  if (/\b(inclusive|including|include|incl)\b/.test(n) && /\b(tax|taxes|gst)\b/.test(n)) return { tax: { included: true, note: clean(note) } };
  return { note: clean(note).slice(0, 160) };
}

// Build one item from {name, price, notes, category?, diet?}; merges handled by caller.
function itemFrom(raw, sectionNames, used, errors) {
  const name = clean(raw.name);
  if (!name) { errors.push('An item has no name.'); return null; }
  const item = { id: '', name };
  item.category = parseCategory(raw.category) || guessCategory(name, sectionNames);
  const notes = clean(raw.notes ?? raw.note);
  const price = raw.price;
  if (typeof price === 'number' && Number.isFinite(price)) item.price = Math.round(price * 100) / 100;
  else if (price !== null && price !== undefined && price !== '') { errors.push(`${name}: price must be a number or null.`); return null; }
  const rest = [];
  for (const part of notes ? notes.split(/[;,]\s*/) : []) {
    const p = part.trim();
    if (!p) continue;
    if (PORTION.test(p)) item.portion = p;
    else if (/^add[- ]?on$/i.test(p)) item.addOn = true;
    else if (/^(seasonal|market price|market|ask|ask for price)$/i.test(p)) item.priceStatus = /seasonal/i.test(p) ? 'seasonal' : /market/i.test(p) ? 'market' : 'ask';
    else if (/^(unavailable|not available|sold out)$/i.test(p)) item.available = false;
    else if (/illegible|unclear|not sure|unsure/i.test(p)) { item.uncertain = true; rest.push(p); }
    else if (VARIANT_WORDS.test(p)) item._variant = titled(p.toLowerCase());
    else rest.push(p);
  }
  if (rest.length) item.note = rest.join('; ').slice(0, 160);
  if (item.price === undefined && !item.priceStatus && !item._variant) item.priceStatus = 'ask';
  const diet = raw.diet || guessDiet(name);
  if (diet) item.diet = diet;
  item._sectionNames = sectionNames;
  return item;
}

// Same-name neighbours tagged Half/Full become one item with variants.
function mergeVariants(items, used) {
  const out = [];
  for (const item of items) {
    const prev = out.at(-1);
    if (item._variant && prev && prev.name.toLowerCase() === item.name.toLowerCase() && (prev._variant || prev.variants)) {
      if (!prev.variants) { prev.variants = [{ id: '', name: prev._variant, price: prev.price, ...(prev.portion ? { portion: prev.portion } : {}) }]; delete prev.price; delete prev.portion; delete prev._variant; }
      prev.variants.push({ id: '', name: item._variant, price: item.price, ...(item.portion ? { portion: item.portion } : {}) });
      continue;
    }
    out.push(item);
  }
  for (const item of out) {
    if (item._variant && !item.variants) { item.note = [item.note, item._variant].filter(Boolean).join('; '); }
    delete item._variant;
    if (item.variants) {
      if (item.variants.some(v => typeof v.price !== 'number')) { item.priceStatus = item.priceStatus || 'ask'; delete item.variants; }
      else { const ids = new Set(); for (const v of item.variants) v.id = uniqueSlug(v.name, ids, 40); }
    }
  }
  return out;
}

function finishSection(name, rawItems, extra, sectionNames, used, sectionIds, errors) {
  const items = mergeVariants(rawItems.map(r => itemFrom(r, sectionNames, used, errors)).filter(Boolean), used);
  return { id: uniqueSlug(name, sectionIds, 50), name: clean(name), ...extra, items };
}
function assignItemIds(place) {
  const used = new Set();
  const names = new Map();
  for (const s of place.sections) for (const i of [...(s.items || []), ...(s.sections || []).flatMap(x => x.items)]) names.set(i.name.toLowerCase(), (names.get(i.name.toLowerCase()) || 0) + 1);
  for (const s of place.sections) {
    for (const [sub, items] of [[null, s.items || []], ...(s.sections || []).map(x => [x, x.items])]) {
      for (const item of items) {
        item.id = uniqueSlug(names.get(item.name.toLowerCase()) > 1 ? `${item.name} ${contextLabel(item.name, s, sub)}` : item.name, used, 60);
        delete item._sectionNames;
      }
    }
  }
  return place;
}

export function fromMenuJson(json, meta) {
  const errors = [];
  if (!json || typeof json !== 'object' || !Array.isArray(json.categories)) return { errors: ['Menu JSON needs a "categories" array.'] };
  const notes = json.notes ?? json.note;
  const place = placeShell({ ...meta, name: meta.name || json.restaurant || json.name, currency: meta.currency || json.currency }, taxFrom(notes));
  const sectionIds = new Set();
  for (const cat of json.categories.slice(0, 40)) {
    const name = clean(cat?.name);
    if (!name) { errors.push('A category has no name.'); continue; }
    const extra = { ...(hoursFrom(cat.hours) ? { hours: hoursFrom(cat.hours) } : {}), ...(clean(cat.notes ?? cat.note) ? { note: clean(cat.notes ?? cat.note).slice(0, 160) } : {}) };
    if (Array.isArray(cat.subcategories)) {
      const section = { id: uniqueSlug(name, sectionIds, 50), name, ...extra, sections: [] };
      for (const sub of cat.subcategories.slice(0, 20)) {
        const subName = clean(sub?.name) || 'Items';
        const subExtra = { ...(hoursFrom(sub.hours) ? { hours: hoursFrom(sub.hours) } : {}), ...(clean(sub.notes ?? sub.note) ? { note: clean(sub.notes ?? sub.note).slice(0, 160) } : {}) };
        section.sections.push(finishSection(subName, Array.isArray(sub.items) ? sub.items : [], subExtra, [name, subName], null, sectionIds, errors));
      }
      place.sections.push(section);
    } else place.sections.push(finishSection(name, Array.isArray(cat.items) ? cat.items : [], extra, [name], null, sectionIds, errors));
  }
  return { place: assignItemIds(place), errors };
}

// "Half 160, Full 200" | "160" | "seasonal" | "ask" | "market"
function priceCell(text) {
  const t = clean(text).replace(/(?:₹|rs\.?|inr)\s*/gi, '').replace(/\/-/g, '');
  if (/^(seasonal|ask|market)$/i.test(t)) return { status: t.toLowerCase() };
  if (/^\d+(\.\d{1,2})?$/.test(t)) return { price: Number(t) };
  const parts = t.split(/\s*[,/]\s*/).map(p => p.match(/^(.{1,40}?)\s+(\d+(?:\.\d{1,2})?)$/));
  if (parts.length >= 2 && parts.every(Boolean)) return { variants: parts.map(m => ({ name: titled(m[1].trim()), price: Number(m[2]) })) };
  return null;
}
export function parseItemLine(line) {
  const cells = line.replace(/^[-*]\s+/, '').split('|').map(c => c.trim());
  if (cells.length < 3) return { error: 'use "name | category | price"' };
  const [name, rawCategory, rawPrice, ...flags] = cells;
  const category = parseCategory(rawCategory);
  if (!name) return { error: 'missing name' };
  if (!category) return { error: 'category must be Tea, Coffee, Drinks, Snacks, Meal, Dessert or Other' };
  const price = priceCell(rawPrice);
  if (!price) return { error: 'price must be a number, "Half 160, Full 200", seasonal, market or ask' };
  if ((price.price ?? 0) > 100000 || price.variants?.some(v => v.price > 100000)) return { error: 'price is too large' };
  const item = { name: clean(name), category };
  if (price.price !== undefined) item.price = price.price;
  if (price.status) item.priceStatus = price.status;
  if (price.variants) item.variants = price.variants;
  for (const flag of flags.filter(Boolean)) {
    const f = flag.toLowerCase();
    if (['veg', 'vegan', 'egg', 'non-veg'].includes(f)) item.diet = f;
    else if (f === 'nonveg') item.diet = 'non-veg';
    else if (f === 'add-on' || f === 'addon') item.addOn = true;
    else if (f === 'unavailable') item.available = false;
    else if (PORTION.test(flag)) item.portion = flag;
    else if (/^note:/i.test(flag)) item.note = clean(flag.slice(5)).slice(0, 160);
    else return { error: `unknown flag "${flag}" (veg, vegan, egg, non-veg, add-on, unavailable, a portion like "2 pcs", or "note: …")` };
  }
  return { item };
}

export function fromMenuText(text, meta) {
  const errors = [];
  const place = placeShell(meta, meta.tax ? { tax: meta.tax } : {});
  const sectionIds = new Set();
  let section = null, sub = null;
  const lines = String(text || '').split('\n').map(l => l.replace(/^```.*$/, '').trim()).filter(Boolean);
  if (lines.length > 400) errors.push('At most 400 lines are allowed.');
  const header = (raw) => { const m = raw.match(/^(.*?)\s*\((\d{1,2}:?\d{2}\s*[-–]\s*\d{1,2}:?\d{2})\)\s*$/); return m ? { name: clean(m[1]), hours: hoursFrom(m[2]) } : { name: clean(raw) }; };
  lines.slice(0, 400).forEach((line, i) => {
    if (line.startsWith('### ')) {
      if (!section) { section = { id: uniqueSlug('Menu', sectionIds), name: 'Menu', sections: [] }; place.sections.push(section); }
      if (section.items?.length) { errors.push(`Line ${i + 1}: a section cannot have both items and subsections.`); return; }
      section.sections = section.sections || [];
      const h = header(line.slice(4));
      sub = { id: uniqueSlug(h.name, sectionIds), name: h.name, ...(h.hours ? { hours: h.hours } : {}), items: [] };
      section.sections.push(sub); delete section.items; return;
    }
    if (line.startsWith('## ')) {
      const h = header(line.slice(3));
      section = { id: uniqueSlug(h.name, sectionIds), name: h.name, ...(h.hours ? { hours: h.hours } : {}), items: [] };
      sub = null; place.sections.push(section); return;
    }
    if (line.startsWith('#')) return;
    const { item, error } = parseItemLine(line);
    if (error) { errors.push(`Line ${i + 1} ("${line.slice(0, 60)}"): ${error}.`); return; }
    if (!section) { section = { id: uniqueSlug('Menu', sectionIds), name: 'Menu', items: [] }; place.sections.push(section); }
    const target = sub || section;
    if (!target.items) { errors.push(`Line ${i + 1}: put items under a ### subsection here.`); return; }
    target.items.push(item);
  });
  for (const s of place.sections) {
    if (s.sections && !s.sections.length) delete s.sections;
    if (s.items && !s.items.length && s.sections) delete s.items;
    for (const x of [s, ...(s.sections || [])]) for (const item of x.items || []) if (item.variants) { const ids = new Set(); for (const v of item.variants) v.id = uniqueSlug(v.name, ids, 40); }
  }
  place.sections = place.sections.filter(s => (s.items && s.items.length) || (s.sections && s.sections.length));
  return { place: assignItemIds(place), errors };
}
