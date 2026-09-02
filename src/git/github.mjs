import { run, commandVersion } from './process.mjs';
import { assertISODate } from '../core/dates.mjs';

export function normalizeRepository(value) {
  const repository = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new TypeError('Repository must use owner/name format');
  }
  return repository;
}

async function ghJson(args, options = {}) {
  const result = await run('gh', args, {
    ...options,
    timeout: options.timeout ?? 30_000,
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('GitHub CLI returned an unexpected response');
  }
}

export async function doctor() {
  const [node, git, gh] = await Promise.all([
    Promise.resolve({ available: true, version: process.version }),
    commandVersion('git'),
    commandVersion('gh'),
  ]);
  const auth = gh.available
    ? await run('gh', ['auth', 'status', '--hostname', 'github.com'], {
        allowFailure: true,
        timeout: 15_000,
      })
    : { code: 1, stdout: '', stderr: 'GitHub CLI is not installed' };

  return {
    ok: node.available && git.available && gh.available && auth.code === 0,
    node,
    git,
    gh,
    githubAuth: {
      ok: auth.code === 0,
      message: auth.code === 0 ? 'Authenticated with GitHub CLI' : auth.stderr.trim().split('\n')[0],
    },
  };
}

export async function getViewer() {
  const user = await ghJson(['api', 'user']);
  return {
    id: Number(user.id),
    login: user.login,
    name: user.name || user.login,
    avatarUrl: user.avatar_url,
    profileUrl: user.html_url,
    createdAt: user.created_at,
    noreplyEmail: `${user.id}+${user.login}@users.noreply.github.com`,
  };
}

export async function listRepositories() {
  const repositories = await ghJson([
    'api',
    'user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member',
  ]);
  return repositories.map((repository) => ({
    id: repository.id,
    name: repository.name,
    nameWithOwner: repository.full_name,
    visibility: repository.visibility,
    isPrivate: repository.private,
    isFork: Boolean(repository.fork),
    isArchived: Boolean(repository.archived),
    isDisabled: Boolean(repository.disabled),
    defaultBranch: repository.default_branch,
    pushedAt: repository.pushed_at,
    url: repository.html_url,
    canPush: Boolean(repository.permissions?.push),
  }));
}

export async function getContributionActivity(from, to) {
  assertISODate(from, 'from');
  assertISODate(to, 'to');
  const query = `
    query ContributionCanvas($from: DateTime!, $to: DateTime!) {
      viewer {
        login
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
                contributionLevel
                color
                weekday
              }
            }
          }
        }
      }
    }
  `;
  const data = await ghJson([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-F',
    `from=${from}T00:00:00Z`,
    '-F',
    `to=${to}T23:59:59Z`,
  ]);
  const calendar = data.data?.viewer?.contributionsCollection?.contributionCalendar;
  if (!calendar) throw new Error('GitHub did not return a contribution calendar');
  const days = calendar.weeks.flatMap((week) => week.contributionDays);
  return {
    login: data.data.viewer.login,
    totalContributions: calendar.totalContributions,
    days,
  };
}

export async function repositoryMetadata(repository) {
  const normalized = normalizeRepository(repository);
  const data = await ghJson(['api', `repos/${normalized}`]);
  return {
    id: data.id,
    nameWithOwner: data.full_name,
    visibility: data.visibility,
    isPrivate: data.private,
    isFork: Boolean(data.fork),
    isArchived: Boolean(data.archived),
    isDisabled: Boolean(data.disabled),
    defaultBranch: data.default_branch || 'main',
    canPush: Boolean(data.permissions?.push),
    size: Number(data.size || 0),
    empty: Number(data.size || 0) === 0,
    url: data.html_url,
  };
}

export async function preflightRepository(repository) {
  const metadata = await repositoryMetadata(repository);
  const errors = [];
  const warnings = [];
  if (!metadata.canPush) errors.push('The authenticated GitHub account does not have push access');
  if (metadata.isFork) errors.push('Forks are not eligible for generated contribution commits');
  if (metadata.isArchived) errors.push('The repository is archived');
  if (metadata.isDisabled) errors.push('The repository is disabled');
  if (metadata.isPrivate) warnings.push('Private activity is only visible when private contributions are enabled on the profile');
  if (!metadata.empty) warnings.push('A dedicated graph-art repository is safer than a repository containing normal development history');

  const branchResponse = await run(
    'gh',
    ['api', `repos/${metadata.nameWithOwner}/branches/${encodeURIComponent(metadata.defaultBranch)}/protection`],
    { allowFailure: true, timeout: 20_000 },
  );
  if (branchResponse.code === 0) warnings.push('The default branch has protection rules that may reject a direct push');

  return { ok: errors.length === 0, errors, warnings, repository: metadata };
}

export async function createEmptyRepository(name, visibility = 'public') {
  const safeName = String(name ?? '').trim();
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(safeName)) {
    throw new TypeError('Repository name may only contain letters, numbers, dots, underscores and hyphens');
  }
  if (!['public', 'private', 'internal'].includes(visibility)) throw new TypeError('Invalid repository visibility');
  const flag = `--${visibility}`;
  await run('gh', [
    'repo',
    'create',
    safeName,
    flag,
    '--description',
    'Transparent contribution graph art generated with Contribution Canvas.',
  ], { timeout: 60_000 });
  const viewer = await getViewer();
  return repositoryMetadata(`${viewer.login}/${safeName}`);
}
