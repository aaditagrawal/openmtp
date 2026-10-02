import '../tests/manual/guard.js';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  mapConcurrent,
  readDirectoryEntries,
} from '../app/utils/localDirectory';

const count = Number(process.env.OPENMTP_BENCH_FILES || 10000);
const root = await mkdtemp(path.join(os.tmpdir(), 'openmtp-benchmark-'));
try {
  await mapConcurrent(
    Array.from({ length: count }, (_, i) => i),
    (i) =>
      writeFile(
        path.join(root, `file-${String(i).padStart(6, '0')}.txt`),
        'benchmark',
      ),
  );
  const files = await readdir(root);
  async function measure(name, action) {
    const samples = [];
    for (let run = 0; run < 5; run += 1) {
      let maxStallMs = 0;
      let last = performance.now();
      const interval = setInterval(() => {
        const now = performance.now();
        maxStallMs = Math.max(maxStallMs, now - last);
        last = now;
      }, 1);
      const start = performance.now();
      const result = await action();
      const elapsedMs = performance.now() - start;
      await new Promise((resolve) => setTimeout(resolve, 5));
      clearInterval(interval);
      if (result.length !== count)
        throw new Error('Directory benchmark omitted entries');
      samples.push({ elapsedMs, maxStallMs });
    }
    return { name, samples };
  }
  // Compare metadata IO against the old synchronous hot path. New includes
  // readdir/filter/object creation; baseline does only the per-file stat calls.
  const before = await measure('baseline synchronous metadata', async () =>
    files.map((file) => statSync(path.join(root, file))),
  );
  const after = await measure('bounded asynchronous listing', () =>
    readDirectoryEntries(root),
  );
  console.info(
    JSON.stringify({ count, node: process.version, before, after }, null, 2),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
