// Local builds keep their maps on disk. Remote uploads require explicit opt-in.
exports.configureSentryCli = () =>
  process.env.OPENMTP_TELEMETRY === '1' &&
  Boolean(process.env.SENTRY_AUTH_TOKEN);

exports.createSentryWebpackPlugin = ({ include, release }) => {
  if (!exports.configureSentryCli()) return null;
  const { sentryWebpackPlugin } = require('@sentry/webpack-plugin');
  return sentryWebpackPlugin({
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    telemetry: false,
    release: { name: release },
    sourcemaps: { assets: include },
  });
};
