import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// stripTypeScriptTypes emits an ExperimentalWarning on first use; swallow only
// that one and keep printing everything else, so real warnings stay visible.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (
    warning.name === 'ExperimentalWarning' &&
    String(warning.message).includes('stripTypeScriptTypes')
  ) {
    return;
  }
  console.error(warning.stack ?? String(warning));
});

// Only demo/ and src/ are on the wire — the demo page plus the library modules
// it imports. Serving the repo root would expose .git/, the downloaded corpus,
// and local scratch to any browser tab that can reach localhost.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demoRoot = resolve(repoRoot, 'demo');
const srcRoot = resolve(repoRoot, 'src');

const defaultPort = 8080;
const portAttempts = 10;

// .ts maps to text/javascript: browsers refuse module scripts served with a
// non-JavaScript MIME type. Type syntax is blanked out server-side before the
// bytes hit the wire (see handle), so the browser receives plain JavaScript.
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
  const extension = extname(filePath).toLowerCase();
  if (extension === '.ts') {
    // mode: 'strip' blanks type syntax in place, preserving line and column
    // numbers so browser stack traces point at the real source location. The
    // stripped output keeps its relative './x.ts' specifiers; the browser
    // requests those and each one is stripped here in turn.
    try {
      body = stripTypeScriptTypes(body.toString('utf8'), { mode: 'strip' });
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Type stripping failed for ${pathname}: ${err.message}`);
      return;
    }
  }
  const type = contentTypes[extension] ?? 'application/octet-stream';
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
