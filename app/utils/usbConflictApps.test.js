import { describe, expect, test } from 'bun:test';
import {
  formatUsbConflictWarning,
  USB_CONFLICT_APPS,
} from './usbConflictApps.format';

describe('USB_CONFLICT_APPS', () => {
  test('has stable ids and non-empty patterns', () => {
    expect(USB_CONFLICT_APPS.length).toBeGreaterThanOrEqual(4);

    for (const app of USB_CONFLICT_APPS) {
      expect(typeof app.id).toBe('string');
      expect(typeof app.label).toBe('string');
      expect(app.patterns.length).toBeGreaterThan(0);
    }
  });
});

describe('formatUsbConflictWarning', () => {
  test('returns null for an empty list', () => {
    expect(formatUsbConflictWarning([])).toBe(null);
  });

  test('uses singular grammar for one app', () => {
    expect(formatUsbConflictWarning([{ label: 'Preview' }])).toBe(
      "Quit 'Preview' — it is holding the USB/MTP connection. Then refresh.",
    );
  });

  test('uses plural grammar for multiple apps', () => {
    expect(
      formatUsbConflictWarning([{ label: 'Preview' }, { label: 'Dropbox' }]),
    ).toBe(
      "Quit 'Preview', 'Dropbox' — they are holding the USB/MTP connection. Then refresh.",
    );
  });
});
