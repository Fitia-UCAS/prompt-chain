export const RUN_ALARM = 'prompt-flow-tick';

export function createScheduler({tick, timers = globalThis}) {
  let tail = Promise.resolve(), queued = false, wakeTimer, disposed = false;

  function enqueue(action) {
    const result = tail.then(action);
    tail = result.catch(() => {});
    return result;
  }

  function requestTick() {
    if (disposed || queued) return;
    queued = true;
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
