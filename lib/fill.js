// Finds and fills the gaps in a call: a path segment like /:round_id, or {{name}} in the path,
// a header value or the body. A colon anywhere else (a time in a body, a port in a header) is not a gap.
// Pure: safe in the browser and in Node.

const SEGMENT = /(^|\/):([A-Za-z_][\w-]*)/g;
const BRACES = /\{\{\s*([\w.-]+)\s*\}\}/g;

const names = (text, re, group) => [...String(text ?? '').matchAll(re)].map((m) => m[group]);
const unique = (list) => [...new Set(list)];

export function findPlaceholders(endpoint) {
  const { path, headers, body } = endpoint;
  return unique([
    ...names(path, SEGMENT, 2),
    ...names(path, BRACES, 1),
    ...Object.values(headers ?? {}).flatMap((v) => names(v, BRACES, 1)),
    ...names(body, BRACES, 1),
  ]);
}

export const allPlaceholders = (endpoints) => unique(endpoints.flatMap(findPlaceholders));

// An empty value counts as not filled, so the gap stays and is still reported.
export function fillValues(endpoint, values) {
  const has = (name) => typeof values[name] === 'string' && values[name] !== '';
  const raw = (text) => text.replace(BRACES, (whole, name) => (has(name) ? values[name] : whole));
  const inPath = (text) =>
    text
      .replace(SEGMENT, (whole, slash, name) => (has(name) ? slash + encodeURIComponent(values[name]) : whole))
      .replace(BRACES, (whole, name) => (has(name) ? encodeURIComponent(values[name]) : whole));
  const out = { ...endpoint, path: inPath(endpoint.path) };
  if (endpoint.headers) out.headers = Object.fromEntries(Object.entries(endpoint.headers).map(([k, v]) => [k, raw(v)]));
  if (typeof endpoint.body === 'string') out.body = raw(endpoint.body);
  return out;
}
