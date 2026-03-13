module.exports = {
  '*.{js,jsx,mjs}': [
    'node ./internals/scripts/run-package-script.js lint',
    'node ./internals/scripts/run-package-script.js postlint-fix',
  ],
  '{*.json,.{babelrc,eslintrc,prettierrc,stylelintrc}}': [
    'prettier --ignore-path .eslintignore --parser json --write',
  ],
  '*.{css,scss}': [
    'node ./internals/scripts/run-package-script.js lint-styles',
    'node ./internals/scripts/run-package-script.js postlint-styles-fix',
  ],
  '*.{html,md,yml}': [
    'prettier --ignore-path .eslintignore --single-quote --write',
  ],
};
