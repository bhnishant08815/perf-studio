import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMetrics, toPoint } from '../lib/timeline.js';

const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/k6-metrics-${n}.json`, import.meta.url), 'utf8'));

test('parseMetrics reads users, requests, failures and latency from a real k6 response', () => {
  const s = parseMetrics(fixture(2));
  assert.equal(s.users, 3);
  assert.equal(s.reqs, 240);
  assert.equal(s.failed, 120); // rate 0.5 of 240
  assert.ok(Math.abs(s.avgMs - 1.884) < 0.001);
  assert.ok(Math.abs(s.p95Ms - 3.71) < 0.001);
});

test('parseMetrics copes with metrics that do not exist yet', () => {
  assert.deepEqual(parseMetrics({ data: [] }), { users: 0, reqs: 0, failed: 0, avgMs: 0, p95Ms: 0 });
});

test('toPoint turns two snapshots into one window', () => {
  const prev = { users: 2, reqs: 100, failed: 10, avgMs: 20, p95Ms: 40 };
  const next = { users: 4, reqs: 150, failed: 20, avgMs: 30, p95Ms: 55 };
  assert.deepEqual(toPoint(prev, next, 10, 5), { t: 10, users: 4, rps: 10, failPct: 20, avgMs: 50, p95SoFarMs: 55 });
});

test('a window with no new requests has no latency and zero rate', () => {
  const s = { users: 1, reqs: 100, failed: 0, avgMs: 20, p95Ms: 40 };
  assert.deepEqual(toPoint(s, s, 15, 5), { t: 15, users: 1, rps: 0, failPct: 0, avgMs: null, p95SoFarMs: 40 });
});

test('toPoint on the two real fixtures gives a sane window', () => {
  const p = toPoint(parseMetrics(fixture(1)), parseMetrics(fixture(2)), 11, 5);
  assert.ok(p.rps > 0);
  assert.ok(p.failPct >= 0 && p.failPct <= 100);
  assert.ok(p.avgMs > 0);
});
