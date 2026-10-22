import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { explainRun } from '../lib/explain.js';
import { buildReport } from '../lib/report.js';

// A real run: POST /api/auth/login answered 4xx every time (1,745 requests) while speed was fine.
const dir = join(resolve(import.meta.dirname, '..'), 'runs', '20261022-101732-d739');
const skip = existsSync(join(dir, 'summary.json')) ? false : 'run folder 20261022-101732-d739 not found';
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

test('the real refused login run is explained in plain words', { skip }, () => {
  const cfg = read('config.json');
  const summary = read('summary.json');
  const r = explainRun({ cfg, summary });
  assert.equal(r.headline, 'Nearly every request was refused by the site, so this test could not measure real speed.');
  // The real cause: the address was typed with /login, so every call went to the wrong place.
  assert.equal(r.found[0], 'Your website address includes "/login", so calls went to https://hire-uat.fly.dev/login/api/auth/login.');
  assert.equal(r.found[1], 'You asked for fewer than 1% of requests to fail. 100% failed.');
  assert.equal(r.next[0], 'Change the website address to just https://hire-uat.fly.dev, then run again.');

  const run = { ...read('run.json'), config: cfg };
  const html = buildReport({ run, summary, timeline: [], previous: undefined });
  assert.ok(html.includes('What to do next'));
  assert.ok(html.indexOf('What to do next') < html.indexOf('Key numbers'));
});
