import {createBackground} from './background/runtime.mjs';

createBackground({
  chrome, model: PromptFlowModel, store: PromptFlowStore,
  native: globalThis.PromptChainNative, upstream: globalThis.PromptChainUpstreamStorage,
  fileMatch: globalThis.PromptFlowFileMatch
});
