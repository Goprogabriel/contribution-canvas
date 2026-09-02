import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  assertISODate,
  createContributionGrid,
  daysInclusive,
  localNoonTimestamp,
  rangeForCalendarYear,
  rangeForRollingYear,
  startOfWeek,
  todayInTimeZone,
  weekday,
} from '../src/core/dates.mjs';

test('validates real ISO dates and rejects impossible leap dates', () => {
  assert.equal(assertISODate('2024-02-29'), '2024-02-29');
  assert.throws(() => assertISODate('2025-02-29'), /real calendar date/);
  assert.throws(() => assertISODate('02-29-2024'), /YYYY-MM-DD/);
});

test('adds days across month and year boundaries', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-12-31', 1), '2025-01-01');
  assert.equal(addDays('2025-01-01', -1), '2024-12-31');
});

test('calendar-year ranges include leap days exactly once', () => {
  const leap = rangeForCalendarYear(2024);
  const normal = rangeForCalendarYear(2025);
  assert.equal(daysInclusive(leap.from, leap.to), 366);
  assert.equal(daysInclusive(normal.from, normal.to), 365);
});

test('rolling ranges contain exactly 365 inclusive dates', () => {
  const range = rangeForRollingYear('2026-09-01');
  assert.equal(range.from, '2025-09-02');
  assert.equal(daysInclusive(range.from, range.to), 365);
});

test('contribution grid uses Sunday row zero and full week columns', () => {
  const grid = createContributionGrid('2025-01-01', '2025-12-31');
  assert.equal(weekday(grid.gridFrom), 0);
  assert.equal(weekday(grid.gridTo), 6);
  assert.equal(startOfWeek('2025-01-01'), grid.gridFrom);
  assert.equal(grid.weeks.every((week) => week.length === 7), true);
  const januaryFirst = grid.weeks.flat().find((cell) => cell.date === '2025-01-01');
  assert.equal(januaryFirst.row, 3);
  assert.equal(januaryFirst.inRange, true);
});

test('local noon keeps Copenhagen date on both sides of DST', () => {
  assert.equal(localNoonTimestamp('2026-01-15', 'Europe/Copenhagen'), '2026-01-15T12:00:00+01:00');
  assert.equal(localNoonTimestamp('2026-07-15', 'Europe/Copenhagen'), '2026-07-15T12:00:00+02:00');
  assert.equal(localNoonTimestamp('2026-03-29', 'Europe/Copenhagen'), '2026-03-29T12:00:00+02:00');
  assert.equal(localNoonTimestamp('2026-10-25', 'Europe/Copenhagen'), '2026-10-25T12:00:00+01:00');
});

test('todayInTimeZone respects positive and negative offsets', () => {
  const instant = new Date('2026-01-01T00:30:00Z');
  assert.equal(todayInTimeZone('Pacific/Honolulu', instant), '2025-12-31');
  assert.equal(todayInTimeZone('Asia/Tokyo', instant), '2026-01-01');
});
