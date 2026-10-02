import './guard';
import { expect, test } from 'bun:test';
import { NativeInvoker } from '../../ffi/kalam/src/NativeInvoker';

function fixture(implementation, options = {}) {
  const active = new Map();
  let registrations = 0;
  const ffi = {
    pointer: (value) => value,
    register(fn) {
      registrations += 1;
      if (registrations === options.failRegistration)
        throw new Error('Registration failed');
      const pointer = BigInt(registrations);
      active.set(pointer, fn);
      return pointer;
    },
    unregister(pointer) {
      active.delete(pointer);
    },
  };
  const functions = {
    Run: { async: (...args) => implementation({ active, args }) },
  };
  const invoker = new NativeInvoker({ ffi, callbackType: {}, functions });
  return { active, invoker };
}
const ok = JSON.stringify({ data: true });

test('does not resolve or unregister until native code has actually returned', async () => {
  let nativeReturned;
  const { invoker, active } = fixture(({ active, args: [done, finish] }) => {
    active.get(done)(ok);
    nativeReturned = finish;
  });
  let settled = false;
  const pending = invoker.invoke('Run').then((result) => {
    settled = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  expect(active.size).toBe(1);
  nativeReturned(null);
  expect((await pending).data).toBe(true);
  expect(active.size).toBe(0);
});

test('malformed native responses become errors and all callbacks are released', async () => {
  for (const value of ['{', 'null', '[]']) {
    const { invoker, active } = fixture(({ active, args: [done, finish] }) => {
      expect(() => active.get(done)(value)).not.toThrow();
      finish(null);
    });
    expect((await invoker.invoke('Run')).error).toBeInstanceOf(Error);
    expect(active.size).toBe(0);
  }
});

test('user progress exceptions cannot escape into native code or leak callbacks', async () => {
  const { invoker, active } = fixture(
    ({ active, args: [progress, done, finish] }) => {
      expect(() => active.get(progress)(ok)).not.toThrow();
      active.get(done)(ok);
      finish(null);
    },
  );
  const result = await invoker.invoke('Run', [], {
    callbacks: [
      () => {
        throw new Error('UI callback failed');
      },
    ],
  });
  expect(result.error.message).toBe('UI callback failed');
  expect(active.size).toBe(0);
});

test('partial registration failure and synchronous native failure clean up allocations', async () => {
  const partial = fixture(
    () => {
      throw new Error('Must not start');
    },
    { failRegistration: 2 },
  );
  expect(
    (await partial.invoker.invoke('Run', [], { callbacks: [() => {}] })).error
      .message,
  ).toBe('Registration failed');
  expect(partial.active.size).toBe(0);
  const thrown = fixture(() => {
    throw new Error('Native start failed');
  });
  expect((await thrown.invoker.invoke('Run')).error.message).toBe(
    'Native start failed',
  );
  expect(thrown.active.size).toBe(0);
});

test('missing terminal result produces an error rather than an unresolved promise', async () => {
  const { invoker, active } = fixture(({ args: [, finish] }) => finish(null));
  expect((await invoker.invoke('Run')).error.message).toContain(
    'without a result',
  );
  expect(active.size).toBe(0);
});

test('operations are serialized through native completion and recover after errors', async () => {
  const order = [];
  let finishFirst;
  const { invoker } = fixture(({ active, args: [done, finish] }) => {
    order.push('start');
    active.get(done)(ok);
    if (order.length === 1) finishFirst = finish;
    else finish(null);
  });
  const first = invoker.invoke('Run');
  const second = invoker.invoke('Run');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(order).toEqual(['start']);
  finishFirst(new Error('Failed first operation'));
  expect((await first).error.message).toBe('Failed first operation');
  expect((await second).data).toBe(true);
  expect(order).toEqual(['start', 'start']);
});
