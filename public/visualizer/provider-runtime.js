import { PROMPT_VERSION, buildGenerationMessages, buildRepairMessages } from './prompt.js';
import { filterLiveDreamModels, liveDreamEligibility, MODEL_ELIGIBILITY_VERSION } from './model-eligibility.js';
import {
  attachTraceContext,
  captureAvailabilityEnd,
  captureAvailabilityStart,
  captureProviderResponse,
  captureTraceError,
} from './trace-bridge.js';

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
const MODELS_CACHE = 'ai-visualizer.openrouter.models-cache.v2';
const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
const OPENROUTER_KEY_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

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
  return sessionStorage.getItem(KEY_STORAGE) || '';
}

function disconnectOpenRouterCredential() {
  sessionStorage.removeItem(KEY_STORAGE);
  sessionStorage.removeItem(VERIFIER_STORAGE);
}

async function beginOpenRouterAuth(callbackUrl = `${location.origin}${location.pathname}`) {
  const verifier = randomVerifier();
  const challenge = await challengeFor(verifier);
  sessionStorage.setItem(VERIFIER_STORAGE, verifier);
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
  const verifier = sessionStorage.getItem(VERIFIER_STORAGE);
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

  sessionStorage.setItem(KEY_STORAGE, payload.key);
  sessionStorage.removeItem(VERIFIER_STORAGE);
  params.delete('code');
  const nextSearch = params.toString();
  history.replaceState({}, '', `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}${location.hash}`);
  return { connected: true, changed: true, providerId: DEFAULT_PROVIDER_ID };
}

function normalizeModel(model) {
  const upstreamProvider = String(model.id || '').split('/')[0] || 'model';
  const supportedParameters = Array.isArray(model.supported_parameters) ? [...model.supported_parameters] : [];
  const outputModalities = model?.architecture?.output_modalities || [];
  return {
    id: model.id,
    name: model.name || model.id,
    provider: upstreamProvider,
    providerId: DEFAULT_PROVIDER_ID,
    source: 'openrouter',
    canonicalSlug: model.canonical_slug || '',
    expirationDate: model.expiration_date || null,
    eligibilityVersion: MODEL_ELIGIBILITY_VERSION,
    description: model.description || '',
    contextLength: model.context_length || 0,
    created: model.created || 0,
    inputPrice: Number(model?.pricing?.prompt || 0),
    outputPrice: Number(model?.pricing?.completion || 0),
    architecture: model.architecture || null,
    supportedParameters,
    capabilities: {
      textOutput: !outputModalities.length || outputModalities.includes('text'),
      reasoning: supportedParameters.includes('reasoning'),
      structuredOutput: supportedParameters.includes('response_format'),
      maxOutputTokens: Number(model?.top_provider?.max_completion_tokens || 0),
    },
  };
}

async function fetchRawOpenRouterCatalog({ fresh = false, signal } = {}) {
  const response = await fetch(OPENROUTER_MODELS_URL, fresh || signal ? { ...(fresh ? { cache: 'no-store' } : {}), signal } : undefined);
  if (!response.ok) throw new Error('The OpenRouter model catalog could not be loaded. Check your connection and try again.');
  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

function normalizeEligibleModels(rawModels) {
  return filterLiveDreamModels(rawModels)
    .map(normalizeModel)
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
}

async function fetchOpenRouterModels() {
  const cached = sessionStorage.getItem(MODELS_CACHE);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (
        parsed.eligibilityVersion === MODEL_ELIGIBILITY_VERSION
        && Date.now() - parsed.savedAt < 15 * 60 * 1000
        && Array.isArray(parsed.models)
      ) return parsed.models;
    } catch {
      // A stale or malformed session cache is ignored in favor of the live catalog.
    }
  }

  const rawModels = await fetchRawOpenRouterCatalog();
  const models = normalizeEligibleModels(rawModels);
  sessionStorage.setItem(MODELS_CACHE, JSON.stringify({
    savedAt: Date.now(),
    eligibilityVersion: MODEL_ELIGIBILITY_VERSION,
    models,
  }));
  return models;
}

function modelEligibilityError(modelId, reason) {
  const reasonCopy = {
    BATCH_ONLY: 'This model entry is Batch API only, so it cannot serve an interactive Dream.',
    EXPIRED: 'This model has expired in the current OpenRouter catalog.',
    NO_TEXT_OUTPUT: 'This model does not provide the text output required to return visualizer HTML.',
    OUTPUT_TOO_SMALL: 'This model cannot return enough output for the Visualizer runtime contract.',
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
    captureAvailabilityEnd(traceContext, { modelId, status: 'failed', code: 'MODEL_AVAILABILITY_UNVERIFIED', error });
    const verificationError = new Error('Could not verify that this model is still available for a live Dream. No generation request was sent; try again in a moment.');
    verificationError.code = 'MODEL_AVAILABILITY_UNVERIFIED';
    verificationError.cause = error;
    throw verificationError;
  }

  const raw = rawModels.find(model => model?.id === modelId);
  if (!raw) {
    sessionStorage.removeItem(MODELS_CACHE);
    captureAvailabilityEnd(traceContext, { modelId, status: 'failed', code: 'NOT_IN_CURRENT_CATALOG' });
    throw modelEligibilityError(modelId, 'NOT_IN_CURRENT_CATALOG');
  }
  const eligibility = liveDreamEligibility(raw);
  if (!eligibility.eligible) {
    sessionStorage.removeItem(MODELS_CACHE);
    captureAvailabilityEnd(traceContext, { modelId, status: 'failed', code: eligibility.reason });
    throw modelEligibilityError(modelId, eligibility.reason);
  }
  const normalized = normalizeModel(raw);
  captureAvailabilityEnd(traceContext, { modelId, status: 'succeeded', resolvedModel: normalized.id });
  return normalized;
}

function extractText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => part?.text || '').join('');
  return '';
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

function providerMessage(payload) {
  return payload?.error?.message || payload?.error?.metadata?.raw || payload?.message || '';
}

function openRouterError(response, payload, modelId) {
  const detail = providerMessage(payload);
  const suffix = detail ? ` ${String(detail).slice(0, 320)}` : '';
  if (response.status === 401 || response.status === 403) {
    return new Error(`OpenRouter rejected this connection. Reconnect OpenRouter and try again.${suffix}`);
  }
  if (response.status === 402) {
    return new Error(`OpenRouter could not fund this Dream. Check your OpenRouter balance or key limit before trying again.${suffix}`);
  }
  if (response.status === 404) {
    return new Error(`The selected model became unavailable after the live catalog check. Choose another model.${suffix}`);
  }
  if (response.status === 408 || response.status === 504) {
    return new Error(`The selected model timed out before returning a complete visualizer. No automatic retry was sent.${suffix}`);
  }
  if (response.status === 429) {
    return new Error(`OpenRouter or ${modelId} is temporarily rate-limited. Wait a moment or choose another model.${suffix}`);
  }
  if (response.status >= 500) {
    return new Error(`OpenRouter or the selected model provider had a temporary problem. Your current visualizer is still safe.${suffix}`);
  }
  return new Error(detail || `OpenRouter model request failed (${response.status}).`);
}

async function requestOpenRouterCompletion({ modelId, apiKey, messages, maxTokens = 14000, signal, traceContext }) {
  await assertCurrentOpenRouterModel(modelId, { signal, traceContext });
  let response;
  try {
    response = await fetch(OPENROUTER_COMPLETIONS_URL, attachTraceContext({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': `${location.origin}${location.pathname}`,
      'X-OpenRouter-Title': 'AI Visualizer',
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      temperature: 1,
      max_tokens: maxTokens,
      stream: false,
    }),
    signal,
  }, traceContext));
  } catch (error) {
    captureTraceError(traceContext, error, { stage: 'provider-fetch' });
    throw error;
  }

  let rawBodyText;
  let payload = {};
  let parseError = null;
  try {
    rawBodyText = await response.text();
  } catch (error) {
    captureTraceError(traceContext, error, { stage: 'provider-response-body', status: response.status });
    throw error;
  }
  try {
    payload = rawBodyText ? JSON.parse(rawBodyText) : {};
  } catch (error) {
    parseError = error;
  }
  const raw = extractText(payload);
  captureProviderResponse(traceContext, {
    response,
    rawBodyText,
    parsedPayload: payload,
    parseError,
    assistantText: raw,
    finishReason: payload?.choices?.[0]?.finish_reason ?? null,
    resolvedModel: payload?.model || modelId,
    requestId: response.headers.get('x-request-id') || payload?.id || null,
    usage: payload?.usage || null,
  });
  if (!response.ok) {
    const error = parseError
      ? new Error(`OpenRouter returned HTTP ${response.status} with a non-JSON error response. Your current visualizer is still safe.`)
      : openRouterError(response, payload, modelId);
    captureTraceError(traceContext, error, { stage: 'provider-response', status: response.status, payload });
    throw error;
  }
  if (parseError) {
    const error = new Error('OpenRouter returned a response that was not valid JSON. Your current visualizer is still safe.');
    captureTraceError(traceContext, error, { stage: 'provider-response-parse' });
    throw error;
  }
  if (!raw.trim()) {
    const error = new Error(`${modelId} returned no visualizer code. Your current visualizer is still safe.`);
    captureTraceError(traceContext, error, { stage: 'provider-empty-response' });
    throw error;
  }
  return {
    raw,
    rawBodyText,
    usage: payload.usage || null,
    resolvedModel: payload.model || modelId,
    requestId: response.headers.get('x-request-id') || payload.id || null,
    providerId: DEFAULT_PROVIDER_ID,
  };
}

async function generateOpenRouterVisualizer({ modelId, apiKey = getOpenRouterCredential(), signal, traceContext, promptProfile }) {
  if (!apiKey) throw new Error('Connect OpenRouter before asking a model to Dream.');
  const result = await requestOpenRouterCompletion({
    modelId,
    apiKey,
    messages: buildGenerationMessages(promptProfile),
    signal,
    traceContext,
  });
  return { ...result, html: extractHtml(result.raw), promptVersion: PROMPT_VERSION, attempt: 1 };
}

async function repairOpenRouterVisualizer({ modelId, raw, problem, apiKey = getOpenRouterCredential(), signal, traceContext, promptProfile }) {
  if (!apiKey) throw new Error('The OpenRouter connection was lost before repair.');
  const result = await requestOpenRouterCompletion({
    modelId,
    apiKey,
    messages: buildRepairMessages(String(raw || '').slice(0, 180000), problem, promptProfile),
    maxTokens: 14000,
    signal,
    traceContext,
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
    inferenceLevels: false,
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
