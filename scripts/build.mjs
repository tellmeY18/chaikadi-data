#!/usr/bin/env node
// Build dist/ for static hosting.
//   node scripts/build.mjs [--date YYYY-MM-DD] [--commit <sha>] [--out dist]
// Defaults: BUILD_DATE or today (UTC), GITHUB_SHA or `git rev-parse HEAD`.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildDist } from './lib/build-core.mjs';
import { todayUTC } from './lib/place.mjs';

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
let commit = arg('--commit') || process.env.GITHUB_SHA;
if (!commit) { try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { commit = 'unknown'; } }
try {
  const manifest = buildDist({ root: process.cwd(), outDir: resolve(arg('--out') || 'dist'), date: arg('--date') || process.env.BUILD_DATE || todayUTC(), commit });
  for (const c of manifest.cities) console.log(`${c.id}: ${c.placeCount} place(s), ${(c.bytes / 1024).toFixed(1)} KB, sha256 ${c.sha256.slice(0, 12)}…`);
  console.log(`Built ${manifest.cities.length} city bundle(s) as of ${manifest.generatedAt}.`);
} catch (error) {
  console.error(`Build failed: ${error.message}`);
  for (const d of error.details || []) console.error(`- ${d.file}: ${d.message}`);
  process.exit(1);
}
