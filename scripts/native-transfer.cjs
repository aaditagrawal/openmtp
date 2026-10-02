require('../tests/manual/guard.js');
// Scoped real-device integration. Run only while the app has released MTP.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const assert = require('node:assert/strict');

// Electron redirects process.exit through app shutdown. The no-window test loads
// Go in main, so use Node's immediate exit only after recording results/disposal.
const runId =
  new Date().toISOString().replace(/[-:.]/g, '').replace('Z', '') +
  '-' +
  crypto.randomUUID().slice(0, 8);
const output = path.resolve(
  process.env.OPENMTP_TRANSFER_OUTPUT ||
    path.join(os.tmpdir(), 'openmtp-transfer-' + runId),
);
const remoteDirectory = '/Download/OpenMTP-verification-' + runId;
fs.mkdirSync(output, { recursive: true });
process.env.OPENMTP_PROFILE_DIR = path.join(output, 'profile');
process.env.OPENMTP_TRACE_FILE = path.join(output, 'trace.jsonl');
process.env.OPENMTP_TELEMETRY = '0';
process.env.NODE_ENV = 'development';
app.setPath('userData', path.join(output, 'electron-profile'));
require('@babel/register').default({
  extensions: ['.js', '.jsx'],
  rootMode: 'upward',
  ignore: [/node_modules/],
});

const report = {
  startedAt: new Date().toISOString(),
  remoteDirectory,
  output,
  steps: [],
  cleanup: 'not-created',
};
const persist = () =>
  fs.writeFileSync(
    path.join(output, 'result.json'),
    JSON.stringify(report, null, 2),
  );
const watchdog = setTimeout(() => {
  report.failure =
    'Hardware test exceeded 5 minutes. Inspect the recorded test directory before cleanup.';
  persist();
  process.reallyExit(1);
}, 300000);

app
  .whenReady()
  // This standalone hardware process exits from finally after releasing USB.
  // oxlint-disable-next-line promise/always-return
  .then(async () => {
    const { Kalam } = require('../ffi/kalam/src/Kalam');
    const { computeSmartSyncDiff } = require('../app/utils/smartSync');
    const kalam = new Kalam();
    let storageId;
    let created = false;
    const testNames = new Set([
      'small-1MiB.bin',
      'large-64MiB.bin',
      'renamed-1MiB.bin',
    ]);
    const operation = async (name, action) => {
      const started = performance.now();
      const result = await action();
      report.steps.push({
        name,
        durationMs: performance.now() - started,
        ok: !result?.error && !result?.stderr,
      });
      persist();
      if (result?.error || result?.stderr)
        throw new Error(
          name +
            ': ' +
            (result.error?.message || result.error || result.stderr),
        );
      return result?.data;
    };
    const listing = () =>
      kalam.walk({
        storageId,
        fullPath: remoteDirectory,
        skipHiddenFiles: false,
      });
    try {
      const device = await operation('initialize', () => kalam.initialize());
      report.deviceModel = device?.mtpDeviceInfo?.Model || 'MTP device';
      const storages = await operation('storages', () => kalam.listStorages());
      assert.ok(storages?.length, 'No writable device storage');
      storageId = storages[0].Sid;
      report.storageId = storageId;
      const root = await operation('root-list', () =>
        kalam.walk({ storageId, fullPath: '/', skipHiddenFiles: false }),
      );
      assert.ok(
        root.some((entry) => entry.name === 'Download' && entry.isFolder),
        'Existing Download directory is required',
      );
      const exists = await operation('verify-test-directory-absent', () =>
        kalam.fileExist({ storageId, files: [remoteDirectory] }),
      );
      assert.ok(
        exists.every((entry) => !entry.exists),
        'Refusing to reuse an existing device directory',
      );
      await operation('create-test-directory', () =>
        kalam.makeDirectory({ storageId, fullPath: remoteDirectory }),
      );
      created = true;
      report.cleanup = 'pending';
      const source = path.join(output, 'source');
      const downloaded = path.join(output, 'downloaded');
      fs.mkdirSync(source);
      fs.mkdirSync(downloaded);
      const files = [
        { name: 'small-1MiB.bin', bytes: 1024 * 1024 },
        { name: 'large-64MiB.bin', bytes: 64 * 1024 * 1024 },
      ];
      for (const file of files) {
        file.path = path.join(source, file.name);
        fs.writeFileSync(file.path, crypto.randomBytes(file.bytes));
        file.sha256 = crypto
          .createHash('sha256')
          .update(fs.readFileSync(file.path))
          .digest('hex');
      }
      report.sourceFiles = files.map(({ name, bytes, sha256 }) => ({
        name,
        bytes,
        sha256,
      }));
      const transfer = async (direction, sources, destination) => {
        let progressEvents = 0;
        let callbackError;
        let lastProgress;
        const data = await operation(direction, () =>
          kalam.transferFiles({
            direction,
            storageId,
            sources,
            destination,
            preprocessFiles: true,
            onError: (result) => {
              callbackError = result.error || result.stderr;
            },
            onPreprocess: () => {},
            onProgress: (progress) => {
              progressEvents += 1;
              lastProgress = progress;
            },
            onCompleted: () => {},
          }),
        );
        assert.ok(!callbackError, String(callbackError));
        const step = report.steps.at(-1);
        step.progressEvents = progressEvents;
        step.lastProgressBytes = lastProgress?.bulkFileSize?.sent;
        step.mibPerSecond = 65 / (step.durationMs / 1000);
        persist();
        return data;
      };
      await transfer(
        'upload',
        files.map((file) => file.path),
        remoteDirectory,
      );
      const uploaded = await operation('verify-upload-listing', listing);
      for (const file of files)
        assert.ok(
          uploaded.some(
            (item) => item.name === file.name && item.size === file.bytes,
          ),
          'Upload listing/size mismatch: ' + file.name,
        );
      const sync = computeSmartSyncDiff({
        sourceRoot: source,
        destRoot: remoteDirectory,
        sourceFiles: files.map((file) => ({
          path: file.path,
          size: file.bytes,
          mtimeMs: fs.statSync(file.path).mtimeMs,
          isFolder: false,
        })),
        destFiles: uploaded,
      });
      report.smartSync = sync.summary;
      await operation('rename-small-file', () =>
        kalam.renameFile({
          storageId,
          fullPath: remoteDirectory + '/small-1MiB.bin',
          newFilename: 'renamed-1MiB.bin',
        }),
      );
      const renamed = await operation('verify-rename-listing', listing);
      assert.ok(
        renamed.some((item) => item.name === 'renamed-1MiB.bin'),
        'Renamed file missing',
      );
      assert.ok(
        !renamed.some((item) => item.name === 'small-1MiB.bin'),
        'Old name retained',
      );
      await transfer(
        'download',
        [
          remoteDirectory + '/renamed-1MiB.bin',
          remoteDirectory + '/large-64MiB.bin',
        ],
        downloaded,
      );
      report.downloadHashes = [];
      for (const file of files) {
        const name =
          file.name === 'small-1MiB.bin' ? 'renamed-1MiB.bin' : file.name;
        const digest = crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(downloaded, name)))
          .digest('hex');
        report.downloadHashes.push({
          name,
          sha256: digest,
          matches: digest === file.sha256,
        });
        assert.equal(
          digest,
          file.sha256,
          'Downloaded content mismatch: ' + name,
        );
      }
      report.ok = true;
    } catch (error) {
      report.ok = false;
      report.failure = error.stack || String(error);
    } finally {
      if (created) {
        try {
          const contents = await operation(
            'inspect-test-directory-before-cleanup',
            listing,
          );
          assert.ok(
            contents.every(
              (item) => !item.isFolder && testNames.has(item.name),
            ),
            'Unexpected content: leaving device test directory intact',
          );
          await operation('cleanup-test-directory', () =>
            kalam.deleteFile({ storageId, files: [remoteDirectory] }),
          );
          const remaining = await operation('verify-cleanup', () =>
            kalam.fileExist({ storageId, files: [remoteDirectory] }),
          );
          assert.ok(
            remaining.every((item) => !item.exists),
            'Test directory still exists after cleanup',
          );
          report.cleanup = 'verified-removed';
        } catch (error) {
          report.cleanup = 'failed';
          report.cleanupError = error.message;
          report.ok = false;
        }
      }
      try {
        await operation('dispose', () => kalam.dispose());
      } catch (error) {
        report.disposeError = error.message;
        report.ok = false;
      }
      clearTimeout(watchdog);
      persist();
      console.info(JSON.stringify(report, null, 2));
      process.reallyExit(report.ok ? 0 : 1);
    }
    return null;
  })
  .catch((error) => {
    clearTimeout(watchdog);
    report.ok = false;
    report.failure = error.stack || String(error);
    persist();
    console.error(error);
    process.reallyExit(1);
  });
