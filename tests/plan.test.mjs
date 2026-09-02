import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactPlan,
  createPlan,
  parsePlan,
  serializePlan,
  sha256Hex,
  stableStringify,
  totalCommits,
  validatePlan,
} from '../src/core/plan.mjs';

function fixture(overrides = {}) {
  return createPlan({
    id: 'cc-test-plan-001',
    title: 'Test plan',
    createdAt: '2025-01-01T12:00:00.000Z',
    timezone: 'Europe/Copenhagen',
    range: { mode: 'calendar-year', year: 2025, from: '2025-01-01', to: '2025-12-31' },
    commitsByDate: { '2025-01-02': 1, '2025-01-03': 4 },
    ...overrides,
  });
}

test('accepts a valid plan and calculates exact total', () => {
  const plan = fixture();
  const result = validatePlan(plan, { rejectFuture: true });
  assert.equal(result.ok, true);
  assert.equal(totalCommits(plan), 5);
});

test('rejects dates outside the plan range and invalid counts', () => {
  const plan = fixture({ commitsByDate: { '2024-12-31': 1, '2025-01-02': 0, '2025-01-03': 1.5 } });
  const result = validatePlan(plan);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /before the plan range/);
  assert.match(result.errors.join(' '), /positive integer/);
});

test('rejects future execution dates while retaining them in draft validation', () => {
  const plan = fixture({
    range: { mode: 'calendar-year', year: 2030, from: '2030-01-01', to: '2030-12-31' },
    commitsByDate: { '2030-01-02': 1 },
  });
  assert.equal(validatePlan(plan).ok, true);
  const execution = validatePlan(plan, { rejectFuture: true, now: new Date('2026-09-01T10:00:00Z') });
  assert.equal(execution.ok, false);
  assert.match(execution.errors.join(' '), /future/);
});

test('enforces per-day and total safety limits', () => {
  const tooHigh = fixture({ commitsByDate: { '2025-01-02': 101 } });
  assert.equal(validatePlan(tooHigh).ok, false);
  const tooMany = fixture({ commitsByDate: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`2025-02-${String((index % 28) + 1).padStart(2, '0')}`, 100])) });
  // Repeated dates collapse, so apply a deliberately lower total limit for a deterministic boundary test.
  assert.equal(validatePlan(tooMany, { limits: { maxTotal: 100 } }).ok, false);
});

test('stable serialization is key-order independent and round-trips', async () => {
  const plan = fixture();
  const reordered = { metadata: plan.metadata, commitsByDate: plan.commitsByDate, ...plan };
  assert.equal(stableStringify(plan), stableStringify(reordered));
  const serialized = serializePlan(plan);
  assert.deepEqual(parsePlan(serialized), compactPlan(plan));
  assert.equal(await sha256Hex(plan), await sha256Hex(reordered));
});
