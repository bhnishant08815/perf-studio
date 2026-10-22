import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeShape, fmtDuration, parseHeaders, presetFor } from '../lib/form.js';

test('fmtDuration speaks plain English', () => {
  assert.equal(fmtDuration(45), '45 seconds');
  assert.equal(fmtDuration(1), '1 second');
  assert.equal(fmtDuration(60), '1 minute');
  assert.equal(fmtDuration(105), '1 minute 45 seconds');
  assert.equal(fmtDuration(120), '2 minutes');
  assert.equal(fmtDuration(3600), '1 hour');
  assert.equal(fmtDuration(3660), '1 hour 1 minute');
});

test('describeShape for load is exact', () => {
  const s = describeShape({ testType: 'load', peakUsers: 20, rampUpS: 30, holdS: 60, rampDownS: 15 });
  assert.equal(s, 'Add users gradually up to 20 over 30 seconds, keep 20 active for 1 minute, then wind down over 15 seconds. Total time: about 1 minute 45 seconds.');
});

test('describeShape for spike mentions peak and total time', () => {
  const s = describeShape({ testType: 'spike', ...presetFor('spike') });
  assert.ok(s.includes('100'), s);
  assert.ok(s.includes('2 minutes'), s);
});

test('describeShape for stress lists the user steps', () => {
  const s = describeShape({ testType: 'stress', peakUsers: 10, stressSteps: [0.5, 1, 2], rampUpS: 10, holdS: 20, rampDownS: 5 });
  assert.ok(s.includes('5, 10, 20'), s);
});

test('parseHeaders reads Name: value lines and keeps colons in values', () => {
  assert.deepEqual(parseHeaders('A: b\n\nC: d: e'), { A: 'b', C: 'd: e' });
  assert.deepEqual(parseHeaders(''), {});
});

test('parseHeaders names the bad line', () => {
  assert.throws(() => parseHeaders('A: b\noops'), { message: 'Header line "oops" needs "Name: value"' });
});

test('presetFor returns the soak preset', () => {
  assert.equal(presetFor('soak').holdS, 3600);
});

import { filterEndpoints, groupEndpoints, toConfigEndpoints } from '../lib/form.js';

const imported = [
  { id: 'i0', group: 'Shop / Orders', name: 'Refund', method: 'POST', path: '/orders/7/refund', headers: { A: 'b' }, body: '{}', warnings: [], selectable: true },
  { id: 'i1', group: 'Catalog', name: 'List', method: 'GET', path: '/products', headers: {}, warnings: [], selectable: true },
  { id: 'i2', group: 'Shop / Orders', name: 'Status', method: 'GET', path: '/health', headers: {}, warnings: ['x'], selectable: false },
  { id: 'i3', group: 'Catalog', name: 'One', method: 'GET', path: '/orders-archive', headers: {}, warnings: [], selectable: true },
];

test('filterEndpoints matches group, path, name and method, ignoring case', () => {
  assert.deepEqual(filterEndpoints(imported, 'ORDERS').map((e) => e.id), ['i0', 'i2', 'i3']);
  assert.deepEqual(filterEndpoints(imported, 'post').map((e) => e.id), ['i0']);
  assert.deepEqual(filterEndpoints(imported, 'list').map((e) => e.id), ['i1']);
  assert.equal(filterEndpoints(imported, '  ').length, 4);
});

test('groupEndpoints keeps first seen order', () => {
  assert.deepEqual(groupEndpoints(imported).map((g) => [g.group, g.items.map((e) => e.id)]), [
    ['Shop / Orders', ['i0', 'i2']],
    ['Catalog', ['i1', 'i3']],
  ]);
});

test('toConfigEndpoints keeps import order, skips non selectable, carries name and group', () => {
  const got = toConfigEndpoints(imported, new Set(['i3', 'i2', 'i0']));
  assert.deepEqual(got, [
    { method: 'POST', path: '/orders/7/refund', headers: { A: 'b' }, body: '{}', name: 'Refund', group: 'Shop / Orders' },
    { method: 'GET', path: '/orders-archive', headers: {}, name: 'One', group: 'Catalog' },
  ]);
});

import { plannedPhase, latestMetrics } from '../lib/form.js';

test('load test phases follow the ramp', () => {
  const cfg = { testType: 'load', peakUsers: 10, rampUpS: 30, holdS: 60, rampDownS: 30 };
  assert.equal(plannedPhase(cfg, 10).label, 'Building up');
  assert.equal(plannedPhase(cfg, 50).label, 'Holding');
  assert.equal(plannedPhase(cfg, 100).label, 'Winding down');
  assert.deepEqual(plannedPhase(cfg, 200), { label: 'Finishing', stage: 3, stages: 3 });
});

test('smoke holds from the start', () => {
  const cfg = { testType: 'smoke', peakUsers: 1, rampUpS: 0, holdS: 30, rampDownS: 0 };
  assert.equal(plannedPhase(cfg, 5).label, 'Holding');
});

test('latest metrics skip a null average', () => {
  const timeline = [
    { t: 5, users: 2, rps: 1, failPct: 0, avgMs: 120, p95SoFarMs: 200 },
    { t: 10, users: 4, rps: 2, failPct: 0, avgMs: null, p95SoFarMs: 210 },
  ];
  assert.deepEqual(latestMetrics(timeline), { users: 4, rps: 2, avgMs: 120, failPct: 0, p95SoFarMs: 210 });
});

test('latest metrics of nothing are null', () => {
  const none = { users: null, rps: null, avgMs: null, failPct: null, p95SoFarMs: null };
  assert.deepEqual(latestMetrics([]), none);
  assert.deepEqual(latestMetrics(undefined), none);
});
