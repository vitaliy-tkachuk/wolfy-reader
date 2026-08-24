import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};

/**
 * Serve `roots` — a map of URL prefix to directory — on an ephemeral port.
 * Module scripts do not load from file:// in Chromium, hence the server.
 */
export async function serve(roots) {
  // Longest prefix first, so a '/' mount does not shadow '/fixtures'.
  const mounts = Object.entries(roots)
    .map(([prefix, dir]) => [prefix, resolve(dir)])
    .sort((a, b) => b[0].length - a[0].length);

  const server = createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (pathname === '/') pathname = '/page.html';

    const mount = mounts.find(
      ([prefix]) => prefix === '/' || pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    if (mount === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const [prefix, dir] = mount;
    const relative = pathname.slice(prefix === '/' ? 1 : prefix.length + 1);
    const filePath = resolve(dir, relative);
    if (filePath !== dir && !filePath.startsWith(dir + sep)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    let body;
    try {
      body = await readFile(filePath);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': contentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  });

  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', fail);
      done();
    });
  });

  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}
