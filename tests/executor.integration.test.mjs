import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { executePlan } from '../src/git/executor.mjs';
import { createPlan } from '../src/core/plan.mjs';

const skip = process.platform === 'win32' ? 'Integration fixture uses a POSIX fake gh executable' : false;

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function fixturePlan(id, commitsByDate) {
  return createPlan({
    id,
    title: 'Integration graph art',
    createdAt: '2025-01-01T12:00:00.000Z',
    timezone: 'Europe/Copenhagen',
    range: { mode: 'calendar-year', year: 2025, from: '2025-01-01', to: '2025-12-31' },
    commitsByDate,
  });
}

async function createBareRepository(root, seeded = false) {
  const remote = path.join(root, 'remote.git');
  git(['init', '--bare', '--initial-branch=main', remote]);
  git(['--git-dir', remote, 'config', 'core.logAllRefUpdates', 'true']);
  if (seeded) {
    const seed = path.join(root, 'seed');
    git(['clone', remote, seed]);
    git(['-C', seed, 'config', 'user.name', 'Seed User']);
    git(['-C', seed, 'config', 'user.email', 'seed@example.test']);
    await writeFile(path.join(seed, 'seed.txt'), 'seed\n');
    git(['-C', seed, 'add', 'seed.txt']);
    git(['-C', seed, 'commit', '-m', 'seed repository']);
    git(['-C', seed, 'push', 'origin', 'main']);
  }
  return remote;
}

async function installFakeGh(root, remote) {
  const bin = path.join(root, 'bin');
  await mkdir(bin, { recursive: true });
  const target = path.join(bin, 'gh');
  const source = `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const remote = process.env.FAKE_GH_REMOTE;
function output(value) { process.stdout.write(JSON.stringify(value)); }
if (args[0] === 'api' && args[1] === 'user') {
  output({ id: 424242, login: 'canvas-tester', name: 'Canvas Tester', avatar_url: '', html_url: 'https://github.com/canvas-tester', created_at: '2020-01-01T00:00:00Z' });
} else if (args[0] === 'api' && args[1]?.includes('/branches/') && args[1]?.endsWith('/protection')) {
  process.stderr.write('not protected'); process.exit(1);
} else if (args[0] === 'api' && args[1]?.startsWith('repos/')) {
  output({ id: 7, full_name: 'canvas-tester/graph-art', visibility: 'public', private: false, fork: false, archived: false, disabled: false, default_branch: 'main', size: Number(process.env.FAKE_REPO_SIZE || 0), html_url: 'https://github.com/canvas-tester/graph-art', permissions: { push: true } });
} else if (args[0] === 'repo' && args[1] === 'clone') {
  const result = spawnSync('git', ['clone', remote, args[3]], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else {
  process.stderr.write('unsupported fake gh command: ' + args.join(' ')); process.exit(2);
}
`;
  await writeFile(target, source);
  await chmod(target, 0o755);
  return bin;
}

async function withEnvironment(callback, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-executor-test-'));
  const remote = await createBareRepository(root, Boolean(options.seeded));
  const bin = await installFakeGh(root, remote);
  const previous = { PATH: process.env.PATH, HOME: process.env.HOME, remote: process.env.FAKE_GH_REMOTE, size: process.env.FAKE_REPO_SIZE };
  process.env.PATH = `${bin}${path.delimiter}${previous.PATH}`;
  process.env.HOME = path.join(root, 'home');
  process.env.FAKE_GH_REMOTE = remote;
  process.env.FAKE_REPO_SIZE = options.seeded ? '1' : '0';
  await mkdir(process.env.HOME, { recursive: true });
  try {
    return await callback({ root, remote });
  } finally {
    process.env.PATH = previous.PATH;
    if (previous.HOME === undefined) delete process.env.HOME; else process.env.HOME = previous.HOME;
    if (previous.remote === undefined) delete process.env.FAKE_GH_REMOTE; else process.env.FAKE_GH_REMOTE = previous.remote;
    if (previous.size === undefined) delete process.env.FAKE_REPO_SIZE; else process.env.FAKE_REPO_SIZE = previous.size;
    await rm(root, { recursive: true, force: true });
  }
}

test('dry-run generates real local commits but leaves remote empty', { skip }, async () => {
  await withEnvironment(async ({ remote }) => {
    const plan = fixturePlan('cc-dry-run-001', { '2025-01-05': 2 });
    const result = await executePlan({ plan, repository: 'canvas-tester/graph-art', dryRun: true });
    assert.equal(result.status, 'dry-run-complete');
    assert.equal(result.pushed, false);
    assert.equal(result.totalCommits, 2);
    assert.throws(() => git(['--git-dir', remote, 'show-ref']), /Command failed/);
  });
});

test('executor creates correctly attributed historical commits with one push and is idempotent', { skip }, async () => {
  await withEnvironment(async ({ remote }) => {
    const plan = fixturePlan('cc-integration-001', { '2025-01-05': 2, '2025-07-05': 1 });
    const first = await executePlan({
      plan,
      repository: 'canvas-tester/graph-art',
      dryRun: false,
      confirmation: '3',
    });
    assert.equal(first.status, 'push-verified');
    assert.equal(first.pushed, true);
    assert.equal(git(['--git-dir', remote, 'rev-list', '--count', 'main']), '3');

    const lines = git(['--git-dir', remote, 'log', '--format=%aI|%cI|%ae|%s', 'main']).split('\n');
    assert.equal(lines.length, 3);
    assert.ok(lines.every((line) => line.includes('424242+canvas-tester@users.noreply.github.com')));
    assert.ok(lines.some((line) => line.includes('2025-01-05T12:00:00+01:00')));
    assert.ok(lines.some((line) => line.includes('2025-07-05T12:00:00+02:00')));
    assert.ok(lines.every((line) => line.includes('chore(graph-art): render')));
    const body = git(['--git-dir', remote, 'log', '-1', '--format=%B', 'main']);
    assert.match(body, /Generated-By: Contribution Canvas/);
    assert.match(body, /Contribution-Canvas-Plan: cc-integration-001/);
    assert.equal(git(['--git-dir', remote, 'reflog', 'show', '--format=%H', 'refs/heads/main']).split('\n').filter(Boolean).length, 1);

    const second = await executePlan({
      plan,
      repository: 'canvas-tester/graph-art',
      dryRun: false,
      confirmation: '3',
    });
    assert.equal(second.status, 'already-applied');
    assert.equal(second.pushed, false);
    assert.equal(git(['--git-dir', remote, 'rev-list', '--count', 'main']), '3');
    assert.equal(git(['--git-dir', remote, 'reflog', 'show', '--format=%H', 'refs/heads/main']).split('\n').filter(Boolean).length, 1);
  });
});

test('executor aborts without graph-art push when the remote changes during generation', { skip }, async () => {
  await withEnvironment(async ({ root, remote }) => {
    const attacker = path.join(root, 'attacker');
    git(['clone', remote, attacker]);
    git(['-C', attacker, 'config', 'user.name', 'Concurrent Writer']);
    git(['-C', attacker, 'config', 'user.email', 'writer@example.test']);
    let changed = false;
    const plan = fixturePlan('cc-race-check-001', { '2025-02-02': 1 });

    await assert.rejects(
      () => executePlan({
        plan,
        repository: 'canvas-tester/graph-art',
        dryRun: false,
        confirmation: '1',
        onProgress: ({ stage, detail }) => {
          if (!changed && stage === 'generate' && detail === 'Generated 1/1 commits') {
            changed = true;
            execFileSync(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(path.join(attacker, 'race.txt'))}, 'race\\n')`]);
            git(['-C', attacker, 'add', 'race.txt']);
            git(['-C', attacker, 'commit', '-m', 'concurrent remote change']);
            git(['-C', attacker, 'push', 'origin', 'main']);
          }
        },
      }),
      /remote default branch changed/,
    );
    assert.equal(changed, true);
    assert.equal(git(['--git-dir', remote, 'rev-list', '--count', 'main']), '2');
    assert.doesNotMatch(git(['--git-dir', remote, 'log', '--format=%s', 'main']), /graph-art/);
  }, { seeded: true });
});
