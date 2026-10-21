import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../server.mjs';

const busy = Object.assign(new Error('busy'), { code: 'BUSY' });
const stub = { start: () => { throw busy; }, get: () => undefined, list: () => [], stop: async () => false, reportPath: () => undefined };
let server, port;
before(async () => {
  server = createServer({ manager: stub, port: 0 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => new Promise((r) => (server.closeAllConnections(), server.close(r))));

const call = (method, path, { host, type, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { host: host ?? `127.0.0.1:${port}`, ...(type ? { 'content-type': type } : {}) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, text: raw, json: () => JSON.parse(raw) }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });

const goodBody = JSON.stringify({
  baseUrl: 'https://example.com',
  testType: 'smoke',
  peakUsers: 1,
  rampUpS: 0,
  holdS: 5,
  rampDownS: 0,
  endpoints: [{ method: 'GET', path: '/' }],
  ownershipConfirmed: true,
});

test('foreign Host header is rejected with 403', async () => {
  const r = await call('POST', '/api/runs', { host: 'evil.example', type: 'application/json', body: goodBody });
  assert.equal(r.status, 403);
});

test('non json content type is rejected with 415', async () => {
  const r = await call('POST', '/api/runs', { type: 'text/plain', body: goodBody });
  assert.equal(r.status, 415);
});

test('invalid config returns 400 with an errors list', async () => {
  const r = await call('POST', '/api/runs', { type: 'application/json', body: '{"baseUrl":"nope"}' });
  assert.equal(r.status, 400);
  assert.ok(Array.isArray(r.json().errors));
});

test('malformed json returns 400', async () => {
  const r = await call('POST', '/api/runs', { type: 'application/json', body: '{oops' });
  assert.equal(r.status, 400);
});

test('a run already active returns 409', async () => {
  const r = await call('POST', '/api/runs', { type: 'application/json', body: goodBody });
  assert.equal(r.status, 409);
});

test('report path traversal and unknown ids return 404', async () => {
  assert.equal((await call('GET', '/runs/..%2f..%2fpackage.json/report.html')).status, 404);
  assert.equal((await call('GET', '/runs/../package.json/report.html')).status, 404);
  assert.equal((await call('GET', '/runs/20260101-000000-abcd/report.html')).status, 404);
});

test('serves the page and the shared browser modules, nothing else from lib', async () => {
  const page = await call('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>Perf Studio<\/title>/);
  for (const f of ['config', 'form', 'stages', 'importers', 'charts']) assert.equal((await call('GET', `/lib/${f}.js`)).status, 200);
  assert.equal((await call('GET', '/lib/runner.js')).status, 404);
  assert.equal((await call('GET', '/lib/..%2fserver.mjs')).status, 404);
});

test('defaults expose presets and limits', async () => {
  const d = (await call('GET', '/api/defaults')).json();
  assert.equal(d.presets.load.peakUsers, 20);
  assert.equal(d.limits.maxUsers, 500);
});
