import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Only demo/ and src/ are on the wire by default — the demo page plus the
// library modules it imports. Serving the repo root would expose .git/, the
// downloaded corpus, and local scratch to any browser tab that can reach
// localhost. The browser test harness adds its own mounts explicitly; nothing
// widens this set implicitly.
export const demoMounts = [
  { prefix: '/src', dir: resolve(repoRoot, 'src') },
  { prefix: '/', dir: resolve(repoRoot, 'demo') },
];

const defaultPort = 8080;
const portAttempts = 10;

// .ts maps to text/javascript: browsers refuse module scripts served with a
// non-JavaScript MIME type. Type syntax is blanked out server-side before the
// bytes hit the wire (see handle), so the browser receives plain JavaScript.
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.epub': 'application/epub+zip',
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

function makeHandler(mounts) {
  // Longest prefix first, so a '/' mount never shadows '/fixtures'.
  const ordered = [...mounts].sort((a, b) => b.prefix.length - a.prefix.length);
  return async function handle(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      notFound(res);
      return;
    }
    const mount = ordered.find(
      ({ prefix }) => prefix === '/' || pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    if (mount === undefined) {
      notFound(res);
      return;
    }
    let relative =
      mount.prefix === '/' ? pathname.slice(1) : pathname.slice(mount.prefix.length + 1);
    if (relative === '') relative = 'index.html';
    const filePath = resolve(mount.dir, relative);
    if (filePath !== mount.dir && !filePath.startsWith(mount.dir + sep)) {
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
    res.writeHead(200, {
      'content-type': contentTypes[extension] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  };
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

/**
 * Serves the given mounts, walking up from `port` until one is free. Pass
 * `port: 0` for an ephemeral port, which is what the test harness wants.
 */
export async function startServer({ mounts = demoMounts, port = defaultPort, attempts = portAttempts } = {}) {
  const server = createServer(makeHandler(mounts));
  const last = port === 0 ? 0 : port + attempts - 1;
  for (let candidate = port; candidate <= last; candidate += 1) {
    try {
      await listen(server, candidate);
      const bound = server.address().port;
      return {
        port: bound,
        origin: `http://localhost:${bound}`,
        close: () => new Promise((done) => server.close(done)),
      };
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(`no free port between ${port} and ${last}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const { origin } = await startServer();
    console.log(`wolfyReader demo at ${origin}/`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
