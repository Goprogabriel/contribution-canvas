import { spawn } from 'node:child_process';

export class ProcessError extends Error {
  constructor(command, args, result) {
    const safeCommand = [command, ...args].join(' ');
    super(`${safeCommand} exited with code ${result.code}${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
    this.name = 'ProcessError';
    this.command = command;
    this.args = args;
    this.code = result.code;
    this.stdout = result.stdout;
    this.stderr = result.stderr;
  }
}

export function run(command, args = [], options = {}) {
  if (typeof command !== 'string' || !command) throw new TypeError('command is required');
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    throw new TypeError('command arguments must be an array of strings');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const maxOutput = options.maxOutput ?? 10 * 1024 * 1024;

    const timer = options.timeout
      ? setTimeout(() => {
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
        }, options.timeout)
      : null;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (stdout.length < maxOutput) stdout += chunk.slice(0, maxOutput - stdout.length);
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < maxOutput) stderr += chunk.slice(0, maxOutput - stderr.length);
    });

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const result = { code: code ?? 1, signal, stdout, stderr };
      if (result.code !== 0 && !options.allowFailure) reject(new ProcessError(command, args, result));
      else resolve(result);
    });
  });
}

export async function commandVersion(command, args = ['--version']) {
  const result = await run(command, args, { allowFailure: true, timeout: 10_000 });
  return {
    available: result.code === 0,
    version: (result.stdout || result.stderr).trim().split('\n')[0] || null,
  };
}
