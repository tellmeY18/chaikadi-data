#!/usr/bin/env node
// Markdown report of menus whose prices were not confirmed recently.
//   node scripts/stale-report.mjs [--days 180] [--date YYYY-MM-DD] [--out report.md]
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateRepo } from './lib/validate-core.mjs';
import { daysBetween, freshness, titleCase, todayUTC } from './lib/place.mjs';

export function staleReport(places, { days = 180, date = todayUTC() } = {}) {
  const old = places.map(p => ({ ...p, age: daysBetween(p.last_confirmed, date), status: freshness(p.last_confirmed, date) }))
    .filter(p => p.age >= days)
    .sort((a, b) => a.city.localeCompare(b.city) || b.age - a.age || a.id.localeCompare(b.id));
  const lines = ['<!-- chaikadi-stale-report -->', `Menus not confirmed in ${days}+ days, as of ${date}.`, ''];
  if (!old.length) lines.push('Nothing stale. Thank you, volunteers.');
  const cities = [...new Set(old.map(p => p.city))];
  for (const city of cities) {
    lines.push(`### ${titleCase(city.split('/')[2])} (\`${city}\`)`, '', '| Place | ID | Last confirmed | Age | Status |', '| --- | --- | --- | --- | --- |');
    for (const p of old.filter(x => x.city === city)) {
      const name = p.name.replace(/[|\\`*_[\]<>]/g, c => `\\${c}`);
      lines.push(`| ${name}${p.sample ? ' (sample)' : ''} | \`${p.id}\` | ${p.last_confirmed} | ${p.age} days | ${p.status === 'unverified' ? 'Not confirmed recently' : 'Prices may be old'} |`);
    }
    lines.push('');
  }
  lines.push('', 'Saw one of these recently? Open an **Update menu** issue with the date you saw the prices.');
  return `${lines.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const date = arg('--date') || todayUTC();
  const days = Number(arg('--days') || 180);
  if (!Number.isInteger(days) || days < 1) { console.error('--days must be a positive integer'); process.exit(2); }
  const { places, errors } = validateRepo(process.cwd(), { today: date });
  if (errors.length) console.error(`Warning: ${errors.length} validation problem(s); invalid files are skipped.`);
  const report = staleReport(places, { days, date });
  if (arg('--out')) writeFileSync(arg('--out'), report); else process.stdout.write(report);
}
