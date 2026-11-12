import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { formatPlace, relPathFor } from '../scripts/lib/place.mjs';

export const REPO = new URL('..', import.meta.url).pathname;

export function place(overrides = {}) {
  return {
    schemaVersion: 2, id: 'test-stall', name: 'Test Stall', city: 'in/kl/ernakulam',
    osm: { type: 'node', id: 9000000000101, relation: 'is' }, currency: 'INR',
    sections: [{ id: 'tea', name: 'Tea', items: [{ id: 'chai', name: 'Chai', category: 'Tea', price: 12, diet: 'veg' }] }],
    last_confirmed: '2026-11-01', ...overrides,
  };
}
export const withItems = (items, overrides = {}) => place({ sections: [{ id: 'menu', name: 'Menu', items }], ...overrides });

// A throwaway repo containing only the given place files (or raw text files).
export function tempRepo(files = []) {
  const root = mkdtempSync(join(tmpdir(), 'chaikadi-data-test-'));
  for (const entry of files) {
    const rel = entry.path || relPathFor(entry.place);
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, entry.text ?? formatPlace(entry.place));
  }
  return root;
}

export function sampleRepo() {
  const root = mkdtempSync(join(tmpdir(), 'chaikadi-data-sample-'));
  cpSync(join(REPO, 'places'), join(root, 'places'), { recursive: true });
  return root;
}
