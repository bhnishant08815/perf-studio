import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainRun } from '../lib/explain.js';

const cfg = (o = {}) => ({
  baseUrl: 'https://shop.test',
  peakUsers: 100,
  endpoints: [{ method: 'POST', path: '/api/auth/login' }],
  thresholds: { p95Ms: 1000, errorPct: 1 },
  ...o,
});
const classes = (o = {}) => ({ '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, none: 0, ...o });
const ep = (name, statusClasses, o = {}) => ({ name, requests: Object.values(statusClasses).reduce((a, b) => a + b, 0), failPct: 0, statusClasses, ...o });
const sum = (o = {}) => ({ passed: false, requests: 1745, failPct: 100, p95Ms: 344, endpoints: [], limits: [], ...o });
const limits = (p95, errors) => [
  { what: 'p95', limit: 1000, actual: p95.actual, ok: p95.ok },
  { what: 'errors', limit: 1, actual: errors.actual, ok: errors.ok },
];

const REFUSED = 'Nearly every request was refused by the site, so this test could not measure real speed.';
const MANY_REFUSED = 'Many requests were refused by the site, so some calls are being turned away.';
const NOT_JUDGED = 'Some requests failed. You set no limits, so this was not judged.';

test('refused login, speed fine: says refused, names the call, says what to do', () => {
  const r = explainRun({
    cfg: cfg(),
    summary: sum({ endpoints: [ep('Login', classes({ '4xx': 1745 }), { failPct: 100 })], limits: limits({ actual: 344, ok: true }, { actual: 100, ok: false }) }),
  });
  assert.equal(r.headline, REFUSED);
  assert.equal(r.found[0], 'You asked for fewer than 1% of requests to fail. 100% failed.');
  assert.ok(r.found.includes('Login: every request was refused (answer type 4xx).'));
  assert.ok(r.found.includes('Speed was fine (the slowest 1 in 20 took 344 ms), but that only measures how fast the site said no.'));
  assert.equal(r.next[0], 'Check the address and the login details for Login, then run again.');
  assert.equal(r.did, 'We sent up to 100 people at once to https://shop.test, visiting 1 page or API call.');
});

test('a website address that already holds a page is named as the cause', () => {
  const c = cfg({ baseUrl: 'https://hire-uat.fly.dev/login', endpoints: [{ method: 'POST', path: '/api/auth/login' }] });
  const summary = sum({ endpoints: [ep('Login', classes({ '4xx': 1745 }), { failPct: 100 })], limits: limits({ actual: 344, ok: true }, { actual: 100, ok: false }) });
  const r = explainRun({ cfg: c, summary });
  assert.equal(r.found[0], 'Your website address includes "/login", so calls went to https://hire-uat.fly.dev/login/api/auth/login.');
  assert.equal(r.next[0], 'Change the website address to just https://hire-uat.fly.dev, then run again.');
  const silent = explainRun({ cfg: c, summary: sum({ requests: 100, endpoints: [ep('Login', classes({ none: 100 }), { failPct: 100 })] }) });
  assert.equal(silent.found[0], r.found[0]);
  assert.equal(silent.next[0], r.next[0]);
  const plain = explainRun({ cfg: { ...c, baseUrl: 'https://hire-uat.fly.dev/' }, summary });
  assert.ok(!plain.found.some((l) => l.includes('Your website address')));
  assert.equal(plain.next[0], 'Check the address and the login details for Login, then run again.');
});

test('one person reads "1 person", and a smoke test is not told to run a smoke test', () => {
  const r = explainRun({
    cfg: cfg({ peakUsers: 1, testType: 'smoke' }),
    summary: sum({ endpoints: [ep('Login', classes({ '4xx': 1745 }), { failPct: 100 })], limits: limits({ actual: 344, ok: true }, { actual: 100, ok: false }) }),
  });
  assert.equal(r.did, 'We sent up to 1 person at once to https://shop.test, visiting 1 page or API call.');
  assert.ok(!r.next.some((l) => l.includes('Smoke test')));
  assert.equal(r.next.length, 2);
});

test('one endpoint refused, another fine: names only the refused one', () => {
  const r = explainRun({
    cfg: cfg({ endpoints: [{}, {}] }),
    summary: sum({
      requests: 200,
      failPct: 50,
      endpoints: [ep('Login', classes({ '4xx': 100 }), { failPct: 100 }), ep('Home', classes({ '2xx': 100 }))],
      limits: limits({ actual: 300, ok: true }, { actual: 50, ok: false }),
    }),
  });
  assert.equal(r.headline, MANY_REFUSED);
  assert.ok(r.found.includes('Login: every request was refused (answer type 4xx).'));
  assert.ok(!r.found.some((l) => l.includes('Home')));
  assert.equal(r.did, 'We sent up to 100 people at once to https://shop.test, visiting 2 pages or API calls.');
});

test('stopped by the user wins over everything', () => {
  const r = explainRun({ cfg: cfg(), stopped: true, summary: sum({ endpoints: [ep('Login', classes({ '4xx': 1745 }))] }) });
  assert.equal(r.headline, 'You stopped this test early, so these numbers cover only part of it.');
  assert.deepEqual(r.next, ['Press Run test again.']);
  assert.equal(r.found.length, 1);
});

test('no limits set and some failures: never says missed or your limit', () => {
  const r = explainRun({
    cfg: cfg({ thresholds: { p95Ms: null, errorPct: null } }),
    summary: sum({ passed: true, requests: 100, failPct: 3, endpoints: [ep('A', classes({ '2xx': 97, '5xx': 3 }), { failPct: 3 })], limits: [] }),
  });
  assert.equal(r.headline, NOT_JUDGED);
  const all = JSON.stringify(r);
  assert.doesNotMatch(all, /missed/);
  assert.doesNotMatch(all, /your limit/);
});

test('no limits and a mixed run: never says "handled", and names the refused call', () => {
  const r = explainRun({
    cfg: cfg({ thresholds: { p95Ms: null, errorPct: null } }),
    summary: sum({ passed: true, requests: 200, failPct: 50, endpoints: [ep('Login', classes({ '4xx': 100 }), { failPct: 100 }), ep('Home', classes({ '2xx': 100 }))], limits: [] }),
  });
  assert.equal(r.headline, NOT_JUDGED);
  assert.ok(r.found.includes('Login: every request was refused (answer type 4xx).'));
  assert.doesNotMatch(JSON.stringify(r), /handled/);
});

test('only a speed limit set and some failures: says failures were not judged', () => {
  const r = explainRun({
    cfg: cfg({ thresholds: { p95Ms: 1000, errorPct: null } }),
    summary: sum({ passed: true, requests: 200, failPct: 50, p95Ms: 300, endpoints: [ep('Login', classes({ '4xx': 100 }), { failPct: 100 }), ep('Home', classes({ '2xx': 100 }))], limits: [] }),
  });
  assert.equal(r.headline, 'The site stayed within your speed limit, but some requests failed and you set no limit for that.');
  assert.ok(r.found.includes('Login: every request was refused (answer type 4xx).'));
});

test('just under the refused cut off is not described as coping', () => {
  const r = explainRun({
    cfg: cfg(),
    summary: sum({ requests: 100, failPct: 89, endpoints: [ep('Login', classes({ '4xx': 89, '2xx': 11 }), { failPct: 89 })], limits: limits({ actual: 300, ok: true }, { actual: 89, ok: false }) }),
  });
  assert.equal(r.headline, MANY_REFUSED);
});

test('a small share of refused requests still reads as coping', () => {
  const r = explainRun({
    cfg: cfg(),
    summary: sum({ requests: 100, failPct: 10, endpoints: [ep('Login', classes({ '4xx': 10, '2xx': 90 }), { failPct: 10 })], limits: limits({ actual: 300, ok: true }, { actual: 10, ok: false }) }),
  });
  assert.equal(r.headline, 'The site coped, but more requests failed than you allowed.');
});

test('an expected 4xx answer is not a refusal', () => {
  const r = explainRun({
    cfg: cfg({ endpoints: [{ method: 'GET', path: '/gone', expectStatus: 404 }] }),
    summary: sum({ passed: true, requests: 100, failPct: 0, p95Ms: 200, endpoints: [ep('Gone', classes({ '4xx': 100 }), { failPct: 0 })], limits: limits({ actual: 200, ok: true }, { actual: 0, ok: true }) }),
  });
  assert.equal(r.headline, 'The site handled this traffic and met every limit you set.');
});

test('an old summary with no statusClasses or limits does not throw', () => {
  const r = explainRun({ cfg: cfg(), summary: { requests: 50, failPct: 0, p95Ms: 200, passed: true, endpoints: [{ name: 'A', requests: 50 }] } });
  assert.ok(r.found.length >= 1);
  assert.ok(r.next.length >= 1);
});

test('zero requests: says there is no result', () => {
  const r = explainRun({ cfg: cfg(), summary: sum({ requests: 0, failPct: 0, endpoints: [] }) });
  assert.equal(r.headline, 'No requests were sent, so there is no result.');
  assert.deepEqual(r.next, ['Check the address and press Run test again.']);
});

test('no answer from the site: says it did not answer', () => {
  const r = explainRun({ cfg: cfg(), summary: sum({ requests: 100, endpoints: [ep('Home', classes({ none: 100 }), { failPct: 100 })] }) });
  assert.equal(r.headline, 'The site did not answer, so there is nothing to measure yet.');
  assert.ok(r.found.includes('Home: the site did not answer.'));
});

test('server errors: says the site broke and shows the share', () => {
  const r = explainRun({
    cfg: cfg(),
    summary: sum({ requests: 100, failPct: 10, endpoints: [ep('Checkout', classes({ '2xx': 90, '5xx': 10 }), { failPct: 10 })], limits: limits({ actual: 300, ok: true }, { actual: 10, ok: false }) }),
  });
  assert.equal(r.headline, 'The site broke under this traffic: it answered with server errors.');
  assert.ok(r.found.includes('Checkout: 10% of requests got a server error (answer type 5xx).'));
});

test('too slow: says how long the slow visits waited', () => {
  const r = explainRun({
    cfg: cfg({ thresholds: { p95Ms: 500, errorPct: 1 } }),
    summary: sum({ passed: false, requests: 100, failPct: 0, p95Ms: 900, endpoints: [ep('Home', classes({ '2xx': 100 }))], limits: [{ what: 'p95', limit: 500, actual: 900, ok: false }, { what: 'errors', limit: 1, actual: 0, ok: true }] }),
  });
  assert.equal(r.headline, 'The site stayed up but was slower than you wanted.');
  assert.equal(r.found[0], '1 in 20 visits waited longer than 500 ms. The slowest 1 in 20 took 900 ms.');
});

test('all fine with limits: shows each number against its limit', () => {
  const r = explainRun({
    cfg: cfg(),
    summary: sum({ passed: true, requests: 100, failPct: 0, p95Ms: 300, endpoints: [ep('Home', classes({ '2xx': 100 }))], limits: limits({ actual: 300, ok: true }, { actual: 0, ok: true }) }),
  });
  assert.equal(r.headline, 'The site handled this traffic and met every limit you set.');
  assert.equal(r.found[0], 'Slowest 1 in 20 took 300 ms, under your 1.00 sec. 0% of requests failed, under your 1%.');
  assert.deepEqual(r.next, ['Run again with more people or a longer time to see how far it can go.']);
});
