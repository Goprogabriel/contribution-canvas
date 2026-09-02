import {
  addDays,
  compareDates,
  createContributionGrid,
  daysInclusive,
  isValidTimeZone,
  monthLabel,
  rangeForCalendarYear,
  rangeForRollingYear,
  todayInTimeZone,
} from '../core/dates.mjs';
import {
  compactPlan,
  createPlan,
  parsePlan,
  serializePlan,
  setCommitCount,
  totalCommits,
  validatePlan,
} from '../core/plan.mjs';
import { rasterizeText } from '../core/text.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value)));
const STORAGE_KEY = 'contribution-canvas:plan:v1';
const THEME_KEY = 'contribution-canvas:theme';
const SESSION_KEY = 'contribution-canvas:local-session';
const MAX_EDITOR_STRENGTH = 100;

const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const currentDate = todayInTimeZone(detectedTimeZone);
const currentYear = Number(currentDate.slice(0, 4));
const initialRange = rangeForCalendarYear(currentYear);

const state = {
  mode: 'demo',
  sessionToken: null,
  plan: createPlan({
    title: 'Untitled contribution canvas',
    timezone: detectedTimeZone,
    range: initialRange,
    commitsByDate: {},
  }),
  grid: null,
  existing: {},
  baselineExisting: {},
  existingMeta: null,
  showExisting: true,
  preview: 'planned',
  tool: 'brush',
  strength: 1,
  maxStrength: 5,
  zoom: 1,
  undo: [],
  redo: [],
  stroke: null,
  cellElements: new Map(),
  ghostDates: new Set(),
  invalidGhostDates: new Set(),
  textPlacement: null,
  user: null,
  repositories: [],
  selectedRepository: null,
  preflight: null,
  lastExecution: null,
  persistTimer: null,
};

function safelyLoadSavedPlan() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const plan = parsePlan(raw);
    state.plan = plan;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

function formatReadableDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function updateScrollProgress() {
  const bar = $('#scroll-progress-bar');
  if (!bar) return;
  const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollableHeight > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollableHeight)) : 0;
  bar.style.transform = `scaleX(${progress})`;
}

function toast(message, type = 'info') {
  const region = $('#toast-region');
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  region.append(node);
  window.setTimeout(() => node.remove(), 4_500);
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.previousLabel = button.textContent;
    button.textContent = label || 'Working…';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    button.textContent = button.dataset.previousLabel || button.textContent;
    delete button.dataset.previousLabel;
    button.removeAttribute('aria-busy');
    updateActionAvailability();
  }
}

function currentPlan() {
  return compactPlan({
    ...state.plan,
    title: $('#plan-title').value.trim() || 'Untitled contribution canvas',
    timezone: state.plan.timezone,
    range: { ...state.plan.range },
    author: state.user
      ? {
          login: state.user.login,
          githubUserId: state.user.id,
          accountCreatedAt: state.user.createdAt,
        }
      : state.plan.author,
    repository: state.selectedRepository
      ? {
          owner: state.selectedRepository.nameWithOwner.split('/')[0],
          name: state.selectedRepository.nameWithOwner.split('/')[1],
          repositoryId: state.selectedRepository.id,
          defaultBranch: state.selectedRepository.defaultBranch,
        }
      : state.plan.repository,
    commitsByDate: { ...state.plan.commitsByDate },
    metadata: { ...(state.plan.metadata || {}), generatedAsGraphArt: true },
  });
}

function schedulePersist() {
  $('#save-state').textContent = 'Saving…';
  window.clearTimeout(state.persistTimer);
  state.persistTimer = window.setTimeout(() => {
    try {
      state.plan = currentPlan();
      localStorage.setItem(STORAGE_KEY, serializePlan(state.plan));
      $('#save-state').textContent = 'Saved locally';
    } catch {
      $('#save-state').textContent = 'Not saved';
    }
  }, 220);
}

function commitSnapshot() {
  return JSON.stringify(state.plan.commitsByDate);
}

function pushUndo(snapshot) {
  if (snapshot === JSON.stringify(state.plan.commitsByDate)) return;
  state.undo.push(snapshot);
  if (state.undo.length > 100) state.undo.shift();
  state.redo = [];
  updateHistoryButtons();
}

function undo() {
  const snapshot = state.undo.pop();
  if (!snapshot) return;
  state.redo.push(commitSnapshot());
  state.plan.commitsByDate = JSON.parse(snapshot);
  updateAllCells();
  afterPlanMutation();
}

function redo() {
  const snapshot = state.redo.pop();
  if (!snapshot) return;
  state.undo.push(commitSnapshot());
  state.plan.commitsByDate = JSON.parse(snapshot);
  updateAllCells();
  afterPlanMutation();
}

function updateHistoryButtons() {
  $('#undo-button').disabled = state.undo.length === 0;
  $('#redo-button').disabled = state.redo.length === 0;
}

function countLevel(count, maximum) {
  if (!count || maximum <= 0) return 0;
  return clamp(Math.ceil((count / maximum) * 4), 1, 4);
}

function githubLevel(day) {
  if (!day || !day.contributionCount) return 0;
  const mapping = {
    NONE: 0,
    FIRST_QUARTILE: 1,
    SECOND_QUARTILE: 2,
    THIRD_QUARTILE: 3,
    FOURTH_QUARTILE: 4,
  };
  return mapping[day.contributionLevel] ?? countLevel(day.contributionCount, projectedMaximum());
}

function projectedMaximum() {
  const values = state.grid
    ? state.grid.weeks.flatMap((week) =>
        week
          .filter((cell) => cell.inRange)
          .map((cell) => (state.existing[cell.date]?.contributionCount || 0) + (state.plan.commitsByDate[cell.date] || 0)),
      )
    : [1];
  return Math.max(1, ...values);
}

function cellPresentation(date) {
  const planned = state.plan.commitsByDate[date] || 0;
  const existingDay = state.existing[date];
  const existing = state.showExisting ? existingDay?.contributionCount || 0 : 0;
  let level = 0;

  if (state.preview === 'existing') level = state.showExisting ? githubLevel(existingDay) : 0;
  else if (state.preview === 'combined') level = countLevel(planned + existing, projectedMaximum());
  else level = planned ? countLevel(planned, state.maxStrength) : state.showExisting ? githubLevel(existingDay) : 0;

  return { planned, existing, existingDay, level, projected: planned + existing };
}

function updateCell(date) {
  const element = state.cellElements.get(date);
  if (!element) return;
  const cell = element.__cell;
  const presentation = cellPresentation(date);
  element.dataset.level = String(presentation.level);
  element.classList.toggle('has-existing', presentation.existing > 0);
  element.classList.toggle('has-planned', presentation.planned > 0);
  element.classList.toggle('ghost', state.ghostDates.has(date));
  element.classList.toggle('ghost-invalid', state.invalidGhostDates.has(date));
  element.setAttribute(
    'aria-label',
    `${formatReadableDate(date)}. Existing ${presentation.existing}. Planned ${presentation.planned}. Projected ${presentation.projected}.${cell.inRange ? '' : ' Outside selected range.'}`,
  );
}

function updateAllCells() {
  for (const date of state.cellElements.keys()) updateCell(date);
}

function buildMonthLabels() {
  const labels = $('#month-labels');
  labels.replaceChildren();
  let previousMonth = null;
  const pitch = (13 + 4) * state.zoom;

  state.grid.weeks.forEach((week, column) => {
    const firstInRange = week.find((cell) => cell.inRange);
    if (!firstInRange) return;
    const month = firstInRange.date.slice(0, 7);
    if (month === previousMonth) return;
    previousMonth = month;
    const label = document.createElement('span');
    label.textContent = monthLabel(firstInRange.date);
    label.style.left = `${column * pitch}px`;
    labels.append(label);
  });
}

function buildGrid() {
  state.grid = createContributionGrid(state.plan.range.from, state.plan.range.to);
  state.cellElements.clear();
  const gridElement = $('#contribution-grid');
  gridElement.replaceChildren();
  gridElement.style.gridTemplateColumns = `repeat(${state.grid.weekCount}, var(--cell-size))`;

  state.grid.weeks.forEach((week, column) => {
    week.forEach((cell) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `day-cell${cell.inRange ? '' : ' outside'}`;
      button.dataset.date = cell.date;
      button.dataset.column = String(column);
      button.dataset.row = String(cell.row);
      button.style.gridColumn = String(column + 1);
      button.style.gridRow = String(cell.row + 1);
      button.tabIndex = column === 0 && cell.row === 0 ? 0 : -1;
      button.__cell = cell;
      if (!cell.inRange) button.disabled = true;
      state.cellElements.set(cell.date, button);
      gridElement.append(button);
    });
  });

  buildMonthLabels();
  updateAllCells();
  $('#range-caption').textContent = `${formatReadableDate(state.plan.range.from)} – ${formatReadableDate(state.plan.range.to)} · ${state.plan.timezone} · ${state.grid.weekCount} weeks`;
  $('#active-days-detail').textContent = `of ${state.grid.dayCount} days`;
  updateTextControls();
}

function renderStrengthButtons() {
  const container = $('#strength-buttons');
  container.replaceChildren();
  let values;
  if (state.maxStrength <= 7) values = Array.from({ length: state.maxStrength }, (_, index) => index + 1);
  else {
    values = [1, Math.ceil(state.maxStrength * 0.25), Math.ceil(state.maxStrength * 0.5), Math.ceil(state.maxStrength * 0.75), state.maxStrength];
    values = [...new Set(values)];
  }

  for (const value of values) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(value);
    button.classList.toggle('active', value === state.strength);
    button.setAttribute('aria-pressed', value === state.strength ? 'true' : 'false');
    button.addEventListener('click', () => setStrength(value));
    container.append(button);
  }
}

function setStrength(value) {
  state.strength = clamp(Math.round(value || 1), 1, state.maxStrength);
  $('#strength-input').value = String(state.strength);
  $('#strength-value').textContent = `${state.strength} commit${state.strength === 1 ? '' : 's'}/day`;
  $('#tool-summary').textContent = state.tool === 'eraser' ? 'Planned layer' : `Strength ${state.tool === 'text' ? $('#text-strength').value : state.strength}`;
  renderStrengthButtons();
}

function setTool(tool) {
  if (!['brush', 'eraser', 'text'].includes(tool)) return;
  state.tool = tool;
  $$('.tool-button[data-tool]').forEach((button) => {
    const active = button.dataset.tool === tool;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  $$('.inspector-panel').forEach((panel) => panel.classList.remove('active'));
  $(`#${tool}-panel`).classList.add('active');
  const toolLabels = { brush: 'Draw', eraser: 'Erase', text: 'Text' };
  $('#inspector-title').textContent = toolLabels[tool];
  $('#tool-summary').textContent = tool === 'eraser' ? 'Planned layer' : `Strength ${tool === 'text' ? $('#text-strength').value : state.strength}`;
  if (tool === 'text') updateTextPreview();
  else {
    state.ghostDates.clear();
    state.invalidGhostDates.clear();
    updateAllCells();
  }
}

function afterPlanMutation() {
  updateStats();
  updateActionAvailability();
  schedulePersist();
  if (state.tool === 'text') updateTextPreview();
}

function paintDate(date, additive = false) {
  const element = state.cellElements.get(date);
  if (!element || !element.__cell.inRange) return false;
  const current = state.plan.commitsByDate[date] || 0;
  let next;
  if (state.tool === 'eraser') next = 0;
  else if (state.tool === 'brush') next = additive ? clamp(current + state.strength, 1, MAX_EDITOR_STRENGTH) : state.strength;
  else return false;
  if (current === next) return false;
  state.plan.commitsByDate = setCommitCount(state.plan.commitsByDate, date, next);
  updateCell(date);
  element.classList.remove('selected-flash');
  void element.offsetWidth;
  element.classList.add('selected-flash');
  return true;
}

function beginStroke(cell, event) {
  if (state.tool === 'text') {
    $('#text-column').value = cell.dataset.column;
    updateTextPreview();
    return;
  }
  if (!['brush', 'eraser'].includes(state.tool)) return;
  event.preventDefault();
  state.stroke = {
    before: commitSnapshot(),
    seen: new Set(),
    changed: false,
    additive: event.shiftKey,
    pointerId: event.pointerId,
  };
  continueStroke(cell);
}

function continueStroke(cell) {
  if (!state.stroke || !cell?.dataset.date || state.stroke.seen.has(cell.dataset.date)) return;
  state.stroke.seen.add(cell.dataset.date);
  if (paintDate(cell.dataset.date, state.stroke.additive)) state.stroke.changed = true;
  updateStats();
}

function endStroke() {
  if (!state.stroke) return;
  if (state.stroke.changed) {
    pushUndo(state.stroke.before);
    afterPlanMutation();
  }
  state.stroke = null;
}

function textPlacement() {
  const text = $('#text-input').value;
  const font = $('#font-select').value;
  const spacing = clamp($('#text-spacing').value, 0, 3);
  const strength = clamp($('#text-strength').value, 1, MAX_EDITOR_STRENGTH);
  const column = clamp($('#text-column').value, 0, Math.max(0, state.grid.weekCount - 1));
  const row = clamp($('#text-row').value, 0, 6);
  const raster = rasterizeText(text, { font, spacing });
  const dates = [];
  const invalidDates = [];
  let clipped = 0;

  for (const pixel of raster.pixels) {
    const targetColumn = column + pixel.x;
    const targetRow = row + pixel.y;
    const cell = state.grid.weeks[targetColumn]?.[targetRow];
    if (!cell) {
      clipped += 1;
      continue;
    }
    if (!cell.inRange) invalidDates.push(cell.date);
    else dates.push(cell.date);
  }

  const uniqueDates = [...new Set(dates)];
  const uniqueInvalid = [...new Set(invalidDates)];
  const collisions = uniqueDates.filter((date) => (state.existing[date]?.contributionCount || 0) > 0).length;
  return {
    text: raster.text,
    raster,
    strength,
    column,
    row,
    dates: uniqueDates,
    invalidDates: uniqueInvalid,
    clipped,
    collisions,
    fits: clipped === 0 && uniqueInvalid.length === 0 && uniqueDates.length > 0,
  };
}

function updateTextControls() {
  if (!state.grid) return;
  const raster = rasterizeText($('#text-input')?.value || 'HELLO', {
    font: $('#font-select')?.value || '5x7',
    spacing: clamp($('#text-spacing')?.value || 1, 0, 3),
  });
  const maximumColumn = Math.max(0, state.grid.weekCount - Math.max(1, raster.width));
  const maximumRow = Math.max(0, 7 - Math.max(1, raster.height));
  $('#text-column').max = String(maximumColumn);
  $('#text-column').value = String(clamp($('#text-column').value, 0, maximumColumn));
  $('#text-row').max = String(maximumRow);
  $('#text-row').value = String(clamp($('#text-row').value, 0, maximumRow));
}

function updateTextPreview() {
  if (!state.grid) return;
  updateTextControls();
  const placement = textPlacement();
  state.textPlacement = placement;
  state.ghostDates = new Set(placement.dates);
  state.invalidGhostDates = new Set(placement.invalidDates);
  $('#text-column-output').textContent = `Week ${placement.column + 1}`;
  $('#text-row-output').textContent = `Row ${placement.row + 1}`;
  const info = $('#text-preview-info');
  info.classList.toggle('error', !placement.fits);

  if (!placement.text) info.textContent = 'Enter text to preview it on the calendar.';
  else if (!placement.fits) {
    info.textContent = `The text does not fit this position. ${placement.clipped + placement.invalidDates.length} pixel(s) fall outside the selected date range.`;
  } else {
    const sorted = [...placement.dates].sort();
    info.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = `${placement.dates.length} painted dates · ${placement.dates.length * placement.strength} commits`;
    info.append(strong, document.createElement('br'));
    info.append(`${formatReadableDate(sorted[0])} → ${formatReadableDate(sorted.at(-1))}`);
    if (placement.collisions) info.append(` · ${placement.collisions} existing-activity collision${placement.collisions === 1 ? '' : 's'}`);
  }
  $('#place-text-button').disabled = !placement.fits;
  $('#tool-summary').textContent = `Strength ${placement.strength}`;
  updateAllCells();
}

function centerText() {
  updateTextControls();
  const raster = rasterizeText($('#text-input').value, {
    font: $('#font-select').value,
    spacing: clamp($('#text-spacing').value, 0, 3),
  });
  $('#text-column').value = String(Math.max(0, Math.floor((state.grid.weekCount - raster.width) / 2)));
  $('#text-row').value = String(Math.max(0, Math.floor((7 - raster.height) / 2)));
  updateTextPreview();
}

function avoidTextCollisions() {
  updateTextControls();
  const raster = rasterizeText($('#text-input').value, {
    font: $('#font-select').value,
    spacing: clamp($('#text-spacing').value, 0, 3),
  });
  const maxColumn = Math.max(0, state.grid.weekCount - raster.width);
  const maxRow = Math.max(0, 7 - raster.height);
  let best = null;
  for (let row = 0; row <= maxRow; row += 1) {
    for (let column = 0; column <= maxColumn; column += 1) {
      let invalid = 0;
      let collisions = 0;
      let planned = 0;
      for (const pixel of raster.pixels) {
        const cell = state.grid.weeks[column + pixel.x]?.[row + pixel.y];
        if (!cell?.inRange) invalid += 1;
        else {
          if ((state.existing[cell.date]?.contributionCount || 0) > 0) collisions += 1;
          if ((state.plan.commitsByDate[cell.date] || 0) > 0) planned += 1;
        }
      }
      const candidate = { column, row, score: invalid * 100_000 + collisions * 10 + planned };
      if (!best || candidate.score < best.score) best = candidate;
    }
  }
  if (best) {
    $('#text-column').value = String(best.column);
    $('#text-row').value = String(best.row);
    updateTextPreview();
    toast(best.score === 0 ? 'Found a collision-free position.' : 'Placed text at the lowest-collision position.', 'success');
  }
}

function placeText() {
  const placement = textPlacement();
  if (!placement.fits) return toast('Move or shorten the text before placing it.', 'error');
  const before = commitSnapshot();
  let next = { ...state.plan.commitsByDate };
  for (const date of placement.dates) next = setCommitCount(next, date, placement.strength);
  state.plan.commitsByDate = next;
  pushUndo(before);
  state.ghostDates.clear();
  state.invalidGhostDates.clear();
  updateAllCells();
  afterPlanMutation();
  toast(`Placed “${placement.text}” as ${formatNumber(placement.dates.length * placement.strength)} commits.`, 'success');
}

function updateStats() {
  const values = Object.entries(state.plan.commitsByDate).filter(([, count]) => count > 0);
  const total = totalCommits(state.plan);
  const peak = values.reduce((best, entry) => (!best || entry[1] > best[1] ? entry : best), null);
  const collisions = values.filter(([date]) => (state.existing[date]?.contributionCount || 0) > 0).length;
  $('#total-commits').textContent = formatNumber(total);
  $('#active-days').textContent = formatNumber(values.length);
  $('#peak-day').textContent = formatNumber(peak?.[1] || 0);
  $('#peak-date').textContent = peak ? formatReadableDate(peak[0]) : 'No painted date';
  $('#collision-count').textContent = formatNumber(collisions);
  const warning = $('#total-warning');
  if (total === 0) warning.textContent = 'Nothing planned yet';
  else if (total > 2_000) warning.textContent = 'Very large plan—review carefully';
  else if (total > 500) warning.textContent = 'Large plan—dry-run recommended';
  else warning.textContent = `${values.length} date${values.length === 1 ? '' : 's'} ready`;
}

function updateActionAvailability() {
  const total = totalCommits(state.plan);
  const localReady = state.mode === 'local' && state.preflight?.ok && state.selectedRepository && total > 0;
  $('#review-push-button').disabled = !localReady;
  $('#preflight-button').disabled = state.mode !== 'local' || !state.selectedRepository;
  $('#recheck-profile-button').disabled = !state.lastExecution || !state.lastExecution.pushed;
  $('#execute-push-button').disabled = $('#push-confirmation').value !== String(total) || total === 0;
}

function applyRange() {
  const mode = $('#range-mode').value;
  const timezone = $('#timezone-input').value.trim();
  if (!isValidTimeZone(timezone)) return toast('Enter a valid IANA timezone, such as Europe/Copenhagen.', 'error');

  let range;
  try {
    if (mode === 'calendar-year') range = rangeForCalendarYear(Number($('#year-input').value));
    else if (mode === 'rolling') range = rangeForRollingYear($('#rolling-end-input').value);
    else {
      const from = $('#custom-from-input').value;
      const to = $('#custom-to-input').value;
      const length = daysInclusive(from, to);
      if (length > 371) throw new RangeError('Custom ranges may contain at most 371 days');
      range = { mode: 'custom', from, to };
    }
  } catch (error) {
    return toast(error.message, 'error');
  }

  const outside = Object.keys(state.plan.commitsByDate).filter((date) => compareDates(date, range.from) < 0 || compareDates(date, range.to) > 0);
  if (outside.length && !window.confirm(`Changing the range will remove planned activity from ${outside.length} date(s). Continue?`)) return;

  const before = commitSnapshot();
  state.plan.range = range;
  state.plan.timezone = timezone;
  state.plan.commitsByDate = Object.fromEntries(
    Object.entries(state.plan.commitsByDate).filter(([date]) => compareDates(date, range.from) >= 0 && compareDates(date, range.to) <= 0),
  );
  state.existing = {};
  state.baselineExisting = {};
  state.existingMeta = null;
  if (outside.length) pushUndo(before);
  buildGrid();
  updateStats();
  schedulePersist();
  $('#activity-status').textContent = 'Date range changed. Reload GitHub activity for this period.';
  $('#activity-status').className = 'result-box muted';
  toast('Date range and timezone updated.', 'success');
}

function syncRangeControls() {
  const mode = $('#range-mode').value;
  $('#calendar-year-fields').hidden = mode !== 'calendar-year';
  $('#rolling-fields').hidden = mode !== 'rolling';
  $('#custom-fields').hidden = mode !== 'custom';
}

function hydrateRangeControls() {
  const range = state.plan.range;
  $('#range-mode').value = ['calendar-year', 'rolling', 'custom'].includes(range.mode) ? range.mode : 'custom';
  $('#year-input').value = String(range.year || Number(range.from.slice(0, 4)));
  $('#rolling-end-input').value = range.to;
  $('#custom-from-input').value = range.from;
  $('#custom-to-input').value = range.to;
  $('#timezone-input').value = state.plan.timezone;
  syncRangeControls();
}

function clearCanvas() {
  const before = commitSnapshot();
  state.plan.commitsByDate = {};
  pushUndo(before);
  state.ghostDates.clear();
  updateAllCells();
  afterPlanMutation();
  $('#confirm-clear-dialog').close();
  toast('Planned activity cleared. Existing GitHub activity was untouched.', 'success');
}

function newCanvas() {
  if (totalCommits(state.plan) > 0 && !window.confirm('Create a new canvas and replace the current locally saved plan?')) return;
  const range = rangeForCalendarYear(currentYear);
  state.plan = createPlan({ title: 'Untitled contribution canvas', timezone: detectedTimeZone, range, commitsByDate: {} });
  state.undo = [];
  state.redo = [];
  state.existing = {};
  state.baselineExisting = {};
  state.lastExecution = null;
  $('#plan-title').value = state.plan.title;
  hydrateRangeControls();
  buildGrid();
  updateStats();
  updateHistoryButtons();
  schedulePersist();
  toast('New canvas created.', 'success');
}

function loadHelloSample() {
  setTool('text');
  $('#text-input').value = 'HELLO';
  $('#font-select').value = '5x7';
  $('#text-spacing').value = '1';
  $('#text-strength').value = '4';
  centerText();
  placeText();
}

function exportPlan() {
  try {
    const plan = currentPlan();
    const result = validatePlan(plan);
    if (!result.ok) throw new Error(result.errors.join('; '));
    const blob = new Blob([`${serializePlan(plan)}\n`], { type: 'application/json' });
    const link = document.createElement('a');
    const safeTitle = plan.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'contribution-canvas';
    link.href = URL.createObjectURL(blob);
    link.download = `${safeTitle}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast('Plan exported as versioned JSON.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function importPlan(file) {
  try {
    const plan = parsePlan(await file.text());
    state.plan = plan;
    state.undo = [];
    state.redo = [];
    state.existing = {};
    state.baselineExisting = {};
    state.selectedRepository = null;
    state.preflight = null;
    $('#plan-title').value = plan.title;
    hydrateRangeControls();
    buildGrid();
    updateStats();
    updateHistoryButtons();
    schedulePersist();
    toast(`Imported “${plan.title}”.`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function copyInstallCommand() {
  const command = $('#install-command').textContent;
  try {
    await navigator.clipboard.writeText(command);
    toast('Setup command copied.', 'success');
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('#install-command'));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    toast('Command selected—copy it with ⌘/Ctrl+C.');
  }
}

function renderHeroGraph() {
  const graph = $('#hero-mini-graph');
  const pattern = [
    0,0,1,1,0,0,0, 0,2,0,0,2,0,0, 3,3,3,3,3,3,3,
    0,0,4,4,0,0,0, 0,2,0,0,2,0,0, 3,0,0,3,0,0,3,
    0,1,0,0,1,0,0, 0,2,2,2,2,0,0, 3,3,3,3,3,3,3,
    0,1,0,0,1,0,0, 0,2,0,0,2,0,0, 3,0,0,0,0,0,3,
    0,0,4,4,0,0,0, 0,2,0,0,2,0,0, 3,3,3,3,3,3,3,
  ];
  for (let index = 0; index < 26 * 7; index += 1) {
    const cell = document.createElement('i');
    const level = pattern[index % pattern.length] || (Math.random() > 0.86 ? 1 : 0);
    cell.dataset.level = String(level);
    graph.append(cell);
  }
}

async function api(path, options = {}) {
  if (!state.sessionToken) throw new Error('This action is available only in local mode');
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Contribution-Canvas-Session': state.sessionToken,
      ...(options.headers || {}),
    },
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = { error: `Local server returned HTTP ${response.status}` };
  }
  if (!response.ok) throw new Error(body.error || `Local request failed with HTTP ${response.status}`);
  return body;
}

function extractSessionToken() {
  const url = new URL(location.href);
  const fromQuery = url.searchParams.get('cc_session');
  if (fromQuery) {
    sessionStorage.setItem(SESSION_KEY, fromQuery);
    url.searchParams.delete('cc_session');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    return fromQuery;
  }
  return sessionStorage.getItem(SESSION_KEY);
}

async function initializeLocalMode() {
  state.sessionToken = extractSessionToken();
  if (!state.sessionToken) return;
  try {
    await api('/api/session');
    state.mode = 'local';
    document.body.classList.add('local-mode');
    $('#mode-pill').classList.remove('demo');
    $('#mode-pill').classList.add('local');
    $('#mode-label').textContent = 'Local publish mode';
    $('#demo-lock').hidden = true;
    $('#local-controls').hidden = false;
    await Promise.allSettled([loadUser(), loadRepositories()]);
  } catch (error) {
    state.sessionToken = null;
    sessionStorage.removeItem(SESSION_KEY);
    toast(`Local session unavailable: ${error.message}`, 'error');
  }
}

async function loadUser() {
  try {
    const user = await api('/api/github/user');
    state.user = user;
    $('#account-name').textContent = user.name || user.login;
    $('#account-detail').textContent = `@${user.login} · ${user.noreplyEmail}`;
    const avatar = $('#account-avatar');
    avatar.replaceChildren();
    if (user.avatarUrl) {
      const image = document.createElement('img');
      image.src = user.avatarUrl;
      image.alt = '';
      avatar.append(image);
    } else avatar.textContent = user.login.slice(0, 2).toUpperCase();
    return user;
  } catch (error) {
    $('#account-name').textContent = 'GitHub CLI is not authenticated';
    $('#account-detail').textContent = 'Run gh auth login in the terminal';
    throw error;
  }
}

async function loadRepositories(selectName) {
  const select = $('#repository-select');
  select.replaceChildren(new Option('Loading repositories…', ''));
  try {
    const result = await api('/api/github/repos');
    state.repositories = result.repositories;
    select.replaceChildren(new Option('Choose a repository', ''));
    for (const repository of result.repositories) {
      const suffix = [repository.visibility, repository.isFork ? 'fork' : '', repository.isArchived ? 'archived' : ''].filter(Boolean).join(' · ');
      const option = new Option(`${repository.nameWithOwner} — ${suffix}`, repository.nameWithOwner);
      option.disabled = !repository.canPush || repository.isFork || repository.isArchived || repository.isDisabled;
      select.append(option);
    }
    if (selectName && result.repositories.some((repository) => repository.nameWithOwner === selectName)) {
      select.value = selectName;
      select.dispatchEvent(new Event('change'));
    }
  } catch (error) {
    select.replaceChildren(new Option('Could not load repositories', ''));
    toast(error.message, 'error');
  }
}

async function createRepository() {
  const button = $('#create-repository-button');
  const name = $('#new-repository-name').value.trim();
  const visibility = $('#new-repository-visibility').value;
  if (!name) return toast('Enter a repository name.', 'error');
  setBusy(button, true, 'Creating…');
  try {
    const result = await api('/api/repository/create', {
      method: 'POST',
      body: JSON.stringify({ name, visibility }),
    });
    $('#new-repository-name').value = '';
    await loadRepositories(result.repository.nameWithOwner);
    toast(`Created empty repository ${result.repository.nameWithOwner}.`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

function renderResultBox(element, result) {
  element.replaceChildren();
  if (result.ok) {
    element.className = result.warnings?.length ? 'result-box warning' : 'result-box success';
    const title = document.createElement('strong');
    title.textContent = result.warnings?.length ? 'Preflight passed with warnings' : 'Preflight passed';
    element.append(title);
    if (result.repository) element.append(document.createElement('br'), `Default branch: ${result.repository.defaultBranch}`);
    for (const warning of result.warnings || []) element.append(document.createElement('br'), `• ${warning}`);
  } else {
    element.className = 'result-box error';
    const title = document.createElement('strong');
    title.textContent = 'Preflight failed';
    element.append(title);
    for (const error of result.errors || []) element.append(document.createElement('br'), `• ${error}`);
  }
}

async function runPreflight() {
  if (!state.selectedRepository) return;
  const button = $('#preflight-button');
  setBusy(button, true, 'Checking…');
  try {
    const result = await api('/api/repository/preflight', {
      method: 'POST',
      body: JSON.stringify({ repository: state.selectedRepository.nameWithOwner }),
    });
    state.preflight = result;
    state.selectedRepository = { ...state.selectedRepository, ...result.repository };
    renderResultBox($('#preflight-result'), result);
  } catch (error) {
    state.preflight = null;
    $('#preflight-result').className = 'result-box error';
    $('#preflight-result').textContent = error.message;
  } finally {
    setBusy(button, false);
    updateActionAvailability();
  }
}

async function loadActivity() {
  const button = $('#load-activity-button');
  setBusy(button, true, 'Loading…');
  try {
    const result = await api(`/api/github/activity?from=${encodeURIComponent(state.plan.range.from)}&to=${encodeURIComponent(state.plan.range.to)}`);
    state.existing = Object.fromEntries(result.days.map((day) => [day.date, day]));
    state.baselineExisting = Object.fromEntries(result.days.map((day) => [day.date, day.contributionCount]));
    state.existingMeta = result;
    updateAllCells();
    updateStats();
    $('#activity-status').className = 'result-box success';
    $('#activity-status').textContent = `Loaded ${formatNumber(result.totalContributions)} contributions for @${result.login} in this range.`;
    toast('Existing GitHub activity loaded.', 'success');
  } catch (error) {
    $('#activity-status').className = 'result-box error';
    $('#activity-status').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

async function runDoctor() {
  const button = $('#doctor-button');
  setBusy(button, true, 'Checking…');
  try {
    const result = await api('/api/doctor');
    const message = [
      `Node: ${result.node.version}`,
      `Git: ${result.git.available ? result.git.version : 'missing'}`,
      `GitHub CLI: ${result.gh.available ? result.gh.version : 'missing'}`,
      result.githubAuth.message,
    ].join('\n');
    toast(result.ok ? 'Local doctor passed.' : 'Local doctor found a problem.', result.ok ? 'success' : 'error');
    $('#execution-result').className = result.ok ? 'result-box success' : 'result-box error';
    $('#execution-result').textContent = message;
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

function openPushReview() {
  if (!state.preflight?.ok || !state.selectedRepository) return;
  const plan = currentPlan();
  const total = totalCommits(plan);
  $('#review-repository').textContent = state.selectedRepository.nameWithOwner;
  $('#review-branch').textContent = state.selectedRepository.defaultBranch || state.preflight.repository.defaultBranch;
  $('#review-dates').textContent = `${formatReadableDate(plan.range.from)} – ${formatReadableDate(plan.range.to)}`;
  $('#review-timezone').textContent = plan.timezone;
  $('#review-total').textContent = formatNumber(total);
  $('#confirmation-total').textContent = String(total);
  $('#push-confirmation').value = '';
  updateActionAvailability();
  $('#push-dialog').showModal();
}

async function executeLocal(dryRun) {
  const button = dryRun ? $('#dry-run-button') : $('#execute-push-button');
  const plan = currentPlan();
  const total = totalCommits(plan);
  const confirmation = $('#push-confirmation').value;
  if (!dryRun && confirmation !== String(total)) return;
  setBusy(button, true, dryRun ? 'Running dry-run…' : 'Generating commits…');
  $('#execution-result').className = 'result-box warning';
  $('#execution-result').textContent = dryRun ? 'Validating and generating in an isolated clone. The remote will remain unchanged.' : 'Generating commits in an isolated clone. Do not close the local process.';

  try {
    const result = await api(dryRun ? '/api/plan/dry-run' : '/api/plan/apply', {
      method: 'POST',
      body: JSON.stringify({
        plan,
        repository: state.selectedRepository.nameWithOwner,
        confirmation,
      }),
    });
    state.lastExecution = result;
    $('#execution-result').className = 'result-box success';
    $('#execution-result').textContent = dryRun
      ? `Dry-run complete. ${formatNumber(result.totalCommits)} commits generated locally; remote unchanged. Receipt: ${result.receiptPath}`
      : `Push verified at ${result.finalSha?.slice(0, 12)}. Receipt: ${result.receiptPath}`;
    toast(dryRun ? 'Dry-run completed without changing GitHub.' : 'One normal push completed and verified.', 'success');
    if (!dryRun) $('#push-dialog').close();
  } catch (error) {
    $('#execution-result').className = 'result-box error';
    $('#execution-result').textContent = error.message;
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
    updateActionAvailability();
  }
}

async function recheckProfile() {
  const button = $('#recheck-profile-button');
  setBusy(button, true, 'Rechecking…');
  try {
    const result = await api('/api/profile/recheck', {
      method: 'POST',
      body: JSON.stringify({ from: state.plan.range.from, to: state.plan.range.to }),
    });
    const current = Object.fromEntries(result.days.map((day) => [day.date, day]));
    let verified = 0;
    let expected = 0;
    for (const [date, planned] of Object.entries(state.plan.commitsByDate)) {
      expected += 1;
      const before = state.baselineExisting[date] || 0;
      if ((current[date]?.contributionCount || 0) >= before + planned) verified += 1;
    }
    state.existing = current;
    updateAllCells();
    updateStats();
    $('#execution-result').className = verified === expected ? 'result-box success' : 'result-box warning';
    $('#execution-result').textContent = verified === expected
      ? `GitHub profile graph reflects all ${expected} planned date(s).`
      : `${verified}/${expected} planned date(s) currently reflect the expected increase. GitHub can take up to 24 hours.`;
  } catch (error) {
    $('#execution-result').className = 'result-box error';
    $('#execution-result').textContent = error.message;
  } finally {
    setBusy(button, false);
  }
}

function switchPreview(preview) {
  state.preview = preview;
  $$('.segmented [data-preview]').forEach((button) => button.classList.toggle('active', button.dataset.preview === preview));
  updateAllCells();
}

function updateZoom(next) {
  state.zoom = clamp(next, 0.72, 1.55);
  document.documentElement.style.setProperty('--cell-size', `${13 * state.zoom}px`);
  document.documentElement.style.setProperty('--cell-gap', `${4 * state.zoom}px`);
  $('#zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
  buildMonthLabels();
}

function showCellTooltip(cell, event) {
  if (!cell?.dataset.date) return;
  const info = cellPresentation(cell.dataset.date);
  const tooltip = $('#cell-tooltip');
  tooltip.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = formatReadableDate(cell.dataset.date);
  tooltip.append(title);
  tooltip.append(`Existing: ${info.existing}`, document.createElement('br'));
  tooltip.append(`Planned: ${info.planned}`, document.createElement('br'));
  tooltip.append(`Projected: ${info.projected}`);
  tooltip.hidden = false;
  const left = Math.min(innerWidth - 245, event.clientX + 14);
  const top = Math.min(innerHeight - 100, event.clientY + 14);
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function bindEvents() {
  $('#undo-button').addEventListener('click', undo);
  $('#redo-button').addEventListener('click', redo);
  $('#import-button').addEventListener('click', () => $('#import-file').click());
  $('#export-button').addEventListener('click', exportPlan);
  $('#import-file').addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (file) importPlan(file);
    event.target.value = '';
  });
  $('#plan-title').addEventListener('input', schedulePersist);
  $('#theme-button').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  });
  ['#copy-install-hero', '#copy-install-inline', '#copy-install-lock'].forEach((selector) => $(selector).addEventListener('click', copyInstallCommand));
  $('#sample-button').addEventListener('click', loadHelloSample);
  $('#new-plan-button').addEventListener('click', newCanvas);
  $$('.tool-button[data-tool]').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool)));
  $('#clear-button').addEventListener('click', () => $('#confirm-clear-dialog').showModal());
  $('#clear-selection-button').addEventListener('click', () => $('#confirm-clear-dialog').showModal());
  $('#confirm-clear-button').addEventListener('click', clearCanvas);

  $('#strength-input').addEventListener('input', (event) => setStrength(event.target.value));
  $('#max-strength-input').addEventListener('change', (event) => {
    state.maxStrength = clamp(Math.round(event.target.value || 5), 1, MAX_EDITOR_STRENGTH);
    event.target.value = String(state.maxStrength);
    $('#strength-input').max = String(state.maxStrength);
    setStrength(Math.min(state.strength, state.maxStrength));
    updateAllCells();
  });

  ['#text-input', '#font-select', '#text-spacing', '#text-strength', '#text-column', '#text-row'].forEach((selector) => {
    $(selector).addEventListener('input', updateTextPreview);
  });
  $('#center-text-button').addEventListener('click', centerText);
  $('#best-text-button').addEventListener('click', avoidTextCollisions);
  $('#place-text-button').addEventListener('click', placeText);

  $$('.segmented [data-preview]').forEach((button) => button.addEventListener('click', () => switchPreview(button.dataset.preview)));
  $('#existing-toggle').addEventListener('change', (event) => {
    state.showExisting = event.target.checked;
    updateAllCells();
    updateStats();
  });
  $('#zoom-out').addEventListener('click', () => updateZoom(state.zoom - 0.12));
  $('#zoom-in').addEventListener('click', () => updateZoom(state.zoom + 0.12));

  $('#range-mode').addEventListener('change', syncRangeControls);
  $('#apply-range-button').addEventListener('click', applyRange);

  const grid = $('#contribution-grid');
  grid.addEventListener('pointerdown', (event) => {
    const cell = event.target.closest('.day-cell');
    if (cell && !cell.disabled) beginStroke(cell, event);
  });
  window.addEventListener('pointermove', (event) => {
    if (!state.stroke || event.pointerId !== state.stroke.pointerId) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.day-cell');
    if (cell && !cell.disabled) continueStroke(cell);
  }, { passive: false });
  window.addEventListener('pointerup', endStroke);
  window.addEventListener('pointercancel', endStroke);

  grid.addEventListener('mousemove', (event) => showCellTooltip(event.target.closest('.day-cell'), event));
  grid.addEventListener('mouseleave', () => { $('#cell-tooltip').hidden = true; });
  grid.addEventListener('focusin', (event) => {
    if (event.target.matches('.day-cell')) {
      const rect = event.target.getBoundingClientRect();
      showCellTooltip(event.target, { clientX: rect.right, clientY: rect.top });
    }
  });
  grid.addEventListener('focusout', () => { $('#cell-tooltip').hidden = true; });
  grid.addEventListener('keydown', (event) => {
    const cell = event.target.closest('.day-cell');
    if (!cell) return;
    const column = Number(cell.dataset.column);
    const row = Number(cell.dataset.row);
    const movements = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (movements[event.key]) {
      event.preventDefault();
      const [dx, dy] = movements[event.key];
      const nextColumn = clamp(column + dx, 0, state.grid.weekCount - 1);
      const nextRow = clamp(row + dy, 0, 6);
      const nextDate = state.grid.weeks[nextColumn]?.[nextRow]?.date;
      const next = state.cellElements.get(nextDate);
      if (next && !next.disabled) {
        cell.tabIndex = -1;
        next.tabIndex = 0;
        next.focus();
      }
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (state.tool === 'text') {
        $('#text-column').value = cell.dataset.column;
        updateTextPreview();
      } else {
        const before = commitSnapshot();
        if (paintDate(cell.dataset.date, event.shiftKey)) {
          pushUndo(before);
          afterPlanMutation();
        }
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (editing || modifier || event.altKey) return;
    if (event.key.toLowerCase() === 'b') setTool('brush');
    if (event.key.toLowerCase() === 'e') setTool('eraser');
    if (event.key.toLowerCase() === 't') setTool('text');
    if (event.key === 'Escape' && state.tool === 'text') setTool('brush');
  });

  $('#repository-select').addEventListener('change', (event) => {
    state.selectedRepository = state.repositories.find((repository) => repository.nameWithOwner === event.target.value) || null;
    state.preflight = null;
    $('#preflight-result').className = 'result-box muted';
    $('#preflight-result').textContent = state.selectedRepository ? 'Repository selected. Run preflight before execution.' : 'Select a repository to continue.';
    updateActionAvailability();
  });
  $('#create-repository-button').addEventListener('click', createRepository);
  $('#preflight-button').addEventListener('click', runPreflight);
  $('#load-activity-button').addEventListener('click', loadActivity);
  $('#doctor-button').addEventListener('click', runDoctor);
  $('#review-push-button').addEventListener('click', openPushReview);
  $('#push-confirmation').addEventListener('input', updateActionAvailability);
  $('#dry-run-button').addEventListener('click', () => executeLocal(true));
  $('#execute-push-button').addEventListener('click', () => executeLocal(false));
  $('#recheck-profile-button').addEventListener('click', recheckProfile);
}

async function initialize() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;
  safelyLoadSavedPlan();
  $('#plan-title').value = state.plan.title;
  hydrateRangeControls();
  renderHeroGraph();
  bindEvents();
  renderStrengthButtons();
  setStrength(state.strength);
  buildGrid();
  updateStats();
  updateHistoryButtons();
  updateActionAvailability();
  window.addEventListener('scroll', updateScrollProgress, { passive: true });
  window.addEventListener('resize', updateScrollProgress);
  updateScrollProgress();
  await initializeLocalMode();
}

initialize().catch((error) => {
  console.error(error);
  toast(`Contribution Canvas could not start: ${error.message}`, 'error');
});
