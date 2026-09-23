import { describe, expect, test } from 'bun:test';
import Alerts, { initialState } from './reducers';
import { actionTypes } from './actions';

describe('Alerts reducer', () => {
  test('THROW_ALERT merges payload', () => {
    const next = Alerts(initialState, {
      type: actionTypes.THROW_ALERT,
      payload: { message: 'boom', variant: 'warning' },
    });

    expect(next.message).toBe('boom');
    expect(next.variant).toBe('warning');
  });

  test('CLEAR_ALERT resets to initial state', () => {
    const dirty = { ...initialState, message: 'boom' };
    const next = Alerts(dirty, { type: actionTypes.CLEAR_ALERT });

    expect(next).toEqual(initialState);
  });
});
