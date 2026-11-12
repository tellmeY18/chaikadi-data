// Parse GitHub issue-form bodies. Everything here is UNTRUSTED user input:
// never pass it to a shell; only return plain values validated afterwards.

// Labels must match .github/ISSUE_TEMPLATE/*.yml (a test checks this).
export const ADD_PLACE = {
  label: 'add-place',
  fields: {
    name: 'Place name', localName: 'Name in the local script', kind: 'Kind of place', city: 'City',
    osm: 'OpenStreetMap link or ID', relation: 'How the OpenStreetMap object relates to the place',
    building: 'Building or landmark', floor: 'Floor or unit', area: 'Area or locality', postcode: 'Postcode',
    tax: 'Taxes', items: 'Menu', menuJson: 'Menu JSON', seen: 'Date the prices were seen', source: 'How you saw the prices',
    wikidata: 'Wikidata ID', consent: 'Licence',
  },
};
export const UPDATE_MENU = {
  label: 'update-menu',
  fields: { placeId: 'Place ID', changes: 'Changes', seen: 'Date the prices were seen', source: 'How you saw the prices', consent: 'Licence' },
};
export const CONSENT_TEXT = 'I made this data myself and release it under CC0';
export const MAX_BODY = 60000;

export const RELATIONS = {
  'This object is the place': 'is', 'The place is inside this building or site': 'inside', 'The nearest landmark': 'near', 'No OpenStreetMap object yet': null,
};
export const KINDS = {
  'Tea stall': 'tea-stall', 'Cafe': 'cafe', 'Restaurant': 'restaurant', 'Canteen': 'canteen', 'Bakery': 'bakery', 'Juice shop': 'juice-shop',
  'Food court stall': 'food-court-stall', 'Hotel (local eatery)': 'hotel', 'Other': 'other',
};
export const TAXES = { 'Prices include taxes': true, 'Taxes are extra': false, 'Not stated': null };
export const SOURCES = { 'In person': 'in-person', 'Printed menu': 'printed-menu', 'Menu board': 'menu-board', 'Bill': 'bill' };

// GitHub renders each field as "### <label>". Menu text may itself contain
// "### Subsection" lines, so only the form's own labels start a new field.
export function parseIssueBody(body, labels) {
  const text = String(body || '').slice(0, MAX_BODY).replace(/\r\n?/g, '\n');
  const known = labels ? new Set(labels) : null;
  const sections = {};
  let current = null, buffer = [];
  const flush = () => { if (current !== null) { const value = buffer.join('\n').trim(); sections[current] = value === '_No response_' ? '' : value; } };
  for (const line of text.split('\n')) {
    const m = line.match(/^### +(.+?) *$/);
    if (m && (!known || known.has(m[1].trim()))) { flush(); current = m[1].trim(); buffer = []; }
    else if (current !== null) buffer.push(line);
  }
  flush();
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
  return m ? { type: m[1].toLowerCase(), id: Number(m[2]) } : null;
}

// "in/kl/ernakulam/place-id", optionally as a places/... path with .json.
export function parsePlaceRef(value) {
  const v = String(value || '').trim().replace(/^places\//, '').replace(/\.json$/, '');
  const m = v.match(/^([a-z]{2}\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
  return m ? { city: m[1], id: m[2] } : null;
}

// Strip a ```json fence around pasted JSON.
export function unfence(text) {
  return String(text || '').trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
}
