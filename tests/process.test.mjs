import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/git/process.mjs';

test('process runner preserves metacharacters as a single argument', async () => {
  const payload = 'value; echo this-must-not-run && touch /tmp/nope';
  const result = await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', payload]);
  assert.equal(result.stdout, payload);
});

test('process runner returns nonzero results only when explicitly allowed', async () => {
  await assert.rejects(() => run(process.execPath, ['-e', 'process.exit(7)']), /exited with code 7/);
  const result = await run(process.execPath, ['-e', 'process.exit(7)'], { allowFailure: true });
  assert.equal(result.code, 7);
});
