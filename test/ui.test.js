import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const markup = html.replace(script, '');
const tagWithId = (id) => markup.match(new RegExp(`<[^>]*\\bid="${id}"[^>]*>`))?.[0];

test('every id the script looks up exists', () => {
  const ids = new Set([...script.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
  assert.ok(ids.size > 30, 'the audit found the lookups');
  const missing = [...ids].filter((id) => !markup.includes(`id="${id}"`) && !script.includes(`id: '${id}'`));
  assert.deepEqual(missing, []);
});

test('every static label has help under it', () => {
  const fors = [...markup.matchAll(/<label for="([\w-]+)"/g)].map((m) => m[1]);
  assert.ok(fors.length > 20);
  for (const id of fors) {
    assert.ok(markup.includes(`id="${id}-help"`), `help line for ${id}`);
    const tag = tagWithId(id);
    assert.ok(tag, `element ${id} exists`);
    assert.match(tag, new RegExp(`aria-describedby="[^"]*\\b${id}-help\\b`), `${id} is described by its help`);
  }
});

test('page loads theme and no external resources', () => {
  assert.ok(html.includes("from '/lib/theme.js'"));
  assert.ok(!html.includes('src="http'));
  assert.ok(!html.includes('href="http'));
});

test('panel toggle is wired', () => {
  const tag = tagWithId('panelToggle');
  assert.ok(tag, 'toggle exists');
  assert.match(tag, /aria-controls="panel"/);
  assert.match(tag, /aria-expanded="false"/);
});

test('status panel has phase and metric strip', () => {
  for (const id of ['stPhase', 'stMetrics', 'runSummary']) assert.ok(markup.includes(`id="${id}"`), id);
});

test('status panel imports the helpers', () => {
  const imp = script.match(/import \{([^}]*)\} from '\/lib\/form\.js'/)?.[1] ?? '';
  assert.match(imp, /\bplannedPhase\b/);
  assert.match(imp, /\blatestMetrics\b/);
});
