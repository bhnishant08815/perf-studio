import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importCollection } from '../lib/importers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const byName = (r, name) => r.endpoints.find((e) => e.name === name);

const postman = importCollection(fixture('postman.json'));

test('postman: format, title, base url from the most common host', () => {
  assert.equal(postman.format, 'postman');
  assert.equal(postman.title, 'Store API');
  assert.equal(postman.baseUrl, 'https://api.shop.test');
});

test('postman: ids follow file order', () => {
  assert.deepEqual(postman.endpoints.map((e) => e.id), postman.endpoints.map((_, i) => `i${i}`));
  assert.equal(postman.endpoints[0].name, 'List products');
});

test('postman: variables resolved, path keeps the query string', () => {
  const e = byName(postman, 'List products');
  assert.equal(e.method, 'GET');
  assert.equal(e.path, '/products?page=1');
  assert.equal(e.group, 'Store API');
});

test('postman: disabled headers dropped, collection bearer auth inherited', () => {
  const e = byName(postman, 'List products');
  assert.equal(e.headers['X-Debug'], undefined);
  assert.equal(e.headers.Accept, 'application/json');
  assert.equal(e.headers.Authorization, 'Bearer abc123');
});

test('postman: nested folders become the group path', () => {
  assert.equal(byName(postman, 'Refund').group, 'Shop / Orders / Admin');
  assert.equal(byName(postman, 'Upload invoice').group, 'Shop / Orders');
});

test('postman: raw json body gets a content type', () => {
  const e = byName(postman, 'Refund');
  assert.equal(e.body, '{"amount":5}');
  assert.equal(e.headers['Content-Type'], 'application/json');
});

test('postman: form data is not imported and says so', () => {
  const e = byName(postman, 'Upload invoice');
  assert.equal(e.body, undefined);
  assert.ok(e.warnings.includes('Form data bodies are not supported'));
});

test('postman: string request is a GET and unresolved variables are flagged', () => {
  const e = byName(postman, 'Tenant info');
  assert.equal(e.method, 'GET');
  assert.equal(e.path, '/{{tenant}}/info');
  assert.ok(e.warnings.includes('Uses {{tenant}}, which has no value'));
  assert.equal(e.selectable, true);
});

test('postman: basic auth and urlencoded body', () => {
  const e = byName(postman, 'Login form');
  assert.equal(e.headers.Authorization, 'Basic dTpw');
  assert.equal(e.body, 'a=1&b=2');
  assert.equal(e.headers['Content-Type'], 'application/x-www-form-urlencoded');
});

test('postman: api key header and graphql body', () => {
  const e = byName(postman, 'Search');
  assert.equal(e.headers['X-Api-Key'], 'k1');
  assert.equal(e.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(e.body), { query: '{ items { id } }', variables: { n: 1 } });
});

test('postman: unknown auth type warns, noauth sends nothing', () => {
  assert.ok(byName(postman, 'Signed call').warnings.includes('Auth type "awsv4" was not imported'));
  assert.equal(byName(postman, 'Public').headers.Authorization, undefined);
});

test('postman: another host cannot be selected', () => {
  const e = byName(postman, 'Status page');
  assert.equal(e.selectable, false);
  assert.ok(e.warnings.includes('Different host https://status.other.test; one host per test'));
});

test('postman v2.0 schema is accepted', () => {
  const r = importCollection(JSON.stringify({ info: { name: 'Old', schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json' }, item: [{ name: 'a', request: 'https://x.test/a' }] }));
  assert.equal(r.format, 'postman');
  assert.equal(r.endpoints[0].path, '/a');
});

const openapi = importCollection(fixture('openapi.json'));

test('openapi: base url, names, groups', () => {
  assert.equal(openapi.format, 'openapi');
  assert.equal(openapi.title, 'Items API');
  assert.equal(openapi.baseUrl, 'https://api.example.com/v2');
  assert.deepEqual(openapi.endpoints.map((e) => e.name), ['getItem', 'List items', 'POST /items', 'GET /health']);
  assert.equal(openapi.endpoints[0].group, 'Items');
  assert.equal(byName(openapi, 'GET /health').group, 'Untagged');
});

test('openapi: path params without example become 1 with a warning', () => {
  const e = byName(openapi, 'getItem');
  assert.equal(e.path, '/items/1');
  assert.ok(e.warnings.includes('Path value {id} set to 1, change it if needed'));
});

test('openapi: required query params added, optional ones skipped', () => {
  assert.equal(byName(openapi, 'List items').path, '/items?limit=10');
});

test('openapi: json body example and security warning', () => {
  const e = byName(openapi, 'POST /items');
  assert.equal(e.body, '{"name":"pen"}');
  assert.equal(e.headers['Content-Type'], 'application/json');
  assert.ok(openapi.warnings.includes('This API uses security schemes. Add a login step or an Authorization header.'));
});

test('swagger 2: base url from host and basePath, body parameter example', () => {
  const r = importCollection(fixture('swagger.json'));
  assert.equal(r.format, 'swagger');
  assert.equal(r.baseUrl, 'https://api.example.com/v1');
  assert.equal(r.endpoints[0].body, '{"email":"a@b.c"}');
  assert.equal(r.endpoints[0].group, 'Users');
});

test('native list', () => {
  const r = importCollection('[{"method":"get","path":"/a"},{"method":"POST","path":"https://x.test/b","body":{"k":1}}]');
  assert.equal(r.format, 'native');
  assert.equal(r.endpoints[0].method, 'GET');
  assert.equal(r.endpoints[1].path, '/b');
  assert.equal(r.endpoints[1].body, '{"k":1}');
  assert.equal(r.baseUrl, 'https://x.test');
});

test('yaml is rejected with a clear message', () => {
  assert.throws(() => importCollection('openapi: 3.0.0\ninfo:\n  title: x'), {
    message: 'YAML files are not supported yet. Export the file as JSON and import again.',
  });
});

test('unknown json is rejected with a clear message', () => {
  assert.throws(() => importCollection('{"hello":1}'), {
    message: 'Unsupported file. Use a Postman collection, OpenAPI 3 or Swagger 2 JSON file, or a list of {method, path}.',
  });
});
