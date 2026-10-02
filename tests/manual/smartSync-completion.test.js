import './guard';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// Exercise the real class method without mounting the Electron-dependent screen.
const source = readFileSync(
  new URL(
    '../../app/containers/HomePage/components/FileExplorer.jsx',
    import.meta.url,
  ),
  'utf8',
);
const start = source.indexOf('  _runSmartSyncBatch = ');
const end = source.indexOf('\n  _executeSmartSyncTransfers', start);
const make = new Function(
  'fileExplorerController',
  'createThrottledProgressUpdater',
  'DEVICE_TYPE',
  'springTruncate',
  `return class {
  props = { actionCreateSetFileTransferProgress() {} };
  ${source.slice(start, end)}
}`,
);
const input = {
  task: { destDir: '/test', files: ['/source'] },
  batchIndex: 0,
  batchCount: 1,
  direction: 'upload',
  storageId: 1,
  deviceLabel: 'phone',
  totalFilesPlanned: 1,
  filesCompletedBeforeBatch: 0,
};
function subject(transferFiles) {
  const calls = { cancel: 0, flush: 0 };
  const Screen = make(
    { transferFiles },
    () => ({
      update() {},
      cancel() {
        calls.cancel += 1;
      },
      flush() {
        calls.flush += 1;
      },
    }),
    { mtp: 'mtp' },
    (s) => ({ truncatedText: s }),
  );
  return { calls, completion: new Screen()._runSmartSyncBatch(input) };
}

test('Smart Sync rejects setup errors returned without native callbacks', async () => {
  const error = new Error('setup failed');
  const { calls, completion } = subject(async () => ({
    error,
    stderr: null,
    data: false,
  }));
  await expect(completion).rejects.toBe(error);
  expect(calls).toEqual({ cancel: 1, flush: 0 });
}, 500);

test('Smart Sync rejects controller validation failures without unhandled rejection', async () => {
  const error = new Error('invalid storage');
  const { calls, completion } = subject(async () => {
    throw error;
  });
  await expect(completion).rejects.toBe(error);
  expect(calls).toEqual({ cancel: 1, flush: 0 });
}, 500);

test('native callback success flushes progress and resolves once', async () => {
  const { calls, completion } = subject(async ({ onCompleted }) => {
    onCompleted();
    return { data: true };
  });
  await completion;
  expect(calls).toEqual({ cancel: 0, flush: 1 });
}, 500);

test('native callback failure still cancels progress and rejects', async () => {
  const error = new Error('disconnected');
  const { calls, completion } = subject(async ({ onError }) => {
    onError({ error });
  });
  await expect(completion).rejects.toBe(error);
  expect(calls).toEqual({ cancel: 1, flush: 0 });
}, 500);
