'use strict';

require('../tests/manual/guard.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { app, BrowserWindow, Menu, ipcMain } = require('electron');

// Start the real production application with a private disposable profile.
// Run in a network namespace with only loopback, as described in SECURITY.md.
const fixture = fs.mkdtempSync(
  path.join(os.tmpdir(), 'openmtp-security-smoke-'),
);
process.env.OPENMTP_PROFILE_DIR = path.join(fixture, 'profile');
process.env.OPENMTP_TEST_MODE = '1';
process.env.OPENMTP_TELEMETRY = '0';
process.env.NODE_ENV = 'production';
app.setPath('userData', path.join(fixture, 'electron'));
fs.mkdirSync(process.env.OPENMTP_PROFILE_DIR, { recursive: true });
fs.writeFileSync(
  path.join(process.env.OPENMTP_PROFILE_DIR, 'settings.json'),
  JSON.stringify({
    enableAutoUpdateCheck: false,
    enableBackgroundAutoUpdate: false,
    enableAnalytics: false,
  }),
  { mode: 0o600 },
);

const failures = [];
const windows = [];
const probe = `(() => {
  const assert = require('node:assert/strict');
  const tls = require('node:tls');
  const dns = require('node:dns');
  const cached = { check: tls.checkServerIdentity, resolve: dns.resolve4 };
  assert.equal(cached.check('127.1', { subjectaltname: 'DNS:127.0.0.1' }).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  assert.equal(cached.check('localhost', { subjectaltname: 'DNS:localhost' }), undefined);
  for (const api of [dns, new dns.Resolver(), dns.promises, new dns.promises.Resolver()]) {
    assert.throws(() => api.resolve4('example.test\\0.trusted.test', () => {}), { code: 'ERR_INVALID_ARG_VALUE' });
  }
  assert.throws(() => cached.resolve('example.test\\0.trusted.test', () => {}), { code: 'ERR_INVALID_ARG_VALUE' });
  return { guarded: true, node: process.versions.node, electron: process.versions.electron };
})()`;

app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_e, _file, error) =>
    failures.push(error.message),
  );
  contents.on('render-process-gone', (_e, detail) =>
    failures.push(detail.reason),
  );
});
const watchdog = setTimeout(
  () => finish(new Error('Security smoke timed out')),
  60000,
);
let finished = false;
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  if (error) failures.push(error.stack || String(error));
  console.info(
    JSON.stringify({
      ok: failures.length === 0,
      failures,
      windows,
      node: process.versions.node,
      electron: process.versions.electron,
    }),
  );
  fs.rmSync(fixture, { recursive: true, force: true });
  app.exit(failures.length ? 1 : 0);
}
app.on('will-quit', () => fs.rmSync(fixture, { recursive: true, force: true }));

async function inspect(window, kind) {
  const preferences = window.webContents.getLastWebPreferences();
  assert.equal(preferences.contextIsolation, false);
  assert.equal(preferences.nodeIntegration, true);
  // Verify the path too when Electron returns it. The execution probe checks
  // coverage even when the serialized preferences omit that field.
  const preload = preferences.preload;
  if (preload) {
    assert.equal(path.basename(preload), 'renderer-preload.cjs');
    assert.equal(fs.existsSync(preload), true);
  }
  const result = await window.webContents.executeJavaScript(probe);
  assert.equal(result.guarded, true);
  windows.push({ kind, ...result });
}

const firstWindow = once(app, 'browser-window-created');
require('../app/main.prod.js');
(async () => {
  const [, main] = await firstWindow;
  await once(main.webContents, 'did-finish-load');
  // Verify that the production entry guarded the main process as well.
  const tls = require('node:tls');
  assert.equal(
    tls.checkServerIdentity('127.1', { subjectaltname: 'DNS:127.0.0.1' }).code,
    'ERR_TLS_CERT_ALTNAME_INVALID',
  );
  await inspect(main, 'main');

  const help = Menu.getApplicationMenu().items.find(
    (item) => item.label === 'Help',
  );
  for (const label of [
    'Report Bugs',
    'Keyboard Shortcuts',
    'New Features And Updates',
    'Privacy Policy',
  ]) {
    const created = once(app, 'browser-window-created');
    const item = help.submenu.items.find((entry) => entry.label === label);
    assert.ok(item, label);
    item.click();
    const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    await inspect(window, label);
    window.destroy();
  }
  for (const channel of [
    'ipc.window.faqs',
    'ipc.window.helpPhoneNotConnecting',
  ]) {
    const created = once(app, 'browser-window-created');
    ipcMain.emit(channel, {});
    const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    await inspect(window, channel);
    window.destroy();
  }
  // Exercise the real updater progress-window constructor without contacting
  // an update service. Only the test process's updater and online check are
  // substituted; the application's window/preload code runs unchanged.
  const { autoUpdater } = require('electron-updater');
  const dns = require('node:dns');
  const originalCheck = autoUpdater.checkForUpdates;
  const originalLookup = dns.lookup;
  try {
    autoUpdater.checkForUpdates = async () => {
      autoUpdater.emit('checking-for-update');
      return null;
    };
    dns.lookup = (_host, callback) => callback(null, '127.0.0.1', 4);
    const created = once(app, 'browser-window-created');
    help.submenu.items
      .find((item) => item.label === 'Check For Updates')
      .click();
    const [, window] = await created;
    await once(window.webContents, 'did-finish-load');
    await inspect(window, 'update progress');
    window.destroy();
  } finally {
    autoUpdater.checkForUpdates = originalCheck;
    dns.lookup = originalLookup;
  }
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.equal(failures.length, 0);
  fs.rmSync(fixture, { recursive: true, force: true });
  finish();
})().catch(finish);
