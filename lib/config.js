// Shared by the server (validation) and the browser (presets). Keep it free of Node and k6 imports.
import { buildStages } from './stages.js';

export const LIMITS = { maxUsers: 500, maxTotalSeconds: 7200, maxEndpoints: 20 };
export const TEST_TYPES = ['smoke', 'load', 'stress', 'spike', 'soak', 'breakpoint'];

const STEPS = [0.5, 1, 1.5, 2];
const preset = (peakUsers, rampUpS, holdS, rampDownS) => ({ peakUsers, rampUpS, holdS, rampDownS, stressSteps: STEPS });
export const PRESETS = {
  smoke: preset(1, 0, 30, 0),
  load: preset(20, 30, 60, 15),
  stress: preset(50, 30, 60, 30),
  spike: preset(100, 30, 30, 30),
  soak: preset(20, 60, 3600, 60),
  breakpoint: preset(200, 0, 600, 0),
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const HEADER_NAME = /^[A-Za-z0-9-]+$/;
const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

export function validateConfig(raw) {
  const errors = [];
  const r = isObj(raw) ? raw : {};
  const err = (m) => errors.push(m);

  let url;
  try {
    url = new URL(r.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    err('baseUrl must be a full http or https address, for example https://example.com');
  }
  if (!TEST_TYPES.includes(r.testType)) err(`testType must be one of: ${TEST_TYPES.join(', ')}`);
  if (!isInt(r.peakUsers, 1, LIMITS.maxUsers)) err(`peakUsers must be a whole number from 1 to ${LIMITS.maxUsers}`);
  for (const k of ['rampUpS', 'holdS', 'rampDownS']) if (!isInt(r[k], 0, LIMITS.maxTotalSeconds)) err(`${k} must be a whole number of seconds`);
  const stressSteps = r.stressSteps ?? STEPS;
  if (!Array.isArray(stressSteps) || stressSteps.length < 1 || stressSteps.length > 10 || !stressSteps.every((n) => typeof n === 'number' && n > 0 && n <= 5)) {
    err('stressSteps must be 1 to 10 numbers, each above 0 and up to 5');
  }
  const thinkTimeS = r.thinkTimeS ?? 1;
  if (typeof thinkTimeS !== 'number' || thinkTimeS < 0 || thinkTimeS > 60) err('thinkTimeS must be a number from 0 to 60');
  const p95Ms = r.thresholds?.p95Ms ?? 1000;
  if (typeof p95Ms !== 'number' || !(p95Ms > 0)) err('thresholds.p95Ms must be a number above 0');
  const errorPct = r.thresholds?.errorPct ?? 1;
  if (typeof errorPct !== 'number' || errorPct < 0 || errorPct > 100) err('thresholds.errorPct must be a number from 0 to 100');
  if (r.ownershipConfirmed !== true) err('ownershipConfirmed must be true: confirm you own or may test this system');

  const endpoints = Array.isArray(r.endpoints) ? r.endpoints : [];
  if (endpoints.length < 1 || endpoints.length > LIMITS.maxEndpoints) err(`endpoints must have 1 to ${LIMITS.maxEndpoints} items`);
  const cleanEndpoints = endpoints.slice(0, LIMITS.maxEndpoints).map((e, i) => {
    const ep = isObj(e) ? e : {};
    if (!METHODS.includes(ep.method)) err(`endpoints[${i}].method must be one of: ${METHODS.join(', ')}`);
    if (typeof ep.path !== 'string' || !ep.path.startsWith('/')) err(`endpoints[${i}].path must start with "/"`);
    const headers = ep.headers ?? {};
    if (!isObj(headers) || !Object.values(headers).every((v) => typeof v === 'string') || !Object.keys(headers).every((k) => HEADER_NAME.test(k))) {
      err(`endpoints[${i}].headers must be "Name: value" text, names using letters, digits and dashes only`);
    }
    if (ep.expectStatus !== undefined && !isInt(ep.expectStatus, 100, 599)) err(`endpoints[${i}].expectStatus must be a whole number from 100 to 599`);
    return { ...ep, headers };
  });

  let auth;
  if (r.auth !== undefined && r.auth !== null) {
    const a = r.auth;
    if (!isObj(a) || typeof a.path !== 'string' || !a.path.startsWith('/') || typeof a.tokenField !== 'string' || !a.tokenField) {
      err('auth needs a path starting with "/" and a tokenField');
    } else {
      if (a.method !== undefined && a.method !== 'POST') err('auth.method must be POST');
      if (a.header !== undefined && !(typeof a.header === 'string' && HEADER_NAME.test(a.header))) err('auth.header must use letters, digits and dashes only');
      if (a.prefix !== undefined && typeof a.prefix !== 'string') err('auth.prefix must be text');
      auth = { path: a.path, body: a.body ?? {}, tokenField: a.tokenField, method: 'POST', header: a.header ?? 'Authorization', prefix: a.prefix ?? 'Bearer ' };
    }
  }

  const base = { testType: r.testType, peakUsers: r.peakUsers, rampUpS: r.rampUpS, holdS: r.holdS, rampDownS: r.rampDownS, stressSteps };
  if (!errors.length) {
    // Check the real shape, not the raw fields: stress and spike add stages the form does not show.
    const stages = buildStages(base);
    const total = stages.reduce((sum, st) => sum + parseInt(st.duration, 10), 0);
    const reach = Math.max(...stages.map((st) => st.target));
    if (total < 1) err('total duration must be above 0 seconds');
    if (total > LIMITS.maxTotalSeconds) err(`total duration is ${total} seconds, the limit is ${LIMITS.maxTotalSeconds}`);
    if (reach > LIMITS.maxUsers) err(`this test would reach ${reach} users, the limit is ${LIMITS.maxUsers}`);
  }

  if (errors.length) return { ok: false, errors };

  const host = url.host;
  return {
    ok: true,
    config: {
      name: r.name || `${r.testType} ${host}`,
      baseUrl: r.baseUrl.replace(/\/+$/, ''),
      testType: r.testType,
      peakUsers: r.peakUsers,
      rampUpS: r.rampUpS,
      holdS: r.holdS,
      rampDownS: r.rampDownS,
      stressSteps,
      thinkTimeS,
      thresholds: { p95Ms, errorPct },
      endpoints: cleanEndpoints,
      ...(auth ? { auth } : {}),
      grafana: { enabled: r.grafana?.enabled === true, url: r.grafana?.url || 'http://localhost:9090/api/v1/write' },
      ownershipConfirmed: true,
    },
  };
}
