/**
 * Webpack config for production electron main process
 */

import path from 'path';
import webpack from 'webpack';
import { merge } from 'webpack-merge';
import TerserPlugin from 'terser-webpack-plugin';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import baseConfig from './config.base';
import { PATHS } from '../app/constants/paths';
import { pkginfo } from '../app/utils/pkginfo';
import { createSentryWebpackPlugin } from './sentry';

const sentryWebpackPlugin = createSentryWebpackPlugin({
  include: 'app/main.prod.js.map',
  ignore: ['node_modules', 'webpack'],
  urlPrefix: '~/app',
  configFile: 'sentry.properties',
  rewrite: false,
  release: pkginfo.version,
});

export default merge(baseConfig, {
  devtool: 'source-map',
  mode: 'production',
  target: 'electron-main',
  entry: './app/main.dev',

  output: {
    path: PATHS.root,
    filename: './app/main.prod.js',
    devtoolModuleFilenameTemplate(info) {
      const rel = path.relative(pkginfo.name, info.absoluteResourcePath);

      return `webpack:///${rel}`;
    },
  },

  optimization: {
    moduleIds: 'named',
    minimizer: [
      new TerserPlugin({
        parallel: true,
        terserOptions: {
          compress: {},
        },
      }),
    ],
  },

  plugins: [
    new BundleAnalyzerPlugin({
      analyzerMode:
        process.env.OPEN_ANALYZER === 'true' ? 'server' : 'disabled',
      openAnalyzer: process.env.OPEN_ANALYZER === 'true',
    }),

    new webpack.EnvironmentPlugin({
      NODE_ENV: 'production',
      DEBUG_PROD: false,
      START_MINIMIZED: false,
    }),

    ...(sentryWebpackPlugin ? [sentryWebpackPlugin] : []),
  ],

  node: {
    __dirname: false,
    __filename: false,
  },
});
