/* eslint import/no-unresolved: off, import/no-self-import: off */

/**
 * Minimal webpack config for the eslint-import-resolver-webpack plugin.
 * Only the `resolve` block is needed — loading the full dev config causes
 * initialisation errors and unwanted side-effects during linting.
 */

const path = require('path');

const root = path.resolve(__dirname, '..');

module.exports = {
  resolve: {
    extensions: ['.js', '.jsx', '.json'],
    modules: [path.join(root, 'node_modules')],
  },
};
