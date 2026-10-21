import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeShape, fmtDuration, parseHeaders, presetFor } from '../lib/form.js';

test('fmtDuration speaks plain English', () => {
  assert.equal(fmtDuration(45), '45 seconds');
  assert.equal(fmtDuration(1), '1 second');
  assert.equal(fmtDuration(60), '1 minute');
  assert.equal(fmtDuration(105), '1 minute 45 seconds');
  assert.equal(fmtDuration(120), '2 minutes');
  assert.equal(fmtDuration(3600), '1 hour');
  assert.equal(fmtDuration(3660), '1 hour 1 minute');
});

test('describeShape for load is exact', () => {
  const s = describeShape({ testType: 'load', peakUsers: 20, rampUpS: 30, holdS: 60, rampDownS: 15 });
  assert.equal(s, 'Add users gradually up to 20 over 30 seconds, keep 20 active for 1 minute, then wind down over 15 seconds. Total time: about 1 minute 45 seconds.');
});

test('describeShape for spike mentions peak and total time', () => {
  const s = describeShape({ testType: 'spike', ...presetFor('spike') });
  assert.ok(s.includes('100'), s);
  assert.ok(s.includes('2 minutes'), s);
});

test('describeShape for stress lists the user steps', () => {
  const s = describeShape({ testType: 'stress', peakUsers: 10, stressSteps: [0.5, 1, 2], rampUpS: 10, holdS: 20, rampDownS: 5 });
  assert.ok(s.includes('5, 10, 20'), s);
});

test('parseHeaders reads Name: value lines and keeps colons in values', () => {
  assert.deepEqual(parseHeaders('A: b\n\nC: d: e'), { A: 'b', C: 'd: e' });
  assert.deepEqual(parseHeaders(''), {});
});

test('parseHeaders names the bad line', () => {
  assert.throws(() => parseHeaders('A: b\noops'), { message: 'Header line "oops" needs "Name: value"' });
});

test('presetFor returns the soak preset', () => {
  assert.equal(presetFor('soak').holdS, 3600);
});
