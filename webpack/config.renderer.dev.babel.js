/**
 * Build config for development electron renderer process that uses
 * Hot-Module-Replacement
 *
 * https://webpack.js.org/concepts/hot-module-replacement/
 */

import path from 'path';
import fs from 'fs';
import webpack from 'webpack';
import { styleText } from 'util';
import { merge } from 'webpack-merge';
import { spawn, execSync } from 'child_process';
import baseConfig from './config.base';
import { PATHS } from '../app/constants/paths';
import { PORT } from '../config/env';
import CheckNodeEnv from '../internals/scripts/CheckNodeEnv';

const publicPath = `http://localhost:${PORT}/dist`;
const dll = path.resolve(PATHS.root, 'dll');
const manifest = path.resolve(dll, 'renderer.json');
const requiredByDLLConfig = module.parent.filename.includes(
  'config.renderer.dev.dll.babel',
);

// When an ESLint server is running, we can't set the NODE_ENV so we'll check if it's
// at the dev webpack config is not accidentally run in a production environment
if (process.env.NODE_ENV === 'production') {
  CheckNodeEnv('development');
}

/**
 * Warn if the DLL is not built
 */
if (!requiredByDLLConfig && !(fs.existsSync(dll) && fs.existsSync(manifest))) {
  console.info(
    styleText(
      ['black', 'bgYellow', 'bold'],
      'The DLL files are missing. Sit back while we build them for you with "build-dll".',
    ),
  );
  execSync('node ./internals/scripts/run-package-script.js build-dll', {
    cwd: PATHS.root,
    stdio: 'inherit',
  });
}

export default merge(baseConfig, {
  devtool: 'inline-source-map',
  mode: 'development',
  target: 'electron-renderer',
  entry: [
    'core-js',
    'regenerator-runtime/runtime',
    path.join(PATHS.app, 'index.js'),
  ],

  output: {
    publicPath: 'auto',
    filename: 'renderer.dev.js',
  },

  module: {
    rules: [
      // Extract all .global.css to style.css as is
      {
        test: /\.global\.css$/,
        use: [
          {
            loader: 'style-loader',
          },
          {
            loader: 'css-loader',
            options: {
              sourceMap: true,
            },
          },
        ],
      },
      // Pipe other styles through css modules and append to style.css
      {
        test: /^((?!\.global).)*\.css$/,
        use: [
          {
            loader: 'style-loader',
          },
          {
            loader: 'css-loader',
            options: {
              modules: {
                localIdentName: '[path][name]__[local]__[hash:base64:5]',
              },
              sourceMap: true,
              importLoaders: 1,
            },
          },
        ],
      },
      // SASS support - compile all .global.scss files and pipe it to style.css
      {
        test: /\.global\.(scss|sass)$/,
        use: [
          {
            loader: 'style-loader',
          },
          {
            loader: 'css-loader',
            options: {
              sourceMap: true,
            },
          },
          {
            loader: 'sass-loader',
          },
        ],
      },
      // SASS support - compile all other .scss files and pipe it to style.css
      {
        test: /^((?!\.global).)*\.(scss|sass)$/,
        use: [
          {
            loader: 'style-loader',
          },
          {
            loader: 'css-loader',
            options: {
              modules: {
                localIdentName: '[path][name]__[local]__[hash:base64:5]',
              },
              sourceMap: true,
              importLoaders: 1,
            },
          },
          {
            loader: 'sass-loader',
          },
        ],
      },
      // WOFF Font
      {
        test: /\.woff(\?v=\d+\.\d+\.\d+)?$/,
        use: {
          loader: 'url-loader',
          options: {
            limit: 10000,
            mimetype: 'application/font-woff',
          },
        },
      },
      // WOFF2 Font
      {
        test: /\.woff2(\?v=\d+\.\d+\.\d+)?$/,
        use: {
          loader: 'url-loader',
          options: {
            limit: 10000,
            mimetype: 'application/font-woff',
          },
        },
      },
      // TTF Font
      {
        test: /\.ttf(\?v=\d+\.\d+\.\d+)?$/,
        use: {
          loader: 'url-loader',
          options: {
            limit: 10000,
            mimetype: 'application/octet-stream',
          },
        },
      },
      // EOT Font
      {
        test: /\.eot(\?v=\d+\.\d+\.\d+)?$/,
        use: 'file-loader',
      },
      // SVG Font
      {
        test: /\.svg(\?v=\d+\.\d+\.\d+)?$/,
        use: {
          loader: 'url-loader',
          options: {
            limit: 10000,
            mimetype: 'image/svg+xml',
          },
        },
      },
      // Common Image Formats
      {
        test: /\.(?:ico|jpe?g|png|gif|webp)$/i,
        use: [
          {
            loader: 'url-loader',
            options: {
              limit: 10000,
              name: 'images/[path][name].[hash].[ext]',
            },
          },
        ],
      },
    ],
  },
  plugins: [
    requiredByDLLConfig
      ? null
      : new webpack.DllReferencePlugin({
          context: PATHS.root,
          manifest: require(manifest), // eslint-disable-line
          sourceType: 'var',
        }),

    new webpack.HotModuleReplacementPlugin({
      multiStep: false,
    }),

    new webpack.NoEmitOnErrorsPlugin(),

    /**
     * Create global constants which can be configured at compile time.
     *
     * Useful for allowing different behaviour between development builds and
     * release builds
     *
     * NODE_ENV should be production so that modules do not perform certain
     * development checks
     *
     * By default, use 'development' as NODE_ENV. This can be overriden with
     * 'staging', for example, by changing the ENV variables in the npm scripts
     */
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
    port: PORT,
    compress: true,
    hot: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
    client: {
      logging: 'error',
      overlay: true,
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
          spawn(
            'node',
            ['./internals/scripts/run-package-script.js', 'start-main-dev'],
            {
              shell: true,
              // Avoid leaking webpack's NODE_OPTIONS (--require @babel/register)
              // into Electron's main process.
              env: { ...process.env, NODE_OPTIONS: '' },
              cwd: PATHS.root,
              stdio: 'inherit',
            },
          )
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
