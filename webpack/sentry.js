const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');

const SENTRY_CLI_HELPER_PATHS = [
  '@sentry/cli/js/helper',
  '@sentry/webpack-plugin/node_modules/@sentry/cli/js/helper',
];

const safeRequire = (modulePath) => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(modulePath);
  } catch (error) {
    return null;
  }
};

const sentryCliHelpers =
  SENTRY_CLI_HELPER_PATHS.map(safeRequire).filter(Boolean);
const projectNodeModulesBinDir = path.resolve(
  __dirname,
  '..',
  'node_modules',
  '.bin',
);
const sentryPropertiesPath = path.resolve(__dirname, '..', 'sentry.properties');

const resolveGlobalSentryCli = () => {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, ['sentry-cli'], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return null;
  }

  const resolvedBinaryPath = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);

  if (!resolvedBinaryPath) {
    return null;
  }

  if (resolvedBinaryPath.startsWith(projectNodeModulesBinDir)) {
    return null;
  }

  return resolvedBinaryPath;
};

exports.configureSentryCli = () => {
  if (!process.env.SENTRY_AUTH_TOKEN || !fs.existsSync(sentryPropertiesPath)) {
    return false;
  }

  const localBinaryPath = sentryCliHelpers
    .map((sentryCliHelper) =>
      typeof sentryCliHelper.getPath === 'function'
        ? sentryCliHelper.getPath()
        : null,
    )
    .find((binaryPath) => binaryPath && fs.existsSync(binaryPath));

  if (localBinaryPath) {
    sentryCliHelpers.forEach((sentryCliHelper) => {
      const helperBinaryPath =
        typeof sentryCliHelper.getPath === 'function'
          ? sentryCliHelper.getPath()
          : null;

      if (!helperBinaryPath || !fs.existsSync(helperBinaryPath)) {
        sentryCliHelper.mockBinaryPath(localBinaryPath);
      }
    });

    return true;
  }

  const globalBinaryPath = resolveGlobalSentryCli();

  if (!globalBinaryPath) {
    return false;
  }

  sentryCliHelpers.forEach((sentryCliHelper) => {
    sentryCliHelper.mockBinaryPath(globalBinaryPath);
  });

  return true;
};

exports.createSentryWebpackPlugin = (options) => {
  if (!exports.configureSentryCli()) {
    return null;
  }

  const sentryWebpackPluginModule = safeRequire('@sentry/webpack-plugin');

  if (!sentryWebpackPluginModule) {
    return null;
  }

  const SentryWebpackPlugin =
    sentryWebpackPluginModule.default || sentryWebpackPluginModule;

  return new SentryWebpackPlugin(options);
};
