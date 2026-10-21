'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const projectRequire = createRequire(path.resolve('package.json'));
const entry =
  process.env.SPRINTF_PACKAGE || projectRequire.resolve('sprintf-js');
for (const file of [
  entry,
  path.resolve(path.dirname(entry), '../dist/sprintf.min.js'),
]) {
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
console.info(
  'sprintf: Node and browser distributions preserve valid formatting and bound numeric precision',
);
