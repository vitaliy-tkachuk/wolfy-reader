import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from './server.mjs';

const benchDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(benchDir, '..');

const PAGE_WIDTH = 800;
const PAGE_HEIGHT = 600;
const COLUMN_GAP = 40;
const FONT_SIZE = 16;
const RELAYOUT_FONT_SIZE = 21;
const WARMUP_RUNS = 1;

function parseArgs(argv) {
  const args = {
    fixtures: resolve(benchDir, 'fixtures', 'manifest.json'),
    runs: 3,
    turns: 60,
    chunkChars: [8000],
    virtualization: ['content-visibility'],
    positions: 12,
  };
  const readers = {
    '--fixtures': (value) => { args.fixtures = resolve(value); },
    '--runs': (value) => { args.runs = Number(value); },
    '--turns': (value) => { args.turns = Number(value); },
    '--positions': (value) => { args.positions = Number(value); },
    '--chunk-chars': (value) => { args.chunkChars = value.split(',').map(Number); },
    '--virtualization': (value) => { args.virtualization = value.split(','); },
  };
  for (let i = 0; i < argv.length; i += 1) {
    const reader = readers[argv[i]];
    if (reader === undefined) continue;
    reader(argv[i + 1]);
    i += 1;
  }
  return args;
}

async function readManifest(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function runGenerator() {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(repoRoot, 'scripts', 'make-bench-fixture.mjs')], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    child.on('error', () => done(false));
    child.on('exit', (code) => done(code === 0));
  });
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function spread(values) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (clean.length === 0) return null;
  return { min: Math.min(...clean), median: median(clean), max: Math.max(...clean), runs: clean.length };
}

function fmt(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function fmtSpread(s, digits = 1) {
  if (s === null) return '—';
  return `${fmt(s.median, digits)} [${fmt(s.min, digits)}–${fmt(s.max, digits)}]`;
}

function pad(text, width) {
  return String(text).padEnd(width);
}

function padStart(text, width) {
  return String(text).padStart(width);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.log('bench: playwright is not installed — skipping. Run `npm install` first.');
    return;
  }

  let manifest = await readManifest(args.fixtures);
  if (manifest === null && args.fixtures === resolve(benchDir, 'fixtures', 'manifest.json')) {
    console.log('bench: fixtures missing, running scripts/make-bench-fixture.mjs…');
    await runGenerator();
    manifest = await readManifest(args.fixtures);
  }
  if (manifest === null || !Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
    console.log(`bench: no fixtures at ${args.fixtures} — skipping (the corpus is probably absent).`);
    return;
  }

  const fixturesDir = dirname(args.fixtures);
  const server = await serve({ '/': benchDir, '/fixtures': fixturesDir });

  // Full Chromium, not the headless shell: the shell is a stripped build with a
  // different compositor path, which is exactly the thing being measured here.
  const browser = await playwright.chromium.launch({
    channel: 'chromium',
    args: ['--enable-precise-memory-info', '--disable-backgrounding-occluded-windows'],
  });

  const variants = [{ id: 'naive', strategy: 'naive', options: {} }];
  for (const chars of args.chunkChars) {
    for (const virtualization of args.virtualization) {
      const suffix = [
        args.chunkChars.length > 1 ? `@${chars}` : '',
        args.virtualization.length > 1 ? `/${virtualization === 'content-visibility' ? 'cv' : virtualization}` : '',
      ].join('');
      variants.push({
        id: `chunked${suffix}`,
        strategy: 'chunked',
        options: { chunkChars: chars, virtualization },
      });
    }
  }

  const results = {
    generatedAt: new Date().toISOString(),
    chromium: browser.version(),
    platform: `${process.platform} ${process.arch}`,
    viewport: { pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT, columnGap: COLUMN_GAP, fontSize: FONT_SIZE, deviceScaleFactor: 1 },
    relayoutFontSize: RELAYOUT_FONT_SIZE,
    runs: args.runs,
    turnsPerRun: args.turns,
    fixtures: manifest.fixtures.map(({ id, label, file, bytes, source }) => ({ id, label, file, bytes, source })),
    measurements: [],
    notes: [
      'Paint timings are double-rAF and therefore floored by the ~16.7ms frame interval; the *Layout* figures are the un-quantized main-thread cost and are what actually separates the strategies.',
      'jsHeap* is performance.memory.usedJSHeapSize (--enable-precise-memory-info): the JS heap only. It excludes the layout tree, style data, paint and GPU memory. cdpLayoutObjects*/domNodes* are the closer proxies for what the columnizer holds.',
      'cdpLayoutDuration/cdpRecalcStyleDuration are cumulative process totals since Performance.enable, not per-measure figures.',
      'The chunked strategy forces a page break at every chunk boundary, so it reports more pages than naive on identical content; pageCountExact carries the size of that penalty.',
      'The chunked page count at first paint is an estimate from measured chunk density; pageCountInitial vs pageCountExact is its error.',
      'Turn timings walk sequential pages from the start; seek timings jump across the whole document. The two regimes give opposite verdicts and both are reported.',
    ],
  };

  for (const fixture of manifest.fixtures) {
    for (const variant of variants) {
      const runs = [];
      let splitStats = null;
      for (let run = 0; run < args.runs + WARMUP_RUNS; run += 1) {
        const sample = await measureOnce({
          browser,
          server,
          fixture,
          variant,
          turnCount: args.turns,
          positionCount: args.positions,
        });
        if (run < WARMUP_RUNS) continue;
        runs.push(sample);
        if (sample.setup.stats.split !== undefined) splitStats = sample.setup.stats.split;
      }

      const pick = (path) => runs.map(path);
      results.measurements.push({
        fixture: fixture.id,
        strategy: variant.id,
        chunkChars: variant.options.chunkChars ?? null,
        chunks: runs[0].setup.stats.chunks,
        pageCountInitial: spread(pick((r) => r.setup.pageCount)),
        pageCountExact: spread(pick((r) => r.exact.pageCount)),
        pagesExactAtSetup: runs[0].setup.pagesExact,
        initialRenderPaintMs: spread(pick((r) => r.setup.paintMs)),
        initialRenderLayoutMs: spread(pick((r) => r.setup.layoutMs)),
        exactPageCountMs: spread(pick((r) => r.exact.ms)),
        turnPaintP50Ms: spread(pick((r) => r.turns.paint.p50)),
        turnPaintP95Ms: spread(pick((r) => r.turns.paint.p95)),
        turnLayoutP50Ms: spread(pick((r) => r.turns.layout.p50)),
        turnLayoutP95Ms: spread(pick((r) => r.turns.layout.p95)),
        turnLayoutMaxMs: spread(pick((r) => r.turns.layout.max)),
        seekPaintP50Ms: spread(pick((r) => r.seeks.paint.p50)),
        seekPaintP95Ms: spread(pick((r) => r.seeks.paint.p95)),
        seekLayoutP50Ms: spread(pick((r) => r.seeks.layout.p50)),
        seekLayoutP95Ms: spread(pick((r) => r.seeks.layout.p95)),
        seekLayoutMaxMs: spread(pick((r) => r.seeks.layout.max)),
        realizedAfterTurns: spread(pick((r) => r.turns.realized)),
        realizedAfterSeeks: spread(pick((r) => r.seeks.realized)),
        jsHeapAfterSeeksBytes: spread(pick((r) => r.memoryAfterSeeks.usedJSHeapSize)),
        domNodesAfterSeeks: spread(pick((r) => r.memoryAfterSeeks.domNodes)),
        cdpNodesAfterSeeks: spread(pick((r) => r.cdpAfterSeeks.Nodes)),
        cdpLayoutObjectsAfterSeeks: spread(pick((r) => r.cdpAfterSeeks.LayoutObjects)),
        relayoutPaintMs: spread(pick((r) => r.relayout.paintMs)),
        relayoutLayoutMs: spread(pick((r) => r.relayout.layoutMs)),
        relayoutPagesExact: runs[0].relayout.pagesExact,
        positionP50Ms: spread(pick((r) => r.positions.p50)),
        positionP95Ms: spread(pick((r) => r.positions.p95)),
        positionSamples: runs[0].positions.samples,
        positionAttempted: runs[0].positions.attempted,
        jsHeapAfterSetupBytes: spread(pick((r) => r.memoryAfterSetup.usedJSHeapSize)),
        jsHeapAfterTurnsBytes: spread(pick((r) => r.memoryAfterTurns.usedJSHeapSize)),
        cdpJSHeapAfterTurnsBytes: spread(pick((r) => r.cdpAfterTurns.JSHeapUsedSize)),
        cdpNodesAfterTurns: spread(pick((r) => r.cdpAfterTurns.Nodes)),
        cdpLayoutObjectsAfterTurns: spread(pick((r) => r.cdpAfterTurns.LayoutObjects)),
        cdpLayoutDurationAfterTurns: spread(pick((r) => r.cdpAfterTurns.LayoutDuration)),
        cdpRecalcStyleDurationAfterTurns: spread(pick((r) => r.cdpAfterTurns.RecalcStyleDuration)),
        domNodesAfterTurns: spread(pick((r) => r.memoryAfterTurns.domNodes)),
        splitStats,
      });
    }
  }

  await browser.close();
  await server.close();

  report(results);
  const outPath = resolve(benchDir, 'results.json');
  await writeFile(outPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(`\nwrote ${outPath}`);
}

async function measureOnce({ browser, server, fixture, variant, turnCount, positionCount }) {
  // A fresh context+page per run: a reused page carries the previous run's DOM,
  // style caches and heap, which is exactly the contamination run-to-run
  // variance is supposed to expose.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  await page.goto(`${server.origin}/page.html`);
  await page.waitForFunction(() => window.__benchReady === true);
  await page.evaluate((url) => window.bench.loadFixture(url), `/fixtures/${fixture.file}`);

  const options = {
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    columnGap: COLUMN_GAP,
    fontSize: FONT_SIZE,
    ...variant.options,
  };

  const setup = await page.evaluate(
    (config) => window.bench.setup(config),
    { strategy: variant.strategy, options },
  );
  const memoryAfterSetup = await page.evaluate(() => window.bench.memory());
  const turns = await page.evaluate((count) => window.bench.turns(count), turnCount);
  const memoryAfterTurns = await page.evaluate(() => window.bench.memory());
  const cdpAfterTurns = metricsToObject(await cdp.send('Performance.getMetrics'));
  const seeks = await page.evaluate((count) => window.bench.seeks(count), turnCount);
  const memoryAfterSeeks = await page.evaluate(() => window.bench.memory());
  const cdpAfterSeeks = metricsToObject(await cdp.send('Performance.getMetrics'));
  const positions = await page.evaluate((count) => window.bench.positions(count), positionCount);
  const relayout = await page.evaluate((size) => window.bench.relayout(size), RELAYOUT_FONT_SIZE);
  const exact = await page.evaluate((size) => window.bench.exactPageCount(size), FONT_SIZE);

  await context.close();
  return {
    setup,
    turns,
    seeks,
    positions,
    relayout,
    exact,
    memoryAfterSetup,
    memoryAfterTurns,
    memoryAfterSeeks,
    cdpAfterTurns,
    cdpAfterSeeks,
  };
}

function metricsToObject(payload) {
  const out = {};
  for (const { name, value } of payload.metrics) out[name] = value;
  return out;
}

function printTable(rows, columns) {
  const cells = [
    columns.map(([header]) => header),
    ...rows.map((row) => columns.map(([, get]) => String(get(row)))),
  ];
  const widths = columns.map((_, i) => Math.max(...cells.map((line) => line[i].length)) + 2);
  for (const line of cells) {
    console.log(`   ${line.map((cell, i) => (i === 0 ? pad(cell, widths[i]) : padStart(cell, widths[i]))).join('')}`);
  }
}

function report(results) {
  console.log('');
  console.log(`Chromium ${results.chromium} · ${results.platform}`);
  console.log(
    `viewport ${results.viewport.pageWidth}x${results.viewport.pageHeight} · column-gap ${results.viewport.columnGap}px · ` +
      `font ${results.viewport.fontSize}px Georgia/serif · dpr ${results.viewport.deviceScaleFactor}`,
  );
  console.log(
    `${results.runs} measured runs (fresh page each) + 1 discarded warm-up · ${results.turnsPerRun} page turns per run · ` +
      `re-layout to ${results.relayoutFontSize}px`,
  );
  console.log('cells are median [min–max] across runs');

  for (const fixture of results.fixtures) {
    console.log('');
    console.log(`── ${fixture.id} — ${fixture.label} (${fixture.bytes.toLocaleString()} bytes)`);
    console.log(`   source: ${fixture.source}`);
    const rows = results.measurements.filter((m) => m.fixture === fixture.id);

    printTable(rows, [
      ['strategy', (m) => m.strategy],
      ['chunks', (m) => m.chunks],
      ['pages', (m) => `${m.pageCountInitial?.median ?? '—'}${m.pagesExactAtSetup ? '' : `~/${m.pageCountExact?.median ?? '—'}`}`],
      ['render ms', (m) => fmtSpread(m.initialRenderPaintMs)],
      ['exact-pages ms', (m) => fmtSpread(m.exactPageCountMs)],
      ['turn p50', (m) => fmtSpread(m.turnPaintP50Ms)],
      ['turn p95', (m) => fmtSpread(m.turnPaintP95Ms)],
      ['turn cpu p50', (m) => fmtSpread(m.turnLayoutP50Ms, 2)],
      ['turn cpu p95', (m) => fmtSpread(m.turnLayoutP95Ms, 2)],
      ['relayout ms', (m) => fmtSpread(m.relayoutLayoutMs)],
    ]);
    console.log('');
    printTable(rows, [
      ['strategy', (m) => m.strategy],
      ['seek cpu p50', (m) => fmtSpread(m.seekLayoutP50Ms, 2)],
      ['seek cpu p95', (m) => fmtSpread(m.seekLayoutP95Ms, 2)],
      ['seek cpu max', (m) => fmtSpread(m.seekLayoutMaxMs, 2)],
      ['seek p95', (m) => fmtSpread(m.seekPaintP95Ms)],
      ['chunks live', (m) => `${m.realizedAfterSeeks?.median ?? '—'}/${m.chunks}`],
      ['pos p50 ms', (m) => fmtSpread(m.positionP50Ms, 2)],
      ['JS heap MB', (m) => fmtSpread(scaleSpread(m.jsHeapAfterSeeksBytes, 1 / 1048576), 1)],
      ['DOM nodes', (m) => fmtSpread(m.domNodesAfterSeeks, 0)],
      ['layout objects', (m) => fmtSpread(m.cdpLayoutObjectsAfterSeeks, 0)],
    ]);

    const chunkedRows = rows.filter((m) => m.splitStats !== null && m.splitStats !== undefined);
    const naiveRow = rows.find((m) => m.strategy === 'naive');
    for (const row of chunkedRows) {
      if (naiveRow === undefined) break;
      const truePages = row.pageCountExact?.median;
      const naivePages = naiveRow.pageCountExact?.median;
      const estimated = row.pageCountInitial?.median;
      const overhead = ((truePages / naivePages - 1) * 100).toFixed(1);
      const estimateError = (((estimated - truePages) / truePages) * 100).toFixed(1);
      console.log(
        `   ${row.strategy} cost — ${truePages} pages vs ${naivePages} naive (+${overhead}% from the forced ` +
          `page break at every chunk boundary) · page count shown to the reader at first paint is off by ${estimateError}%`,
      );
    }
    for (const row of chunkedRows) {
      const s = row.splitStats;
      const tags = Object.entries(s.topLevelTags)
        .sort((a, b) => b[1] - a[1])
        .map(([tag, count]) => `${tag.toLowerCase()}:${count}`)
        .join(' ');
      console.log(
        `   ${row.strategy} split — budget ${row.chunkChars} chars → ${row.chunks} chunks · ` +
          `${s.topLevelNodes} top-level nodes · largest block ${s.largestElementChars} chars · ` +
          `${s.oversizedElements} oversized (${s.atomicOversized} atomic) · ${s.headingsDeferred} headings pushed forward`,
      );
      console.log(`   ${' '.repeat(row.strategy.length)}   top-level tags: ${tags}`);
    }
  }

  console.log('');
  console.log('columns');
  console.log('  pages          initial page count (~ = estimated) / exact count after realizing every chunk');
  console.log('  render ms      content handed over → first page painted (double-rAF), split + parse + layout included');
  console.log('  exact-pages ms extra time to know the true page count (naive: already known, this is a re-measure)');
  console.log('  turn p50/p95   goToPage → painted, double-rAF; floored by the ~16.7ms frame interval');
  console.log('  turn cpu       goToPage → forced layout read returns; main-thread cost only, not frame-quantized');
  console.log('  seek cpu       same measure over pseudo-random jumps across the whole document — chunked\'s');
  console.log('                 worst case (cold chunks) and naive\'s best (nothing left to do)');
  console.log('  chunks live    chunks materialized after the seek pass, out of the total');
  console.log('  relayout ms    font-size change → re-paginated (forced layout read), paint excluded');
  console.log('  pos p50        Range.getClientRects() page → character-offset lookup for the current page');
  console.log('  JS heap MB     performance.memory.usedJSHeapSize with --enable-precise-memory-info.');
  console.log('                 This is the JS heap ONLY: it excludes the layout tree, the style cache, paint');
  console.log('                 memory and the GPU tiles — i.e. exactly the memory the columnizer holds.');
  console.log('                 DOM nodes and CDP LayoutObjects (in results.json) are the closer proxies.');
}

function scaleSpread(s, factor) {
  if (s === null) return null;
  return { min: s.min * factor, median: s.median * factor, max: s.max * factor, runs: s.runs };
}

await main();
