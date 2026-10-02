import './guard';
import { expect, test } from 'bun:test';
import { spawn } from 'child_process';
import { isProcessRunning, isAnyProcessRunning } from '../../app/utils/process';

test('process probes ignore command arguments and concurrent search phrases', async () => {
  const marker = `OpenMTP-fake-conflict-${process.pid}`;
  const child = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)', marker],
    { stdio: 'ignore' },
  );
  try {
    await new Promise((resolve) => child.once('spawn', resolve));
    const results = await Promise.all([
      isProcessRunning(marker),
      isProcessRunning(`${marker} Agent`),
      isAnyProcessRunning([marker, `${marker} Agent`]),
    ]);
    expect(results).toEqual([false, false, false]);
    expect(await isProcessRunning('bun')).toBe(true);
  } finally {
    child.kill();
  }
});
