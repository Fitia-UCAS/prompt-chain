export const RUN_ALARM = 'prompt-flow-tick';

export function createScheduler({tick, timers = globalThis, clock = Date, staleAfterMs = 30000}) {
  let tail = Promise.resolve(), queued = false, wakeTimer, disposed = false, startedAt = 0;

  function enqueue(action) {
    const result = tail.then(action);
    tail = result.catch(() => {});
    return result;
  }

  function requestTick() {
    if (disposed) return;
    if (queued) {
      if (clock.now() - startedAt < staleAfterMs) return;
      // A tick waiting on a page that never answers must not swallow every later
      // wake-up. Detach the stuck chain; the page-side effects are idempotent
      // because dispatch re-reads the stored run before sending.
      queued = false;
      tail = Promise.resolve();
    }
    queued = true; startedAt = clock.now();
    enqueue(tick).catch(() => {}).finally(() => {queued = false;});
  }

  function arm(run) {
    timers.clearTimeout(wakeTimer);
    if (!disposed && run?.status === 'running') wakeTimer = timers.setTimeout(requestTick, 1700);
  }

  function dispose() {
    disposed = true;
    timers.clearTimeout(wakeTimer);
  }

  return {enqueue, requestTick, arm, dispose, idle: () => tail};
}
