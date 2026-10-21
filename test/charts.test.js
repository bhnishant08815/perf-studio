import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barChart, lineChart, stackedBar } from '../lib/charts.js';

const fmt = (v) => `${v} ms`;

test('lineChart is an accessible svg with a title', () => {
  const svg = lineChart({ title: 'Response time', series: [{ label: 'Average', points: [[0, 1], [5, 2]] }], formatY: fmt });
  assert.ok(svg.startsWith('<svg'));
  assert.match(svg, /role="img"/);
  assert.match(svg, /<title>Response time<\/title>/);
});

test('a null value breaks the line into two segments', () => {
  const svg = lineChart({ title: 't', series: [{ label: 'a', points: [[0, 1], [5, 2], [10, null], [15, 3], [20, 4]] }], formatY: fmt });
  assert.equal(svg.match(/class="line s1"/g).length, 2);
});

test('labels are escaped', () => {
  const svg = lineChart({ title: '<b>&"', series: [{ label: '<i>', points: [[0, 1]] }, { label: 'x', points: [[0, 2]] }], formatY: fmt });
  assert.ok(!svg.includes('<b>') && !svg.includes('<i>'));
  assert.match(svg, /&lt;b&gt;&amp;&quot;/);
});

test('two or more series get a legend, one series does not', () => {
  const one = lineChart({ title: 't', series: [{ label: 'Only', points: [[0, 1]] }], formatY: fmt });
  const two = lineChart({ title: 't', series: [{ label: 'A', points: [[0, 1]] }, { label: 'B', points: [[0, 2]] }], formatY: fmt });
  assert.ok(!one.includes('class="legend"'));
  assert.ok(two.includes('class="legend"'));
});

test('a limit draws a labelled reference line', () => {
  const svg = lineChart({ title: 't', series: [{ label: 'a', points: [[0, 1]] }], formatY: fmt, limit: { value: 5, label: 'Your limit' } });
  assert.match(svg, /class="limit"/);
  assert.match(svg, /Your limit/);
});

test('every point has a hover title with its value', () => {
  const svg = lineChart({ title: 't', series: [{ label: 'a', points: [[65, 12]] }], formatY: fmt });
  assert.match(svg, /<title>a, 1:05: 12 ms<\/title>/);
});

test('barChart draws one bar per item, in order, with values', () => {
  const svg = barChart({ title: 'p95', items: [{ label: 'First', value: 3 }, { label: 'Second', value: 9 }], formatValue: fmt, limit: { value: 5, label: 'Limit' } });
  assert.equal(svg.match(/class="bar"/g).length, 2);
  assert.ok(svg.indexOf('First') < svg.indexOf('Second'));
  assert.match(svg, /9 ms/);
  assert.match(svg, /class="limit"/);
});

test('stackedBar draws a segment per non zero part and a legend', () => {
  const svg = stackedBar({ title: 'Status', items: [{ label: 'A', parts: { '2xx': 8, '5xx': 2, '4xx': 0 } }], order: ['2xx', '4xx', '5xx'], names: { '2xx': 'Worked', '4xx': 'Client error', '5xx': 'Server error' } });
  assert.equal(svg.match(/class="seg /g).length, 2);
  assert.match(svg, /class="legend"/);
  assert.match(svg, /Server error/);
});

test('axis ticks are round numbers', () => {
  const svg = lineChart({ title: 't', series: [{ label: 'a', points: [[0, 10], [100, 140]] }], formatY: (v) => `${v}` });
  const ys = [...svg.matchAll(/text-anchor="end">(\d+(?:\.\d+)?)</g)].map((m) => Number(m[1]));
  assert.deepEqual(ys, [0, 50, 100, 150]);
  const xs = [...svg.matchAll(/text-anchor="middle">([\d:]+)</g)].map((m) => m[1]);
  assert.deepEqual(xs, ['0:00', '0:30', '1:00', '1:30']);
});
