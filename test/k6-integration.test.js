import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startMock } from './mock-target.mjs';
import { validateConfig, PRESETS } from '../lib/config.js';

const K6 = process.env.K6_BIN || 'C:\\Program Files\\k6\\k6.exe';
const skip = existsSync(K6) ? false : 'k6 binary not found';
const root = resolve(import.meta.dirname, '..');
let mock;
before(async () => (mock = await startMock()));
after(() => mock?.close());

async function runK6(overrides) {
  const v = validateConfig({
    baseUrl: mock.url,
    testType: 'smoke',
    ...PRESETS.smoke,
    holdS: 5,
    thinkTimeS: 0.2,
    ownershipConfirmed: true,
    ...overrides,
  });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const dir = mkdtempSync(join(tmpdir(), 'perf-studio-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify(v.config));
  const fwd = (p) => p.replaceAll('\\', '/');
  const child = spawn(K6, ['run', 'k6/test.js'], {
    cwd: root,
    env: { ...process.env, CONFIG_PATH: fwd(join(dir, 'config.json')), RUN_DIR: fwd(dir) },
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const code = await new Promise((r) => child.on('close', r));
  const summaryFile = join(dir, 'summary.json');
  return {
    code,
    out,
    dir,
    summary: existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, 'utf8')) : undefined,
  };
}

test('smoke run writes the summary', { skip }, async () => {
  const r = await runK6({ endpoints: [{ method: 'GET', path: '/ok' }] });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.summary.requests > 0);
  assert.equal(r.summary.failPct, 0);
  assert.equal(r.summary.passed, true);
});

test('impossible threshold marks run failed', { skip }, async () => {
  const r = await runK6({ endpoints: [{ method: 'GET', path: '/slow' }], thresholds: { p95Ms: 1, errorPct: 1 } });
  assert.equal(r.code, 99, r.out);
  assert.equal(r.summary.passed, false);
});

test('no limits set: a slow call still passes and no limits are recorded', { skip }, async () => {
  const r = await runK6({ endpoints: [{ method: 'GET', path: '/slow' }], thresholds: { p95Ms: null, errorPct: null } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.summary.passed, true);
  assert.deepEqual(r.summary.limits, []);
  assert.ok(r.summary.requests > 0 && r.summary.endpoints[0].p95Ms > 0);
});

test('only one limit set: just that one is judged', { skip }, async () => {
  const r = await runK6({ endpoints: [{ method: 'GET', path: '/slow' }], thresholds: { p95Ms: 1, errorPct: null } });
  assert.equal(r.code, 99, r.out);
  assert.deepEqual(r.summary.limits.map((l) => l.what), ['p95']);
});

test('errorPct 0 passes when nothing fails', { skip }, async () => {
  const r = await runK6({ endpoints: [{ method: 'GET', path: '/ok' }], thresholds: { p95Ms: 5000, errorPct: 0 } });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.summary.passed, true);
});

test('credentials reach the site: bearer, api key and basic', { skip }, async () => {
  for (const [path, credentials] of [
    ['/secure', { type: 'bearer', token: 't1' }],
    ['/key', { type: 'apikey', header: 'X-Api-Key', value: 'k1' }],
    ['/basic', { type: 'basic', username: 'user', password: 'pa:ss' }],
  ]) {
    const r = await runK6({ endpoints: [{ method: 'GET', path }], credentials });
    assert.equal(r.code, 0, `${credentials.type}: ${r.out}`);
    assert.equal(r.summary.failPct, 0, credentials.type);
  }
});

test('wrong credentials are refused by the site, so the run fails', { skip }, async () => {
  const r = await runK6({ endpoints: [{ method: 'GET', path: '/secure' }], credentials: { type: 'bearer', token: 'nope' } });
  assert.equal(r.code, 99, r.out);
  assert.equal(r.summary.failPct, 100);
});

test('auth token is sent', { skip }, async () => {
  const r = await runK6({
    auth: { path: '/login', body: { user: 'u' }, tokenField: 'access_token' },
    endpoints: [{ method: 'GET', path: '/secure' }],
  });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.summary.failPct, 0);
});

test('bad login aborts', { skip }, async () => {
  const r = await runK6({
    auth: { path: '/login', body: { user: 'x' }, tokenField: 'access_token' },
    endpoints: [{ method: 'GET', path: '/secure' }],
  });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /login failed/);
});

test('per endpoint metrics, status classes and limits', { skip }, async () => {
  const odd = 'GET /search?q=a,b {x}: "y"';
  const r = await runK6({
    endpoints: [
      { method: 'GET', path: '/ok', name: odd },
      { method: 'GET', path: '/fail' },
      { method: 'GET', path: '/notfound' },
    ],
    thresholds: { p95Ms: 5000, errorPct: 100 },
  });
  assert.equal(r.code, 0, r.out);
  const [ok, fail, missing] = r.summary.endpoints;
  assert.equal(r.summary.endpoints.length, 3);
  assert.equal(ok.name, odd);
  assert.equal(fail.name, 'GET /fail');
  assert.ok(ok.requests > 0);
  assert.ok(ok.statusClasses['2xx'] > 0);
  assert.equal(ok.failPct, 0);
  assert.equal(fail.statusClasses['5xx'], fail.requests);
  assert.equal(fail.failPct, 100);
  assert.equal(missing.statusClasses['4xx'], missing.requests);
  for (const e of r.summary.endpoints) for (const k of ['avgMs', 'p50Ms', 'p90Ms', 'p95Ms', 'p99Ms', 'maxMs']) assert.equal(typeof e[k], 'number', `${e.name} ${k}`);
  assert.deepEqual(r.summary.limits.map((l) => [l.what, l.ok]), [['p95', true], ['errors', true]]);
  assert.equal(typeof r.summary.checksPassPct, 'number');
  assert.ok(r.summary.iterations > 0 && r.summary.durationS > 0 && r.summary.dataReceivedBytes > 0);
});
