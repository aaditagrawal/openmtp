/**
 * Coalesce rapid updates to at most one call per intervalMs.
 * Always delivers the latest pending payload on flush.
 */
export const createThrottledUpdater = (updateFn, intervalMs = 100) => {
  let lastSentAt = 0;
  let timer = null;
  let pendingPayload = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    if (!pendingPayload) {
      return;
    }

    const payload = pendingPayload;

    pendingPayload = null;
    lastSentAt = Date.now();
    updateFn(payload);
  };

  return {
    update: (payload) => {
      pendingPayload = payload;
      const elapsed = Date.now() - lastSentAt;

      if (elapsed >= intervalMs) {
        flush();

        return;
      }

      if (!timer) {
        timer = setTimeout(flush, intervalMs - elapsed);
      }
    },
    flush,
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      pendingPayload = null;
    },
  };
};
