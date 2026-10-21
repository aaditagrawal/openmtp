'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const projectRequire = createRequire(path.resolve('package.json'));
const entries = new Set([
  process.env.SPRINTF_PACKAGE || projectRequire.resolve('sprintf-js'),
]);
const loggerEntries = new Set();
if (!process.env.SPRINTF_PACKAGE) {
  const builderRequire = createRequire(
    projectRequire.resolve('electron-builder'),
  );
  const appBuilderRequire = createRequire(
    builderRequire.resolve('app-builder-lib'),
  );
  const electronGetRequire = createRequire(
    appBuilderRequire.resolve('@electron/get'),
  );
  const agentRequire = createRequire(
    electronGetRequire.resolve('global-agent'),
  );
  loggerEntries.add(agentRequire.resolve('roarr'));
  for (const loggerEntry of loggerEntries) {
    entries.add(createRequire(loggerEntry).resolve('sprintf-js'));
  }
}
for (const file of new Set(
  [...entries].flatMap((entry) => [
    entry,
    path.resolve(path.dirname(entry), '../dist/sprintf.min.js'),
  ]),
)) {
  const { sprintf, vsprintf } = require(file);
  assert.equal(sprintf('value: %+08.2f', 1.25), 'value: +0001.25');
  assert.equal(sprintf('%(user.name)s', { user: { name: 'Ada' } }), 'Ada');
  assert.equal(vsprintf('%s %d', ['items', 3]), 'items 3');
  assert.equal(sprintf('%.150s', 'a'.repeat(200)), 'a'.repeat(150));
  for (const type of ['e', 'f', 'g']) {
    for (const digits of ['101', '1000000', '9'.repeat(350)]) {
      const actual = sprintf('%.' + digits + type, 1.25);
      const expected = sprintf('%.100' + type, 1.25);
      assert.equal(actual, expected);
      assert.ok(actual.length <= 110);
    }
    for (const digits of [1, 2, 20, 100]) {
      const value = 1.25;
      const expected =
        type === 'e'
          ? value.toExponential(digits)
          : type === 'f'
            ? value.toFixed(digits)
            : String(Number(value.toPrecision(digits)));
      assert.equal(sprintf('%.' + digits + type, value), expected);
    }
  }
}
for (const loggerEntry of loggerEntries) {
  const result = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=128',
      '-e',
      `const logger = require(process.argv[1]).default;
       for (const type of ['e', 'f', 'g']) {
         for (const digits of ['101', '1000000', '9'.repeat(350)]) {
           logger.info('%.' + digits + type, 1.25);
         }
       }`,
      loggerEntry,
    ],
    {
      env: { ...process.env, ROARR_LOG: 'true' },
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 64 * 1024,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const messages = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line).message);
  const fraction = '25'.padEnd(100, '0');
  const expected = ['1.' + fraction + 'e+0', '1.' + fraction, '1.25'].flatMap(
    (message) => [message, message, message],
  );
  assert.deepEqual(messages, expected);
}
console.info(
  'sprintf: root and Electron builder consumer distributions preserve formatting and bound precision; real roarr logging passes',
);
