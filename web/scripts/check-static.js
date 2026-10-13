import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const forbidden = [
  ['/', 'workspace'].join(''),
  ['local', 'host'].join(''),
  ['127.', '0.0.1'].join(''),
  ['file', ':'].join(''),
  [':87', '66'].join(''),
];

const textExt = new Set(['.js', '.gs', '.md', '.html', '.css', '.json', '.yml', '.yaml', '.svg', '.txt']);
const skip = new Set(['.git', 'node_modules']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (textExt.has(path.extname(name))) out.push(full);
  }
  return out;
}

const files = walk(root);
const hits = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const token of forbidden) {
    if (text.includes(token)) hits.push(`${path.relative(root, file)} contains a forbidden string`);
  }
}

const webFiles = files.filter((file) => file.includes(`${path.sep}web${path.sep}`));
const deployment = /macros\/s\/[A-Za-z0-9_-]{20,}/;
for (const file of webFiles) {
  const text = readFileSync(file, 'utf8');
  if (deployment.test(text)) hits.push(`${path.relative(root, file)} hardcodes an Apps Script deployment`);
  if (/['"]token['"]\s*:\s*['"][^'"]+['"]/.test(text)) hits.push(`${path.relative(root, file)} hardcodes a token`);
}

const api = readFileSync(path.join(root, 'web/js/api.js'), 'utf8');
if (!api.includes("'Content-Type': 'text/plain'")) hits.push('api.js must POST as text/plain');
if (!api.includes("redirect: 'follow'")) hits.push('api.js must follow Apps Script redirects');
if (!api.includes('localStorage')) hits.push('api.js must keep the endpoint in localStorage');

const html = readFileSync(path.join(root, 'web/index.html'), 'utf8');
if (!html.includes('./js/main.js')) hits.push('index.html must load the module with a relative path');
if (!html.includes('lang="zh-Hant"')) hits.push('index.html must be Traditional Chinese');

const syntax = files.filter((file) => ['.js', '.gs'].includes(path.extname(file)));
const scratch = mkdtempSync(path.join(tmpdir(), 'pf-syntax-'));
try {
  for (const file of syntax) {
    let target = file;
    if (path.extname(file) === '.gs') {
      target = path.join(scratch, `${path.basename(file)}.js`);
      writeFileSync(target, readFileSync(file));
    }
    const result = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
    if (result.status !== 0) hits.push(`${path.relative(root, file)} failed syntax check\n${result.stderr}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (hits.length) {
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log(`checked ${files.length} files`);
