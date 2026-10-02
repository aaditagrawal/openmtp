/**
 * CJS bootstrap for the Electron main process in development.
 *
 * Electron 41+ / modern Node can treat files with `import` as native ESM
 * before @babel/register rewrites them. Bootstrapping from a require()-only
 * entry keeps the main process on the Babel-transformed CommonJS path.
 */
require('@babel/register').default({
  extensions: ['.js', '.jsx'],
  rootMode: 'upward',
  ignore: [/node_modules/],
});

require('./main.dev');
