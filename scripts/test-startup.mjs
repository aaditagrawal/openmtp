import '../tests/manual/guard.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');
const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(
  process.env.OPENMTP_TEST_OUTPUT ||
    (await fs.mkdtemp(path.join(os.tmpdir(), 'openmtp-startup-'))),
);
const results = [];
const settings = {
  freshInstall: 1,
  onboarding: { lastFiredVersion: '3.2.20' },
  appThemeMode: 'light',
  fileExplorerListingType: { local: 'list', mtp: 'grid' },
  enableAutoUpdateCheck: false,
  enableBackgroundAutoUpdate: false,
  enableAnalytics: false,
  showLocalPaneOnLeftSide: false,
  recoveryTestMarker: 'preserve-me',
};

for (const mode of ['fresh', 'existing', 'corrupt']) {
  const profile = path.join(output, mode, 'profile');
  await fs.mkdir(profile, { recursive: true });
  if (mode !== 'fresh')
    await fs.writeFile(
      path.join(profile, 'settings.json'),
      mode === 'corrupt' ? '{"broken":' : JSON.stringify(settings),
    );
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const runDir = path.join(output, mode, `launch-${iteration + 1}`);
    await fs.mkdir(runDir, { recursive: true });
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      OPENMTP_SMOKE_OUTPUT: runDir,
      OPENMTP_PROFILE_DIR: profile,
    };
    env.OPENMTP_SMOKE_EXPECT_CORRUPT_PROFILE =
      mode === 'corrupt' && iteration === 0 ? '1' : '0';
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    delete env.OPENMTP_SMOKE_SCENARIO;
    delete env.OPENMTP_TRACE_FILE;
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(electron, ['scripts/smoke-electron.cjs'], {
        cwd: root,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let log = '';
      child.stdout.on('data', (data) => {
        log += data;
      });
      child.stderr.on('data', (data) => {
        log += data;
      });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
      child.once('error', reject);
      child.once('close', async (code) => {
        clearTimeout(timeout);
        await fs.writeFile(path.join(runDir, 'console.log'), log);
        resolve(code);
      });
    });
    const report = JSON.parse(
      await fs.readFile(path.join(runDir, 'result.json'), 'utf8'),
    );
    if (exitCode !== 0 || !report.ok)
      throw new Error(
        `Startup failed: ${mode}/${iteration + 1}: ${report.failure}`,
      );
    if (mode === 'existing') {
      const saved = JSON.parse(
        await fs.readFile(path.join(profile, 'settings.json'), 'utf8'),
      );
      for (const key of [
        'appThemeMode',
        'fileExplorerListingType',
        'showLocalPaneOnLeftSide',
        'recoveryTestMarker',
      ]) {
        if (JSON.stringify(saved[key]) !== JSON.stringify(settings[key]))
          throw new Error(`Preference reset: ${key}`);
      }
    }
    results.push({
      mode,
      iteration: iteration + 1,
      usableMs: report.usableMs,
      crashes: report.crashes.length,
    });
    console.info(
      `${mode} launch ${iteration + 1}: ${report.usableMs.toFixed(0)} ms`,
    );
  }
  if (mode === 'corrupt') {
    const backup = await fs.readFile(
      path.join(profile, 'settings.json.corrupt-backup'),
      'utf8',
    );
    if (backup !== '{"broken":')
      throw new Error('Corrupt profile backup was not preserved');
  }
}
const times = results.map((result) => result.usableMs).sort((a, b) => a - b);
const summary = {
  results,
  medianMs: times[Math.floor(times.length / 2)],
  p95Ms: times[Math.ceil(times.length * 0.95) - 1],
};
await fs.writeFile(
  path.join(output, 'summary.json'),
  JSON.stringify(summary, null, 2),
);
console.info(JSON.stringify(summary));
