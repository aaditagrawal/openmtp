import './guard.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tests = [
  ...new Bun.Glob('tests/manual/*.test.{js,jsx}').scanSync(root),
].sort();

// Isolate Electron/native mocks between suites, as well as from CI's app tests.
for (const test of tests) {
  const result = spawnSync(
    process.execPath,
    [
      'test',
      '--preload',
      './tests/manual/guard.js',
      '--preload',
      './app/test/electron-mock.js',
      `./${test}`,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
