// Turns a Postman, OpenAPI 3, Swagger 2 or plain JSON list into endpoints the side panel can offer.
// Pure: runs in the browser (file picker) and in Node tests. No Node imports.

import { maskQuery } from './config.js';

const UNSUPPORTED = 'Unsupported file. Use a Postman collection, OpenAPI 3 or Swagger 2 JSON file, or a list of {method, path}.';
const YAML = 'YAML files are not supported yet. Export the file as JSON and import again.';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const MAX_TEXT = 120; // the config validator's limit for names and groups
const JSON_TYPE = 'application/json';

const kv = (arr) => Object.fromEntries((arr ?? []).map((x) => [x.key, x.value]));

/** "https://host/a?b" -> { origin, path }. Regex, not URL(), so {{vars}} stay readable. */
function splitUrl(raw) {
  const m = /^(https?:\/\/[^/?#]+)(.*)$/i.exec(raw.trim());
  if (!m) return { origin: null, path: raw.startsWith('/') ? raw : `/${raw}` };
  return { origin: m[1], path: m[2] || '/' };
}

function finish(format, title, endpoints, warnings, fixedBase) {
  const counts = new Map();
  for (const e of endpoints) if (e.origin) counts.set(e.origin, (counts.get(e.origin) ?? 0) + 1);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const baseUrl = fixedBase !== undefined ? fixedBase : common;
  const baseOrigin = baseUrl ? splitUrl(baseUrl).origin?.toLowerCase() : null;
  const out = endpoints.map(({ origin, ...e }, i) => {
    const foreign = Boolean(origin && baseOrigin && origin.toLowerCase() !== baseOrigin);
    const badMethod = !METHODS.includes(e.method.toLowerCase());
    const ep = { id: `i${i}`, ...e, name: e.name.slice(0, MAX_TEXT), group: e.group.slice(0, MAX_TEXT), selectable: !foreign && !badMethod };
    if (foreign) ep.warnings.push(`Different host ${origin}; one host per test`);
    if (badMethod) ep.warnings.push(`Method ${e.method} is not supported`);
    return ep;
  });
  return { format, title, baseUrl, endpoints: out, warnings };
}

// ---- Postman v2.0 / v2.1 ----

function postmanAuth(auth, headers, warnings) {
  if (!auth || auth.type === 'noauth') return;
  const a = kv(auth[auth.type]);
  if (auth.type === 'bearer') headers.Authorization = `Bearer ${a.token}`;
  else if (auth.type === 'basic') headers.Authorization = `Basic ${btoa(`${a.username ?? ''}:${a.password ?? ''}`)}`;
  else if (auth.type === 'apikey' && (a.in ?? 'header') === 'header') headers[a.key] = a.value;
  else warnings.push(`Auth type "${auth.type}" was not imported`);
}

function postmanBody(body, headers, warnings) {
  if (!body) return undefined;
  const setType = (t) => {
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = t;
  };
  switch (body.mode) {
    case 'raw':
      if (body.options?.raw?.language === 'json') setType(JSON_TYPE);
      return body.raw || undefined;
    case 'urlencoded':
      setType('application/x-www-form-urlencoded');
      return (body.urlencoded ?? []).filter((x) => !x.disabled).map((x) => `${encodeURIComponent(x.key)}=${encodeURIComponent(x.value ?? '')}`).join('&');
    case 'graphql': {
      setType(JSON_TYPE);
      let variables = body.graphql?.variables;
      try {
        variables = variables ? JSON.parse(variables) : undefined;
      } catch {
        // keep the text as given
      }
      return JSON.stringify({ query: body.graphql?.query ?? '', variables });
    }
    case 'formdata':
      warnings.push('Form data bodies are not supported');
      return undefined;
    default:
      return undefined;
  }
}

/** Postman url objects may lack "raw": rebuild it from protocol, host, port, path and enabled query. */
function urlFromParts(u) {
  if (!u) return '';
  const host = Array.isArray(u.host) ? u.host.join('.') : u.host ?? '';
  const path = Array.isArray(u.path) ? u.path.join('/') : String(u.path ?? '').replace(/^\//, '');
  const query = (u.query ?? []).filter((q) => !q.disabled).map((q) => (q.value === undefined || q.value === null ? q.key : `${q.key}=${q.value}`));
  const origin = host ? `${u.protocol ? `${u.protocol}://` : ''}${host}${u.port ? `:${u.port}` : ''}` : '';
  return `${origin}/${path}${query.length ? `?${query.join('&')}` : ''}`;
}

function fromPostman(doc) {
  const vars = kv(doc.variable);
  const sub = (s) => String(s ?? '').replace(/\{\{([^}]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
  const title = doc.info?.name ?? 'Postman collection';
  const endpoints = [];

  const walk = (items, folders, inheritedAuth) => {
    for (const it of items ?? []) {
      const auth = it.auth ?? inheritedAuth;
      if (it.item) {
        walk(it.item, [...folders, it.name], auth);
        continue;
      }
      if (!it.request) continue;
      const req = typeof it.request === 'string' ? { method: 'GET', url: it.request } : it.request;
      const rawUrl = typeof req.url === 'string' ? req.url : req.url?.raw ?? urlFromParts(req.url);
      const warnings = [];
      const headers = {};
      for (const h of req.header ?? []) if (!h.disabled) headers[h.key] = sub(h.value);
      postmanAuth(req.auth ?? auth, headers, warnings);
      let body = postmanBody(req.body, headers, warnings);
      if (body !== undefined) body = sub(body);
      let url = sub(rawUrl);
      // A leading {{baseUrl}} with no value usually lives in a Postman environment file: treat it as the site address.
      const lead = /^\{\{[^}]+\}\}/.exec(url);
      if (lead) {
        url = url.slice(lead[0].length) || '/';
        warnings.push(`Starts with ${lead[0]}, which has no value. Enter the website address yourself.`);
      }
      for (const m of new Set(url.match(/\{\{[^}]+\}\}/g) ?? [])) warnings.push(`Uses ${m}, which has no value`);
      const { origin, path } = splitUrl(url);
      endpoints.push({ origin, group: folders.length ? folders.join(' / ') : title, name: it.name, method: (req.method ?? 'GET').toUpperCase(), path, headers, ...(body !== undefined ? { body } : {}), warnings });
    }
  };
  walk(doc.item, [], doc.auth);
  return finish('postman', title, endpoints, []);
}

// ---- OpenAPI 3 and Swagger 2 ----

const exampleOf = (p) => p.example ?? p.schema?.example ?? p.schema?.default;

function fromSpec(doc, format) {
  const warnings = [];
  let baseUrl = null;
  let prefix = '';
  if (format === 'swagger') {
    if (doc.host) baseUrl = `${doc.schemes?.[0] ?? 'https'}://${doc.host}${doc.basePath ?? ''}`.replace(/\/+$/, '');
    else warnings.push('No server address in the file. Enter the website address yourself.');
  } else {
    const vars = doc.servers?.[0]?.variables ?? {};
    const server = doc.servers?.[0]?.url?.replace(/\{([^}]+)\}/g, (m, k) => (vars[k]?.default !== undefined ? String(vars[k].default) : m));
    if (!server) warnings.push('No server address in the file. Enter the website address yourself.');
    else if (/^https?:\/\//i.test(server)) baseUrl = server.replace(/\/+$/, '');
    else {
      prefix = server.replace(/\/+$/, '');
      warnings.push('The server address in the file is relative. Enter the website address yourself.');
    }
  }
  if (doc.security?.length || doc.securityDefinitions) warnings.push('This API uses security schemes. Add a login step or an Authorization header.');

  const endpoints = [];
  for (const [rawPath, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = item?.[method];
      if (!op) continue;
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])];
      const epWarnings = [];
      const path = rawPath.replace(/\{([^}]+)\}/g, (m, name) => {
        const v = exampleOf(params.find((p) => p.in === 'path' && p.name === name) ?? {});
        if (v === undefined) {
          epWarnings.push(`Path value {${name}} set to 1, change it if needed`);
          return '1';
        }
        return encodeURIComponent(v);
      });
      const query = params
        .filter((p) => p.in === 'query' && p.required)
        .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(exampleOf(p) ?? '')}`)
        .join('&');
      const headers = {};
      let example;
      if (format === 'swagger') example = params.find((p) => p.in === 'body')?.schema?.example;
      else {
        const c = op.requestBody?.content?.[JSON_TYPE];
        example = c?.example ?? Object.values(c?.examples ?? {})[0]?.value ?? c?.schema?.example;
      }
      const upper = method.toUpperCase();
      const ep = { origin: null, group: op.tags?.[0] ?? 'Untagged', name: op.operationId ?? op.summary ?? `${upper} ${rawPath}`, method: upper, path: prefix + path + (query ? `?${query}` : ''), headers, warnings: epWarnings };
      if (example !== undefined) {
        headers['Content-Type'] = JSON_TYPE;
        ep.body = typeof example === 'string' ? example : JSON.stringify(example);
      }
      endpoints.push(ep);
    }
  }
  return finish(format, doc.info?.title ?? 'API', endpoints, warnings, baseUrl);
}

// ---- plain list ----

function fromNative(list) {
  const endpoints = list.map((e) => {
    const { origin, path } = splitUrl(String(e.path));
    const ep = { origin, group: e.group ?? 'Imported', name: e.name ?? `${String(e.method).toUpperCase()} ${maskQuery(path)}`, method: String(e.method).toUpperCase(), path, headers: e.headers ?? {}, warnings: [] };
    if (e.body !== undefined) ep.body = typeof e.body === 'string' ? e.body : JSON.stringify(e.body);
    return ep;
  });
  return finish('native', 'API list', endpoints, []);
}

export function importCollection(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    if (/^\s*(openapi|swagger)\s*:/m.test(text)) throw new Error(YAML);
    throw new Error('This file is not valid JSON.');
  }
  if (typeof doc?.info?.schema === 'string' && doc.info.schema.includes('getpostman.com/json/collection')) return fromPostman(doc);
  if (typeof doc?.openapi === 'string' && doc.openapi.startsWith('3')) return fromSpec(doc, 'openapi');
  if (doc?.swagger === '2.0') return fromSpec(doc, 'swagger');
  if (Array.isArray(doc) && doc.length && doc.every((e) => e && typeof e === 'object' && e.method && e.path)) return fromNative(doc);
  throw new Error(UNSUPPORTED);
}
