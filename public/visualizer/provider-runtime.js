import { AUDIO_API_VERSION, PROMPT_VERSION, buildGenerationMessages, buildRepairMessages } from './prompt.js';
import { filterLiveDreamModels, liveDreamEligibility, MODEL_ELIGIBILITY_VERSION } from './model-eligibility.js';
import { GENERATION_ENVELOPE_VERSION } from './generation-envelope.js';
import {
  GENERATION_FAILURE_CATEGORIES,
  classifyGenerationFailure,
  generationFailureCopy,
} from './generation-failure.js';
import {
  createReasoningRequestConfiguration,
  createReasoningSelectionStore,
  normalizeReasoningMetadata,
  normalizeReasoningSelection,
} from './reasoning-settings.js';
import {
  attachTraceContext,
  attachRequestPolicy,
  captureAvailabilityEnd,
  captureAvailabilityStart,
  captureProviderResponse,
  captureRequestPolicy,
  captureStreamTransport,
  captureTraceError,
  traceCaptureIdentity,
} from './trace-bridge.js';
import {
  linkCompletionAccounting,
  reconcileCompletionAccounting,
  releaseCompletionAccounting,
  settleCompletionAccounting,
} from './completion-accounting.js';
import { consumeOpenRouterChatStream } from './openrouter-sse.js';

export const PROVIDER_CONTRACT_VERSION = 'visualizer-provider-v1';
export const DEFAULT_PROVIDER_ID = 'openrouter';

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  'getCredential',
  'isConnected',
  'connect',
  'consumeCallback',
  'disconnect',
  'listModels',
  'generate',
  'repair',
]);

const adapters = new Map();
let activeProviderId = DEFAULT_PROVIDER_ID;

function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('Provider adapter must be an object.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(adapter.id || ''))) throw new TypeError('Provider adapter id is invalid.');
  for (const method of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter[method] !== 'function') throw new TypeError(`Provider ${adapter.id} is missing ${method}().`);
  }
  if (adapter.browserOnly !== true) throw new TypeError(`Provider ${adapter.id} must preserve the browser-only product boundary.`);
  if (adapter.billing !== 'user') throw new TypeError(`Provider ${adapter.id} must use user-funded access in the current product phase.`);
}

export function registerProvider(adapter) {
  validateAdapter(adapter);
  if (adapters.has(adapter.id)) throw new Error(`Provider ${adapter.id} is already registered.`);
  adapters.set(adapter.id, Object.freeze(adapter));
  return adapter;
}

export function listRegisteredProviders() {
  return [...adapters.values()].map(adapter => ({
    id: adapter.id,
    name: adapter.name,
    browserOnly: adapter.browserOnly,
    billing: adapter.billing,
    transport: adapter.transport,
    capabilities: adapter.capabilities,
  }));
}

export function setActiveProvider(providerId) {
  if (!adapters.has(providerId)) throw new Error(`Unknown provider: ${providerId}`);
  activeProviderId = providerId;
}

export function getActiveProvider() {
  const adapter = adapters.get(activeProviderId);
  if (!adapter) throw new Error(`Active provider ${activeProviderId} is not registered.`);
  return adapter;
}

export function getProviderCredential() {
  return getActiveProvider().getCredential();
}

export function isProviderConnected() {
  return getActiveProvider().isConnected();
}

export function disconnectProvider() {
  return getActiveProvider().disconnect();
}

export function beginProviderAuth(callbackUrl = `${location.origin}${location.pathname}`) {
  return getActiveProvider().connect(callbackUrl);
}

export function consumeProviderCallback() {
  return getActiveProvider().consumeCallback();
}

export function fetchProviderModels() {
  return getActiveProvider().listModels();
}

export function generateProviderVisualizer(options) {
  return getActiveProvider().generate(options);
}

export function repairProviderVisualizer(options) {
  return getActiveProvider().repair(options);
}

const KEY_STORAGE = 'ai-visualizer.openrouter.key';
const VERIFIER_STORAGE = 'ai-visualizer.openrouter.pkce-verifier';
export const OPENROUTER_MODEL_NORMALIZATION_VERSION = 'openrouter-model-normalization-v3';

const MODELS_CACHE = 'ai-visualizer.openrouter.models-cache.v3';
const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
const OPENROUTER_KEY_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

function safeSessionStorage() {
  const values = new Map();
  try {
    const storage = globalThis.sessionStorage;
    if (storage?.getItem && storage?.setItem && storage?.removeItem) {
      return {
        getItem(key) {
          try { return storage.getItem(key) ?? values.get(String(key)) ?? null; } catch { return values.get(String(key)) ?? null; }
        },
        setItem(key, value) {
          values.set(String(key), String(value));
          try { storage.setItem(key, value); } catch { /* Session memory remains available. */ }
        },
        removeItem(key) {
          values.delete(String(key));
          try { storage.removeItem(key); } catch { /* Session memory is already cleared. */ }
        },
      };
    }
  } catch {
    // A memory fallback keeps the built-in product usable when storage is denied.
  }
  return {
    getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => { values.set(String(key), String(value)); },
    removeItem: key => { values.delete(String(key)); },
  };
}

const sessionStore = safeSessionStorage();

function base64Url(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function randomVerifier() {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function getOpenRouterCredential() {
  return sessionStore.getItem(KEY_STORAGE) || '';
}

function disconnectOpenRouterCredential() {
  sessionStore.removeItem(KEY_STORAGE);
  sessionStore.removeItem(VERIFIER_STORAGE);
}

async function beginOpenRouterAuth(callbackUrl = `${location.origin}${location.pathname}`) {
  const verifier = randomVerifier();
  const challenge = await challengeFor(verifier);
  sessionStore.setItem(VERIFIER_STORAGE, verifier);
  const url = new URL(OPENROUTER_AUTH_URL);
  url.searchParams.set('callback_url', callbackUrl);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  location.assign(url.toString());
}

async function consumeOpenRouterCallback() {
  const params = new URLSearchParams(location.search);
  const providerError = params.get('error');
  if (providerError) {
    const providerDescription = params.get('error_description');
    params.delete('error');
    params.delete('error_description');
    history.replaceState({}, '', `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash}`);
    throw new Error(providerDescription || 'OpenRouter authorization was cancelled or rejected.');
  }

  const code = params.get('code');
  if (!code) return { connected: Boolean(getOpenRouterCredential()), changed: false, providerId: DEFAULT_PROVIDER_ID };
  const verifier = sessionStore.getItem(VERIFIER_STORAGE);
  if (!verifier) throw new Error('OpenRouter returned without the browser PKCE verifier. Press Connect and try again.');

  const response = await fetch(OPENROUTER_KEY_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.key) {
    throw new Error(payload?.error?.message || payload?.message || 'OpenRouter authorization could not be completed.');
  }

  sessionStore.setItem(KEY_STORAGE, payload.key);
  sessionStore.removeItem(VERIFIER_STORAGE);
  params.delete('code');
  const nextSearch = params.toString();
  history.replaceState({}, '', `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}${location.hash}`);
  return { connected: true, changed: true, providerId: DEFAULT_PROVIDER_ID };
}

const hasOwn = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function publishedPrice(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function exactCatalogFields(source, fields) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const output = {};
  for (const field of fields) {
    if (!hasOwn(source, field)) continue;
    const value = source[field];
    output[field] = Array.isArray(value) ? [...value] : value;
  }
  return output;
}

export function normalizeOpenRouterModel(model = {}) {
  const upstreamProvider = String(model.id || '').split('/')[0] || 'model';
  const supportedParameters = Array.isArray(model.supported_parameters) ? [...model.supported_parameters] : [];
  const outputModalities = model?.architecture?.output_modalities || [];
  const rawPricing = exactCatalogFields(model?.pricing, ['prompt', 'completion', 'request', 'internal_reasoning', 'overrides']) || {};
  const rawReasoning = exactCatalogFields(model?.reasoning, [
    'mandatory',
    'default_enabled',
    'supported_efforts',
    'default_effort',
    'supports_max_tokens',
    'defaultEnabled',
    'supportedEfforts',
    'defaultEffort',
    'supportsMaxTokens',
  ]);
  const rawTopProvider = exactCatalogFields(model?.top_provider, [
    'max_completion_tokens',
    'context_length',
    'is_moderated',
  ]) || {};
  const rootContextLength = positiveInteger(model?.context_length);
  const topProviderContextLength = positiveInteger(model?.top_provider?.context_length);
  const maxCompletionTokens = positiveInteger(model?.top_provider?.max_completion_tokens);
  const normalized = {
    id: model.id,
    name: model.name || model.id,
    provider: upstreamProvider,
    providerId: DEFAULT_PROVIDER_ID,
    source: 'openrouter',
    canonicalSlug: model.canonical_slug || '',
    expirationDate: model.expiration_date || null,
    eligibilityVersion: MODEL_ELIGIBILITY_VERSION,
    description: model.description || '',
    contextLength: rootContextLength || topProviderContextLength || 0,
    rootContextLength: rootContextLength || 0,
    topProviderContextLength: topProviderContextLength || 0,
    maxCompletionTokens: maxCompletionTokens || 0,
    created: model.created || 0,
    inputPrice: publishedPrice(model?.pricing?.prompt) ?? 0,
    outputPrice: publishedPrice(model?.pricing?.completion) ?? 0,
    pricing: rawPricing,
    top_provider: rawTopProvider,
    topProvider: {
      maxCompletionTokens: maxCompletionTokens || 0,
      contextLength: topProviderContextLength || 0,
    },
    reasoning: rawReasoning,
    architecture: model.architecture || null,
    supportedParameters,
    metadataSource: {
      catalog: 'openrouter.models',
      contextLength: hasOwn(model, 'context_length') ? 'model.context_length' : null,
      topProvider: model?.top_provider ? 'model.top_provider' : null,
      pricing: model?.pricing ? 'model.pricing' : null,
      reasoning: model?.reasoning ? 'model.reasoning' : null,
    },
    capabilities: {
      textOutput: !outputModalities.length || outputModalities.includes('text'),
      reasoning: supportedParameters.includes('reasoning') || Boolean(rawReasoning),
      structuredOutput: supportedParameters.includes('response_format'),
      maxOutputTokens: maxCompletionTokens || 0,
    },
  };
  normalized.reasoningMetadata = normalizeReasoningMetadata(normalized);
  return normalized;
}

async function fetchRawOpenRouterCatalog({ fresh = false, signal } = {}) {
  const response = await fetch(OPENROUTER_MODELS_URL, fresh || signal ? { ...(fresh ? { cache: 'no-store' } : {}), signal } : undefined);
  if (!response.ok) throw new Error('The OpenRouter model catalog could not be loaded. Check your connection and try again.');
  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

function normalizeEligibleModels(rawModels) {
  return filterLiveDreamModels(rawModels)
    .map(normalizeOpenRouterModel)
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
}

function publishModelCatalog(models, savedAt = Date.now()) {
  if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
  globalThis.dispatchEvent(new globalThis.CustomEvent('visualizer:model-catalog-updated', {
    detail: { models, savedAt },
  }));
}

async function fetchOpenRouterModels() {
  const cached = sessionStore.getItem(MODELS_CACHE);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (
        parsed.eligibilityVersion === MODEL_ELIGIBILITY_VERSION
        && parsed.normalizationVersion === OPENROUTER_MODEL_NORMALIZATION_VERSION
        && Date.now() - parsed.savedAt < 15 * 60 * 1000
        && Array.isArray(parsed.models)
      ) {
        publishModelCatalog(parsed.models, parsed.savedAt);
        return parsed.models;
      }
    } catch {
      // A stale or malformed session cache is ignored in favor of the live catalog.
    }
  }

  const rawModels = await fetchRawOpenRouterCatalog();
  const models = normalizeEligibleModels(rawModels);
  const savedAt = Date.now();
  sessionStore.setItem(MODELS_CACHE, JSON.stringify({
    savedAt,
    eligibilityVersion: MODEL_ELIGIBILITY_VERSION,
    normalizationVersion: OPENROUTER_MODEL_NORMALIZATION_VERSION,
    models,
  }));
  publishModelCatalog(models, savedAt);
  return models;
}

function modelEligibilityError(modelId, reason) {
  const reasonCopy = {
    BATCH_ONLY: 'This model entry is Batch API only, so it cannot serve an interactive Dream.',
    EXPIRED: 'This model has expired in the current OpenRouter catalog.',
    NO_TEXT_OUTPUT: 'This model does not provide the text output required to return visualizer HTML.',
    OUTPUT_TOO_SMALL: 'This model cannot return enough output for the Visualizer runtime contract.',
    OUTPUT_LIMIT_UNENFORCEABLE: 'This model does not expose an enforceable completion limit for spend protection.',
    NOT_IN_CURRENT_CATALOG: 'This model is no longer in OpenRouter’s current live catalog.',
  }[reason] || 'This model is not currently compatible with live Dreams.';
  const error = new Error(`${reasonCopy} Choose another model. No generation request was sent.`);
  error.code = 'MODEL_NOT_LIVE_DREAM_COMPATIBLE';
  error.modelId = modelId;
  error.eligibilityReason = reason;
  return error;
}

async function assertCurrentOpenRouterModel(modelId, { signal, traceContext } = {}) {
  captureAvailabilityStart(traceContext, { modelId, endpoint: 'openrouter.models' });
  let rawModels;
  try {
    rawModels = await fetchRawOpenRouterCatalog({ fresh: true, signal });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'CANCELLED') {
      captureAvailabilityEnd(traceContext, { modelId, status: 'cancelled', code: 'CANCELLED', error });
      throw cancellationError(signal, error);
    }
    captureAvailabilityEnd(traceContext, { modelId, status: 'failed', code: 'MODEL_AVAILABILITY_UNVERIFIED', error });
    const verificationError = new Error('Could not verify that this model is still available for a live Dream. No generation request was sent; try again in a moment.');
    verificationError.code = 'MODEL_AVAILABILITY_UNVERIFIED';
    verificationError.cause = error;
    throw verificationError;
  }

  const raw = rawModels.find(model => model?.id === modelId);
  if (!raw) {
    sessionStore.removeItem(MODELS_CACHE);
    captureAvailabilityEnd(traceContext, { modelId, status: 'failed', code: 'NOT_IN_CURRENT_CATALOG' });
    throw modelEligibilityError(modelId, 'NOT_IN_CURRENT_CATALOG');
  }
  const eligibility = liveDreamEligibility(raw);
  if (!eligibility.eligible) {
    sessionStore.removeItem(MODELS_CACHE);
    captureAvailabilityEnd(traceContext, { modelId, status: 'failed', code: eligibility.reason });
    throw modelEligibilityError(modelId, eligibility.reason);
  }
  const normalized = normalizeOpenRouterModel(raw);
  captureAvailabilityEnd(traceContext, { modelId, status: 'succeeded', resolvedModel: normalized.id });
  return normalized;
}

export function extractHtml(raw) {
  let value = String(raw || '').trim();
  value = value.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const doctype = value.search(/<!doctype\s+html/i);
  const htmlStart = value.search(/<html[\s>]/i);
  const start = doctype >= 0 ? doctype : htmlStart;
  const endMatch = [...value.matchAll(/<\/html\s*>/gi)].at(-1);
  if (start >= 0 && endMatch) value = value.slice(start, endMatch.index + endMatch[0].length);
  return value.trim();
}

function normalizedRequestModel(model) {
  return model?.eligibilityVersion === MODEL_ELIGIBILITY_VERSION
    && model?.metadataSource?.catalog === 'openrouter.models'
    ? model
    : normalizeOpenRouterModel(model || {});
}

function modelContextCapacity(model) {
  const values = [model?.rootContextLength, model?.topProviderContextLength, model?.contextLength]
    .map(positiveInteger)
    .filter(value => value !== null);
  return values.length ? Math.min(...values) : null;
}

function reasoningSelectionIntent(selection, fallback) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return { ...fallback };
  return {
    schema: typeof selection.schema === 'string' ? selection.schema : fallback.schema,
    modelId: String(selection.modelId ?? fallback.modelId),
    mode: String(selection.mode ?? ''),
    effort: selection.effort == null ? null : String(selection.effort),
    selectedAt: Number.isFinite(Number(selection.selectedAt)) ? Number(selection.selectedAt) : null,
    staleFallback: selection.staleFallback === true,
  };
}

function staleSelectionReason(requested, applied) {
  if (!applied.staleFallback) return '';
  if (requested?.modelId && String(requested.modelId) !== applied.modelId) return 'MODEL_CHANGED';
  if (requested?.mode === 'explicit') return 'EFFORT_NO_LONGER_SUPPORTED';
  return 'SELECTION_INVALID_OR_STALE';
}

export function buildOpenRouterCompletionRequest({
  model,
  messages,
  reasoningSelection = null,
  promptProfile = null,
  attemptKind = 'generation',
} = {}) {
  const currentModel = normalizedRequestModel(model);
  const appliedReasoningSelection = normalizeReasoningSelection(currentModel, reasoningSelection);
  const requestedReasoningSelection = reasoningSelectionIntent(reasoningSelection, appliedReasoningSelection);
  const dispatchedReasoning = createReasoningRequestConfiguration(currentModel, appliedReasoningSelection);
  const maxCompletionTokens = positiveInteger(currentModel.maxCompletionTokens);
  const reasoningFacts = normalizeReasoningMetadata(currentModel);
  const supportedParameters = new Set(currentModel.supportedParameters || []);
  const declaredParameters = supportedParameters.size > 0;
  const maxTokenParameter = supportedParameters.has('max_tokens') || !declaredParameters
    ? 'max_tokens'
    : supportedParameters.has('max_completion_tokens')
      ? 'max_completion_tokens'
      : null;
  const body = {
    model: currentModel.id,
    messages: Array.isArray(messages) ? messages : [],
    ...(!declaredParameters || supportedParameters.has('temperature') ? { temperature: 1 } : {}),
    ...(maxCompletionTokens === null || !maxTokenParameter ? {} : { [maxTokenParameter]: maxCompletionTokens }),
    stream: true,
    provider: { require_parameters: true },
    ...(dispatchedReasoning === undefined ? {} : { reasoning: dispatchedReasoning }),
  };
  const policy = {
    userReasoningSelection: requestedReasoningSelection,
    appliedReasoningSelection,
    nativeDefaultUsed: dispatchedReasoning === undefined,
    dispatchedReasoning: dispatchedReasoning ?? null,
    modelReasoningFacts: reasoningFacts,
    metadataSource: {
      model: currentModel.metadataSource,
      reasoning: reasoningFacts.source,
    },
    catalogModel: {
      id: currentModel.id,
      name: currentModel.name,
      source: currentModel.source,
      contextLength: currentModel.contextLength,
      rootContextLength: currentModel.rootContextLength,
      topProviderContextLength: currentModel.topProviderContextLength,
      maxCompletionTokens: currentModel.maxCompletionTokens,
      top_provider: currentModel.top_provider,
      topProvider: currentModel.topProvider,
      pricing: currentModel.pricing,
      reasoning: currentModel.reasoning,
    },
    modelMaximumCompletionTokens: maxCompletionTokens,
    maxTokenParameter,
    modelContextCapacityTokens: modelContextCapacity(currentModel),
    generationEnvelopeVersion: GENERATION_ENVELOPE_VERSION,
    finalMaxTokens: null,
    finalRequestCostCeiling: null,
    attemptKind: attemptKind === 'repair' ? 'repair' : 'generation',
    prompt: {
      profileId: String(promptProfile?.id || ''),
      version: PROMPT_VERSION,
      hash: String(promptProfile?.briefHash || ''),
      audioApiVersion: AUDIO_API_VERSION,
    },
    staleReason: staleSelectionReason(requestedReasoningSelection, appliedReasoningSelection),
  };
  return {
    body,
    policy,
    reasoningSelection: appliedReasoningSelection,
    reasoningSelectionStale: Boolean(policy.staleReason),
  };
}

let browserReasoningSelectionStore = null;
const activeDreamReasoningSelections = new Map();

function currentReasoningSelection(model) {
  if (!browserReasoningSelectionStore) {
    const storage = (() => {
      try { return globalThis.localStorage || null; } catch { return null; }
    })();
    browserReasoningSelectionStore = createReasoningSelectionStore({ storage });
  }
  return browserReasoningSelectionStore.snapshot(model);
}

function selectionForAttempt(model, suppliedSelection, attemptKind) {
  if (suppliedSelection !== undefined) return suppliedSelection;
  if (attemptKind === 'repair' && activeDreamReasoningSelections.has(model.id)) {
    return activeDreamReasoningSelections.get(model.id);
  }
  return currentReasoningSelection(model);
}

function emitStaleReasoningSelection(prepared) {
  if (!prepared.reasoningSelectionStale || typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
  globalThis.dispatchEvent(new globalThis.CustomEvent('visualizer:reasoning-selection-stale', {
    detail: Object.freeze({
      modelId: prepared.policy.catalogModel.id,
      requested: Object.freeze({ ...prepared.policy.userReasoningSelection }),
      applied: prepared.reasoningSelection,
      reason: prepared.policy.staleReason,
      supportedEfforts: Object.freeze([...prepared.policy.modelReasoningFacts.supportedEfforts]),
      metadataSource: Object.freeze({ ...prepared.policy.metadataSource }),
    }),
  }));
}

export function shouldBlockStaleReasoningRepair(attemptKind, requestedSelection, prepared) {
  return attemptKind === 'repair'
    && requestedSelection?.mode === 'explicit'
    && prepared?.reasoningSelectionStale === true;
}

function providerMessage(payload) {
  return payload?.error?.message
    || payload?.error?.metadata?.raw
    || payload?.choices?.[0]?.error?.message
    || payload?.choices?.[0]?.error?.metadata?.raw
    || payload?.message
    || '';
}

function providerFailureCopy(category, status) {
  if (category === GENERATION_FAILURE_CATEGORIES.PROVIDER_TIMEOUT) return generationFailureCopy(category);
  if (status === 401 || status === 403) return 'The AI service rejected this connection. Reconnect OpenRouter and try again. Your current Dream is still here.';
  if (status === 402) return 'This Dream could not be funded. Check your OpenRouter balance or key limit. Your current Dream is still here.';
  if (status === 404) return 'This exact model became unavailable. Choose another model; your current Dream is still here.';
  if (status === 429) return 'This model is temporarily rate-limited. Wait a moment or choose another model. Your current Dream is still here.';
  if (status >= 500) return 'AI service unavailable. Try again later or choose another model. Your current Dream is still here.';
  return generationFailureCopy(category);
}

function generationFailureError(category, { status = null, payload = null, cause = null } = {}) {
  const numericStatus = Number(status);
  const error = new Error(providerFailureCopy(category, Number.isFinite(numericStatus) ? numericStatus : null));
  error.name = 'GenerationFailureError';
  error.code = category;
  if (Number.isFinite(Number(status))) error.status = Number(status);
  const detail = providerMessage(payload);
  if (detail) error.providerDetail = String(detail).slice(0, 320);
  if (cause) error.cause = cause;
  return error;
}

function cancellationError(signal, cause = null) {
  const reason = signal?.reason;
  if (reason?.name === 'AbortError' || reason?.code === 'CANCELLED') return reason;
  const error = new Error('Dream cancelled. No retry was sent, and your current Dream is unchanged.');
  error.name = 'AbortError';
  error.code = 'CANCELLED';
  error.cause = cause || reason || null;
  return error;
}

export function categorizedTransportError(error, { signal = null } = {}) {
  const timeoutKind = error?.timeoutKind
    || (error?.code === 'DREAM_IDLE_TIMEOUT' ? 'idle' : error?.code === 'DREAM_HARD_TIMEOUT' ? 'hard' : null);
  if (signal?.aborted && !timeoutKind) return cancellationError(signal, error);
  const category = timeoutKind ? GENERATION_FAILURE_CATEGORIES.PROVIDER_TIMEOUT : classifyGenerationFailure({ error });
  if (category !== GENERATION_FAILURE_CATEGORIES.PROVIDER_TIMEOUT) return error;
  const failure = generationFailureError(category, { cause: error });
  failure.timeoutKind = timeoutKind;
  failure.streamTransport = error?.streamResult?.transport || error?.streamTransport || error?.transport || null;
  return failure;
}

function emitStreamProgress(traceContext, detail) {
  if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
  const identity = traceCaptureIdentity(traceContext);
  if (!identity) return;
  globalThis.dispatchEvent(new globalThis.CustomEvent('visualizer:dream-stream-progress', {
    detail: Object.freeze({
      correlationId: identity.correlationId,
      traceId: identity.traceId,
      attemptId: identity.attemptId,
      kind: String(detail?.kind || ''),
      at: Number(detail?.at) || Date.now(),
      eventCount: Number(detail?.eventCount) || 0,
      commentCount: Number(detail?.commentCount) || 0,
      contentDeltaCount: Number(detail?.contentDeltaCount) || 0,
      reasoningDeltaCount: Number(detail?.reasoningDeltaCount) || 0,
      usageReceived: detail?.usageReceived === true,
      providerGenerationId: String(detail?.providerGenerationId || ''),
      outcome: String(detail?.outcome || ''),
    }),
  }));
}

function scheduleMetadataReconciliation(traceContext, providerGenerationId, evidence = {}) {
  void reconcileCompletionAccounting(traceContext, { ...evidence, providerGenerationId });
}

function settleUsageWithoutBlocking(traceContext, usage, providerGenerationId, evidence = {}) {
  if (!usage || typeof usage !== 'object') {
    scheduleMetadataReconciliation(traceContext, providerGenerationId, evidence);
    return;
  }
  void settleCompletionAccounting(traceContext, { usage, providerGenerationId })
    .then(result => {
      if (result.settled !== true) scheduleMetadataReconciliation(traceContext, providerGenerationId, evidence);
    })
    .catch(() => scheduleMetadataReconciliation(traceContext, providerGenerationId, evidence));
}

function terminalHttpErrorEvidence(status, payload) {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  const content = choices.map(choice => choice?.message?.content ?? choice?.delta?.content ?? choice?.text ?? '').join('');
  const reasoning = choices.map(choice => choice?.message?.reasoning ?? choice?.message?.reasoning_content ?? choice?.delta?.reasoning ?? '').join('');
  const bytes = value => new TextEncoder().encode(String(value || '')).byteLength;
  return {
    status,
    usagePresent: payload?.usage !== null && payload?.usage !== undefined,
    contentBytes: bytes(content),
    reasoningBytes: bytes(reasoning),
    partialArtifact: content.trim().length > 0,
    terminal: true,
    cancelled: false,
    timedOut: false,
  };
}

async function readResponseText(response, { signal, traceContext, providerGenerationId, stage }) {
  try {
    return await response.text();
  } catch (error) {
    const classified = categorizedTransportError(error, { signal });
    const transport = classified?.streamTransport || error?.streamTransport || error?.transport || null;
    if (transport) captureStreamTransport(traceContext, transport);
    scheduleMetadataReconciliation(traceContext, providerGenerationId || transport?.providerGenerationId || '');
    captureTraceError(traceContext, classified, { stage, status: response.status, transport });
    throw classified;
  }
}

function attachTransportFailure(error, streamResult) {
  if (!error || !streamResult) return error;
  error.streamTransport = streamResult.transport;
  error.providerGenerationId = streamResult.providerGenerationId || '';
  return error;
}

async function requestOpenRouterCompletion({
  modelId,
  apiKey,
  messages,
  signal,
  traceContext,
  reasoningSelection,
  promptProfile,
  attemptKind = 'generation',
}) {
  const currentModel = await assertCurrentOpenRouterModel(modelId, { signal, traceContext });
  const selectedReasoning = selectionForAttempt(currentModel, reasoningSelection, attemptKind);
  const prepared = buildOpenRouterCompletionRequest({
    model: currentModel,
    messages,
    reasoningSelection: selectedReasoning,
    promptProfile,
    attemptKind,
  });
  if (attemptKind === 'generation') {
    activeDreamReasoningSelections.set(modelId, prepared.reasoningSelection);
  }
  captureRequestPolicy(traceContext, prepared.policy);
  emitStaleReasoningSelection(prepared);
  if (shouldBlockStaleReasoningRepair(attemptKind, selectedReasoning, prepared)) {
    const error = new Error('The selected reasoning level is no longer supported for this repair. No repair request was sent, and your current Dream is still here.');
    error.name = 'ReasoningSelectionError';
    error.code = 'REASONING_SELECTION_UNAVAILABLE_FOR_REPAIR';
    captureTraceError(traceContext, error, { stage: 'reasoning-revalidation' });
    throw error;
  }
  let response;
  try {
    response = await fetch(OPENROUTER_COMPLETIONS_URL, attachTraceContext(attachRequestPolicy({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': `${location.origin}${location.pathname}`,
        'X-OpenRouter-Title': 'AI Visualizer',
      },
      body: JSON.stringify(prepared.body),
      signal,
    }, prepared.policy), traceContext));
  } catch (error) {
    const classified = categorizedTransportError(error, { signal });
    const transport = classified?.streamTransport || error?.streamTransport || error?.transport || null;
    if (transport) captureStreamTransport(traceContext, transport);
    scheduleMetadataReconciliation(traceContext, transport?.providerGenerationId || '');
    captureTraceError(traceContext, classified, { stage: 'provider-fetch', transport });
    throw classified;
  }

  const headerGenerationId = response.headers.get('x-generation-id') || '';
  const headerRequestId = response.headers.get('x-request-id') || '';
  if (headerGenerationId) void linkCompletionAccounting(traceContext, { providerGenerationId: headerGenerationId });
  if (!response.ok) {
    const rawBodyText = await readResponseText(response, {
      signal,
      traceContext,
      providerGenerationId: headerGenerationId,
      stage: 'provider-error-response-body',
    });
    let payload = {};
    let parseError = null;
    try {
      payload = rawBodyText ? JSON.parse(rawBodyText) : {};
    } catch (error) {
      parseError = error;
    }
    const providerGenerationId = headerGenerationId || payload?.id || '';
    if (providerGenerationId) void linkCompletionAccounting(traceContext, { providerGenerationId });
    const requestId = headerRequestId || payload?.request_id || '';
    const transport = {
      schema: 'openrouter-chat-sse-v1',
      streamed: true,
      outcome: 'provider-error',
      timeoutKind: null,
      chunkCount: rawBodyText ? 1 : 0,
      eventCount: 0,
      commentCount: 0,
      bytesReceived: new TextEncoder().encode(rawBodyText).byteLength,
      doneReceived: false,
      usageReceived: Boolean(payload?.usage),
      providerGenerationId,
      firstActivityAt: null,
      firstEventAt: null,
      firstReasoningDeltaAt: null,
      firstContentDeltaAt: null,
      lastActivityAt: null,
      streamCompletedAt: null,
      terminatedAt: Date.now(),
    };
    captureStreamTransport(traceContext, transport);
    settleUsageWithoutBlocking(
      traceContext,
      payload?.usage || null,
      providerGenerationId,
      terminalHttpErrorEvidence(response.status, payload),
    );
    captureProviderResponse(traceContext, {
      response,
      rawBodyText,
      parsedPayload: payload,
      parseError,
      assistantText: '',
      extractedHtml: '',
      finishReason: payload?.choices?.[0]?.finish_reason ?? null,
      nativeFinishReason: payload?.choices?.[0]?.native_finish_reason ?? payload?.native_finish_reason ?? null,
      resolvedModel: payload?.model || modelId,
      requestId,
      providerGenerationId,
      usage: payload?.usage || null,
      transport,
    });
    const category = classifyGenerationFailure({ status: response.status, payload, error: null });
    const error = generationFailureError(
      category === GENERATION_FAILURE_CATEGORIES.PROVIDER_TIMEOUT
        ? category
        : GENERATION_FAILURE_CATEGORIES.PROVIDER_EXPLICIT_ERROR,
      { status: response.status, payload },
    );
    captureTraceError(traceContext, error, { stage: 'provider-response', status: response.status, payload });
    throw error;
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/event-stream')) {
    const rawBodyText = await readResponseText(response, {
      signal,
      traceContext,
      providerGenerationId: headerGenerationId,
      stage: 'provider-non-stream-response-body',
    });
    let payload = null;
    try {
      payload = rawBodyText ? JSON.parse(rawBodyText) : null;
    } catch { /* The exact bounded body remains in diagnostics when available. */ }
    const providerGenerationId = headerGenerationId || payload?.id || '';
    if (providerGenerationId) void linkCompletionAccounting(traceContext, { providerGenerationId });
    const transport = {
      schema: 'openrouter-chat-sse-v1',
      streamed: false,
      outcome: 'protocol-error',
      timeoutKind: null,
      chunkCount: rawBodyText ? 1 : 0,
      eventCount: 0,
      commentCount: 0,
      bytesReceived: new TextEncoder().encode(rawBodyText).byteLength,
      doneReceived: false,
      usageReceived: Boolean(payload?.usage),
      providerGenerationId,
      streamCompletedAt: null,
      terminatedAt: Date.now(),
    };
    captureStreamTransport(traceContext, transport);
    settleUsageWithoutBlocking(traceContext, payload?.usage || null, providerGenerationId);
    captureProviderResponse(traceContext, {
      response,
      rawBodyText,
      parsedPayload: payload,
      assistantText: '',
      extractedHtml: '',
      resolvedModel: payload?.model || modelId,
      requestId: headerRequestId || payload?.request_id || '',
      providerGenerationId,
      usage: payload?.usage || null,
      transport,
    });
    const error = generationFailureError(GENERATION_FAILURE_CATEGORIES.PROVIDER_EXPLICIT_ERROR, {
      status: response.status,
      payload,
      cause: new Error('OpenRouter returned a non-streaming success body for a streaming request.'),
    });
    captureTraceError(traceContext, error, { stage: 'provider-stream-protocol', transport });
    throw error;
  }

  let streamed;
  try {
    streamed = await consumeOpenRouterChatStream(response, {
      signal,
      providerGenerationId: headerGenerationId,
      onProgress: detail => {
        if (detail?.providerGenerationId) void linkCompletionAccounting(traceContext, { providerGenerationId: detail.providerGenerationId });
        emitStreamProgress(traceContext, detail);
      },
    });
  } catch (streamError) {
    const partial = streamError?.streamResult || null;
    if (partial?.transport) captureStreamTransport(traceContext, partial.transport);
    const providerGenerationId = partial?.providerGenerationId || headerGenerationId;
    if (partial?.transport?.generationIdMismatch) releaseCompletionAccounting(traceContext);
    else settleUsageWithoutBlocking(traceContext, partial?.usage || null, providerGenerationId);
    if (partial) {
      captureProviderResponse(traceContext, {
        response,
        rawBodyText: partial.rawBodyText,
        parsedPayload: null,
        streamAggregate: partial.streamAggregate,
        assistantText: partial.assistantText,
        extractedHtml: '',
        finishReason: partial.finishReason,
        nativeFinishReason: partial.nativeFinishReason,
        resolvedModel: partial.resolvedModel || modelId,
        requestId: headerRequestId,
        providerGenerationId,
        usage: partial.usage,
        transport: partial.transport,
      });
    }
    let error;
    const streamFailureCategory = classifyGenerationFailure({
      status: response.status,
      payload: streamError?.providerPayload || null,
      error: streamError,
      stage: 'provider-stream',
    });
    if (streamError?.code === 'DREAM_IDLE_TIMEOUT' || streamError?.code === 'DREAM_HARD_TIMEOUT') {
      error = categorizedTransportError(streamError, { signal });
      if (error === streamError) {
        error = generationFailureError(GENERATION_FAILURE_CATEGORIES.PROVIDER_TIMEOUT, {
          status: response.status,
          payload: streamError?.providerPayload || null,
          cause: streamError,
        });
      }
    } else if (signal?.aborted) {
      error = cancellationError(signal, streamError);
    } else if (streamFailureCategory === GENERATION_FAILURE_CATEGORIES.PROVIDER_TIMEOUT) {
      error = categorizedTransportError(streamError, { signal });
      if (error === streamError) {
        error = generationFailureError(GENERATION_FAILURE_CATEGORIES.PROVIDER_TIMEOUT, {
          status: response.status,
          payload: streamError?.providerPayload || null,
          cause: streamError,
        });
      }
    } else {
      error = generationFailureError(GENERATION_FAILURE_CATEGORIES.PROVIDER_EXPLICIT_ERROR, {
        status: response.status,
        payload: streamError?.providerPayload || null,
        cause: streamError,
      });
    }
    attachTransportFailure(error, partial);
    emitStreamProgress(traceContext, {
      kind: 'terminated',
      at: partial?.transport?.terminatedAt || Date.now(),
      outcome: partial?.transport?.outcome || 'transport-error',
      providerGenerationId,
    });
    captureTraceError(traceContext, error, {
      stage: partial?.transport?.outcome || 'provider-stream',
      status: response.status,
      payload: streamError?.providerPayload || null,
      transport: partial?.transport || null,
    });
    throw error;
  }

  captureStreamTransport(traceContext, streamed.transport);
  settleUsageWithoutBlocking(traceContext, streamed.usage, streamed.providerGenerationId);
  const raw = streamed.assistantText;
  const payload = streamed.streamAggregate;
  const finishReason = streamed.finishReason;
  const nativeFinishReason = streamed.nativeFinishReason;
  const requestId = headerRequestId || '';
  const extractedHtml = extractHtml(raw);
  const failureCategory = classifyGenerationFailure({
    response: {
      status: response.status,
      payload,
      assistantText: raw,
      extractedHtml,
      finishReason,
      nativeFinishReason,
    },
  });
  captureProviderResponse(traceContext, {
    response,
    rawBodyText: streamed.rawBodyText,
    parsedPayload: null,
    streamAggregate: payload,
    assistantText: raw,
    extractedHtml: failureCategory ? '' : extractedHtml,
    finishReason,
    nativeFinishReason,
    resolvedModel: streamed.resolvedModel || modelId,
    requestId,
    providerGenerationId: streamed.providerGenerationId,
    usage: streamed.usage,
    transport: streamed.transport,
  });
  if (failureCategory) {
    const error = generationFailureError(failureCategory, { status: response.status, payload });
    captureTraceError(traceContext, error, {
      stage: failureCategory === GENERATION_FAILURE_CATEGORIES.EMPTY_PROVIDER_CONTENT
        ? 'provider-empty-response'
        : 'provider-incomplete-response',
      status: response.status,
      finishReason,
      nativeFinishReason,
    });
    throw error;
  }
  return {
    raw,
    rawBodyText: streamed.rawBodyText,
    usage: streamed.usage || null,
    resolvedModel: streamed.resolvedModel || modelId,
    resolvedProvider: streamed.resolvedProvider || '',
    requestId,
    providerGenerationId: streamed.providerGenerationId,
    providerId: DEFAULT_PROVIDER_ID,
    reasoningSelection: prepared.reasoningSelection,
    requestPolicy: prepared.policy,
    finishReason,
    nativeFinishReason,
    native_finish_reason: nativeFinishReason,
  };
}

async function generateOpenRouterVisualizer({ modelId, apiKey = getOpenRouterCredential(), signal, traceContext, promptProfile, reasoningSelection }) {
  if (!apiKey) throw new Error('Connect OpenRouter before asking a model to Dream.');
  const result = await requestOpenRouterCompletion({
    modelId,
    apiKey,
    messages: buildGenerationMessages(promptProfile),
    signal,
    traceContext,
    reasoningSelection,
    promptProfile,
    attemptKind: 'generation',
  });
  return { ...result, html: extractHtml(result.raw), promptVersion: PROMPT_VERSION, attempt: 1 };
}

async function repairOpenRouterVisualizer({ modelId, raw, problem, apiKey = getOpenRouterCredential(), signal, traceContext, promptProfile, reasoningSelection }) {
  if (!apiKey) throw new Error('The OpenRouter connection was lost before repair.');
  const result = await requestOpenRouterCompletion({
    modelId,
    apiKey,
    messages: buildRepairMessages(String(raw || '').slice(0, 180000), problem, promptProfile),
    signal,
    traceContext,
    reasoningSelection,
    promptProfile,
    attemptKind: 'repair',
  });
  return { ...result, html: extractHtml(result.raw), promptVersion: PROMPT_VERSION, attempt: 2 };
}

const openRouterAdapter = {
  id: DEFAULT_PROVIDER_ID,
  name: 'OpenRouter',
  browserOnly: true,
  billing: 'user',
  transport: 'browser-direct',
  capabilities: Object.freeze({
    authorization: 'pkce',
    modelCatalog: true,
    pricing: true,
    usageAccounting: true,
    inferenceLevels: true,
    reasoningSelection: 'catalog-exact',
    modelEligibility: MODEL_ELIGIBILITY_VERSION,
  }),
  getCredential: getOpenRouterCredential,
  isConnected: () => Boolean(getOpenRouterCredential()),
  connect: beginOpenRouterAuth,
  consumeCallback: consumeOpenRouterCallback,
  disconnect: disconnectOpenRouterCredential,
  listModels: fetchOpenRouterModels,
  generate: generateOpenRouterVisualizer,
  repair: repairOpenRouterVisualizer,
};

registerProvider(openRouterAdapter);
