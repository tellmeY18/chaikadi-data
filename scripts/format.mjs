#!/usr/bin/env node
// Rewrite every place file in canonical form. Only formatting changes:
// key order, 2-space indent, LF and a final newline.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listPlaceFiles } from './lib/validate-core.mjs';
import { formatPlace } from './lib/place.mjs';

let changed = 0;
for (const file of listPlaceFiles(process.cwd())) {
  const path = join(process.cwd(), file);
  const text = readFileSync(path, 'utf8');
  let place;
  try { place = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { console.error(`Skipped invalid JSON: ${file}`); continue; }
  const next = formatPlace(place);
  if (next !== text) { writeFileSync(path, next); changed++; console.log(`formatted ${file}`); }
}
console.log(`${changed} file(s) reformatted.`);
