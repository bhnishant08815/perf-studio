import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { callTraits, checkSetup, loginFromCall } from '../lib/setup.js';
import { importCollection } from '../lib/importers.js';

const get = (path, o = {}) => ({ method: 'GET', path, ...o });
const post = (path, o = {}) => ({ method: 'POST', path, ...o });
const check = (o = {}) => checkSetup({ baseUrl: 'https://hire-uat.fly.dev', endpoints: [get('/health')], values: {}, credKind: 'none', loginCall: null, ...o });
const byId = (issues, id) => issues.find((i) => i.id === id);

test('callTraits: reads, writes, destructive calls and gaps', () => {
  assert.deepEqual(callTraits(get('/a')), { writes: false, risky: false, needs: [] });
  assert.deepEqual(callTraits(post('/api/x')), { writes: true, risky: false, needs: [] });
  assert.deepEqual(callTraits({ method: 'DELETE', path: '/api/x/:id' }), { writes: true, risky: true, needs: ['id'] });
  assert.equal(callTraits(post('/api/wallet/topup')).risky, true);
  assert.equal(callTraits(get('/api/wallet')).risky, false);
  assert.deepEqual([callTraits(post('/api/auth/login')).writes, callTraits(post('/api/auth/login')).risky], [true, false]);
});

test('loginFromCall: finds the login call and its field names', () => {
  const found = loginFromCall(post('/api/auth/login', { body: '{"email":"u@x.com","password":"","remember":true}' }));
  assert.deepEqual(found, { path: '/api/auth/login', userField: 'email', passField: 'password', extra: { remember: true } });
  assert.equal(loginFromCall(get('/api/auth/login', { body: '{"email":"a","password":"b"}' })), null);
  assert.equal(loginFromCall(post('/api/auth/login', { body: '{"code":"1"}' })), null);
  assert.equal(loginFromCall(post('/api/auth/signup', { body: '{"email":"a","password":"b"}' })), null);
  assert.equal(loginFromCall(post('/api/auth/login', { body: 'not json' })), null);
  assert.equal(loginFromCall(post('/api/auth/login')), null);
});

test('base-path: warns when the address already holds a page, with a one click fix', () => {
  const i = byId(check({ baseUrl: 'https://hire-uat.fly.dev/login', endpoints: [post('/api/auth/login')] }), 'base-path');
  assert.equal(i.level, 'warn');
  assert.equal(i.text, 'The website address ends with "/login". Page paths are added after it, so the first call would go to https://hire-uat.fly.dev/login/api/auth/login. Use only https://hire-uat.fly.dev unless that is really where your API starts.');
  assert.deepEqual(i.fix, { label: 'Use https://hire-uat.fly.dev', baseUrl: 'https://hire-uat.fly.dev' });
});

test('base-path: no warning for no path, a lone slash, a port, or an unparseable address', () => {
  for (const baseUrl of ['https://x.com', 'https://x.com/', 'http://localhost:8000', 'http://localhost:8000/', 'not a url', '']) {
    assert.equal(byId(check({ baseUrl }), 'base-path'), undefined, baseUrl);
  }
});

test('fill: stops while a call still needs a value, names them once, and clears when filled', () => {
  const calls = [get('/api/interviews/:round_id'), get('/api/interviews/:round_id/notes'), get('/api/org/:org_id')];
  const i = byId(check({ endpoints: calls }), 'fill');
  assert.equal(i.level, 'stop');
  assert.equal(i.text, '3 calls still need a value from you: round_id, org_id.');
  assert.equal(byId(check({ endpoints: [calls[0]] }), 'fill').text, '1 call still needs a value from you: round_id.');
  assert.equal(byId(check({ endpoints: calls, values: { round_id: '5', org_id: '7' } }), 'fill'), undefined);
  assert.equal(byId(check({ endpoints: calls, values: { round_id: '5' } }), 'fill').text, '1 call still needs a value from you: org_id.');
});

test('writes: warns how many selected calls change data', () => {
  const i = byId(check({ endpoints: [get('/a'), post('/b'), { method: 'PUT', path: '/c' }] }), 'writes');
  assert.equal(i.level, 'warn');
  assert.equal(i.text, '2 of the selected calls change data (POST, PUT, PATCH or DELETE). A load test repeats them many times, so use a test system, not real data.');
  assert.equal(byId(check({ endpoints: [get('/a')] }), 'writes'), undefined);
  assert.equal(byId(check({ endpoints: [post('/b')] }), 'writes').text, '1 of the selected calls changes data (POST, PUT, PATCH or DELETE). A load test repeats them many times, so use a test system, not real data.');
});

test('base-path: the example call path uses the values already typed', () => {
  const i = byId(check({ baseUrl: 'https://x.com/login', endpoints: [get('/api/interviews/:round_id')], values: { round_id: '42' } }), 'base-path');
  assert.ok(i.text.includes('would go to https://x.com/login/api/interviews/42.'), i.text);
});

test('risky: names the first three and counts the rest', () => {
  const calls = [post('/api/wallet/topup', { name: 'Topup' }), { method: 'DELETE', path: '/api/org/logo' }, post('/api/x/delete', { name: 'Delete X' }), post('/api/y/suspend'), post('/api/z/checkout')];
  const i = byId(check({ endpoints: calls }), 'risky');
  assert.equal(i.level, 'warn');
  assert.equal(i.text, 'These look destructive: Topup, DELETE /api/org/logo, Delete X and 2 more.');
  assert.equal(byId(check({ endpoints: calls.slice(0, 2) }), 'risky').text, 'These look destructive: Topup, DELETE /api/org/logo.');
});

test('login: points at an unused login call until credentials are chosen', () => {
  const loginCall = post('/api/auth/login');
  const i = byId(check({ loginCall }), 'login');
  assert.equal(i.level, 'warn');
  assert.equal(i.text, 'This API has a login call (POST /api/auth/login). If the other calls need you signed in, set it up under Credentials.');
  assert.deepEqual(i.fix, { label: 'Use it as the login call' });
  assert.equal(byId(check({ loginCall, credKind: 'bearer' }), 'login'), undefined);
  assert.equal(byId(check({ loginCall: null }), 'login'), undefined);
});

test('issues come back in the order of the table', () => {
  const ids = check({ baseUrl: 'https://x.com/v1', endpoints: [post('/a/:id/delete')], loginCall: post('/login') }).map((i) => i.id);
  assert.deepEqual(ids, ['base-path', 'fill', 'writes', 'risky', 'login']);
});

const collection = resolve(import.meta.dirname, '..', '..', 'Hire.postman_collection.json');
test('the real Hire collection: counts and the login call', { skip: existsSync(collection) ? false : 'Hire.postman_collection.json not found' }, () => {
  const calls = importCollection(readFileSync(collection, 'utf8')).endpoints;
  const traits = calls.map(callTraits);
  assert.equal(traits.filter((t) => t.writes).length, 96);
  assert.equal(traits.filter((t) => t.risky).length, 30);
  assert.equal(traits.filter((_, i) => calls[i].method === 'GET' && !traits[i].needs.length).length, 52);
  assert.equal(traits.filter((t) => t.needs.length).length, 80);
  const login = calls.map(loginFromCall).find(Boolean);
  assert.equal(login.path, '/api/auth/login');
  assert.equal(login.userField, 'email');
  assert.equal(login.passField, 'password');
});
