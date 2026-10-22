// "Check one call": sends a single real request (after the login step if there is one) and says in plain
// words what the answer means. Returns only the status, the time and a hint, never a body or a credential.
import { PRESETS, validateConfig } from './config.js';

const TIMEOUT_MS = 10_000;
const DETAILS = 'The site did not accept the details sent. Check the request body and the values you filled in.';

export function hintFor(status, signedIn) {
  if (status === 0) return 'The site did not answer. Check the website address and that the site is switched on.';
  if (status >= 200 && status < 300) return 'Works: the site answered normally.';
  if (status >= 301 && status <= 308) return 'The site sent us to another address. Try the address it redirects to.';
  if (status === 401) return signedIn ? 'The site refused the sign in details. Check the username, password or token.' : 'The site wants you signed in. Set up Credentials, then check again.';
  if (status === 403) return 'You are signed in but not allowed to use this call. Try an account with more access.';
  if (status === 404) return "Nothing is at this address. Check the website address and the call's path, and fill in any gaps like :round_id.";
  if ([400, 405, 409, 415, 422].includes(status)) return DETAILS;
  if (status === 429) return 'The site says too many requests. Wait a moment and check again.';
  if (status >= 500 && status <= 599) return 'The site had a problem of its own. Try again; if it repeats, tell the team that runs the site.';
  return `The site answered with code ${status}.`;
}

// Same header rules as k6/test.js, so a passing check means the real run sends the same thing.
function credentialHeader(c) {
  if (c.type === 'bearer') return ['Authorization', `Bearer ${c.token}`];
  if (c.type === 'basic') return ['Authorization', `Basic ${Buffer.from(`${c.username}:${c.password}`).toString('base64')}`];
  return [c.header, c.value];
}

const pick = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export async function checkCall(raw, fetchImpl = fetch) {
  const v = validateConfig({ testType: 'smoke', ...PRESETS.smoke, ...raw });
  if (!v.ok) throw Object.assign(new Error(v.errors.join('; ')), { errors: v.errors });
  const cfg = v.config;
  const call = cfg.endpoints[0];
  const started = Date.now();
  const done = (status, step, hint, ok) => ({ ok, status, ms: Date.now() - started, step, hint: hint ?? hintFor(status, signedIn) });
  const send = async (url, init) => {
    try {
      const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
      return res;
    } catch {
      return null; // refused, unreachable or too slow: reported as "did not answer"
    }
  };

  const headers = { ...call.headers };
  let signedIn = false;

  if (cfg.auth) {
    const text = typeof cfg.auth.body === 'string' ? cfg.auth.body : JSON.stringify(cfg.auth.body ?? {});
    const res = await send(cfg.baseUrl + cfg.auth.path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
    signedIn = true;
    if (!res) return done(0, 'login', undefined, false);
    let token;
    try {
      token = pick(await res.json(), cfg.auth.tokenField);
    } catch { /* not JSON: no token */ }
    if (res.status < 200 || res.status > 299) return done(res.status, 'login', undefined, false);
    if (!token) return done(res.status, 'login', `The login worked but no token named "${cfg.auth.tokenField}" was in the reply. Check the token name.`, false);
    headers[cfg.auth.header] = `${cfg.auth.prefix}${token}`;
  }
  if (cfg.credentials) {
    const [name, value] = credentialHeader(cfg.credentials);
    headers[name] = value;
    signedIn = true;
  }

  const hasBody = call.body !== undefined && call.body !== '' && !['GET', 'HEAD'].includes(call.method);
  const res = await send(cfg.baseUrl + call.path, { method: call.method, headers, ...(hasBody ? { body: call.body } : {}) });
  if (!res) return done(0, 'call', undefined, false);
  await res.body?.cancel(); // the answer's content is never read or returned
  const ok = call.expectStatus ? res.status === call.expectStatus : res.status >= 200 && res.status < 300;
  const hint = call.expectStatus && ok ? `Works: the site answered with code ${res.status}, as you expected.` : undefined;
  return done(res.status, 'call', hint, ok);
}
