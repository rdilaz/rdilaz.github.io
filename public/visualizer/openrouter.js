// One-time cleanup for browser sessions that saw the abandoned local-provider
// experiment. This removes only its synthetic selection/catalog state.
const RESET_MARKER = 'ai-visualizer.browser-provider-reset.v1';
if (!sessionStorage.getItem(RESET_MARKER)) {
  sessionStorage.removeItem('ai-visualizer.openrouter.models-cache.v1');
  const selected = localStorage.getItem('ai-visualizer.selected-model') || '';
  if (selected.startsWith('local/')) localStorage.removeItem('ai-visualizer.selected-model');
  sessionStorage.setItem(RESET_MARKER, '1');
}

// OpenRouter's general catalog includes asynchronous :batch variants that are
// not valid on the live chat-completions path. Clear stale pre-filter caches and
// selections once so an old browser session cannot keep offering them.
const LIVE_MODEL_RESET_MARKER = 'ai-visualizer.live-model-eligibility-reset.v1';
if (!sessionStorage.getItem(LIVE_MODEL_RESET_MARKER)) {
  sessionStorage.removeItem('ai-visualizer.openrouter.models-cache.v1');
  sessionStorage.removeItem('ai-visualizer.openrouter.models-cache.v2');
  const selected = localStorage.getItem('ai-visualizer.selected-model') || '';
  if (/:batch$/i.test(selected)) localStorage.removeItem('ai-visualizer.selected-model');
  sessionStorage.setItem(LIVE_MODEL_RESET_MARKER, '1');
}

// Compatibility facade for the V0 UI. The actual provider implementation and
// browser-only adapter contract live in provider-runtime.js.
export {
  PROVIDER_CONTRACT_VERSION,
  extractHtml,
  getProviderCredential as getOpenRouterKey,
  isProviderConnected as isOpenRouterConnected,
  disconnectProvider as disconnectOpenRouter,
  beginProviderAuth as beginOpenRouterAuth,
  consumeProviderCallback as consumeOpenRouterCallback,
  fetchProviderModels as fetchModels,
  generateProviderVisualizer as generateVisualizer,
  repairProviderVisualizer as repairVisualizer,
} from './provider-runtime.js';
