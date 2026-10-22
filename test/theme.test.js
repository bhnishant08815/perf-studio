import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_CSS } from '../lib/theme.js';

const TOKENS = ['canvas', 'surface', 'surface-muted', 'border', 'text', 'text-2', 'accent', 'live', 'healthy', 'warning', 'critical', 'neutral'];

test('defines every token in light and dark', () => {
  for (const t of TOKENS) assert.ok(THEME_CSS.split(`--${t}:`).length - 1 >= 2, `--${t} needs light and dark values`);
  assert.ok(THEME_CSS.includes('#F1F3F0'));
  assert.ok(THEME_CSS.includes('#171B18'));
});

test('print forces light tokens', () => {
  const print = THEME_CSS.slice(THEME_CSS.indexOf('@media print'));
  assert.ok(print.includes('#29332C'));
  assert.ok(print.includes('background:#fff'));
});

test('respects reduced motion', () => {
  assert.ok(THEME_CSS.includes('prefers-reduced-motion'));
});
