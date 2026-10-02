require('../tests/manual/guard.js');
// Runs the real built main process and renderer with a disposable profile.
// Invoke with Electron, not Node: NODE_ENV=production electron scripts/smoke-electron.cjs
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const started = performance.now();
const output = path.resolve(
  process.env.OPENMTP_SMOKE_OUTPUT ||
    path.join(os.tmpdir(), `openmtp-smoke-${process.pid}`),
);
fs.mkdirSync(output, { recursive: true });
process.env.OPENMTP_PROFILE_DIR ||= path.join(output, 'profile');
process.env.OPENMTP_TRACE_FILE ||= path.join(output, 'trace.jsonl');
process.env.OPENMTP_TRACE = '1';
process.env.OPENMTP_TEST_MODE = '1';
process.env.OPENMTP_RENDERER_DIAGNOSTICS = '1';
process.env.OPENMTP_TELEMETRY = '0';
app.setPath('userData', path.join(output, 'electron-profile'));

const report = {
  startedAt: new Date().toISOString(),
  electron: process.versions.electron,
  crashes: [],
  errors: [],
  expectedRecoveryErrors: [],
};
let finished = false;
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  report.ok =
    !error && report.crashes.length === 0 && report.errors.length === 0;
  if (error) report.failure = error.stack || String(error);
  report.totalMs = performance.now() - started;
  fs.writeFileSync(
    path.join(output, 'result.json'),
    JSON.stringify(report, null, 2),
  );
  console.info(JSON.stringify(report));
  process.exitCode = report.ok ? 0 : 1;
  app.quit();
  setTimeout(() => app.exit(report.ok ? 0 : 1), 5000).unref();
}
const timeoutMs = Number(process.env.OPENMTP_SMOKE_TIMEOUT_MS || 45000);
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000)
  throw new Error('OPENMTP_SMOKE_TIMEOUT_MS must be between 1000 and 300000');
const watchdog = setTimeout(
  () => finish(new Error(`App scenario did not finish within ${timeoutMs}ms`)),
  timeoutMs,
);
app.on('child-process-gone', (_event, details) => report.crashes.push(details));
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('render-process-gone', (_event, details) =>
    report.crashes.push(details),
  );
  window.webContents.on('console-message', (...args) => {
    const details = args[0]?.message ? args[0] : args[1];
    if (details?.level === 'error') {
      // The corrupt-profile matrix deliberately supplies truncated JSON. Keep
      // its recovery diagnostics visible without treating that expected input
      // as an unrelated renderer failure. Every other error remains fatal.
      if (
        process.env.OPENMTP_SMOKE_EXPECT_CORRUPT_PROFILE === '1' &&
        details.message ===
          'SyntaxError: Unexpected end of JSON input Storage -> getAll'
      ) {
        report.expectedRecoveryErrors.push(details.message);
      } else report.errors.push(details.message);
    }
  });
  // app.html already logs startup errors before deferred renderer scripts run.
  // Record subsequent errors independently too, including rejected promises
  // that occur after the initial usable snapshot.
  window.webContents.once('dom-ready', () => {
    window.webContents
      .executeJavaScript(
        `(() => {
      window.__OPENMTP_SMOKE_ERRORS__ = [];
      window.addEventListener('error', event => {
        window.__OPENMTP_SMOKE_ERRORS__.push(event.message || 'Resource error');
      });
      window.addEventListener('unhandledrejection', event => {
        window.__OPENMTP_SMOKE_ERRORS__.push(String(event.reason?.stack || event.reason));
      });
    })()`,
      )
      .catch((error) =>
        report.errors.push(`Diagnostics injection failed: ${error.message}`),
      );
  });
  window.webContents.once('did-finish-load', async () => {
    try {
      const deadline = Date.now() + 25000;
      let state;
      while (Date.now() < deadline) {
        state = await window.webContents.executeJavaScript(`({
          text: document.getElementById('root')?.innerText || '',
          storeReady: Boolean(window.__OPENMTP_TEST_STORE__?.getState().Home?.directoryLists.local.isLoaded),
          fonts: [...document.fonts].map(f => ({ family: f.family, status: f.status })),
          bodyFont: getComputedStyle(document.body).fontFamily,
          brokenImages: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src)
        })`);
        if (state.storeReady && state.text.length > 30) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!state?.storeReady || state.text.length < 30)
        throw new Error(`Renderer not usable: ${JSON.stringify(state)}`);
      report.usableMs = performance.now() - started;
      if (process.env.OPENMTP_SMOKE_WIDTH || process.env.OPENMTP_SMOKE_HEIGHT) {
        const width = Number(process.env.OPENMTP_SMOKE_WIDTH || 880);
        const height = Number(process.env.OPENMTP_SMOKE_HEIGHT || 640);
        if (
          !Number.isFinite(width) ||
          !Number.isFinite(height) ||
          width < 1 ||
          height < 1
        )
          throw new Error('Invalid smoke window dimensions');
        window.unmaximize();
        window.setContentSize(Math.round(width), Math.round(height));
        await window.webContents.executeJavaScript(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        );
        report.windowSize = window.getContentSize();
      }
      await window.webContents.executeJavaScript(
        'document.fonts.ready.then(() => true)',
      );
      report.renderer = await window.webContents.executeJavaScript(`({
        text: document.getElementById('root').innerText.slice(0, 1500),
        font: getComputedStyle(document.body).fontFamily,
        fonts: [...document.fonts].map(f => ({ family: f.family, status: f.status })),
        brokenImages: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src)
      })`);
      if (report.renderer.fonts.some((font) => font.status === 'error'))
        throw new Error('A font failed to load');
      if (process.env.OPENMTP_SMOKE_SCENARIO) {
        const scenario = fs.readFileSync(
          path.resolve(process.env.OPENMTP_SMOKE_SCENARIO),
          'utf8',
        );
        report.scenario = await window.webContents.executeJavaScript(scenario);
      }
      const settleMs = Number(process.env.OPENMTP_SMOKE_SETTLE_MS || 1500);
      if (!Number.isFinite(settleMs) || settleMs < 0 || settleMs > 30000)
        throw new Error('Invalid smoke observation duration');
      // getAppMetrics computes CPU usage since its previous sample.
      app.getAppMetrics();
      const cpuSampleStarted = performance.now();
      await new Promise((resolve) => setTimeout(resolve, settleMs));
      report.metrics = app.getAppMetrics();
      report.cpuSampleMs = performance.now() - cpuSampleStarted;
      report.finalRenderer = await window.webContents
        .executeJavaScript(`(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
        const root = document.getElementById('root');
        return {
          rootChildCount: root?.children.length || 0,
          textLength: root?.innerText.length || 0,
          errorBoundaryVisible: [...(root?.querySelectorAll('button') || [])].some(button => button.textContent.trim() === 'Reload The App'),
          errors: window.__OPENMTP_SMOKE_ERRORS__ || [],
          fonts: [...document.fonts].map(font => ({family: font.family, status: font.status})),
          brokenImages: [...document.images].filter(image => !image.complete || image.naturalWidth === 0).map(image => image.src)
        };
      })()`);
      fs.writeFileSync(
        path.join(output, 'window.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      if (
        !report.finalRenderer.rootChildCount ||
        report.finalRenderer.textLength < 30 ||
        report.finalRenderer.errorBoundaryVisible
      )
        throw new Error('Renderer became unusable after startup');
      if (report.finalRenderer.brokenImages.length)
        throw new Error(
          `Images failed to load: ${report.finalRenderer.brokenImages.join(', ')}`,
        );
      if (report.finalRenderer.fonts.some((font) => font.status === 'error'))
        throw new Error('A font failed to load after startup');
      if (report.finalRenderer.errors.length || report.errors.length)
        throw new Error(
          `Renderer reported errors: ${JSON.stringify([...report.errors, ...report.finalRenderer.errors])}`,
        );
      finish();
    } catch (error) {
      try {
        fs.writeFileSync(
          path.join(output, 'failure.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
      } catch (_) {
        // A crashed renderer cannot provide a screenshot; its trace remains.
      }
      finish(error);
    }
  });
});
require('../app/main.prod.js');
