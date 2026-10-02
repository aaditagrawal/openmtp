/**
 * Build config for development electron renderer process that uses
 * Hot-Module-Replacement
 *
 * https://webpack.js.org/concepts/hot-module-replacement/
 */

import path from 'path';
import webpack from 'webpack';
import { merge } from 'webpack-merge';
import { spawn } from 'child_process';
import baseConfig from './config.base';
import rendererRules from './renderer-rules';
import { PATHS } from '../app/constants/paths';
import { PORT } from '../config/env';

const publicPath = '/dist/';
// When an ESLint server is running, we can't set the NODE_ENV so we'll check if it's
// at the dev webpack config is not accidentally run in a production environment
if (process.env.NODE_ENV === 'production') {
  console.error(
    'Use NODE_ENV=development for the renderer development config.',
  );
  process.exit(2);
}

export default merge(baseConfig, {
  devtool: 'inline-source-map',
  mode: 'development',
  target: 'electron-renderer',
  entry: [path.join(PATHS.app, 'index.js')],

  output: {
    publicPath: 'auto',
    filename: 'renderer.dev.js',
  },

  module: { rules: rendererRules(false) },

  plugins: [
    new webpack.NoEmitOnErrorsPlugin(),

    new webpack.EnvironmentPlugin({
      NODE_ENV: 'development',
    }),

    new webpack.LoaderOptionsPlugin({
      debug: true,
    }),
  ],

  node: {
    __dirname: false,
    __filename: false,
  },

  devServer: {
    host: '0.0.0.0',
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      'quasar',
      'quasar.walrus-pangolin.ts.net',
      '100.89.228.43',
    ],
    port: PORT,
    compress: true,
    hot: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
    client: {
      logging: 'error',
      overlay: true,
      webSocketURL: {
        hostname:
          process.env.OPENMTP_DEV_HOST || 'quasar.walrus-pangolin.ts.net',
        port: PORT,
      },
    },
    devMiddleware: {
      publicPath,
      stats: 'errors-only',
      writeToDisk: true,
    },
    static: {
      directory: path.join(PATHS.dist),
      publicPath,
      watch: false,
    },
    historyApiFallback: true,
    setupMiddlewares: (middlewares, devServer) => {
      if (process.env.START_HOT) {
        let mainProcessStarted = false;

        const startMainProcess = () => {
          if (mainProcessStarted) {
            return;
          }
          mainProcessStarted = true;

          // app.html loads ./renderer.dev.js from disk (writeToDisk). Wait for
          // the first successful compile so that file exists before Electron opens.
          console.info('Starting Main Process...');
          spawn('bun', ['run', 'start-main-dev'], {
            // Avoid leaking webpack's NODE_OPTIONS (--require @babel/register)
            // into Electron's main process.
            env: { ...process.env, NODE_OPTIONS: '' },
            cwd: PATHS.root,
            stdio: 'inherit',
          })
            .on('close', (code) => process.exit(code))
            .on('error', (spawnError) => console.error(spawnError));
        };

        const compiler = devServer?.compiler;
        if (compiler?.hooks?.done) {
          compiler.hooks.done.tap('OpenMTPStartMainDev', (stats) => {
            if (!stats.hasErrors()) {
              startMainProcess();
            }
          });
        } else {
          startMainProcess();
        }
      }

      return middlewares;
    },
  },
});
