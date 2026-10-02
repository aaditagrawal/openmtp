import './guard';
import { describe, expect, test } from 'bun:test';
import { css } from '@emotion/react';
import { createTheme } from '@mui/material/styles';
import { materialUiTheme } from '../../app/containers/App/styles';
import path from 'path';

const appRoot = path.resolve(import.meta.dir, '../../app');
const modules = [];
for await (const file of new Bun.Glob(
  '{containers,components}/**/styles/*.js',
).scan(appRoot)) {
  modules.push({ file, module: await import(path.join(appRoot, file)) });
}

describe('migrated Emotion styles', () => {
  for (const mode of ['light', 'dark']) {
    test(`all ${mode} component styles serialize in development`, () => {
      const theme = createTheme(materialUiTheme({ appThemeMode: mode }));
      let serialized = 0;
      for (const { file, module } of modules) {
        if (!module.styles) continue;
        const rules =
          typeof module.styles === 'function'
            ? module.styles(theme)
            : module.styles;
        for (const [rule, value] of Object.entries(rules)) {
          // Development Emotion rejects unquoted generated content. Production
          // builds skip that validation, so a packaged launch cannot catch it.
          expect(() => css(value), `${file}: ${rule}`).not.toThrow();
          serialized += 1;
        }
      }
      expect(serialized).toBeGreaterThan(100);
    });
  }
});
