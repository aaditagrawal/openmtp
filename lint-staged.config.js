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
  // Lint only the staged stylesheets — the package `lint-styles` script globs
  // the whole tree and fails on unrelated legacy SCSS.
  '*.{css,scss}': [
    'stylelint --ignore-path .eslintignore --custom-syntax postcss-scss --fix',
    'oxfmt --ignore-path .eslintignore --write',
  ],
  '*.{html,md,yml}': ['oxfmt --ignore-path .eslintignore --write'],
};
