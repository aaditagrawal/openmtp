import path from 'path';
import { isMacOSVersion } from 'macos-version';
import {
  getPlatform,
  getBinariesSupportedSystemArchitecture,
} from '../utils/getPlatform';
import { IS_PROD } from '../constants/env';
import { PATHS } from '../constants/paths';
import { isPackaged } from '../utils/isPackaged';
import {
  KALAM_HISTORIC_MACOS_VERSION_RANGE,
  KALAM_MODE_MIN_MACOS_VERSION,
} from '../constants';

const binariesDir =
  IS_PROD && isPackaged
    ? path.join(PATHS.root, 'Contents', 'Resources', 'bin')
    : path.join(PATHS.root, 'build', getPlatform(), 'bin');
const historicVersion = Object.entries(KALAM_HISTORIC_MACOS_VERSION_RANGE).find(
  ([, range]) => isMacOSVersion(range),
)?.[0];
const nativeDir = path.join(
  binariesDir,
  historicVersion ?? '',
  getBinariesSupportedSystemArchitecture(),
);

export const mtpCliPath = path.resolve(binariesDir, 'mtp-cli');
export const kalamDebugReportCli = path.resolve(
  nativeDir,
  'kalam_debug_report',
);
export const kalamLibPath = path.resolve(nativeDir, 'kalam.dylib');

// We have now officially retired the support for `Kalam` Kernel on macOS 10.13 (OS X El High Sierra) and lower. Only the "Legacy" MTP mode will continue working on these outdated machines.
export function isKalamModeSupported() {
  return isMacOSVersion(KALAM_MODE_MIN_MACOS_VERSION);
}
