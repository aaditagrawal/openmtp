/**
 * Join the app's CSS class strings and optional truthy flag map.
 * Accepts a string, two strings, a flag map, or a string and a flag map.
 * Class order, duplicate classes and whitespace are preserved.
 *
 * @param {string | Record<string, unknown>} base
 * @param {string | Record<string, unknown>} [extra]
 * @returns {string}
 */
export default function classNames(base, extra) {
  if (!base) base = '';
  if (typeof base !== 'string') return flaggedClasses(base);
  if (!extra) return base;
  if (typeof extra === 'string') return base ? base + ' ' + extra : extra;
  const suffix = flaggedClasses(extra);
  return suffix ? (base ? base + ' ' + suffix : suffix) : base;
}

// A cached own-property predicate lets V8 reuse its for-in enumeration checks.
const hasOwn = Object.prototype.hasOwnProperty;
function flaggedClasses(flags) {
  let names = '';
  for (const name in flags) {
    if (hasOwn.call(flags, name) && flags[name]) {
      names = names && name ? names + ' ' + name : names + name;
    }
  }
  return names;
}
