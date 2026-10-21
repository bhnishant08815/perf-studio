// Tiny local target for tests, so nothing hits a real site.
import http from 'node:http';

export function startMock() {
  const server = http.createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/ok') return send(200, { items: [] });
    if (req.url === '/slow') return void setTimeout(() => send(200, { slow: true }), 300);
    if (req.url === '/secure') return req.headers.authorization === 'Bearer t1' ? send(200, { ok: true }) : send(401, {});
    if (req.url === '/login' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body = {};
        try {
          body = JSON.parse(raw);
        } catch {}
        body.user === 'u' ? send(200, { access_token: 't1' }) : send(401, {});
      });
      return;
    }
    send(404, {});
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))),
      }),
    ),
  );
}
