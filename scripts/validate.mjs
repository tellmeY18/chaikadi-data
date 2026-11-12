#!/usr/bin/env node
// Validate place files. Full mode by default; `--changed <base-ref>` validates
// only files changed since the merge base (duplicate ids still checked repo-wide).
// Emits GitHub Actions annotations plus a readable summary.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { validateRepo } from './lib/validate-core.mjs';

const args = process.argv.slice(2);
const root = process.cwd();
let files;
const changedIndex = args.indexOf('--changed');
if (changedIndex >= 0) {
  const base = args[changedIndex + 1] || '';
  // Refs come from the workflow; still refuse anything that looks like an option.
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(base) || base.startsWith('-')) {
    console.error('Usage: validate.mjs --changed <base-ref>'); process.exit(2);
  }
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`, '--', 'places'], { encoding: 'utf8' });
  files = out.split('\n').filter(Boolean);
}

const escapeData = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProp = s => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

const result = validateRepo(root, { files });
for (const { file, message } of result.errors) {
  if (process.env.GITHUB_ACTIONS) console.log(`::error file=${escapeProp(file)},line=1,title=${escapeProp('Invalid place file')}::${escapeData(message)}`);
}
const mode = files ? `changed (${result.checked} of ${result.total} files)` : `full (${result.total} files)`;
const byFile = new Map();
for (const e of result.errors) byFile.set(e.file, [...(byFile.get(e.file) || []), e.message]);
const lines = [`### Place validation: ${mode}`, ''];
if (!result.errors.length) lines.push(`All ${result.checked} checked place file(s) are valid.`);
else {
  lines.push(`${result.errors.length} problem(s) in ${byFile.size} file(s):`, '');
  for (const [file, messages] of byFile) { lines.push(`- \`${file}\``); for (const m of messages) lines.push(`  - ${m}`); }
}
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n\n`);
process.exit(result.errors.length ? 1 : 0);
