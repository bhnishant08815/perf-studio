import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allPlaceholders, fillValues, findPlaceholders } from '../lib/fill.js';

const call = (o = {}) => ({ method: 'GET', path: '/api/interviews/:round_id/notes/:note', headers: { Authorization: 'Bearer {{tok}}' }, body: '{"to":"{{email}}","at":"10:30"}', ...o });

test('finds path segments and double brace names, in order, once', () => {
  assert.deepEqual(findPlaceholders(call()), ['round_id', 'note', 'tok', 'email']);
  assert.deepEqual(findPlaceholders(call({ path: '/a/:x/b/:x' })).slice(0, 1), ['x']);
  assert.equal(findPlaceholders(call({ path: '/a/:x/b/:x' })).filter((n) => n === 'x').length, 1);
});

test('a colon that is not a placeholder is ignored', () => {
  assert.deepEqual(findPlaceholders({ method: 'POST', path: '/api/time', headers: { Host: 'example.com:8080' }, body: '{"at":"10:30"}' }), []);
  assert.deepEqual(findPlaceholders({ method: 'GET', path: '/api/time' }), []);
});

test('fills the path with encoding, and headers and body as typed', () => {
  const out = fillValues(call(), { round_id: 'a/b c', tok: 'T', email: 'x@y.z' });
  assert.equal(out.path, '/api/interviews/a%2Fb%20c/notes/:note');
  assert.equal(out.headers.Authorization, 'Bearer T');
  assert.ok(out.body.includes('"to":"x@y.z"'));
  assert.deepEqual(findPlaceholders(out), ['note']);
});

test('an empty value leaves the placeholder as it is', () => {
  assert.deepEqual(fillValues(call(), { round_id: '' }), call());
});

test('filling does not mutate the call', () => {
  const c = call();
  const before = JSON.parse(JSON.stringify(c));
  fillValues(c, { round_id: '1', tok: 'T' });
  assert.deepEqual(c, before);
});

test('a value with ? and # is encoded in the path', () => {
  assert.equal(fillValues({ method: 'GET', path: '/x/:id' }, { id: 'a?b#c' }).path, '/x/a%3Fb%23c');
});

test('allPlaceholders merges across calls, each name once', () => {
  const list = allPlaceholders([{ method: 'GET', path: '/a/:round_id' }, { method: 'POST', path: '/b/:round_id/x/:slug' }]);
  assert.deepEqual(list, ['round_id', 'slug']);
});
