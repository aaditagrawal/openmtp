export function isConsoleError(e) {
  return e && e.stack;
}
