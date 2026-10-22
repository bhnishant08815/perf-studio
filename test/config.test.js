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

test('limits are optional: null means no limit, each one independently', () => {
  const r = validateConfig({ ...good(), thresholds: { p95Ms: null, errorPct: 5 } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.config.thresholds, { p95Ms: null, errorPct: 5 });
  assert.deepEqual(validateConfig({ ...good(), thresholds: { p95Ms: null, errorPct: null } }).config.thresholds, { p95Ms: null, errorPct: null });
});

const withCred = (credentials, extra = {}) => validateConfig({ ...good(), credentials, ...extra });

test('credentials: each type is accepted and passed through unchanged', () => {
  for (const c of [
    { type: 'bearer', token: 'abc.def' },
    { type: 'apikey', header: 'X-Api-Key', value: 'k1' },
    { type: 'basic', username: 'user', password: 'pa:ss' },
  ]) {
    const r = withCred(c);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(r.config.credentials, c);
  }
  assert.ok(!('credentials' in validateConfig(good()).config), 'no credentials key when none are given');
  assert.ok(!('credentials' in withCred(null).config), 'null means none');
});

test('credentials: bad input is rejected with a message naming the field', () => {
  const bad = (c, word, extra) => {
    const r = withCred(c, extra);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes(word)), `expected "${word}" in ${JSON.stringify(r.errors)}`);
  };
  bad({ type: 'oauth' }, 'credentials.type');
  bad('token', 'credentials');
  bad({ type: 'bearer', token: '' }, 'credentials.token');
  bad({ type: 'bearer', token: 'a\r\nX-Evil: 1' }, 'credentials.token');
  bad({ type: 'apikey', header: 'bad header', value: 'v' }, 'credentials.header');
  bad({ type: 'apikey', header: 'X-Key', value: '' }, 'credentials.value');
  bad({ type: 'basic', username: '', password: 'p' }, 'credentials.username');
  bad({ type: 'basic', username: 'a:b', password: 'p' }, 'credentials.username');
  bad({ type: 'basic', username: 'u', password: 5 }, 'credentials.password');
  bad({ type: 'bearer', token: 't' }, 'either', { auth: { path: '/login', body: {}, tokenField: 't' } });
});

test('a Breakpoint test needs at least one limit, or it never stops early', () => {
  const bp = (thresholds) => ({ ...good(), testType: 'breakpoint', ...PRESETS.breakpoint, thresholds });
  const none = validateConfig(bp({ p95Ms: null, errorPct: null }));
  assert.equal(none.ok, false);
  assert.ok(none.errors.some((e) => e.includes('Breakpoint')), JSON.stringify(none.errors));
  assert.equal(validateConfig(bp({ p95Ms: null, errorPct: 5 })).ok, true);
  assert.equal(validateConfig({ ...good(), thresholds: { p95Ms: null, errorPct: null } }).ok, true, 'other test types may have no limits');
});

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
test('rejects total duration above the limit', () => rejects((c) => ((c.testType = 'load'), (c.rampUpS = 5000), (c.holdS = 3000)), 'duration'));
test('rejects non string header value', () => rejects((c) => (c.endpoints[0].headers = { A: 1 }), 'headers'));
test('rejects too many endpoints', () =>
  rejects((c) => (c.endpoints = Array.from({ length: LIMITS.maxEndpoints + 1 }, () => ({ method: 'GET', path: '/x' }))), 'endpoints'));

const many = (n) => Array.from({ length: n }, (_, i) => ({ method: 'GET', path: `/x${i}` }));
test('accepts 50 endpoints', () => {
  const raw = good();
  raw.endpoints = many(50);
  assert.equal(validateConfig(raw).ok, true);
});
test('rejects 51 endpoints', () => rejects((c) => (c.endpoints = many(51)), 'endpoints'));
test('keeps endpoint name and group', () => {
  const raw = good();
  raw.endpoints[0] = { method: 'GET', path: '/a', name: 'List', group: 'Shop' };
  const e = validateConfig(raw).config.endpoints[0];
  assert.equal(e.name, 'List');
  assert.equal(e.group, 'Shop');
});
test('rejects an endpoint name over 120 characters', () => rejects((c) => (c.endpoints[0].name = 'x'.repeat(121)), 'name'));
test('rejects a non string body', () => rejects((c) => (c.endpoints[0].body = { a: 1 }), 'body'));

const stress = (c, o) => Object.assign(c, { testType: 'stress', peakUsers: 500, rampUpS: 3000, holdS: 3000, rampDownS: 200, ...o });

test('rejects stress steps that would exceed the user and time limits', () => {
  const raw = good();
  stress(raw, { stressSteps: [5, 5, 5, 5, 5, 5, 5, 5] });
  const r = validateConfig(raw);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('users')), JSON.stringify(r.errors));
  assert.ok(r.errors.some((e) => e.includes('duration')), JSON.stringify(r.errors));
});

test('rejects more than 10 stress steps', () => rejects((c) => stress(c, { peakUsers: 5, rampUpS: 5, holdS: 5, rampDownS: 5, stressSteps: Array(11).fill(1) }), 'stressSteps'));
test('rejects a test with zero total duration', () => rejects((c) => (c.holdS = 0), 'duration'));
test('rejects negative thinkTimeS', () => rejects((c) => (c.thinkTimeS = -5), 'thinkTimeS'));
test('rejects non numeric p95Ms', () => rejects((c) => (c.thresholds = { p95Ms: 'abc' }), 'p95Ms'));
test('rejects errorPct above 100', () => rejects((c) => (c.thresholds = { errorPct: 150 }), 'errorPct'));
test('rejects expectStatus given as text', () => rejects((c) => (c.endpoints[0].expectStatus = '200'), 'expectStatus'));
test('rejects a header name with a space', () => rejects((c) => (c.endpoints[0].headers = { 'Bad Header': 'x' }), 'headers'));
test('rejects an auth header name with a space', () => rejects((c) => (c.auth = { path: '/login', tokenField: 't', header: 'Bad Header' }), 'auth.header'));
test('rejects an auth method other than POST', () => rejects((c) => (c.auth = { path: '/login', tokenField: 't', method: 'TRACE' }), 'auth.method'));

import { maskQuery } from '../lib/config.js';
test('maskQuery hides every query value and keeps the names', () => {
  assert.equal(maskQuery('/s?api_key=SECRET&page=2'), '/s?api_key=***&page=***');
  assert.equal(maskQuery('/plain/path'), '/plain/path');
  assert.equal(maskQuery('/s?flag'), '/s?flag');
});
