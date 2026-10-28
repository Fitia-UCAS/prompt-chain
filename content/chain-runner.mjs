export function createChainRunner({readUrl, publish}) {
  let current = null, version = 0;
  let state = {stepIndex: 0, totalSteps: 0, status: 'completed'};
  const listeners = new Set();
  function update(run) {
    if (!run || run.id !== current) return;
    state = {stepIndex: run.index, totalSteps: run.flow.steps.length, status: run.status === 'running' ? run.phase : run.status, error: run.reason || ''};
    for (const listener of listeners) listener({...state});
    publish({...state});
  }
  async function run(steps) {
    const response = await chrome.runtime.sendMessage({type: 'PC_RUN_NATIVE', payload: {steps, expectedHref: readUrl()}});
    if (!response?.ok) throw new Error(response?.error || '无法启动流程');
    current = response.run.id; update(response.run); return true;
  }
  async function cancel() {
    version++;
    if (current) await chrome.runtime.sendMessage({type: 'PC_STOP_NATIVE', runId: current});
  }
  chrome.storage.onChanged.addListener((changes, area) => {if (area === 'local' && changes.pfRun) update(changes.pfRun.newValue);});
  return {run, cancel, stopForNavigation() {}, isRunning: () => ['ready', 'uploading', 'sending', 'waiting', 'paused'].includes(state.status), getCancellationVersion: () => version,
    getSnapshot: () => ({...state}), subscribe(listener) {listeners.add(listener); listener({...state}); return () => listeners.delete(listener);}};
}
