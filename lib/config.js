// Shared by the server (validation) and the browser (presets). Keep it free of Node and k6 imports.

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
  if (['rampUpS', 'holdS', 'rampDownS'].every((k) => Number.isInteger(r[k])) && r.rampUpS + r.holdS + r.rampDownS > LIMITS.maxTotalSeconds) {
    err(`total duration must be at most ${LIMITS.maxTotalSeconds} seconds`);
  }
  const stressSteps = r.stressSteps ?? STEPS;
  if (!Array.isArray(stressSteps) || !stressSteps.length || !stressSteps.every((n) => typeof n === 'number' && n > 0 && n <= 5)) {
    err('stressSteps must be a list of numbers above 0 and up to 5');
  }
  if (r.ownershipConfirmed !== true) err('ownershipConfirmed must be true: confirm you own or may test this system');

  const endpoints = Array.isArray(r.endpoints) ? r.endpoints : [];
  if (endpoints.length < 1 || endpoints.length > LIMITS.maxEndpoints) err(`endpoints must have 1 to ${LIMITS.maxEndpoints} items`);
  const cleanEndpoints = endpoints.slice(0, LIMITS.maxEndpoints).map((e, i) => {
    const ep = isObj(e) ? e : {};
    if (!METHODS.includes(ep.method)) err(`endpoints[${i}].method must be one of: ${METHODS.join(', ')}`);
    if (typeof ep.path !== 'string' || !ep.path.startsWith('/')) err(`endpoints[${i}].path must start with "/"`);
    const headers = ep.headers ?? {};
    if (!isObj(headers) || !Object.values(headers).every((v) => typeof v === 'string')) err(`endpoints[${i}].headers must be text values`);
    return { ...ep, headers };
  });

  if (r.auth !== undefined && r.auth !== null) {
    const a = r.auth;
    if (!isObj(a) || typeof a.path !== 'string' || !a.path.startsWith('/') || typeof a.tokenField !== 'string' || !a.tokenField) {
      err('auth needs a path starting with "/" and a tokenField');
    }
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
      thinkTimeS: r.thinkTimeS ?? 1,
      thresholds: { p95Ms: r.thresholds?.p95Ms ?? 1000, errorPct: r.thresholds?.errorPct ?? 1 },
      endpoints: cleanEndpoints,
      ...(r.auth ? { auth: { method: 'POST', header: 'Authorization', prefix: 'Bearer ', ...r.auth } } : {}),
      grafana: { enabled: r.grafana?.enabled === true, url: r.grafana?.url || 'http://localhost:9090/api/v1/write' },
      ownershipConfirmed: true,
    },
  };
}
