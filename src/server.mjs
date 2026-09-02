import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createEmptyRepository,
  doctor,
  getContributionActivity,
  getViewer,
  listRepositories,
  preflightRepository,
} from './git/github.mjs';
import { executePlan } from './git/executor.mjs';
import { totalCommits, validatePlan } from './core/plan.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(moduleDirectory, '..', 'public');
const coreRoot = path.resolve(moduleDirectory, 'core');
const docsRoot = path.resolve(moduleDirectory, '..', 'docs');
const projectRoot = path.resolve(moduleDirectory, '..');
const MAX_BODY_BYTES = 1_000_000;

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function sendText(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(value),
    'Cache-Control': 'no-store',
  });
  response.end(value);
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJsonBody(request) {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    const error = new Error('Content-Type must be application/json');
    error.statusCode = 415;
    throw error;
  }

  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('Request body is not valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function staticPath(urlPath) {
  if (urlPath === '/' || urlPath === '/index.html') return path.join(publicRoot, 'index.html');
  if (urlPath.startsWith('/core/')) {
    const relative = urlPath.slice('/core/'.length);
    const target = path.resolve(coreRoot, relative);
    if (!target.startsWith(`${coreRoot}${path.sep}`)) return null;
    return target;
  }
  if (urlPath.startsWith('/docs/')) {
    const relative = urlPath.slice('/docs/'.length);
    const target = path.resolve(docsRoot, relative);
    if (!target.startsWith(`${docsRoot}${path.sep}`)) return null;
    return target;
  }
  if (['/README.md', '/README.da.md', '/SECURITY.md', '/LICENSE'].includes(urlPath)) {
    return path.join(projectRoot, urlPath.slice(1));
  }
  const target = path.resolve(publicRoot, `.${urlPath}`);
  if (!target.startsWith(`${publicRoot}${path.sep}`)) return null;
  return target;
}

async function serveStatic(request, response, url) {
  let target = staticPath(decodeURIComponent(url.pathname));
  if (!target) return sendText(response, 404, 'Not found');
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = path.join(target, 'index.html');
    const body = await readFile(target);
    const extension = path.extname(target).toLowerCase();
    response.writeHead(200, {
      'Content-Type': MIME_TYPES.get(extension) ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    response.end(body);
  } catch (error) {
    if (error.code === 'ENOENT') return sendText(response, 404, 'Not found');
    throw error;
  }
}

export async function startLocalServer(options) {
  const sessionToken = options.sessionToken;
  if (typeof sessionToken !== 'string' || sessionToken.length < 32) throw new TypeError('A strong session token is required');
  let activeExecution = false;
  let expectedHost = null;
  let expectedOrigin = null;

  const server = createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    try {
      if (request.headers.host !== expectedHost) return sendText(response, 403, 'Invalid host');
      const url = new URL(request.url, expectedOrigin);

      if (!url.pathname.startsWith('/api/')) return serveStatic(request, response, url);

      const suppliedToken = request.headers['x-contribution-canvas-session'];
      if (!secureEqual(suppliedToken, sessionToken)) return sendJson(response, 401, { error: 'Local session expired or invalid' });
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        if (request.headers.origin !== expectedOrigin) return sendJson(response, 403, { error: 'Invalid request origin' });
      }

      if (request.method === 'GET' && url.pathname === '/api/session') {
        return sendJson(response, 200, { mode: 'local', version: '1.0.0', origin: expectedOrigin });
      }
      if (request.method === 'GET' && url.pathname === '/api/doctor') {
        return sendJson(response, 200, await doctor());
      }
      if (request.method === 'GET' && url.pathname === '/api/github/user') {
        return sendJson(response, 200, await getViewer());
      }
      if (request.method === 'GET' && url.pathname === '/api/github/repos') {
        return sendJson(response, 200, { repositories: await listRepositories() });
      }
      if (request.method === 'GET' && url.pathname === '/api/github/activity') {
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        return sendJson(response, 200, await getContributionActivity(from, to));
      }
      if (request.method === 'POST' && url.pathname === '/api/repository/create') {
        const body = await readJsonBody(request);
        const repository = await createEmptyRepository(body.name, body.visibility ?? 'public');
        return sendJson(response, 201, { repository });
      }
      if (request.method === 'POST' && url.pathname === '/api/repository/preflight') {
        const body = await readJsonBody(request);
        return sendJson(response, 200, await preflightRepository(body.repository));
      }
      if (request.method === 'POST' && url.pathname === '/api/plan/validate') {
        const body = await readJsonBody(request);
        const result = validatePlan(body.plan, { rejectFuture: true });
        return sendJson(response, result.ok ? 200 : 400, result);
      }
      if (request.method === 'POST' && ['/api/plan/dry-run', '/api/plan/apply'].includes(url.pathname)) {
        if (activeExecution) return sendJson(response, 409, { error: 'Another plan execution is already active' });
        const body = await readJsonBody(request);
        const dryRun = url.pathname.endsWith('/dry-run');
        if (!dryRun && String(body.confirmation) !== String(totalCommits(body.plan))) {
          return sendJson(response, 400, { error: 'Confirmation must exactly match the total commit count' });
        }
        activeExecution = true;
        try {
          const result = await executePlan({
            plan: body.plan,
            repository: body.repository,
            confirmation: body.confirmation,
            dryRun,
          });
          return sendJson(response, 200, result);
        } finally {
          activeExecution = false;
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/profile/recheck') {
        const body = await readJsonBody(request);
        return sendJson(response, 200, await getContributionActivity(body.from, body.to));
      }

      return sendJson(response, 404, { error: 'Unknown API route' });
    } catch (error) {
      const status = Number(error.statusCode) || (error.name === 'TypeError' || error.name === 'RangeError' ? 400 : 500);
      const safeMessage = status >= 500 ? 'The local operation failed. Check the terminal for details.' : error.message;
      if (status >= 500) console.error(`[Contribution Canvas] ${error.name}: ${error.message}`);
      return sendJson(response, status, { error: safeMessage });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  expectedHost = `127.0.0.1:${port}`;
  expectedOrigin = `http://${expectedHost}`;

  return {
    server,
    port,
    origin: expectedOrigin,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
