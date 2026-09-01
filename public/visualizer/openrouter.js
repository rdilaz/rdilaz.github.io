// One-time cleanup for browser sessions that saw the abandoned local-provider
// experiment. This removes only its synthetic selection/catalog state.
const RESET_MARKER = 'ai-visualizer.browser-provider-reset.v1';
if (!sessionStorage.getItem(RESET_MARKER)) {
  sessionStorage.removeItem('ai-visualizer.openrouter.models-cache.v1');
  const selected = localStorage.getItem('ai-visualizer.selected-model') || '';
  if (selected.startsWith('local/')) localStorage.removeItem('ai-visualizer.selected-model');
  sessionStorage.setItem(RESET_MARKER, '1');
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
