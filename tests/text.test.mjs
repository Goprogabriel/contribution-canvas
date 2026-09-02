import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collisionScore,
  findLowestCollisionPlacement,
  normalizeText,
  placeRasterOnGrid,
  rasterizeText,
} from '../src/core/text.mjs';

test('normalizes lowercase and common Danish letters', () => {
  assert.equal(normalizeText('blåbær ø'), 'BLABAER O');
});

test('5x7 raster has deterministic dimensions and pixels', () => {
  const raster = rasterizeText('HI', { font: '5x7', spacing: 1 });
  assert.equal(raster.width, 11);
  assert.equal(raster.height, 7);
  assert.ok(raster.pixels.length > 10);
  assert.deepEqual(rasterizeText('HI', { font: '5x7', spacing: 1 }), raster);
});

test('3x5 font fits into a vertically offset seven-row graph', () => {
  const raster = rasterizeText('A', { font: '3x5' });
  const result = placeRasterOnGrid(raster, { startColumn: 2, startRow: 2, weekCount: 12, rowCount: 7 });
  assert.equal(result.fits, true);
  assert.equal(Math.max(...result.placed.map((pixel) => pixel.row)), 6);
});

test('placement reports clipped pixels instead of silently wrapping', () => {
  const raster = rasterizeText('HELLO', { font: '5x7' });
  const result = placeRasterOnGrid(raster, { startColumn: 50, startRow: 0, weekCount: 53, rowCount: 7 });
  assert.equal(result.fits, false);
  assert.ok(result.clipped.length > 0);
});

test('collision scoring and best placement prefer empty dates', () => {
  const raster = rasterizeText('I', { font: '3x5', spacing: 0 });
  const dates = Array.from({ length: 10 }, (_, column) =>
    Array.from({ length: 7 }, (_, row) => `2025-01-${String(column * 7 + row + 1).padStart(2, '0')}`),
  );
  const dateAt = (column, row) => dates[column]?.[row];
  const existing = Object.fromEntries(dates[0].map((date) => [date, 3]));
  const first = placeRasterOnGrid(raster, { startColumn: 0, startRow: 0, weekCount: 10, rowCount: 7 });
  assert.ok(collisionScore(first.placed, dateAt, existing).existing > 0);
  const best = findLowestCollisionPlacement(raster, { weekCount: 10, rowCount: 7, dateAt, existing, planned: {} });
  assert.notEqual(best.column, 0);
  assert.equal(best.score.existing, 0);
});
