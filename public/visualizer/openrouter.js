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
