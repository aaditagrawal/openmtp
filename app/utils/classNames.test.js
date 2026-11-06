import { describe, expect, test } from 'bun:test';
import classNames from './classNames';

describe('CSS classes', () => {
  test('preserves strings, order, duplicates and whitespace', () => {
    expect(classNames('icon')).toBe('icon');
    expect(classNames('icon', 'icon')).toBe('icon icon');
    expect(classNames(' a ', 'b ')).toBe(' a  b ');
    expect(classNames(undefined, 'root')).toBe('root');
    expect(classNames('root', '')).toBe('root');
    expect(classNames()).toBe('');
  });

  test('keeps the same classes through selection and toolbar states', () => {
    expect(classNames('row', { selected: true })).toBe('row selected');
    expect(classNames('row', { selected: false })).toBe('row');
    expect(classNames({ selected: false })).toBe('');
    expect(classNames({ selected: true })).toBe('selected');
    expect(
      classNames('toolbar', { disabled: false, inverted: true, image: 1 }),
    ).toBe('toolbar inverted image');
  });

  test('only includes truthy own keys in enumeration order', () => {
    const flags = Object.assign(Object.create({ inherited: true }), {
      '': true,
      hidden: false,
      active: true,
      toString: false,
      constructor: true,
      'two classes': 'truthy',
    });
    expect(classNames('root', flags)).toBe(
      'root active constructor two classes',
    );
    expect(classNames(undefined, { undefined: true, root: true })).toBe(
      'undefined root',
    );
  });
});
