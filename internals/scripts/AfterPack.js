const path = require('path');
const fs = require('node:fs/promises');

exports.default = async (context) => {
  if (context.packager.platform.name !== 'mac') return;
  const resources = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app/Contents/Resources`,
  );
  const entries = await fs.readdir(resources);
  await Promise.all(
    entries
      .filter(
        (name) =>
          name.endsWith('.lproj') &&
          name !== 'en.lproj' &&
          !name.startsWith('.'),
      )
      .map((name) =>
        fs.rm(path.join(resources, name), { recursive: true, force: true }),
      ),
  );
};
