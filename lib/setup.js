// Plain language checks of a test setup, before anything is sent. Pure: shared by the page and the tests.
import { allPlaceholders, fillValues, findPlaceholders } from './fill.js';

const RISKY = /delete|suspend|reactivate|adjust|topup|checkout|webhook|cancel|reject|restore|replace|bulk|paid|screening-lab\/data/i;

export function callTraits(endpoint) {
  return {
    writes: endpoint.method !== 'GET',
    risky: endpoint.method === 'DELETE' || RISKY.test(endpoint.path),
    needs: findPlaceholders(endpoint),
  };
}

// Looks like a sign in call: POST, a login looking path, and a JSON body with a user and a password field.
export function loginFromCall(endpoint) {
  if (endpoint.method !== 'POST' || !/login|signin|sign-in/i.test(endpoint.path)) return null;
  let body;
  try {
    body = JSON.parse(endpoint.body);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  const passField = keys.find((k) => /pass/i.test(k));
  const userField = keys.find((k) => k !== passField && /email|user(name)?|login/i.test(k));
  if (!userField || !passField) return null;
  const extra = Object.fromEntries(keys.filter((k) => k !== userField && k !== passField).map((k) => [k, body[k]]));
  return { path: endpoint.path, userField, passField, extra };
}

const label = (e) => e.name || `${e.method} ${e.path}`;

export function checkSetup({ baseUrl, endpoints, values, credKind, loginCall }) {
  const issues = [];

  let origin;
  let basePath = '';
  try {
    const url = new URL(baseUrl);
    origin = url.origin;
    basePath = url.pathname.replace(/\/+$/, '');
  } catch { /* the server rejects an unusable address; nothing to say here */ }
  const filled = endpoints.map((e) => fillValues(e, values ?? {}));
  if (basePath) {
    issues.push({
      id: 'base-path',
      level: 'warn',
      text: `The website address ends with "${basePath}". Page paths are added after it, so the first call would go to ${origin}${basePath}${filled[0]?.path ?? ''}. Use only ${origin} unless that is really where your API starts.`,
      fix: { label: `Use ${origin}`, baseUrl: origin },
    });
  }

  const open = filled.filter((e) => findPlaceholders(e).length);
  if (open.length) {
    const n = open.length;
    issues.push({ id: 'fill', level: 'stop', text: `${n} ${n === 1 ? 'call still needs' : 'calls still need'} a value from you: ${allPlaceholders(open).join(', ')}.` });
  }

  const writes = endpoints.filter((e) => callTraits(e).writes);
  if (writes.length) {
    issues.push({ id: 'writes', level: 'warn', text: `${writes.length} of the selected calls ${writes.length === 1 ? 'changes' : 'change'} data (POST, PUT, PATCH or DELETE). A load test repeats them many times, so use a test system, not real data.` });
  }

  const risky = endpoints.filter((e) => callTraits(e).risky);
  if (risky.length) {
    const more = risky.length > 3 ? ` and ${risky.length - 3} more` : '';
    issues.push({ id: 'risky', level: 'warn', text: `These look destructive: ${risky.slice(0, 3).map(label).join(', ')}${more}.` });
  }

  if (credKind === 'none' && loginCall) {
    issues.push({
      id: 'login',
      level: 'warn',
      text: `This API has a login call (${loginCall.method} ${loginCall.path}). If the other calls need you signed in, set it up under Credentials.`,
      fix: { label: 'Use it as the login call' },
    });
  }
  return issues;
}
