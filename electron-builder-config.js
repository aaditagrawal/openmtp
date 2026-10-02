const OS_ARCH_TYPE = {
  amd64: 'amd64',
  arm64: 'arm64',
};

const getBinariesSupportedSystemArchitecture = () => {
  if (process.arch === 'arm64') {
    return OS_ARCH_TYPE.arm64;
  }

  return OS_ARCH_TYPE.amd64;
};

const shouldSignMacBuild = () =>
  process.env.OPENMTP_UNSIGNED !== '1' &&
  Boolean(process.env.CSC_LINK || process.env.CSC_NAME || process.env.APPLEID);

module.exports = () => {
  const signMacBuild = shouldSignMacBuild();

  const getExtraFiles = () => {
    const currentSystemArch = getBinariesSupportedSystemArchitecture();

    let macResourceBinFilter;

    switch (currentSystemArch) {
      case OS_ARCH_TYPE.arm64:
        macResourceBinFilter = [`${OS_ARCH_TYPE.arm64}/**/*`, `mtp-cli`];
        break;

      case OS_ARCH_TYPE.amd64:
      default:
        macResourceBinFilter = [
          `${OS_ARCH_TYPE.amd64}/**/*`,
          `medieval/${OS_ARCH_TYPE.amd64}/**/*`,
          `mtp-cli`,
        ];

        break;
    }

    return [
      {
        from: 'build/mac/bin',
        to: 'Resources/bin',
        filter: macResourceBinFilter,
      },
    ];
  };

  return {
    productName: 'OpenMTP',
    appId: 'io.ganeshrvel.openmtp',
    forceCodeSigning: signMacBuild,
    // oxlint-disable-next-line no-template-curly-in-string
    artifactName: '${name}-${version}-${os}-${arch}.${ext}',
    copyright: '© Ganesh Rathinavel',
    afterPack: './internals/scripts/AfterPack.js',
    afterSign: signMacBuild ? './internals/scripts/Notarize.js' : undefined,
    npmRebuild: false,
    asarUnpack: [
      'node_modules/@koromix/**/*',
      'node_modules/@node-usb/**/*',
      'node_modules/usb/**/*.node',
      'node_modules/node-mac-permissions/**/*.node',
    ],
    publish: [
      {
        provider: 'github',
        owner: 'aaditagrawal',
        repo: 'openmtp',
        private: false,
      },
    ],
    files: [
      'app/dist/',
      'app/app.html',
      'app/main.prod.js',
      'app/main.prod.js.map',
      'package.json',
    ],
    extraFiles: getExtraFiles(),
    // Directory-only local builds also need an updater config; never fall back
    // to the upstream app's releases and replace this fork's custom UI.
    extraResources: [
      { from: 'config/dev-app-update.yml', to: 'app-update.yml' },
    ],
    mac: {
      type: 'distribution',
      icon: 'build/icon.icns',
      category: 'public.app-category.productivity',
      hardenedRuntime: signMacBuild,
      gatekeeperAssess: false,
      entitlements: './build/entitlements.mac.plist',
      entitlementsInherit: './build/entitlements.mac.plist',
      identity: signMacBuild ? undefined : null,
      extendInfo: {
        LSMinimumSystemVersion: '13.0.0',
        NSDesktopFolderUsageDescription: 'Desktop folder access',
        NSDocumentsFolderUsageDescription: 'Documents folder access',
        NSDownloadsFolderUsageDescription: 'Downloads folder access',
        NSRemovableVolumesUsageDescription: 'Removable Disk access',
        NSPhotoLibraryUsageDescription: 'Photo library access',
      },
      target: {
        target: 'default',
      },
    },
    mas: {
      type: 'distribution',
      category: 'public.app-category.productivity',
      entitlements: 'build/entitlements.mas.plist',
      icon: 'build/icon.icns',
      binaries: ['dist/mas/OpenMTP.app/Contents/Resources/bin/mtp-cli'],
    },
    dmg: {
      contents: [
        {
          x: 130,
          y: 220,
        },
        {
          x: 410,
          y: 220,
          type: 'link',
          path: '/Applications',
        },
      ],
    },
    win: {
      target: ['nsis'],
    },
    linux: {
      target: ['deb', 'AppImage'],
      category: 'public.app-category.productivity',
    },
  };
};
