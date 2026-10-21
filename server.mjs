// Local JSON API for Perf Studio. Binds to 127.0.0.1 only.
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LIMITS, PRESETS, TEST_TYPES, validateConfig } from './lib/config.js';
import { RunManager } from './lib/runner.js';

const ID_RE = /^[a-z0-9-]+$/;
const MAX_BODY = 1_000_000;

// Only these files are ever served as static content (never a path built from the URL).
const STATIC = {
  '/': ['ui/index.html', 'text/html; charset=utf-8'],
  '/lib/config.js': ['lib/config.js', 'text/javascript'],
  '/lib/form.js': ['lib/form.js', 'text/javascript'],
  '/lib/stages.js': ['lib/stages.js', 'text/javascript'],
};

export function createServer({ manager, port, root = import.meta.dirname }) {
  const server = http.createServer((req, res) => {
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    const handle = async () => {
      // Blocks other websites (DNS rebinding) and cross site form posts from driving load tests.
      const p = server.address()?.port ?? port;
      if (![`127.0.0.1:${p}`, `localhost:${p}`].includes(req.headers.host)) return send(403, { error: 'Forbidden host' });

      const path = req.url.split('?')[0];
      if (req.method === 'POST' && !(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(415, { error: 'Content-Type must be application/json' });
      }

      if (req.method === 'GET' && Object.hasOwn(STATIC, path)) {
        const [file, type] = STATIC[path];
        return send(200, readFileSync(join(root, file)), type);
      }

      if (req.method === 'GET' && path === '/api/defaults') {
        return send(200, { limits: LIMITS, presets: PRESETS, testTypes: TEST_TYPES, grafanaDashboardUrl: 'http://localhost:3000/d/perf-studio/perf-studio?var-testid=' });
      }
      if (req.method === 'GET' && path === '/api/runs') return send(200, manager.list());

      if (req.method === 'POST' && path === '/api/runs') {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > MAX_BODY) return send(413, { errors: ['Request is too large'] });
        }
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return send(400, { errors: ['Body must be valid JSON'] });
        }
        const v = validateConfig(body);
        if (!v.ok) return send(400, { errors: v.errors });
        try {
          return send(201, manager.start(v.config));
        } catch (e) {
          if (e.code === 'BUSY') return send(409, { error: 'A test is already running. Stop it or wait for it to finish.' });
          throw e;
        }
      }

      let m = path.match(/^\/api\/runs\/([^/]+)$/);
      if (req.method === 'GET' && m) {
        const run = ID_RE.test(m[1]) && manager.get(m[1]);
        return run ? send(200, run) : send(404, { error: 'Unknown run' });
      }
      m = path.match(/^\/api\/runs\/([^/]+)\/stop$/);
      if (req.method === 'POST' && m) return send(200, { stopped: ID_RE.test(m[1]) ? await manager.stop(m[1]) : false });

      m = path.match(/^\/runs\/([^/]+)\/report\.html$/);
      if (req.method === 'GET' && m) {
        const file = ID_RE.test(m[1]) ? manager.reportPath(m[1]) : undefined;
        return file ? send(200, readFileSync(file), 'text/html; charset=utf-8') : send(404, { error: 'No report for this run' });
      }
      send(404, { error: 'Not found' });
    };
    handle().catch((e) => send(500, { error: e.message }));
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const root = import.meta.dirname;
  const k6Bin = process.env.K6_BIN || (existsSync('C:\\Program Files\\k6\\k6.exe') ? 'C:\\Program Files\\k6\\k6.exe' : 'k6');
  const port = Number(process.env.PORT || 4173);
  const manager = new RunManager({ runsDir: join(root, 'runs'), k6Bin, root });
  createServer({ manager, port }).listen(port, '127.0.0.1', () => console.log(`Perf Studio running at http://localhost:${port}`));
}
