import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, LIMITS, PRESETS } from '../lib/config.js';

const good = () => ({
  baseUrl: 'https://hire-uat.fly.dev/',
  testType: 'smoke',
  ...PRESETS.smoke,
  endpoints: [{ method: 'GET', path: '/login' }],
  ownershipConfirmed: true,
});

const rejects = (mutate, field) => {
  const raw = good();
  mutate(raw);
  const r = validateConfig(raw);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes(field)), `expected an error naming "${field}", got ${JSON.stringify(r.errors)}`);
};

test('valid config passes, trailing slash is stripped, defaults applied', () => {
  const r = validateConfig(good());
  assert.equal(r.ok, true);
  assert.equal(r.config.baseUrl, 'https://hire-uat.fly.dev');
  assert.equal(r.config.thinkTimeS, 1);
  assert.deepEqual(r.config.thresholds, { p95Ms: 1000, errorPct: 1 });
  assert.deepEqual(r.config.endpoints[0].headers, {});
  assert.deepEqual(r.config.grafana, { enabled: false, url: 'http://localhost:9090/api/v1/write' });
  assert.deepEqual(r.config.stressSteps, [0.5, 1, 1.5, 2]);
  assert.equal(r.config.name, 'smoke hire-uat.fly.dev');
});

test('rejects missing ownership confirmation', () => rejects((c) => delete c.ownershipConfirmed, 'ownershipConfirmed'));
test('rejects non http baseUrl', () => rejects((c) => (c.baseUrl = 'ftp://x'), 'baseUrl'));
test('rejects empty endpoints', () => rejects((c) => (c.endpoints = []), 'endpoints'));
test('rejects path without leading slash', () => rejects((c) => (c.endpoints[0].path = 'login'), 'path'));
test('rejects peakUsers above the limit', () => rejects((c) => (c.peakUsers = 100000), 'peakUsers'));
test('rejects unknown testType', () => rejects((c) => (c.testType = 'chaos'), 'testType'));
test('rejects total duration above the limit', () => rejects((c) => ((c.rampUpS = 5000), (c.holdS = 3000)), 'duration'));
test('rejects non string header value', () => rejects((c) => (c.endpoints[0].headers = { A: 1 }), 'headers'));
test('rejects too many endpoints', () =>
  rejects((c) => (c.endpoints = Array.from({ length: LIMITS.maxEndpoints + 1 }, () => ({ method: 'GET', path: '/x' }))), 'endpoints'));
