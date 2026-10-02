/* eslint global-require: off, prefer-template: off */

/**
 * handle image import into the program.
 * default path: ../public/images/
 * @param filePath
 * @param returnNoImageFound (optional)
 * @returns {*}
 */
export const imgsrc = (filePath, returnNoImageFound = true) => {
  try {
    const image = require('../public/images/' + filePath);

    // Webpack asset/resource exports a URL string; older file-loader builds
    // wrapped that URL in a default export.
    return typeof image === 'string' ? image : image.default;
  } catch (e) {
    if (!returnNoImageFound) {
      return null;
    }

    const fallback = require('../public/images/no-image.png');

    return typeof fallback === 'string' ? fallback : fallback.default;
  }
};
