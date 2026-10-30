import {createScheduler, RUN_ALARM} from './scheduler.mjs';
import {createRunStore} from './run-store.mjs';
import {createConnection} from './connection.mjs';
import {createRunner} from './runner.mjs';
import {createMessageHandler} from './messages.mjs';

export function createBackground({chrome, model, store, native, upstream, fileMatch, clock = Date, timers = globalThis}) {
  let runner;
  const scheduler = createScheduler({tick: () => runner.tick(), timers, clock});
  const runs = createRunStore({chrome, model, scheduler, clock});
  const connection = createConnection({chrome, model, runs, native, clock});
  runner = createRunner({chrome, model, store, runs, connection, scheduler, native, fileMatch, clock});
  const handle = createMessageHandler({chrome, model, store, runs, connection, runner, native, upstream, clock});
  const listeners = [];

  function listen(event, listener) {
    event.addListener(listener);
    listeners.push(() => event.removeListener?.(listener));
  }

  listen(chrome.runtime.onMessage, (message, sender, respond) => {
    if (message?.type === 'PF_HEARTBEAT') {
      if (sender.tab) scheduler.requestTick();
      respond({ok: true}); return;
    }
    if (!message?.type?.startsWith('PF_') && !message?.type?.startsWith('PC_')) return;
    scheduler.enqueue(() => handle(message, sender)).then(
      result => respond({ok: true, ...result}),
      error => respond({ok: false, error: error.message})
    ).catch(() => {});
    return true;
  });
  listen(chrome.alarms.onAlarm, alarm => {if (alarm.name === RUN_ALARM) scheduler.requestTick();});
  listen(chrome.tabs.onRemoved, tabId => scheduler.enqueue(async () => {
    const run = await runs.getRun();
    if (run?.tabId === tabId && run.status === 'running') await runner.pause(run, '目标标签页已关闭');
  }).catch(() => {}));
  listen(chrome.tabs.onUpdated, (_id, info) => {if (info.status === 'complete') scheduler.requestTick();});
  const panelBehavior = () => chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).catch(() => {});
  listen(chrome.runtime.onInstalled, panelBehavior);
  panelBehavior();
  scheduler.requestTick();

  return {scheduler, runs, connection, runner, dispose() {
    scheduler.dispose();
    for (const remove of listeners.splice(0)) remove();
  }};
}
