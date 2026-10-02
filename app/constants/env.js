/**
 * Constants
 * Note: Don't import log helper file from utils here
 */

const isDev = process.env.NODE_ENV !== 'production';
const isProd = process.env.NODE_ENV === 'production';
const isDebug = process.env.DEBUG_PROD === 'true';
const telemetryEnabled =
  process.env.OPENMTP_TELEMETRY === '1' && process.env.NODE_ENV !== 'test';

const config = {
  dev: {
    reportToSenty: false,
    enableMixpanelAnalytics: false,
    disableReactWarnings: false,
    allowDevelopmentEnvironment: true,
  },
  prod: {
    reportToSenty: telemetryEnabled && Boolean(process.env.OPENMTP_SENTRY_DSN),
    enableMixpanelAnalytics:
      telemetryEnabled && Boolean(process.env.OPENMTP_MIXPANEL_TOKEN),
    disableReactWarnings: false,
    allowDevelopmentEnvironment: false,
  },
  debug: {
    reportToSenty: telemetryEnabled && Boolean(process.env.OPENMTP_SENTRY_DSN),
    enableMixpanelAnalytics:
      telemetryEnabled && Boolean(process.env.OPENMTP_MIXPANEL_TOKEN),
    disableReactWarnings: false,
    allowDevelopmentEnvironment: true,
  },
};

let _env = 'dev';

if (isProd) {
  _env = 'prod';
} else if (isDebug) {
  _env = 'debug';
}

module.exports.ENV_FLAVOR = config[_env];

module.exports.IS_DEV = isDev;

module.exports.IS_PROD = isProd;

module.exports.DEBUG_PROD = isDebug;

module.exports.IS_RENDERER = process && process.type === 'renderer';
