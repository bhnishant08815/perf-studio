import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildK6Args, RunManager } from '../lib/runner.js';
import { startMock } from './mock-target.mjs';
import { validateConfig, PRESETS } from '../lib/config.js';

const K6 = process.env.K6_BIN || 'C:\\Program Files\\k6\\k6.exe';
const skip = existsSync(K6) ? false : 'k6 binary not found';
const root = resolve(import.meta.dirname, '..');
let mock;
before(async () => (mock = await startMock()));
after(() => mock?.close());

const cfg = (o = {}) => {
  const v = validateConfig({
    baseUrl: mock?.url ?? 'http://127.0.0.1:1',
    testType: 'smoke',
    ...PRESETS.smoke,
    holdS: 5,
    thinkTimeS: 0.2,
    endpoints: [{ method: 'GET', path: '/ok' }],
    ownershipConfirmed: true,
    ...o,
  });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return v.config;
};
const manager = () => new RunManager({ runsDir: mkdtempSync(join(tmpdir(), 'ps-runs-')), k6Bin: K6, root, apiPort: 6565 });
async function until(fn, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timed out waiting');
}
const finished = (m, id) => until(() => m.get(id).status !== 'running' && m.get(id));

test('buildK6Args without grafana has no --out and tags the run', () => {
  const { args, env } = buildK6Args(cfg(), { runId: 'r1', runDir: 'C:\\x\\r1', apiPort: 6565 });
  assert.deepEqual(args.slice(0, 5), ['run', '--address', '127.0.0.1:6565', '--tag', 'testid=r1']);
  assert.equal(args.at(-1), 'k6/test.js');
  assert.ok(!args.includes('--out'));
  assert.equal(env.CONFIG_PATH, 'C:/x/r1/config.json');
  assert.equal(env.RUN_DIR, 'C:/x/r1');
});

test('buildK6Args with grafana sends metrics to prometheus', () => {
  const c = cfg({ grafana: { enabled: true } });
  const { args, env } = buildK6Args(c, { runId: 'r1', runDir: 'C:\\x\\r1', apiPort: 6565 });
  assert.ok(args.join(' ').includes('--out experimental-prometheus-rw'));
  assert.equal(env.K6_PROMETHEUS_RW_SERVER_URL, 'http://localhost:9090/api/v1/write');
  assert.equal(env.K6_PROMETHEUS_RW_TREND_STATS, 'p(50),p(95),p(99),max');
});

test('a smoke run ends passed with a summary', { skip }, async () => {
  const m = manager();
  const { id } = m.start(cfg());
  const run = await finished(m, id);
  assert.equal(run.status, 'passed', run.logTail.join('\n'));
  assert.ok(run.summary.requests > 0);
});

test('second start while running is BUSY, stop on a finished run is false', { skip }, async () => {
  const m = manager();
  const { id } = m.start(cfg());
  assert.throws(() => m.start(cfg()), (e) => e.code === 'BUSY');
  await finished(m, id);
  assert.equal(await m.stop(id), false);
});

test('stop ends a long run as stopped and still writes the report', { skip }, async () => {
  const m = manager();
  const { id } = m.start(cfg({ holdS: 60 }));
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(await m.stop(id), true);
  const run = await finished(m, id);
  assert.equal(run.status, 'stopped');
  assert.ok(m.reportPath(id), 'report.html should exist after a graceful stop');
});

test('bad login ends as error and says why', { skip }, async () => {
  const m = manager();
  const { id } = m.start(cfg({ auth: { path: '/login', body: { user: 'x' }, tokenField: 'access_token' }, endpoints: [{ method: 'GET', path: '/secure' }] }));
  const run = await finished(m, id);
  assert.equal(run.status, 'error');
  assert.match(run.logTail.join('\n'), /login failed/);
});

test('shutdown stops the active k6 so it cannot keep loading the target', { skip }, async () => {
  const m = manager();
  const { id } = m.start(cfg({ holdS: 60 }));
  await new Promise((r) => setTimeout(r, 3000));
  m.shutdown();
  const run = await finished(m, id);
  assert.equal(run.status, 'stopped');
});
