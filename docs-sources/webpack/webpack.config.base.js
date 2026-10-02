const path = require('path');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const PrivacyPolicyContent = require('../../shared/privacyPolicy');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { merge } = require('webpack-merge');
const devConfig = require('./webpack.config.dev');
const prodConfig = require('./webpack.config.prod');

const IS_PROD = process.env.NODE_ENV === 'production';
const buildPath = path.join(__dirname, '..', '..', 'docs');

const baseConfig = {
  mode: process.env.NODE_ENV,
  entry: {
    index: './docs-sources/index.js',
  },
  output: {
    filename: 'bundle/[name].[contenthash:20].js',
    path: buildPath,
    assetModuleFilename: 'bundle/[name].[hash:20][ext]',
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: './docs-sources/templates/index.html',
      inject: true,
      chunks: ['index'],
      filename: 'index.html',
      minify: {
        collapseWhitespace: true,
        removeComments: true,
        minifyJS: true,
        minifyCSS: true,
      },
    }),

    new HtmlWebpackPlugin({
      template: './docs-sources/templates/privacy.html',
      templateParameters: {
        privacyPolicy: renderToStaticMarkup(
          createElement(PrivacyPolicyContent, {
            appName: 'OpenMTP',
            authorName: 'Ganesh Rathinavel',
            authorEmail: 'ganeshrvel@outlook.com',
            contactUrl: 'https://github.com/ganeshrvel',
            profileDir:
              '$HOME/Library/Application Support/io.ganeshrvel.openmtp',
            website: true,
          }),
        ),
      },
      inject: true,
      chunks: ['privacy'],
      filename: 'privacy.html',
      minify: {
        collapseWhitespace: true,
        removeComments: true,
        minifyJS: true,
        minifyCSS: true,
      },
    }),
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        type: 'javascript/auto',
        exclude: /node_modules/,
        loader: 'babel-loader',
        options: {
          configFile: false,
          babelrc: false,
          presets: [
            [
              '@babel/preset-env',
              {
                targets: {
                  edge: '12',
                },
              },
            ],
          ],
          cacheDirectory: true,
        },
      },
      {
        test: /\.(?:ico|jpe?g|png|gif|webp)$/i,
        type: 'asset/resource',
      },
    ],
  },
};

module.exports = merge(baseConfig, IS_PROD ? prodConfig : devConfig);
