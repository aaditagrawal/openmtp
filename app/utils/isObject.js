// Match the existing utility: arrays and functions are objects; null is not.
export const isObject = (value) =>
  value !== null && (typeof value === 'object' || typeof value === 'function');
