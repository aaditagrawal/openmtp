import { afterAll, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gunzipSync } from 'zlib';
mock.module('./log', () => ({ log: { error: () => {} } }));
const { compressFile } = await import('./gzip');
const directory = mkdtempSync(join(tmpdir(), 'openmtp-gzip-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
describe('error report compression', () => {
  test('reports a missing source without an uncaught stream error', async () => {
    expect(
      await compressFile(
        join(directory, 'missing'),
        join(directory, 'missing.gz'),
      ),
    ).toBe(false);
  });
  test('reports output failures', async () => {
    const input = join(directory, 'log');
    writeFileSync(input, 'report');
    expect(
      await compressFile(input, join(directory, 'absent', 'output.gz')),
    ).toBe(false);
  });
  test('round trips a readable log', async () => {
    const input = join(directory, 'log');
    const output = join(directory, 'log.gz');
    writeFileSync(input, 'report');
    expect(await compressFile(input, output)).toBe(true);
    expect(gunzipSync(readFileSync(output)).toString()).toBe('report');
  });
});
