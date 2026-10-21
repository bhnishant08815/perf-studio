import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStages } from '../lib/stages.js';

const s = (duration, target) => ({ duration, target });

test('load ramps up, holds, ramps down', () => {
  const got = buildStages({ testType: 'load', peakUsers: 20, rampUpS: 30, holdS: 60, rampDownS: 15 });
  assert.deepEqual(got, [s('30s', 20), s('60s', 20), s('15s', 0)]);
});

test('smoke is one user for holdS seconds', () => {
  assert.deepEqual(buildStages({ testType: 'smoke', peakUsers: 1, rampUpS: 0, holdS: 30, rampDownS: 0 }), [s('30s', 1)]);
});

test('stress steps up through each factor of peak', () => {
  const got = buildStages({ testType: 'stress', peakUsers: 10, stressSteps: [0.5, 1, 1.5], rampUpS: 10, holdS: 20, rampDownS: 5 });
  assert.deepEqual(got, [s('10s', 5), s('20s', 5), s('10s', 10), s('20s', 10), s('10s', 15), s('20s', 15), s('5s', 0)]);
});

test('spike warms up, jumps to peak, drops, recovers', () => {
  const got = buildStages({ testType: 'spike', peakUsers: 100, rampUpS: 20, holdS: 30, rampDownS: 10 });
  assert.deepEqual(got, [s('20s', 10), s('10s', 100), s('30s', 100), s('10s', 10), s('20s', 10), s('10s', 0)]);
});

test('soak has the same shape as load', () => {
  const cfg = { peakUsers: 20, rampUpS: 60, holdS: 3600, rampDownS: 60 };
  assert.deepEqual(buildStages({ ...cfg, testType: 'soak' }), buildStages({ ...cfg, testType: 'load' }));
});

test('breakpoint is one linear ramp to peak', () => {
  assert.deepEqual(buildStages({ testType: 'breakpoint', peakUsers: 50, rampUpS: 0, holdS: 600, rampDownS: 0 }), [s('600s', 50)]);
});

test('fractional targets round to integers and never drop below 1', () => {
  const got = buildStages({ testType: 'stress', peakUsers: 3, stressSteps: [0.1, 0.5], rampUpS: 5, holdS: 5, rampDownS: 5 });
  assert.deepEqual(got.map((x) => x.target), [1, 1, 2, 2, 0]);
});
