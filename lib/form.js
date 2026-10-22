// Pure helpers for the page: plain English wording and form parsing. Runs in the browser and in Node tests.
import { PRESETS } from './config.js';
import { buildStages } from './stages.js';

export const presetFor = (testType) => PRESETS[testType];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function fmtDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts = [];
  if (h) parts.push(plural(h, 'hour'));
  if (m) parts.push(plural(m, 'minute'));
  if (s || !parts.length) parts.push(plural(s, 'second'));
  return parts.join(' ');
}

export function describeShape(cfg) {
  const { testType: t, peakUsers: peak, rampUpS, holdS, rampDownS } = cfg;
  const steps = cfg.stressSteps ?? PRESETS.stress.stressSteps;
  const total = buildStages({ ...cfg, stressSteps: steps }).reduce((sum, st) => sum + parseInt(st.duration, 10), 0);
  const time = `Total time: about ${fmtDuration(total)}.`;
  switch (t) {
    case 'smoke':
      return `Send 1 user for ${fmtDuration(holdS)}, just to check that everything responds. ${time}`;
    case 'stress': {
      const list = steps.map((f) => Math.max(1, Math.round(peak * f))).join(', ');
      return `Step up through ${list} users, holding each step for ${fmtDuration(holdS)}, then wind down. ${time}`;
    }
    case 'spike':
      return `Start quietly, then suddenly jump to ${peak} users for ${fmtDuration(holdS)}, then drop back to see how the site recovers. ${time}`;
    case 'breakpoint':
      return `Keep adding users up to ${peak} over ${fmtDuration(holdS)}, and stop early if your limits are broken. ${time}`;
    default:
      return `Add users gradually up to ${peak} over ${fmtDuration(rampUpS)}, keep ${peak} active for ${fmtDuration(holdS)}, then wind down over ${fmtDuration(rampDownS)}. ${time}`;
  }
}

export function parseHeaders(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 1) throw new Error(`Header line "${line}" needs "Name: value"`);
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

// ---- side panel helpers for imported endpoints ----

export function filterEndpoints(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((e) => [e.name, e.path, e.method, e.group].some((v) => String(v).toLowerCase().includes(q)));
}

export function groupEndpoints(list) {
  const groups = new Map();
  for (const e of list) {
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }
  return [...groups].map(([group, items]) => ({ group, items }));
}

export function toConfigEndpoints(list, selectedIds) {
  return list
    .filter((e) => e.selectable && selectedIds.has(e.id))
    .map((e) => ({ method: e.method, path: e.path, headers: e.headers, ...(e.body !== undefined ? { body: e.body } : {}), name: e.name, group: e.group }));
}

// ---- status panel helpers ----

// Which part of the planned shape a run is in at `elapsedS`. k6 starts at 1 user for smoke, else 0.
export function plannedPhase(cfg, elapsedS) {
  const stages = buildStages({ ...cfg, stressSteps: cfg.stressSteps ?? PRESETS.stress.stressSteps });
  let prev = cfg.testType === 'smoke' ? 1 : 0;
  let end = 0;
  for (let i = 0; i < stages.length; i++) {
    end += parseInt(stages[i].duration, 10);
    if (elapsedS < end) {
      const { target } = stages[i];
      const label = target > prev ? 'Building up' : target === prev ? 'Holding' : 'Winding down';
      return { label, stage: i + 1, stages: stages.length };
    }
    prev = stages[i].target;
  }
  return { label: 'Finishing', stage: stages.length, stages: stages.length };
}

export function latestMetrics(timeline) {
  const last = timeline?.at(-1) ?? {};
  const avg = timeline?.findLast((p) => p.avgMs != null)?.avgMs;
  return {
    users: last.users ?? null,
    rps: last.rps ?? null,
    avgMs: avg ?? null,
    failPct: last.failPct ?? null,
    p95SoFarMs: last.p95SoFarMs ?? null,
  };
}
