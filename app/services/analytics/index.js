import { log } from '../../utils/log';
import { settingsStorage } from '../../helpers/storageHelper';
import { MixpanelAnalytics } from './mixpanelAnalytics';
import { getDeviceInfo } from '../../helpers/deviceInfo';
import { checkIf } from '../../utils/checkIf';
import { getMtpModeSetting } from '../../helpers/settings';
import { EVENT_TYPE } from '../../enums/events';
import { ENV_FLAVOR, IS_RENDERER } from '../../constants/env';
import { inArray } from '../../utils/funcs';
import { redactHomeDirectory } from '../../helpers/logs';

class AnalyticsService {
  constructor() {
    this.mixpanelAnalytics = new MixpanelAnalytics();
  }

  _isAnalyticsEnabled = () => {
    // dont proceed if the instance is not a renderer.
    if (!IS_RENDERER || !ENV_FLAVOR.enableMixpanelAnalytics) {
      return;
    }

    const isAnalyticsEnabledSettings = settingsStorage.getItems([
      'enableAnalytics',
    ]);

    return isAnalyticsEnabledSettings.enableAnalytics;
  };

  async sendEvent(key, value) {
    checkIf(key, 'inObjectValues', EVENT_TYPE);
    checkIf(value, 'object');

    // if analytics is disabled then dont proceed
    if (!this._isAnalyticsEnabled()) {
      return;
    }

    let _value = value;

    if (inArray(['stderr', 'error'], key)) {
      // [Privacy] redact home directory path from the error log
      _value = redactHomeDirectory(value);
    }

    try {
      await this.mixpanelAnalytics.sendEvent(key, _value);
    } catch (e) {
      log.error(e, `AnalyticsService -> sendEvent`);
    }
  }

  async init() {
    // if analytics is disabled then dont proceed
    if (!this._isAnalyticsEnabled()) {
      return;
    }

    try {
      await this.mixpanelAnalytics.init();
    } catch (e) {
      log.error(e, `AnalyticsService -> init`);
    }
  }

  async sendDeviceInfo() {
    // if analytics is disabled then dont proceed
    if (!this._isAnalyticsEnabled()) {
      return;
    }

    try {
      const deviceInfo = getDeviceInfo();
      const mtpMode = getMtpModeSetting();

      await this.mixpanelAnalytics.sendDeviceInfo({ deviceInfo, mtpMode });
    } catch (e) {
      log.error(e, `AnalyticsService -> sendDeviceInfo`);
    }
  }
}

export const analyticsService = new AnalyticsService();
