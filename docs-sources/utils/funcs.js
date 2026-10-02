/* eslint global-require: off, prefer-template: off */

import { ALLOWED_GITHUB_FETCH_STATUSES } from './consts';

/**
 * handle image import into the program.
 * default path: ../public/images/
 * @param filePath
 * @returns {*}
 */
export const imgsrc = (filePath) => {
  return require('../images/' + filePath);
};

export const undefinedOrNull = (_var) => {
  return typeof _var === 'undefined' || _var === null;
};

export const fetchUrl = ({ url }) => {
  // eslint-disable-next-line compat/compat
  return fetch(`${url}`)
    .then((res) => {
      if (ALLOWED_GITHUB_FETCH_STATUSES.indexOf(res.status) !== -1) {
        return {
          json: res.json(),
          status: res.status,
        };
      }

      return null;
    })
    .catch(() => {});
};

export const imageLoaded = (src) => {
  // eslint-disable-next-line compat/compat
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => resolve({ src, status: 'ok' });
    img.onerror = () => resolve({ src, status: 'error' });

    img.src = src;
  });
};

export const urls = {
  get({ param = '', url = '' }) {
    const data = {};

    if (url === '') {
      url = window.location.href; // oxlint-disable-line no-param-reassign
    }

    url.replace(/[?&]+([^=&]+)=([^&]*)/gi, (m, key, value) => {
      data[key] = decodeURI(value);
    });

    if (param === '') {
      return data;
    }

    if (typeof data[param] === 'undefined') {
      return null;
    }

    return data[param];
  },
};

export const setStyle = (selector, styles) => {
  let elem;

  if (isString(selector)) {
    elem = document.querySelector(selector);
  } else {
    elem = selector;
  }

  if (!elem) {
    return;
  }

  let styleString = '';

  Object.keys(styles).map((a) => {
    const item = styles[a];

    styleString += `${a}:${item};`;

    return a;
  });

  elem.setAttribute('style', styleString);
};

export const isString = (variable) => {
  return typeof variable === 'string' || variable instanceof String;
};
