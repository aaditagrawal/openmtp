/**
 * Repair a broken Electron install (common with Bun on macOS).
 *
 * Bun install can leave electron/dist incomplete or missing path.txt.
 * Ad-hoc codesign of Electron.app breaks launch (SIGKILL / Code Signature
 * Invalid). This script re-extracts from cache or re-runs electron's
 * installer, clears quarantine xattrs, and rewrites path.txt /
 * dist/version — without resigning.
 *
 * Prefer launching `bun run dev` from local Terminal.app / iTerm. SSH or
 * remote sessions often SIGKILL Electron (GUI / Mach bootstrap limits);
 * that is an environment issue, not fixed by codesign.
 *
 * Note: Official Electron 41+ darwin-arm64 builds are linker-signed and
 * ship without app-bundle CodeResources. `codesign -vv Electron.app`
 * (or the in-bundle MacOS/Electron path) fails even on a healthy extract.
 * Do NOT "fix" that with codesign -s -.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const ELECTRON_DIR = path.join(ROOT, 'node_modules', 'electron');
const DIST_DIR = path.join(ELECTRON_DIR, 'dist');
const PATH_TXT = path.join(ELECTRON_DIR, 'path.txt');
const VERSION_FILE = path.join(DIST_DIR, 'version');
const EXPECTED_PATH =
  process.platform === 'darwin'
    ? 'Electron.app/Contents/MacOS/Electron'
    : process.platform === 'win32'
      ? 'electron.exe'
      : 'electron';
const PROBE_TIMEOUT_MS = 15_000;

function readTrimmed(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

/** Write exact bytes — no trailing newline (electron/index.js does not trim). */
function writeNoNewline(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, 'utf8');
}

function expectedVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ELECTRON_DIR, 'package.json'), 'utf8'),
  );
  return String(pkg.version);
}

function electronBinaryPath() {
  return path.join(DIST_DIR, EXPECTED_PATH);
}

function frameworkBinaryPath() {
  if (process.platform !== 'darwin') return null;
  return path.join(
    DIST_DIR,
    'Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
  );
}

function formatSpawnFailure(result, label) {
  if (result.error) {
    return `${label}: ${result.error.message}`;
  }
  if (result.signal) {
    const sshHint =
      result.signal === 'SIGKILL'
        ? ' If this happens over SSH, re-run from a local Terminal session.'
        : '';
    return `${label}: killed by ${result.signal}.${sshHint}`;
  }
  const detail = (result.stderr || result.stdout || '').trim();
  return `${label}: exit ${result.status}${detail ? `\n${detail}` : ''}`;
}

function probeElectronVersion(binary, expected) {
  const result = spawnSync(
    binary,
    ['-e', 'console.log(process.versions.electron)'],
    {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    },
  );
  if (result.status !== 0) {
    return {
      ok: false,
      reason: formatSpawnFailure(result, 'ELECTRON_RUN_AS_NODE probe failed'),
    };
  }
  const got = (result.stdout || '').trim();
  if (got !== expected) {
    return {
      ok: false,
      reason: `electron probe version mismatch (got ${JSON.stringify(
        got,
      )}, want ${expected})`,
    };
  }
  return { ok: true };
}

function metadataHealthy(version) {
  const pathTxt = readTrimmed(PATH_TXT);
  if (pathTxt !== EXPECTED_PATH) {
    return {
      ok: false,
      reason: `path.txt missing or wrong (got ${JSON.stringify(pathTxt)})`,
    };
  }

  // Reject trailing junk / ensure exact on-disk bytes have no newline —
  // electron/index.js concatenates path.txt without trimming.
  try {
    const raw = fs.readFileSync(PATH_TXT, 'utf8');
    if (raw !== EXPECTED_PATH) {
      return {
        ok: false,
        reason: 'path.txt has trailing whitespace/newline; rewriting required',
      };
    }
  } catch {
    return { ok: false, reason: 'path.txt unreadable' };
  }

  const distVersionRaw = fs.existsSync(VERSION_FILE)
    ? fs.readFileSync(VERSION_FILE, 'utf8')
    : null;
  if (distVersionRaw !== version) {
    return {
      ok: false,
      reason: `dist/version mismatch (got ${JSON.stringify(
        distVersionRaw,
      )}, want ${JSON.stringify(version)} with no trailing newline)`,
    };
  }

  return { ok: true };
}

function binariesHealthy(version) {
  const binary = electronBinaryPath();
  if (!fs.existsSync(binary)) {
    return { ok: false, reason: `electron binary missing at ${binary}` };
  }

  try {
    fs.accessSync(binary, fs.constants.X_OK);
  } catch {
    return { ok: false, reason: `electron binary not executable: ${binary}` };
  }

  const framework = frameworkBinaryPath();
  if (framework) {
    if (!fs.existsSync(framework)) {
      return { ok: false, reason: 'Electron Framework binary missing' };
    }
    const size = fs.statSync(framework).size;
    if (size < 1_000_000) {
      return {
        ok: false,
        reason: `Electron Framework too small (${size} bytes)`,
      };
    }
  }

  const probe = probeElectronVersion(binary, version);
  if (!probe.ok) return probe;

  return { ok: true };
}

function isHealthy() {
  if (!fs.existsSync(ELECTRON_DIR)) {
    return { ok: false, reason: 'node_modules/electron missing' };
  }

  let version;
  try {
    version = expectedVersion();
  } catch (error) {
    return {
      ok: false,
      reason: `cannot read electron package.json: ${error.message}`,
    };
  }

  const meta = metadataHealthy(version);
  if (!meta.ok) return { ...meta, version, binariesOk: false };

  const bins = binariesHealthy(version);
  if (!bins.ok) return { ...bins, version, binariesOk: false };

  return { ok: true, version, binariesOk: true };
}

/** True when binaries look runnable but path.txt / dist/version need rewrite. */
function needsMetadataOnlyRepair() {
  if (!fs.existsSync(ELECTRON_DIR)) return false;

  let version;
  try {
    version = expectedVersion();
  } catch {
    return false;
  }

  if (metadataHealthy(version).ok) return false;
  return binariesHealthy(version).ok;
}

function findCachedZip(version) {
  if (process.platform !== 'darwin') return null;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const zipName = `electron-v${version}-darwin-${arch}.zip`;
  const cacheRoots = [
    process.env.ELECTRON_CACHE,
    process.env.electron_config_cache,
    path.join(os.homedir(), 'Library/Caches/electron'),
  ].filter(Boolean);

  for (const root of cacheRoots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(root, entry.name, zipName);
        if (fs.existsSync(candidate)) return candidate;
      }
      const flat = path.join(root, zipName);
      if (fs.existsSync(flat)) return flat;
    } catch {
      // ignore unreadable cache dirs
    }
  }
  return null;
}

function clearQuarantine(appPath) {
  if (process.platform !== 'darwin') return;
  // Best-effort only; never codesign.
  spawnSync('xattr', ['-cr', appPath], { encoding: 'utf8' });
}

function extractZip(zipPath) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // ditto preserves macOS metadata better than unzip for .app bundles
  const ditto = spawnSync('ditto', ['-x', '-k', zipPath, DIST_DIR], {
    encoding: 'utf8',
  });
  if (ditto.status === 0) return;

  const unzip = spawnSync('unzip', ['-q', zipPath, '-d', DIST_DIR], {
    encoding: 'utf8',
  });
  if (unzip.status !== 0) {
    throw new Error(
      [
        `Failed to extract ${zipPath}`,
        `ditto: ${formatSpawnFailure(ditto, 'ditto')}`,
        `unzip: ${formatSpawnFailure(unzip, 'unzip')}`,
      ].join('\n'),
    );
  }
}

function runElectronInstall() {
  const installJs = path.join(ELECTRON_DIR, 'install.js');
  if (!fs.existsSync(installJs)) {
    throw new Error(
      'electron install.js not found; run bun install (or npm/yarn) first',
    );
  }

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  try {
    fs.unlinkSync(PATH_TXT);
  } catch {
    // ignore
  }

  const result = spawnSync(process.execPath, [installJs], {
    cwd: ELECTRON_DIR,
    env: { ...process.env },
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(formatSpawnFailure(result, 'electron install.js failed'));
  }
}

function finalizeMetadata(version) {
  writeNoNewline(PATH_TXT, EXPECTED_PATH);
  writeNoNewline(VERSION_FILE, version);

  if (process.platform === 'darwin') {
    const appPath = path.join(DIST_DIR, 'Electron.app');
    if (fs.existsSync(appPath)) {
      clearQuarantine(appPath);
    }
  }
}

function repair() {
  const version = expectedVersion();

  // Fast path: healthy binaries, only metadata bytes wrong.
  if (needsMetadataOnlyRepair()) {
    console.info(
      `[ensure-electron] rewriting path.txt / dist/version for Electron ${version}...`,
    );
    finalizeMetadata(version);
    const health = isHealthy();
    if (!health.ok) {
      throw new Error(
        `[ensure-electron] metadata repair failed: ${health.reason}`,
      );
    }
    console.info(`[ensure-electron] Electron ${version} metadata OK`);
    return;
  }

  console.info(`[ensure-electron] repairing Electron ${version}...`);

  const cached = findCachedZip(version);
  if (cached) {
    console.info(`[ensure-electron] re-extracting from cache: ${cached}`);
    extractZip(cached);
    finalizeMetadata(version);
  } else {
    console.info(
      '[ensure-electron] no cache zip found; running electron/install.js',
    );
    runElectronInstall();
    // install.js may write path.txt; normalize to exact bytes (no newline).
    finalizeMetadata(version);
  }

  const health = isHealthy();
  if (!health.ok) {
    throw new Error(
      [
        `[ensure-electron] repair failed: ${health.reason}`,
        'Do not ad-hoc codesign Electron.app. Prefer ditto/unzip from cache,',
        'or delete node_modules/electron and re-run bun install.',
        "If Electron is SIGKILL'd only over SSH, launch from local Terminal.",
      ].join('\n'),
    );
  }
  console.info(
    `[ensure-electron] Electron ${version} ready (not ad-hoc codesigned)`,
  );
}

function main() {
  if (!fs.existsSync(path.join(ELECTRON_DIR, 'package.json'))) {
    console.error(
      '[ensure-electron] electron package not installed; run bun install',
    );
    process.exit(1);
  }

  const health = isHealthy();
  if (health.ok) {
    console.info(`[ensure-electron] Electron ${health.version} OK`);
    return;
  }

  console.warn(`[ensure-electron] unhealthy: ${health.reason}`);
  try {
    repair();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

main();
