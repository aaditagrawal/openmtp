import { describe, expect, test } from 'bun:test';
import prefixer from './reducerPrefixer';

describe('reducerPrefixer', () => {
  test('prefixes action type strings', () => {
    expect(prefixer('@@Alerts', ['THROW_ALERT', 'CLEAR_ALERT'])).toEqual({
      THROW_ALERT: '@@Alerts/THROW_ALERT',
      CLEAR_ALERT: '@@Alerts/CLEAR_ALERT',
    });
  });
});
