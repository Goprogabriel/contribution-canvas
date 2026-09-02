const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertISODate(value, label = 'date') {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new TypeError(`${label} must use YYYY-MM-DD format`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`${label} is not a real calendar date`);
  }
  return value;
}

export function parseISODate(value) {
  assertISODate(value);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatISODate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('A valid Date is required');
  }
  return date.toISOString().slice(0, 10);
}

export function addDays(value, amount) {
  const date = parseISODate(value);
  date.setUTCDate(date.getUTCDate() + Number(amount));
  return formatISODate(date);
}

export function compareDates(left, right) {
  assertISODate(left, 'left date');
  assertISODate(right, 'right date');
  return left.localeCompare(right);
}

export function daysInclusive(from, to) {
  assertISODate(from, 'from');
  assertISODate(to, 'to');
  const milliseconds = parseISODate(to).getTime() - parseISODate(from).getTime();
  if (milliseconds < 0) throw new RangeError('The end date must not precede the start date');
  return Math.floor(milliseconds / 86_400_000) + 1;
}

export function enumerateDates(from, to) {
  const length = daysInclusive(from, to);
  return Array.from({ length }, (_, index) => addDays(from, index));
}

export function weekday(value) {
  return parseISODate(value).getUTCDay();
}

export function startOfWeek(value) {
  return addDays(value, -weekday(value));
}

export function endOfWeek(value) {
  return addDays(value, 6 - weekday(value));
}

export function createContributionGrid(from, to) {
  daysInclusive(from, to);
  const gridFrom = startOfWeek(from);
  const gridTo = endOfWeek(to);
  const dates = enumerateDates(gridFrom, gridTo);
  const weeks = [];

  for (let index = 0; index < dates.length; index += 7) {
    const weekDates = dates.slice(index, index + 7);
    weeks.push(
      weekDates.map((date, row) => ({
        date,
        row,
        inRange: compareDates(date, from) >= 0 && compareDates(date, to) <= 0,
      })),
    );
  }

  return {
    from,
    to,
    gridFrom,
    gridTo,
    weeks,
    weekCount: weeks.length,
    dayCount: daysInclusive(from, to),
  };
}

export function rangeForCalendarYear(year) {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear) || numericYear < 1970 || numericYear > 9999) {
    throw new RangeError('Year must be an integer between 1970 and 9999');
  }
  return {
    mode: 'calendar-year',
    year: numericYear,
    from: `${numericYear}-01-01`,
    to: `${numericYear}-12-31`,
  };
}

export function rangeForRollingYear(to) {
  assertISODate(to, 'rolling end date');
  return {
    mode: 'rolling',
    from: addDays(to, -364),
    to,
  };
}

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function dateTimeParts(instant, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return parts;
}

export function todayInTimeZone(timeZone, now = new Date()) {
  if (!isValidTimeZone(timeZone)) throw new RangeError(`Unknown IANA timezone: ${timeZone}`);
  const parts = dateTimeParts(now, timeZone);
  return [parts.year, parts.month, parts.day]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0'))
    .join('-');
}

function formatOffset(totalMinutes) {
  const sign = totalMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(totalMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function localNoonTimestamp(value, timeZone) {
  assertISODate(value);
  if (!isValidTimeZone(timeZone)) throw new RangeError(`Unknown IANA timezone: ${timeZone}`);

  const [year, month, day] = value.split('-').map(Number);
  const desiredWallClockAsUtc = Date.UTC(year, month - 1, day, 12, 0, 0);
  let instant = desiredWallClockAsUtc;

  // Resolve the UTC instant whose representation in `timeZone` is local noon.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = dateTimeParts(new Date(instant), timeZone);
    const representedWallClockAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const correction = desiredWallClockAsUtc - representedWallClockAsUtc;
    instant += correction;
    if (correction === 0) break;
  }

  const finalParts = dateTimeParts(new Date(instant), timeZone);
  if (
    finalParts.year !== year ||
    finalParts.month !== month ||
    finalParts.day !== day ||
    finalParts.hour !== 12
  ) {
    throw new RangeError(`Could not resolve local noon for ${value} in ${timeZone}`);
  }

  const representedAsUtc = Date.UTC(
    finalParts.year,
    finalParts.month - 1,
    finalParts.day,
    finalParts.hour,
    finalParts.minute,
    finalParts.second,
  );
  const offsetMinutes = Math.round((representedAsUtc - instant) / 60_000);
  return `${value}T12:00:00${formatOffset(offsetMinutes)}`;
}

export function monthLabel(value, locale = 'en') {
  const date = parseISODate(value);
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date);
}
