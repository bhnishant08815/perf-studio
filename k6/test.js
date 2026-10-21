// One generic k6 script driven by the UI. Reads a validated config (lib/config.js) from CONFIG_PATH
// and writes report.html and summary.json into RUN_DIR when the run ends.
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { buildStages } from '../lib/stages.js';
import { buildReport } from './report.js';

const cfg = JSON.parse(open(__ENV.CONFIG_PATH));
const RUN_DIR = __ENV.RUN_DIR;
const abort = cfg.testType === 'breakpoint' ? { abortOnFail: true, delayAbortEval: '10s' } : {};

export const options = {
  scenarios: {
    users: { executor: 'ramping-vus', startVUs: cfg.testType === 'smoke' ? 1 : 0, stages: buildStages(cfg), gracefulRampDown: '10s', gracefulStop: '10s' },
  },
  thresholds: {
    http_req_failed: [{ threshold: `rate<${cfg.thresholds.errorPct / 100}`, ...abort }],
    http_req_duration: [{ threshold: `p(95)<${cfg.thresholds.p95Ms}`, ...abort }],
  },
};

const label = (e) => `${e.method} ${e.path}`;

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

export default function (data) {
  for (const e of cfg.endpoints) {
    const headers = { ...e.headers };
    if (data.token) headers[cfg.auth.header] = `${cfg.auth.prefix}${data.token}`;
    const body = e.body === undefined || e.body === '' ? null : typeof e.body === 'string' ? e.body : JSON.stringify(e.body);
    const params = { headers, tags: { name: label(e) } };
    if (e.expectStatus) params.responseCallback = http.expectedStatuses(e.expectStatus);
    const res = http.request(e.method, cfg.baseUrl + e.path, body, params);
    check(res, { [`${label(e)} ok`]: (r) => (e.expectStatus ? r.status === e.expectStatus : r.status < 400) });
  }
  sleep(cfg.thinkTimeS);
}

const thresholdOk = (t) => (typeof t === 'object' ? t.ok !== false : t !== false);

export function handleSummary(data) {
  const dur = data.metrics.http_req_duration.values;
  const passed = Object.values(data.metrics).every((m) => Object.values(m.thresholds ?? {}).every(thresholdOk));
  const summary = {
    passed,
    requests: data.metrics.http_reqs.values.count,
    failPct: (data.metrics.http_req_failed?.values.rate ?? 0) * 100,
    p50Ms: dur.med,
    p95Ms: dur['p(95)'],
    maxMs: dur.max,
    peakUsers: data.metrics.vus_max.values.max,
  };
  const meta = { url: cfg.baseUrl, endpoints: cfg.endpoints.map(label), loggedIn: Boolean(cfg.auth) };
  return {
    [`${RUN_DIR}/report.html`]: buildReport(data, meta),
    [`${RUN_DIR}/summary.json`]: JSON.stringify(summary),
    stdout: `\nResult: ${passed ? 'PASS' : 'FAIL'}\nRequests: ${summary.requests}, failed ${summary.failPct.toFixed(2)}%\nSlowest 1 in 20: ${Math.round(summary.p95Ms)} ms\n`,
  };
}
