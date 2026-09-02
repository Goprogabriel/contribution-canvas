import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localNoonTimestamp } from '../core/dates.mjs';
import { compactPlan, stableStringify, totalCommits, validatePlan } from '../core/plan.mjs';
import { getViewer, normalizeRepository, preflightRepository } from './github.mjs';
import { run } from './process.mjs';

const ACTIVITY_FILE = path.join('.contribution-canvas', 'activity.ndjson');

async function git(cwd, args, options = {}) {
  return run('git', args, { cwd, timeout: options.timeout ?? 120_000, ...options });
}

async function remoteHead(cwd, branch) {
  const result = await git(cwd, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], {
    allowFailure: true,
    timeout: 30_000,
  });
  if (result.code !== 0 || !result.stdout.trim()) return null;
  return result.stdout.trim().split(/\s+/)[0] ?? null;
}

async function currentHead(cwd) {
  const result = await git(cwd, ['rev-parse', 'HEAD'], { allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

async function planAlreadyApplied(cwd, planId) {
  try {
    const content = await readFile(path.join(cwd, ACTIVITY_FILE), 'utf8');
    return content.split('\n').some((line) => line.includes(`"planId":"${planId}"`));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function prepareCheckout(repository, branch, directory) {
  await run('gh', ['repo', 'clone', repository, directory, '--', '--filter=blob:none', '--no-tags'], {
    timeout: 180_000,
  });
  const baseSha = await remoteHead(directory, branch);
  if (baseSha) {
    await git(directory, ['fetch', '--no-tags', 'origin', branch]);
    const switched = await git(directory, ['switch', branch], { allowFailure: true });
    if (switched.code !== 0) await git(directory, ['switch', '-c', branch, '--track', `origin/${branch}`]);
    await git(directory, ['reset', '--hard', baseSha]);
  } else {
    // An empty GitHub repository has no remote branch yet.
    await git(directory, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
  }
  return baseSha;
}

function safeReceiptName(planId) {
  return planId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function writeReceipt(receipt) {
  const directory = path.join(os.homedir(), '.contribution-canvas', 'receipts');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${safeReceiptName(receipt.planId)}.json`);
  await writeFile(target, `${stableStringify(receipt, 2)}\n`, { mode: 0o600 });
  return target;
}

export async function executePlan(input) {
  const repository = normalizeRepository(input.repository);
  const validation = validatePlan(input.plan, { rejectFuture: true });
  if (!validation.ok) throw new TypeError(`Plan validation failed: ${validation.errors.join('; ')}`);
  const plan = compactPlan(input.plan);
  const count = totalCommits(plan);
  if (!input.dryRun && String(input.confirmation) !== String(count)) {
    throw new Error(`Push confirmation must exactly match the total commit count (${count})`);
  }

  const preflight = await preflightRepository(repository);
  if (!preflight.ok) throw new Error(`Repository preflight failed: ${preflight.errors.join('; ')}`);
  const viewer = await getViewer();
  if (plan.author?.login && plan.author.login.toLowerCase() !== viewer.login.toLowerCase()) {
    throw new Error(`Plan author ${plan.author.login} does not match authenticated account ${viewer.login}`);
  }

  const workRoot = await mkdtemp(path.join(os.tmpdir(), 'contribution-canvas-'));
  const clonePath = path.join(workRoot, 'repository');
  let baseSha = null;
  let finalSha = null;
  let pushed = false;
  const startedAt = new Date().toISOString();

  const progress = (stage, detail) => input.onProgress?.({ stage, detail });

  try {
    progress('clone', `Cloning ${repository}`);
    baseSha = await prepareCheckout(repository, preflight.repository.defaultBranch, clonePath);

    if (await planAlreadyApplied(clonePath, plan.id)) {
      const receipt = {
        schemaVersion: 1,
        planId: plan.id,
        repository,
        defaultBranch: preflight.repository.defaultBranch,
        status: 'already-applied',
        baseSha,
        finalSha: baseSha,
        pushed: false,
        dryRun: Boolean(input.dryRun),
        totalCommits: count,
        startedAt,
        completedAt: new Date().toISOString(),
      };
      return { ...receipt, receiptPath: await writeReceipt(receipt), warnings: preflight.warnings };
    }

    await mkdir(path.join(clonePath, '.contribution-canvas'), { recursive: true });
    const initializeReadme = baseSha === null;
    if (initializeReadme) {
      await writeFile(
        path.join(clonePath, 'README.md'),
        `# Contribution graph art\n\nThis repository contains transparent, automatically generated contribution graph art created with [Contribution Canvas](https://github.com/Goprogabriel/contribution-canvas).\n\nThe commits in this repository are **not presented as ordinary software development work**. Every generated commit includes a graph-art subject, a plan identifier and a \`Generated-By: Contribution Canvas\` trailer.\n\nGitHub determines whether qualifying commits appear on a profile and how final contribution colors are rendered.\n`,
        'utf8',
      );
    }
    await git(clonePath, ['config', 'user.name', viewer.name]);
    await git(clonePath, ['config', 'user.email', viewer.noreplyEmail]);

    const messagePath = path.join(workRoot, 'commit-message.txt');
    const entries = Object.entries(plan.commitsByDate).sort(([left], [right]) => left.localeCompare(right));
    let generated = 0;

    progress('generate', `Generating ${count} transparent graph-art commits`);
    for (const [date, perDay] of entries) {
      const timestamp = localNoonTimestamp(date, plan.timezone);
      for (let index = 1; index <= perDay; index += 1) {
        const logEntry = {
          planId: plan.id,
          date,
          index,
          countForDate: perDay,
          generatedBy: 'Contribution Canvas',
        };
        await appendFile(path.join(clonePath, ACTIVITY_FILE), `${JSON.stringify(logEntry)}\n`, 'utf8');
        const pathsToAdd = generated === 0 && initializeReadme ? [ACTIVITY_FILE, 'README.md'] : [ACTIVITY_FILE];
        await git(clonePath, ['add', '--', ...pathsToAdd]);
        const message = [
          `chore(graph-art): render ${date} pixel ${index}/${perDay}`,
          '',
          `Contribution-Canvas-Plan: ${plan.id}`,
          'Generated-By: Contribution Canvas',
          '',
        ].join('\n');
        await writeFile(messagePath, message, 'utf8');
        await git(clonePath, ['commit', '--no-gpg-sign', '--file', messagePath], {
          env: {
            GIT_AUTHOR_NAME: viewer.name,
            GIT_AUTHOR_EMAIL: viewer.noreplyEmail,
            GIT_AUTHOR_DATE: timestamp,
            GIT_COMMITTER_NAME: viewer.name,
            GIT_COMMITTER_EMAIL: viewer.noreplyEmail,
            GIT_COMMITTER_DATE: timestamp,
          },
        });
        generated += 1;
        if (generated % 100 === 0 || generated === count) {
          progress('generate', `Generated ${generated}/${count} commits`);
        }
      }
    }

    finalSha = await currentHead(clonePath);
    const latestRemoteSha = await remoteHead(clonePath, preflight.repository.defaultBranch);
    if (latestRemoteSha !== baseSha) {
      throw new Error('The remote default branch changed while commits were being generated; no push was attempted');
    }

    if (!input.dryRun) {
      progress('push', 'Pushing once with a normal fast-forward push');
      await git(clonePath, [
        'push',
        '--set-upstream',
        'origin',
        `HEAD:refs/heads/${preflight.repository.defaultBranch}`,
      ], { timeout: 300_000 });
      pushed = true;
      const verifiedRemoteSha = await remoteHead(clonePath, preflight.repository.defaultBranch);
      if (verifiedRemoteSha !== finalSha) throw new Error('Remote verification failed after push');
    }

    const receipt = {
      schemaVersion: 1,
      planId: plan.id,
      title: plan.title,
      repository,
      repositoryUrl: preflight.repository.url,
      defaultBranch: preflight.repository.defaultBranch,
      author: {
        login: viewer.login,
        name: viewer.name,
        email: viewer.noreplyEmail,
      },
      timezone: plan.timezone,
      range: plan.range,
      commitsByDate: plan.commitsByDate,
      totalCommits: count,
      baseSha,
      finalSha,
      pushed,
      dryRun: Boolean(input.dryRun),
      status: input.dryRun ? 'dry-run-complete' : 'push-verified',
      startedAt,
      completedAt: new Date().toISOString(),
      generatedBy: 'Contribution Canvas',
    };
    const receiptPath = await writeReceipt(receipt);
    progress('complete', input.dryRun ? 'Dry run completed; remote unchanged' : 'Push verified');
    return { ...receipt, receiptPath, warnings: preflight.warnings };
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}
