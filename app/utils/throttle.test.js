import { describe, expect, test, mock } from 'bun:test';
import { createThrottledUpdater } from './throttle';

describe('createThrottledUpdater', () => {
  test('sends the first update immediately', () => {
    const updateFn = mock(() => {});
    const throttled = createThrottledUpdater(updateFn, 100);

    throttled.update({ n: 1 });

    expect(updateFn).toHaveBeenCalledTimes(1);
    expect(updateFn.mock.calls[0][0]).toEqual({ n: 1 });
  });

  test('coalesces rapid updates to the latest payload', async () => {
    const updateFn = mock(() => {});
    const throttled = createThrottledUpdater(updateFn, 40);

    throttled.update({ n: 1 });
    throttled.update({ n: 2 });
    throttled.update({ n: 3 });

    expect(updateFn).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(updateFn).toHaveBeenCalledTimes(2);
    expect(updateFn.mock.calls[1][0]).toEqual({ n: 3 });
  });

  test('cancel drops a pending update', async () => {
    const updateFn = mock(() => {});
    const throttled = createThrottledUpdater(updateFn, 40);

    throttled.update({ n: 1 });
    throttled.update({ n: 2 });
    throttled.cancel();

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(updateFn).toHaveBeenCalledTimes(1);
  });
});
