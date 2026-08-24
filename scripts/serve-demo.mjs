import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only demo/ and src/ are on the wire — the demo page plus the library modules
// it imports. Serving the repo root would expose .git/, the downloaded corpus,
// and local scratch to any browser tab that can reach localhost.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoRoot = resolve(repoRoot, 'demo');
const srcRoot = resolve(repoRoot, 'src');

const defaultPort = 8080;
const portAttempts = 10;

// .ts maps to text/javascript: browsers refuse module scripts served with a
// non-JavaScript MIME type, and Chrome strips types from .ts sources it can run.
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ts': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

async function handle(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    notFound(res);
    return;
  }
  const inSrc = pathname === '/src' || pathname.startsWith('/src/');
  const mountRoot = inSrc ? srcRoot : demoRoot;
  let relative;
  if (inSrc) {
    relative = pathname.slice('/src/'.length);
  } else {
    relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  }
  const filePath = resolve(mountRoot, relative);
  if (filePath !== mountRoot && !filePath.startsWith(mountRoot + sep)) {
    notFound(res);
    return;
  }
  let body;
  try {
    body = await readFile(filePath);
  } catch {
    notFound(res);
    return;
  }
  const type = contentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  res.end(body);
}

function listen(server, port) {
  return new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      resolvePort();
    });
  });
}

const server = createServer(handle);
let boundPort = null;
for (let port = defaultPort; port < defaultPort + portAttempts; port += 1) {
  try {
    await listen(server, port);
    boundPort = port;
    break;
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
  }
}

if (boundPort === null) {
  console.error(`no free port between ${defaultPort} and ${defaultPort + portAttempts - 1}`);
  process.exitCode = 1;
} else {
  console.log(`wolfyReader demo at http://localhost:${boundPort}/`);
}
