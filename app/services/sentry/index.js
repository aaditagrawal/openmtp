import { ENV_FLAVOR } from '../../constants/env';
import { SERVICE_KEYS } from '../../constants/serviceKeys';
import { getDeviceInfo } from '../../helpers/deviceInfo';
import { isEmpty } from '../../utils/funcs';
import { pkginfo } from '../../utils/pkginfo';
import { checkIf } from '../../utils/checkIf';
import { MTP_MODE } from '../../enums';
import { getMachineId } from '../../helpers/identifiers';

const getSentrySdk = () => {
  /* eslint-disable camelcase, no-eval, no-undef */
  const runtimeRequire =
    typeof __non_webpack_require__ === 'function'
      ? __non_webpack_require__
      : eval('require');
  /* eslint-enable camelcase, no-eval, no-undef */
  return process.type === 'renderer'
    ? runtimeRequire('@sentry/electron/renderer')
    : runtimeRequire('@sentry/electron/main');
};

class SentryService {
  constructor() {
    if (!ENV_FLAVOR.reportToSenty) {
      return;
    }

    this.sentry = getSentrySdk();
    this.init();
  }

  async init() {
    this.sentry.init({
      dsn: SERVICE_KEYS.sentryDsn,
      // Electron SDK 7 removed enableNative. Explicitly exclude native upload integrations.
      integrations: (defaults) =>
        defaults.filter(
          ({ name }) => !['SentryMinidump', 'ElectronMinidump'].includes(name),
        ),
      sendDefaultPii: false,
      release: pkginfo.version,
    });

    this.machineId = getMachineId();
  }

  async report({ error, title, mtpMode }) {
    checkIf(mtpMode, 'inObjectValues', MTP_MODE);

    if (!ENV_FLAVOR.reportToSenty) {
      return;
    }

    const deviceInfo = getDeviceInfo();
    const applyScope = (scope) => {
      if (!isEmpty(deviceInfo)) {
        Object.keys(deviceInfo).forEach((a) => {
          const item = deviceInfo[a];

          scope.setExtra(a, item);
        });
      }

      if (!isEmpty(title)) {
        scope.setExtra('error title', title);
      }

      scope.setExtra('MTP Mode', mtpMode);

      // this is a hashed value (sha-256)
      scope.setUser({ id: this.machineId });

      this.sentry.captureException(error);
    };

    if (typeof this.sentry.withScope === 'function') {
      this.sentry.withScope(applyScope);

      return;
    }

    if (typeof this.sentry.configureScope === 'function') {
      this.sentry.configureScope(applyScope);

      return;
    }

    const scope = this.sentry.getCurrentScope?.();

    if (scope) {
      applyScope(scope);

      return;
    }

    this.sentry.captureException(error);
  }
}

export const sentryService = new SentryService();
