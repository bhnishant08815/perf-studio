import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../lib/report.js';

const odd = 'GET /search?q=a,b {x}: "y" <tag>';
const run = (o = {}) => ({
  id: 'r1',
  name: 'load shop.test',
  startedAt: '2026-10-21T05:00:00.000Z',
  config: {
    name: 'load shop.test',
    baseUrl: 'https://shop.test',
    testType: 'load',
    peakUsers: 20,
    rampUpS: 30,
    holdS: 60,
    rampDownS: 15,
    thinkTimeS: 1,
    thresholds: { p95Ms: 1000, errorPct: 1 },
    endpoints: [
      { method: 'GET', path: '/a', name: odd, headers: { Authorization: 'Bearer secret-token' } },
      { method: 'POST', path: '/b', headers: {}, body: '{"password":"x"}' },
    ],
    auth: { path: '/login', body: { password: 'hunter2' }, tokenField: 't' },
  },
  ...o,
});
const endpoint = (name, p95, o = {}) => ({ id: 'e0', name, method: 'GET', path: '/a', requests: 100, failPct: 0, avgMs: p95 / 2, p50Ms: p95 / 2, p90Ms: p95 * 0.9, p95Ms: p95, p99Ms: p95 * 1.2, maxMs: p95 * 2, statusClasses: { '2xx': 100, '3xx': 0, '4xx': 0, '5xx': 0, none: 0 }, ...o });
const summary = (o = {}) => ({
  passed: true,
  requests: 200,
  failPct: 0,
  p50Ms: 120,
  p95Ms: 300,
  maxMs: 900,
  peakUsers: 20,
  checksPassPct: 100,
  iterations: 100,
  durationS: 105,
  dataReceivedBytes: 5_000_000,
  dataSentBytes: 20_000,
  endpoints: [endpoint(odd, 200), endpoint('POST /b', 400, { id: 'e1', method: 'POST', path: '/b' })],
  limits: [
    { what: 'p95', limit: 1000, actual: 300, ok: true },
    { what: 'errors', limit: 1, actual: 0, ok: true },
  ],
  ...o,
});
const timeline = [
  { t: 5, users: 4, rps: 3, failPct: 0, avgMs: 110, p95SoFarMs: 200 },
  { t: 10, users: 8, rps: 7, failPct: 0, avgMs: null, p95SoFarMs: 250 },
  { t: 15, users: 12, rps: 9, failPct: 1, avgMs: 140, p95SoFarMs: 300 },
];

test('sections appear in the planned order', () => {
  const html = buildReport({ run: run(), summary: summary(), timeline, previous: { summary: summary({ p95Ms: 200 }) } });
  const order = ['class="verdict', 'Key numbers', 'What we tested', 'Over time', 'Per page or API', 'Your limits', 'Compared with last run', 'Plain English glossary'];
  const at = order.map((s) => html.indexOf(s));
  assert.ok(at.every((i) => i > 0), JSON.stringify(order.filter((_, i) => at[i] < 0)));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test('one table row per endpoint, slowest first, names escaped', () => {
  const html = buildReport({ run: run(), summary: summary(), timeline, previous: undefined });
  const rows = html.split('<tr class="ep-row">').length - 1;
  assert.equal(rows, 2);
  assert.ok(html.indexOf('POST /b') < html.indexOf('GET /search?q=a,b {x}: &quot;y&quot; &lt;tag&gt;'));
  assert.ok(!html.includes('<tag>'));
});

test('a failed run says Not ready', () => {
  assert.match(buildReport({ run: run(), summary: summary({ passed: false }), timeline, previous: undefined }), /<h2>Not ready<\/h2>/);
});

test('an empty timeline says so and draws no line chart', () => {
  const html = buildReport({ run: run(), summary: summary(), timeline: [], previous: undefined });
  assert.match(html, /No timeline data for this run/);
  assert.ok(!html.includes('class="line '));
});

test('no previous run hides the comparison', () => {
  assert.ok(!buildReport({ run: run(), summary: summary(), timeline, previous: undefined }).includes('Compared with last run'));
});

test('a slower p95 than last run shows the change in words', () => {
  const html = buildReport({ run: run(), summary: summary({ p95Ms: 450 }), timeline, previous: { summary: summary({ p95Ms: 300 }) } });
  assert.match(html, /\+50%/);
  assert.match(html, /slower/);
});

test('header values, request bodies and login details never appear', () => {
  const html = buildReport({ run: run(), summary: summary(), timeline, previous: undefined });
  for (const secret of ['secret-token', 'password', 'hunter2']) assert.ok(!html.includes(secret), secret);
});

test('print styles and a Save as PDF button', () => {
  const html = buildReport({ run: run(), summary: summary(), timeline, previous: undefined });
  assert.match(html, /@media print/);
  assert.match(html, /window\.print\(\)/);
  assert.match(html, /Save as PDF/);
});

test('your limits are written in words', () => {
  const html = buildReport({ run: run(), summary: summary(), timeline, previous: undefined });
  assert.match(html, /Slowest 1 in 20 under 1000 ms: 300 ms, met/);
  assert.match(html, /Failed requests under 1%: 0.00%, met/);
});

test('every chart has a visible title, not only a hidden svg title', () => {
  const html = buildReport({ run: run(), summary: summary(), timeline, previous: undefined });
  for (const t of ['People on the site', 'Requests per second', 'Response time', 'Share of requests that failed', 'Slow 1 in 20, per page or API (slowest first)', 'How each page or API answered']) {
    assert.ok(html.includes(`<figcaption>${t}</figcaption>`), t);
  }
});

test('cards graded by your limits say so, instead of a bare Good', () => {
  const html = buildReport({ run: run(), summary: summary({ failPct: 33, limits: [] }), timeline, previous: undefined });
  const card = html.slice(html.indexOf('Did the site stay up?'), html.indexOf('How fast did pages feel?'));
  assert.match(card, /Over your limit/);
  const ok = buildReport({ run: run({ config: { ...run().config, thresholds: { p95Ms: 1000, errorPct: 40 } } }), summary: summary({ failPct: 33 }), timeline, previous: undefined });
  const okCard = ok.slice(ok.indexOf('Did the site stay up?'), ok.indexOf('How fast did pages feel?'));
  assert.match(okCard, /Within your limit/);
  assert.ok(!okCard.includes('>Good<'));
});

test('with no limits set, nothing is judged against a limit', () => {
  const none = { p95Ms: null, errorPct: null };
  const html = buildReport({ run: run({ config: { ...run().config, thresholds: none } }), summary: summary({ failPct: 33, passed: true, limits: [] }), timeline, previous: undefined });
  assert.ok(!html.includes('Over your limit') && !html.includes('Within your limit'));
  assert.ok(html.includes('You set no limits for this run.'));
  assert.ok(!html.includes('met your limits'));
  assert.ok(!html.includes('class="bad">33.00%'), 'a failure rate is not flagged without a limit');
});

test('status legend lists only the answers that happened', () => {
  const html = buildReport({ run: run(), summary: summary(), timeline, previous: undefined });
  assert.ok(html.includes('Worked (2xx)'));
  assert.ok(!html.includes('No answer'));
});

test('report has an inline favicon so the browser does not ask the server', () => {
  assert.match(buildReport({ run: run(), summary: summary(), timeline, previous: undefined }), /<link rel="icon" href="data:,">/);
});

test('query values in paths never reach the report', () => {
  const s = summary();
  s.endpoints[0].path = '/s?api_key=SECRET123';
  const html = buildReport({ run: run(), summary: s, timeline, previous: undefined });
  assert.ok(!html.includes('SECRET123'));
  assert.ok(html.includes('/s?api_key=***'));
});
