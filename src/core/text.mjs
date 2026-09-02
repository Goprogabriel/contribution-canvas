import { FONTS } from './fonts.mjs';

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[æä]/gi, 'A')
    .replace(/[øö]/gi, 'O')
    .replace(/[å]/gi, 'A')
    .toUpperCase();
}

export function rasterizeText(value, options = {}) {
  const fontName = options.font ?? '5x7';
  const spacing = Number.isInteger(options.spacing) ? Math.max(0, options.spacing) : 1;
  const font = FONTS[fontName];
  if (!font) throw new RangeError(`Unknown bitmap font: ${fontName}`);

  const normalized = normalizeText(value);
  const fallback = font['?'];
  const pixels = [];
  let cursor = 0;
  let height = 0;

  for (const character of normalized) {
    const rows = font[character] ?? fallback;
    const width = rows[0]?.length ?? 0;
    height = Math.max(height, rows.length);
    for (let y = 0; y < rows.length; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (rows[y][x] === '1') pixels.push({ x: cursor + x, y });
      }
    }
    cursor += width + spacing;
  }

  const width = normalized.length === 0 ? 0 : Math.max(0, cursor - spacing);
  return { text: normalized, font: fontName, spacing, width, height, pixels };
}

export function placeRasterOnGrid(raster, options) {
  const startColumn = Number(options.startColumn ?? 0);
  const startRow = Number(options.startRow ?? 0);
  const weekCount = Number(options.weekCount);
  const rowCount = Number(options.rowCount ?? 7);
  const placed = [];
  const clipped = [];

  for (const pixel of raster.pixels) {
    const column = startColumn + pixel.x;
    const row = startRow + pixel.y;
    const target = { column, row };
    if (column < 0 || row < 0 || column >= weekCount || row >= rowCount) clipped.push(target);
    else placed.push(target);
  }

  return { placed, clipped, fits: clipped.length === 0 };
}

export function collisionScore(placed, dateAt, existing = {}, planned = {}) {
  let existingCollisions = 0;
  let plannedCollisions = 0;
  for (const pixel of placed) {
    const date = dateAt(pixel.column, pixel.row);
    if (!date) continue;
    if ((existing[date] ?? 0) > 0) existingCollisions += 1;
    if ((planned[date] ?? 0) > 0) plannedCollisions += 1;
  }
  return {
    existing: existingCollisions,
    planned: plannedCollisions,
    total: existingCollisions + plannedCollisions,
  };
}

export function findLowestCollisionPlacement(raster, options) {
  const candidates = [];
  const maxStartColumn = Math.max(0, options.weekCount - raster.width);
  const maxStartRow = Math.max(0, (options.rowCount ?? 7) - raster.height);
  for (let row = 0; row <= maxStartRow; row += 1) {
    for (let column = 0; column <= maxStartColumn; column += 1) {
      const result = placeRasterOnGrid(raster, {
        startColumn: column,
        startRow: row,
        weekCount: options.weekCount,
        rowCount: options.rowCount ?? 7,
      });
      const score = collisionScore(result.placed, options.dateAt, options.existing, options.planned);
      candidates.push({ column, row, score });
    }
  }
  candidates.sort(
    (a, b) =>
      a.score.total - b.score.total ||
      a.score.existing - b.score.existing ||
      a.row - b.row ||
      a.column - b.column,
  );
  return candidates[0] ?? null;
}
