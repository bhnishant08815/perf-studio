// One generic k6 script driven by the UI. Reads a validated config (lib/config.js) from CONFIG_PATH
// and writes summary.json into RUN_DIR when the run ends (Node builds report.html from it).
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { buildStages } from '../lib/stages.js';
import { maskQuery } from '../lib/config.js';

const cfg = JSON.parse(open(__ENV.CONFIG_PATH));
const RUN_DIR = __ENV.RUN_DIR;
const abort = cfg.testType === 'breakpoint' ? { abortOnFail: true, delayAbortEval: '10s' } : {};
const CLASSES = ['2xx', '3xx', '4xx', '5xx', 'none'];
const statusClass = new Counter('status_class');

// Query values may hold API keys; names end up in the report and in Grafana, so mask them.
const label = (e) => `${e.method} ${maskQuery(e.path)}`;
const display = (e) => e.name || label(e);
// Submetric selectors only ever use these generated ids, never user text (names may hold , : { } ").
const epId = (i) => `e${i}`;

// Rules that always pass. They exist only so k6 reports these submetrics in handleSummary.
const TRACKING = ['max>=0', 'rate>=0', 'count>=0'];
const tracking = {};
cfg.endpoints.forEach((_, i) => {
  tracking[`http_req_duration{ep:${epId(i)}}`] = ['max>=0'];
  tracking[`http_req_failed{ep:${epId(i)}}`] = ['rate>=0'];
  for (const cls of CLASSES) tracking[`status_class{ep:${epId(i)},cls:${cls}}`] = ['count>=0'];
});

// A limit left empty (null) gets no rule, so k6 never judges or aborts on it.
const errRule = cfg.thresholds.errorPct === null ? null : `rate<=${cfg.thresholds.errorPct / 100}`;
const p95Rule = cfg.thresholds.p95Ms === null ? null : `p(95)<${cfg.thresholds.p95Ms}`;

export const options = {
  scenarios: {
    users: { executor: 'ramping-vus', startVUs: cfg.testType === 'smoke' ? 1 : 0, stages: buildStages(cfg), gracefulRampDown: '10s', gracefulStop: '10s' },
  },
  thresholds: {
    ...(errRule && { http_req_failed: [{ threshold: errRule, ...abort }] }),
    ...(p95Rule && { http_req_duration: [{ threshold: p95Rule, ...abort }] }),
    ...tracking,
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

export function setup() {
  if (!cfg.auth) return {};
  const body = typeof cfg.auth.body === 'string' ? cfg.auth.body : JSON.stringify(cfg.auth.body ?? {});
  const res = http.request(cfg.auth.method, cfg.baseUrl + cfg.auth.path, body, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: `${cfg.auth.method} ${cfg.auth.path}` },
  });
  let token;
  try {
    token = res.json(cfg.auth.tokenField);
  } catch {
    token = undefined;
  }
  if (res.status < 200 || res.status > 299 || !token) exec.test.abort(`login failed (status ${res.status}, token field "${cfg.auth.tokenField}")`);
  return { token };
}

const classOf = (status) => (status >= 200 && status < 600 ? `${Math.floor(status / 100)}xx` : 'none');

export default function (data) {
  cfg.endpoints.forEach((e, i) => {
    const headers = { ...e.headers };
    if (data.token) headers[cfg.auth.header] = `${cfg.auth.prefix}${data.token}`;
    const body = e.body === undefined || e.body === '' ? null : e.body;
    const params = { headers, tags: { name: display(e), ep: epId(i) } };
    if (e.expectStatus) params.responseCallback = http.expectedStatuses(e.expectStatus);
    const res = http.request(e.method, cfg.baseUrl + e.path, body, params);
    statusClass.add(1, { ep: epId(i), cls: classOf(res.status) });
    check(res, { [`${display(e)} ok`]: (r) => (e.expectStatus ? r.status === e.expectStatus : r.status < 400) });
  });
  sleep(cfg.thinkTimeS);
}

const thresholdOk = (t) => (typeof t === 'object' ? t.ok !== false : t !== false);
const ruleOk = (metric, rule) => thresholdOk(metric?.thresholds?.[rule] ?? true);

export function handleSummary(data) {
  const m = data.metrics;
  const dur = m.http_req_duration?.values ?? {};
  const passed = Object.values(m).every((x) => Object.entries(x.thresholds ?? {}).every(([rule, t]) => TRACKING.includes(rule) || thresholdOk(t)));
  const failPct = (m.http_req_failed?.values.rate ?? 0) * 100;

  const endpoints = cfg.endpoints.map((e, i) => {
    const d = m[`http_req_duration{ep:${epId(i)}}`]?.values ?? {};
    const f = m[`http_req_failed{ep:${epId(i)}}`]?.values ?? {};
    const requests = (f.passes ?? 0) + (f.fails ?? 0);
    const statusClasses = Object.fromEntries(CLASSES.map((cls) => [cls, m[`status_class{ep:${epId(i)},cls:${cls}}`]?.values.count ?? 0]));
    return {
      id: epId(i),
      name: display(e),
      method: e.method,
      path: e.path,
      requests,
      failPct: (f.rate ?? 0) * 100,
      avgMs: d.avg ?? 0,
      p50Ms: d.med ?? 0,
      p90Ms: d['p(90)'] ?? 0,
      p95Ms: d['p(95)'] ?? 0,
      p99Ms: d['p(99)'] ?? 0,
      maxMs: d.max ?? 0,
      statusClasses,
    };
  });

  const summary = {
    passed,
    requests: m.http_reqs?.values.count ?? 0,
    failPct,
    p50Ms: dur.med ?? 0,
    p95Ms: dur['p(95)'] ?? 0,
    maxMs: dur.max ?? 0,
    peakUsers: m.vus_max?.values.max ?? 0,
    checksPassPct: (m.checks?.values.rate ?? 0) * 100,
    iterations: m.iterations?.values.count ?? 0,
    durationS: data.state.testRunDurationMs / 1000,
    dataReceivedBytes: m.data_received?.values.count ?? 0,
    dataSentBytes: m.data_sent?.values.count ?? 0,
    endpoints,
    limits: [
      ...(p95Rule ? [{ what: 'p95', limit: cfg.thresholds.p95Ms, actual: dur['p(95)'] ?? 0, ok: ruleOk(m.http_req_duration, p95Rule) }] : []),
      ...(errRule ? [{ what: 'errors', limit: cfg.thresholds.errorPct, actual: failPct, ok: ruleOk(m.http_req_failed, errRule) }] : []),
    ],
  };
  return {
    [`${RUN_DIR}/summary.json`]: JSON.stringify(summary),
    stdout: `\nResult: ${passed ? 'PASS' : 'FAIL'}\nRequests: ${summary.requests}, failed ${summary.failPct.toFixed(2)}%\nSlowest 1 in 20: ${Math.round(summary.p95Ms)} ms\n`,
  };
}
