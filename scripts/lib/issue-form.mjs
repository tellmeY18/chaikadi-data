// Parse GitHub issue-form bodies. Everything here is UNTRUSTED user input:
// never pass it to a shell; only return plain values validated afterwards.

// Labels must match .github/ISSUE_TEMPLATE/*.yml (a test checks this).
export const ADD_PLACE = {
  label: 'add-place',
  fields: { name: 'Stall name', osm: 'OpenStreetMap link or ID', city: 'City', items: 'Menu items', seen: 'Date the prices were seen', wikidata: 'Wikidata ID', consent: 'Licence' },
};
export const UPDATE_MENU = {
  label: 'update-menu',
  fields: { placeId: 'Place ID', changes: 'Changes', seen: 'Date the prices were seen', consent: 'Licence' },
};
export const CONSENT_TEXT = 'I made this data myself and release it under CC0';
export const MAX_BODY = 20000;

export function parseIssueBody(body) {
  const text = String(body || '').slice(0, MAX_BODY).replace(/\r\n?/g, '\n');
  const sections = {};
  const parts = text.split(/^### +(.+?) *$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const value = parts[i + 1].trim();
    sections[parts[i].trim()] = value === '_No response_' ? '' : value;
  }
  return sections;
}

export function isChecked(value, text = CONSENT_TEXT) {
  return String(value || '').split('\n').some(line => /^- \[[xX]\] /.test(line.trim()) && line.includes(text));
}

// Accepts node/123, "node 123", n123, or an openstreetmap.org object link.
export function parseOsmId(value) {
  const v = String(value || '').trim();
  let m = v.match(/^https?:\/\/(?:www\.)?openstreetmap\.org\/(node|way|relation)\/([1-9][0-9]{0,14})(?:[/?#].*)?$/i);
  if (!m) m = v.match(/^(node|way|relation)[\s/:]+([1-9][0-9]{0,14})$/i);
  if (!m) { const s = v.match(/^([nwr])([1-9][0-9]{0,14})$/i); if (s) m = [s[0], { n: 'node', w: 'way', r: 'relation' }[s[1].toLowerCase()], s[2]]; }
  return m ? `${m[1].toLowerCase()}/${m[2]}` : null;
}

const CATEGORY_ALIASES = { tea: 'Tea', chai: 'Tea', drink: 'Tea', drinks: 'Tea', beverage: 'Tea', coffee: 'Coffee', snack: 'Snacks', snacks: 'Snacks', meal: 'Meal', meals: 'Meal', food: 'Meal', other: 'Other' };

// "name | category | price" lines, optional "| veg" / "| non-veg" / "| unavailable".
// Update forms may use "name | remove". Returns { items, removals, errors }.
export function parseItemLines(text, { allowRemove = false } = {}) {
  const items = [], removals = [], errors = [];
  const lines = String(text || '').split('\n').map(l => l.replace(/^```.*$/, '').trim()).filter(l => l && !l.startsWith('#'));
  if (lines.length > 150) errors.push('At most 150 item lines are allowed.');
  lines.slice(0, 150).forEach((line, i) => {
    const cells = line.replace(/^[-*]\s+/, '').split('|').map(c => c.trim());
    const where = `Line ${i + 1} ("${line.slice(0, 60)}")`;
    if (allowRemove && cells.length === 2 && /^remove$/i.test(cells[1])) { removals.push(cells[0]); return; }
    if (cells.length < 3 || cells.length > 5) { errors.push(`${where}: use "name | category | price".`); return; }
    const [name, rawCategory, rawPrice, ...flags] = cells;
    const category = CATEGORY_ALIASES[rawCategory.toLowerCase()];
    const priceText = rawPrice.replace(/^(?:₹|rs\.?|inr)\s*/i, '').replace(/\/-$/, '');
    const price = Number(priceText);
    if (!name) { errors.push(`${where}: missing name.`); return; }
    if (!category) { errors.push(`${where}: category must be Tea, Coffee, Snacks, Meal or Other.`); return; }
    if (!/^\d+(\.\d{1,2})?$/.test(priceText) || price > 10000) { errors.push(`${where}: price must be a number from 0 to 10000 with up to 2 decimals.`); return; }
    const item = { name, category, price };
    for (const flag of flags.map(f => f.toLowerCase())) {
      if (flag === 'veg') item.veg = true;
      else if (flag === 'non-veg' || flag === 'nonveg') item.veg = false;
      else if (flag === 'unavailable') item.available = false;
      else if (flag) { errors.push(`${where}: unknown flag "${flag}" (use veg, non-veg or unavailable).`); return; }
    }
    items.push(item);
  });
  return { items, removals, errors };
}
