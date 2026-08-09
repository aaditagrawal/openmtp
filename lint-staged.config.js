module.exports = {
  '*.{js,jsx,mjs}': [
    'oxlint --ignore-path .eslintignore --fix',
    'oxfmt --ignore-path .eslintignore --write',
  ],
  '{*.json,.{babelrc,stylelintrc},.oxlintrc.json,.oxfmtrc.json}': [
    'oxfmt --ignore-path .eslintignore --write',
  ],
  '*.{css,scss}': [
    'node ./internals/scripts/run-package-script.js lint-styles',
    'oxfmt --ignore-path .eslintignore --write',
  ],
  '*.{html,md,yml}': ['oxfmt --ignore-path .eslintignore --write'],
};
