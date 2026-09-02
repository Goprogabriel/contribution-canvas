import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePlan } from '../src/core/plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['bin', 'src', 'public/assets', 'scripts', 'tests'];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else files.push(target);
  }
  return files;
}

function checkSyntax(filename) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', filename], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(error.trim() || `Syntax check failed for ${filename}`))));
  });
}

const files = (
  await Promise.all(sourceRoots.map((directory) => walk(path.join(root, directory))))
).flat();
const scripts = files.filter((filename) => /\.(?:m?js)$/.test(filename));
for (const filename of scripts) await checkSyntax(filename);

const privilegedSource = await Promise.all(
  (await walk(path.join(root, 'src'))).filter((filename) => /\.mjs$/.test(filename)).map((filename) => readFile(filename, 'utf8')),
);
const joined = privilegedSource.join('\n');
const forbidden = [
  ['force push flag', /git[^\n]{0,120}(?:--force|-f\b)/i],
  ['token extraction command', /gh["'`,\]\s]+auth["'`,\]\s]+token/i],
  ['shell-enabled child process', /shell\s*:\s*true/],
];
for (const [label, pattern] of forbidden) {
  if (pattern.test(joined)) throw new Error(`Security invariant failed: ${label}`);
}

const appSource = await readFile(path.join(root, 'public', 'assets', 'app.js'), 'utf8');
if (/\.innerHTML\s*=/.test(appSource)) throw new Error('Frontend must not assign user-controlled innerHTML');
const html = await readFile(path.join(root, 'public', 'index.html'), 'utf8');
if (/<script(?![^>]*\bsrc=)/i.test(html)) throw new Error('Inline scripts are not allowed');

parsePlan(await readFile(path.join(root, 'examples', 'hello-2025.json'), 'utf8'));
console.log(`Checked ${scripts.length} JavaScript files and project security invariants.`);
