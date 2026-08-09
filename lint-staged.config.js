module.exports = {
  '*.{js,jsx,mjs}': [
    'oxlint --ignore-path .eslintignore --fix',
    'oxfmt --ignore-path .eslintignore --write',
  ],
  // package.json / ox*rc are listed in .eslintignore; do not pass that ignore here
  // or oxfmt exits with "Expected at least one target file" on package.json edits.
  '{*.json,.{babelrc,stylelintrc},.oxlintrc.json,.oxfmtrc.json}': [
    'oxfmt --write',
  ],
  '*.{css,scss}': [
    'node ./internals/scripts/run-package-script.js lint-styles',
    'oxfmt --ignore-path .eslintignore --write',
  ],
  '*.{html,md,yml}': ['oxfmt --ignore-path .eslintignore --write'],
};
