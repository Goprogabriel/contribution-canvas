#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { startLocalServer } from '../src/server.mjs';
import { doctor } from '../src/git/github.mjs';
import { executePlan } from '../src/git/executor.mjs';
import { parsePlan, totalCommits, validatePlan } from '../src/core/plan.mjs';

function printHelp() {
  console.log(`
Contribution Canvas — local-first GitHub contribution graph art

Usage:
  contribution-canvas studio [--port 4173] [--no-open]
  contribution-canvas doctor
  contribution-canvas validate <plan.json>
  contribution-canvas preview <plan.json>
  contribution-canvas apply <plan.json> --repo owner/name --dry-run
  contribution-canvas apply <plan.json> --repo owner/name --confirm <total>

The hosted GitHub Pages site is a safe demo. GitHub access and pushes happen only
inside this local process through the authenticated GitHub CLI.
`);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function openBrowser(url) {
  const platform = process.platform;
  let command;
  let args;
  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }
  const child = spawn(command, args, { stdio: 'ignore', detached: true, shell: false, windowsHide: true });
  child.unref();
  child.on('error', () => {});
}

async function loadPlan(filename) {
  if (!filename) throw new Error('A plan JSON file is required');
  return parsePlan(await readFile(filename, 'utf8'));
}

async function studio(args) {
  const portValue = option(args, '--port');
  const port = portValue === undefined ? 0 : Number(portValue);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be a valid TCP port');
  const sessionToken = randomBytes(32).toString('base64url');
  const local = await startLocalServer({ port, sessionToken });
  const url = `${local.origin}/?cc_session=${encodeURIComponent(sessionToken)}`;

  console.log(`\nContribution Canvas is running locally at:\n${local.origin}\n`);
  console.log('GitHub credentials remain inside the gh CLI and are never sent to the browser.');
  console.log('Press Ctrl+C to stop.\n');

  if (!args.includes('--no-open')) await openBrowser(url);
  const shutdown = async () => {
    await local.close().catch(() => {});
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift() ?? 'studio';

  if (['help', '--help', '-h'].includes(command)) return printHelp();
  if (command === 'studio') return studio(args);
  if (command === 'doctor') {
    const result = await doctor();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (command === 'validate') {
    const plan = await loadPlan(args[0]);
    const result = validatePlan(plan, { rejectFuture: true });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (command === 'preview') {
    const plan = await loadPlan(args[0]);
    console.log(`Plan: ${plan.title}`);
    console.log(`Range: ${plan.range.from} → ${plan.range.to}`);
    console.log(`Timezone: ${plan.timezone}`);
    console.log(`Active days: ${Object.keys(plan.commitsByDate).length}`);
    console.log(`Generated commits: ${totalCommits(plan)}`);
    return;
  }
  if (command === 'apply') {
    const plan = await loadPlan(args[0]);
    const repository = option(args, '--repo');
    const dryRun = args.includes('--dry-run');
    const confirmation = option(args, '--confirm');
    if (!repository) throw new Error('--repo owner/name is required');
    const result = await executePlan({
      plan,
      repository,
      dryRun,
      confirmation,
      onProgress: ({ detail }) => console.log(detail),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`\nError: ${error.message}\n`);
  process.exitCode = 1;
});
