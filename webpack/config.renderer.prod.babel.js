/**
 * Build config for electron renderer process
 */

import path from 'path';
import webpack from 'webpack';
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import { merge } from 'webpack-merge';
import TerserPlugin from 'terser-webpack-plugin';
import baseConfig from './config.base';
import rendererRules from './renderer-rules';
import { PATHS } from '../app/constants/paths';
import { pkginfo } from '../app/utils/pkginfo';
import { createSentryWebpackPlugin } from './sentry';

const sentryWebpackPlugin = createSentryWebpackPlugin({
  include: 'app/dist',
  ignore: ['node_modules', 'webpack'],
  urlPrefix: '~/app/dist',
  configFile: 'sentry.properties',
  rewrite: false,
  release: pkginfo.version,
});

export default merge(baseConfig, {
  devtool: 'source-map',
  mode: 'production',
  target: 'electron-renderer',

  entry: [path.join(PATHS.app, 'index.js')],

  output: {
    path: path.join(PATHS.app, 'dist'),
    clean: true,
    publicPath: './dist/',
    filename: 'renderer.prod.js',
    devtoolModuleFilenameTemplate(info) {
      const rel = path.relative(pkginfo.name, info.absoluteResourcePath);

      return `webpack:///${rel}`;
    },
  },

  module: { rules: rendererRules(true) },

  optimization: {
    moduleIds: 'named',
    minimizer: [
      new TerserPlugin({
        parallel: true,
        terserOptions: {
          compress: {},
        },
      }),

      new CssMinimizerPlugin(),
    ],
  },

  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'production',
    }),

    new MiniCssExtractPlugin({
      filename: 'style.css',
    }),

    ...(sentryWebpackPlugin ? [sentryWebpackPlugin] : []),
  ],

  node: {
    __dirname: false,
    __filename: false,
  },
});
