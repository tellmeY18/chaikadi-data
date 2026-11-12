import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { formatPlace, relPathFor } from '../scripts/lib/place.mjs';

export const REPO = new URL('..', import.meta.url).pathname;

export function place(overrides = {}) {
  return {
    schemaVersion: 1, id: 'node/9000000000101', name: 'Test Stall', city: 'in/kl/ernakulam', currency: 'INR',
    menu: [{ id: 'chai', name: 'Chai', category: 'Tea', price: 12, veg: true, available: true }],
    last_confirmed: '2026-11-01', ...overrides,
  };
}

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
