import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import dns from 'dns';
import { isConnected } from './isOnline';
let lookup;
afterEach(() => lookup?.mockRestore());
describe('DNS connectivity', () => {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']) {
    test(`returns offline for ${code}`, async () => {
      lookup = spyOn(dns, 'lookup').mockImplementation((_hostname, callback) =>
        callback(Object.assign(new Error('lookup failed'), { code })),
      );
      expect(await isConnected()).toBe(false);
    });
  }
  test('returns online after a successful lookup', async () => {
    lookup = spyOn(dns, 'lookup').mockImplementation((_hostname, callback) =>
      callback(null, '127.0.0.1', 4),
    );
    expect(await isConnected()).toBe(true);
  });
});
