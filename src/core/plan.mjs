import {
  assertISODate,
  compareDates,
  daysInclusive,
  enumerateDates,
  isValidTimeZone,
  todayInTimeZone,
} from './dates.mjs';

export const PLAN_SCHEMA_VERSION = 1;
export const DEFAULT_LIMITS = Object.freeze({
  maxDays: 371,
  maxPerDay: 100,
  maxTotal: 5_000,
});

export function createPlan(input = {}) {
  const timeZone = input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const now = new Date();
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    id: input.id ?? globalThis.crypto?.randomUUID?.() ?? `cc-${now.getTime()}-${Math.random().toString(16).slice(2)}`,
    title: input.title ?? 'Untitled contribution canvas',
    createdAt: input.createdAt ?? now.toISOString(),
    generatorVersion: input.generatorVersion ?? '1.0.0',
    timezone: timeZone,
    range: {
      mode: input.range?.mode ?? 'calendar-year',
      from: input.range?.from,
      to: input.range?.to,
      ...(input.range?.year ? { year: input.range.year } : {}),
    },
    author: input.author ?? null,
    repository: input.repository ?? null,
    commitsByDate: { ...(input.commitsByDate ?? {}) },
    metadata: {
      generatedAsGraphArt: true,
      ...(input.metadata ?? {}),
    },
  };
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function totalCommits(plan) {
  return Object.values(plan?.commitsByDate ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

export function validatePlan(plan, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const errors = [];
  const warnings = [];

  if (!isPlainObject(plan)) return { ok: false, errors: ['Plan must be a JSON object'], warnings, plan: null };
  if (plan.schemaVersion !== PLAN_SCHEMA_VERSION) errors.push(`schemaVersion must be ${PLAN_SCHEMA_VERSION}`);
  if (typeof plan.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{5,127}$/.test(plan.id)) {
    errors.push('Plan id must be 6–128 safe characters');
  }
  if (typeof plan.title !== 'string' || plan.title.length > 160) errors.push('Plan title must be at most 160 characters');
  if (!isValidTimeZone(plan.timezone)) errors.push('Plan timezone must be a valid IANA timezone');
  if (!isPlainObject(plan.range)) errors.push('Plan range is required');

  let dateCount = 0;
  try {
    assertISODate(plan.range?.from, 'range.from');
    assertISODate(plan.range?.to, 'range.to');
    dateCount = daysInclusive(plan.range.from, plan.range.to);
    if (dateCount > limits.maxDays) errors.push(`Plan range exceeds ${limits.maxDays} days`);
  } catch (error) {
    errors.push(error.message);
  }

  if (!isPlainObject(plan.commitsByDate)) {
    errors.push('commitsByDate must be an object');
  } else {
    for (const [date, count] of Object.entries(plan.commitsByDate)) {
      try {
        assertISODate(date, 'commit date');
      } catch (error) {
        errors.push(error.message);
        continue;
      }
      if (plan.range?.from && compareDates(date, plan.range.from) < 0) errors.push(`${date} is before the plan range`);
      if (plan.range?.to && compareDates(date, plan.range.to) > 0) errors.push(`${date} is after the plan range`);
      if (!Number.isInteger(count) || count < 1) errors.push(`${date} must contain a positive integer commit count`);
      if (count > limits.maxPerDay) errors.push(`${date} exceeds the per-day limit of ${limits.maxPerDay}`);
      else if (count > 50) warnings.push(`${date} contains more than 50 generated commits`);
    }
  }

  const total = totalCommits(plan);
  if (total > limits.maxTotal) errors.push(`Plan exceeds the total limit of ${limits.maxTotal} commits`);
  else if (total > 2_000) warnings.push('This plan is very large and can take a long time to generate');
  else if (total > 500) warnings.push('This plan will add more than 500 generated commits');

  if (options.rejectFuture && isValidTimeZone(plan.timezone) && plan.range?.to) {
    const today = todayInTimeZone(plan.timezone, options.now ?? new Date());
    for (const date of Object.keys(plan.commitsByDate ?? {})) {
      if (compareDates(date, today) > 0) errors.push(`${date} is in the future in ${plan.timezone}`);
    }
  }

  if (dateCount && isPlainObject(plan.commitsByDate)) {
    const allowed = new Set(enumerateDates(plan.range.from, plan.range.to));
    for (const date of Object.keys(plan.commitsByDate)) {
      if (!allowed.has(date)) errors.push(`${date} is not part of the selected range`);
    }
  }

  if (plan.metadata?.generatedAsGraphArt !== true) {
    errors.push('metadata.generatedAsGraphArt must be true');
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], total, plan };
}

export function compactPlan(plan) {
  const copy = structuredClone(plan);
  copy.commitsByDate = Object.fromEntries(
    Object.entries(copy.commitsByDate ?? {})
      .filter(([, count]) => Number.isInteger(count) && count > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return copy;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value, spacing = 0) {
  return JSON.stringify(stableValue(value), null, spacing);
}

export function serializePlan(plan, spacing = 2) {
  const result = validatePlan(plan);
  if (!result.ok) throw new TypeError(`Invalid plan: ${result.errors.join('; ')}`);
  return stableStringify(compactPlan(plan), spacing);
}

export function parsePlan(json) {
  let value;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new SyntaxError(`Plan is not valid JSON: ${error.message}`);
  }
  const result = validatePlan(value);
  if (!result.ok) throw new TypeError(`Invalid plan: ${result.errors.join('; ')}`);
  return compactPlan(value);
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : stableStringify(value));
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}

export function setCommitCount(commitsByDate, date, count) {
  assertISODate(date);
  const next = { ...commitsByDate };
  if (!Number.isInteger(count) || count <= 0) delete next[date];
  else next[date] = count;
  return next;
}
