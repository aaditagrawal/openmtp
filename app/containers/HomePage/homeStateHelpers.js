/**
 * Shared frozen empties so clear/reset paths keep stable references and
 * connected selectors can bail out without allocating new [] each time.
 */
export const EMPTY_NODES = Object.freeze([]);
export const EMPTY_SELECTED = Object.freeze([]);

/**
 * True when every key in `patch` already matches `mtpDevice`.
 */
export function mtpDevicePatchIsNoop(mtpDevice, patch) {
  if (!mtpDevice || !patch) {
    return false;
  }

  const keys = Object.keys(patch);

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];

    if (mtpDevice[key] !== patch[key]) {
      return false;
    }
  }

  return keys.length > 0;
}

/**
 * Normalize a selection payload to a stable empty reference when empty.
 */
export function normalizeSelected(selected) {
  if (!selected || selected.length === 0) {
    return EMPTY_SELECTED;
  }

  return selected;
}

/**
 * Normalize directory nodes to a stable empty reference when empty/missing.
 */
export function normalizeNodes(nodes) {
  if (!nodes || nodes.length === 0) {
    return EMPTY_NODES;
  }

  return nodes;
}
