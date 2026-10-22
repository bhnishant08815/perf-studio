import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkCall, hintFor } from '../lib/check.js';
import { startMock } from './mock-target.mjs';

let mock;
before(async () => (mock = await startMock()));
after(() => mock?.close());

const body = (path, o = {}) => ({ baseUrl: mock.url, endpoints: [{ method: 'GET', path }], ownershipConfirmed: true, ...o });

test('hintFor: the plain words for each answer', () => {
  const rows = [
    [0, false, 'The site did not answer. Check the website address and that the site is switched on.'],
    [200, false, 'Works: the site answered normally.'],
    [204, true, 'Works: the site answered normally.'],
    [302, false, 'The site sent us to another address. Try the address it redirects to.'],
    [401, false, 'The site wants you signed in. Set up Credentials, then check again.'],
    [401, true, 'The site refused the sign in details. Check the username, password or token.'],
    [403, true, 'You are signed in but not allowed to use this call. Try an account with more access.'],
    [404, false, "Nothing is at this address. Check the website address and the call's path, and fill in any gaps like :round_id."],
    [422, false, 'The site did not accept the details sent. Check the request body and the values you filled in.'],
    [400, false, 'The site did not accept the details sent. Check the request body and the values you filled in.'],
    [429, false, 'The site says too many requests. Wait a moment and check again.'],
    [503, false, 'The site had a problem of its own. Try again; if it repeats, tell the team that runs the site.'],
    [418, false, 'The site answered with code 418.'],
  ];
  for (const [status, signedIn, text] of rows) assert.equal(hintFor(status, signedIn), text, `${status} ${signedIn}`);
});

test('a working call: ok, 200, a time, and the works hint', async () => {
  const r = await checkCall(body('/ok'));
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.step, 'call');
  assert.equal(r.hint, 'Works: the site answered normally.');
  assert.ok(typeof r.ms === 'number' && r.ms >= 0);
});

test('credentials: bearer works, none is told to sign in', async () => {
  assert.equal((await checkCall(body('/secure', { credentials: { type: 'bearer', token: 't1' } }))).status, 200);
  const none = await checkCall(body('/secure'));
  assert.equal(none.status, 401);
  assert.equal(none.ok, false);
  assert.equal(none.hint, 'The site wants you signed in. Set up Credentials, then check again.');
  assert.equal((await checkCall(body('/key', { credentials: { type: 'apikey', header: 'X-Api-Key', value: 'k1' } }))).status, 200);
  assert.equal((await checkCall(body('/basic', { credentials: { type: 'basic', username: 'user', password: 'pa:ss' } }))).status, 200);
});

test('login call: signs in first, and says when the sign in itself fails', async () => {
  const good = await checkCall(body('/secure', { auth: { path: '/login', body: { user: 'u' }, tokenField: 'access_token' } }));
  assert.equal(good.status, 200);
  assert.equal(good.step, 'call');
  const bad = await checkCall(body('/secure', { auth: { path: '/login', body: { user: 'x' }, tokenField: 'access_token' } }));
  assert.equal(bad.step, 'login');
  assert.equal(bad.status, 401);
  assert.equal(bad.hint, 'The site refused the sign in details. Check the username, password or token.');
  const noToken = await checkCall(body('/secure', { auth: { path: '/login', body: { user: 'u' }, tokenField: 'nope' } }));
  assert.equal(noToken.step, 'login');
  assert.equal(noToken.ok, false);
  assert.match(noToken.hint, /no token named "nope"/);
});

test('a wrong address says nothing is there', async () => {
  const r = await checkCall(body('/notfound'));
  assert.equal(r.status, 404);
  assert.match(r.hint, /^Nothing is at this address/);
});

test('an expected status counts as working', async () => {
  const r = await checkCall(body('/notfound', { endpoints: [{ method: 'GET', path: '/notfound', expectStatus: 404 }] }));
  assert.equal(r.ok, true);
  assert.equal(r.hint, 'Works: the site answered with code 404, as you expected.');
});

test('a closed port gives a friendly answer quickly, never a crash', async () => {
  const gone = await startMock();
  const url = gone.url;
  await gone.close();
  const started = Date.now();
  const r = await checkCall({ baseUrl: url, endpoints: [{ method: 'GET', path: '/ok' }], ownershipConfirmed: true });
  assert.equal(r.status, 0);
  assert.equal(r.ok, false);
  assert.equal(r.hint, 'The site did not answer. Check the website address and that the site is switched on.');
  assert.ok(Date.now() - started < 12000);
});

test('the result never carries a response body or any credential', async () => {
  const r = await checkCall(body('/secure', { auth: { path: '/login', body: { user: 'u' }, tokenField: 'access_token' } }));
  const text = JSON.stringify(r);
  assert.doesNotMatch(text, /\bt1\b/);
  assert.doesNotMatch(text, /access_token/);
  assert.deepEqual(Object.keys(r).sort(), ['hint', 'ms', 'ok', 'status', 'step']);
});

test('invalid input is rejected with the same messages as a run', async () => {
  await assert.rejects(() => checkCall(body('/ok', { ownershipConfirmed: false })), (e) => e.errors.some((m) => m.includes('ownershipConfirmed')));
  await assert.rejects(() => checkCall(body('/ok', { endpoints: [{ method: 'GET', path: '/ok', headers: { 'Bad Name': 'x' } }] })), (e) => e.errors.some((m) => m.includes('headers')));
});
