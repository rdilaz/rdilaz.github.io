import {
  captureFinalRequest,
  captureRequestPolicy,
  captureRequestDispatched,
  captureTraceError,
  requestPolicyFromInit,
  traceRequestPolicy,
  traceContextFromInit,
} from './trace-bridge.js';
import {
  DEFAULT_GENERATION_ENVELOPE_SAFETY_FACTOR,
  GENERATION_ENVELOPE_VERSION,
  calculateGenerationEnvelope,
} from './generation-envelope.js';
import {
  MODEL_FIT_STORAGE_KEY,
  createModelFitEvidenceStore,
  empiricalModelFitCostPreview,
} from './model-fit-evidence.js';
import {
  REASONING_SELECTION_STORAGE_PREFIX,
  createReasoningSelectionStore,
} from './reasoning-settings.js';
import {
  AUDIO_API_VERSION,
  PROMPT_STORAGE_KEY,
  PROMPT_VERSION,
  buildGenerationMessages,
  loadPromptProfile,
} from './prompt.js';
import { RELIABILITY_SCHEMA } from './reliability.js';
import { filterLiveDreamModels } from './model-eligibility.js';

export const COST_GUARD_VERSION = 'visualizer-cost-guard-v2';
export const VISUALIZER_RUNTIME_VERSION = 'visualizer-runtime-v1';

const windowRef = typeof window !== 'undefined' ? window : null;
const documentRef = typeof document !== 'undefined' ? document : null;
const nativeFetch = windowRef?.fetch?.bind(windowRef) || globalThis.fetch?.bind(globalThis) || null;
let spendReturnFocus = null;
let confirmationReturnFocus = null;

const OPENROUTER_KEY_STORAGE = 'ai-visualizer.openrouter.key';
const SETTINGS_STORAGE = 'ai-visualizer.spend.settings.v1';
const SESSION_SPEND_STORAGE = 'ai-visualizer.spend.session.v1';
const SESSION_LEDGER_STORAGE = 'ai-visualizer.spend.ledger.v1';
const DAILY_SPEND_STORAGE = 'ai-visualizer.spend.daily.v1';
const DEFAULTS = Object.freeze({ perDream: 0.75, session: 5, daily: 10, confirmAbove: 0.15, confirmExpensive: true });
const MAX_LEDGER = 50;
const SAFETY_FACTOR = DEFAULT_GENERATION_ENVELOPE_SAFETY_FACTOR;
const SELECTED_MODEL_STORAGE = 'ai-visualizer.selected-model';
const SPEND_LOCK_NAME = 'ai-visualizer-spend-guard-v1';

const money = (value) => {
  const number = Number(value || 0);
  if (number === 0) return '$0.00';
  if (number < 0.01) return '<$0.01';
  return `$${number.toFixed(2)}`;
};
export const maximumMoney = (value) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '$0.00';
  return `$${(Math.ceil(number * 100 - 1e-10) / 100).toFixed(2)}`;
};
const clampNumber = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const todayKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const readJson = (storage, key, fallback) => {
  try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const writeJson = (storage, key, value) => storage.setItem(key, JSON.stringify(value));

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => { values.set(String(key), String(value)); },
    removeItem: key => { values.delete(String(key)); },
  };
}

function browserStorage(name) {
  try {
    const storage = globalThis[name];
    if (!storage?.getItem || !storage?.setItem) return memoryStorage();
    return {
      getItem(key) { try { return storage.getItem(key); } catch { return null; } },
      setItem(key, value) { try { storage.setItem(key, value); } catch { /* Fall back to current in-memory state. */ } },
      removeItem(key) { try { storage.removeItem(key); } catch { /* Missing persistence is non-fatal. */ } },
    };
  } catch {
    return memoryStorage();
  }
}

const localStore = browserStorage('localStorage');
const sessionStore = browserStorage('sessionStorage');

let settings = { ...DEFAULTS, ...readJson(localStore, SETTINGS_STORAGE, {}) };
settings.perDream = clampNumber(settings.perDream, DEFAULTS.perDream, 0.05, 100);
settings.session = clampNumber(settings.session, DEFAULTS.session, settings.perDream, 500);
settings.daily = clampNumber(settings.daily, DEFAULTS.daily, settings.session, 2000);
settings.confirmAbove = clampNumber(settings.confirmAbove, DEFAULTS.confirmAbove, 0, settings.perDream);
settings.confirmExpensive = settings.confirmExpensive !== false;

let sessionSpent = clampNumber(sessionStore.getItem(SESSION_SPEND_STORAGE), 0, 0, 100000);
let ledger = readJson(sessionStore, SESSION_LEDGER_STORAGE, []);
if (!Array.isArray(ledger)) ledger = [];
let daily = readJson(localStore, DAILY_SPEND_STORAGE, { date: todayKey(), spent: 0 });
if (daily.date !== todayKey()) daily = { date: todayKey(), spent: 0 };
let modelCatalog = new Map();
let keyInfo = null;
let lastKey = '';
let currentDreamSpent = 0;
let keyRefreshTimer = 0;
let catalogUpdatedAt = null;
const reasoningSelectionStore = createReasoningSelectionStore({ storage: localStore });
const modelFitEvidenceStore = createModelFitEvidenceStore({ storage: localStore });

const els = {
  spendButton: documentRef?.getElementById('spendButton'),
  spendButtonValue: documentRef?.getElementById('spendButtonValue'),
  spendDrawer: documentRef?.getElementById('spendDrawer'),
  drawerScrim: documentRef?.getElementById('drawerScrim'),
  closeSpend: documentRef?.getElementById('closeSpendDrawer'),
  billingSource: documentRef?.getElementById('billingSource'),
  dreamCapSummary: documentRef?.getElementById('dreamCapSummary'),
  sessionSpendSummary: documentRef?.getElementById('sessionSpendSummary'),
  dailySpendSummary: documentRef?.getElementById('dailySpendSummary'),
  keyBudgetSummary: documentRef?.getElementById('keyBudgetSummary'),
  keyBudgetCopy: documentRef?.getElementById('keyBudgetCopy'),
  currentCostModel: documentRef?.getElementById('currentCostModel'),
  currentCostTypical: documentRef?.getElementById('currentCostTypical'),
  currentCostCeiling: documentRef?.getElementById('currentCostCeiling'),
  currentRequestCeiling: documentRef?.getElementById('currentRequestCeiling'),
  currentCostRates: documentRef?.getElementById('currentCostRates'),
  perDreamInput: documentRef?.getElementById('perDreamInput'),
  sessionCapInput: documentRef?.getElementById('sessionCapInput'),
  dailyCapInput: documentRef?.getElementById('dailyCapInput'),
  confirmAboveInput: documentRef?.getElementById('confirmAboveInput'),
  confirmExpensiveInput: documentRef?.getElementById('confirmExpensiveInput'),
  spendLedger: documentRef?.getElementById('spendLedger'),
  selectedModelName: documentRef?.getElementById('selectedModelName'),
  dreamButton: documentRef?.getElementById('dreamButton'),
  dreamCost: documentRef?.getElementById('dreamCost'),
  toast: documentRef?.getElementById('toast'),
  confirmBackdrop: documentRef?.getElementById('costConfirmBackdrop'),
  confirmModel: documentRef?.getElementById('costConfirmModel'),
  confirmEstimate: documentRef?.getElementById('costConfirmEstimate'),
  confirmCap: documentRef?.getElementById('costConfirmCap'),
  confirmContinue: documentRef?.getElementById('costConfirmContinue'),
  confirmCancel: documentRef?.getElementById('costConfirmCancel'),
};

function currentModelId() {
  return localStore.getItem(SELECTED_MODEL_STORAGE) || '';
}

const owns = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function minimumPositiveInteger(values) {
  const valid = values.map(positiveInteger).filter(value => value !== null);
  return valid.length ? Math.min(...valid) : null;
}

function priceMetadata(pricing, key) {
  if (!pricing || typeof pricing !== 'object' || !owns(pricing, key)) {
    return { present: false, valid: true, value: 0 };
  }
  const raw = pricing[key];
  if ((typeof raw !== 'number' && typeof raw !== 'string') || (typeof raw === 'string' && !raw.trim())) {
    return { present: true, valid: false, value: null };
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? { present: true, valid: true, value }
    : { present: true, valid: false, value: null };
}

function conservativePriceMetadata(pricing, key) {
  const base = priceMetadata(pricing, key);
  if (!base.valid) return base;
  let value = base.value;
  for (const override of Array.isArray(pricing?.overrides) ? pricing.overrides : []) {
    if (!override || typeof override !== 'object' || !owns(override, key)) continue;
    const candidate = priceMetadata(override, key);
    if (!candidate.valid || !candidate.present) return { present: true, valid: false, value: null };
    value = Math.max(value, candidate.value);
  }
  return { ...base, value };
}

export function normalizeCostGuardModel(model = {}) {
  if (model?.normalizationVersion === COST_GUARD_VERSION) return model;
  const pricing = model?.pricing && typeof model.pricing === 'object' ? model.pricing : {};
  const prompt = conservativePriceMetadata(pricing, 'prompt');
  const completion = conservativePriceMetadata(pricing, 'completion');
  const request = priceMetadata(pricing, 'request');
  const internalReasoning = priceMetadata(pricing, 'internal_reasoning');
  const maxCompletionTokens = minimumPositiveInteger([
    model.maxCompletionTokens,
    model.topProvider?.maxCompletionTokens,
    model.top_provider?.max_completion_tokens,
    model.capabilities?.maxOutputTokens,
  ]);
  const contextCapacityTokens = minimumPositiveInteger([
    model.rootContextLength,
    model.contextLength,
    model.context_length,
    model.topProviderContextLength,
    model.topProvider?.contextLength,
    model.top_provider?.context_length,
  ]);
  return Object.freeze({
    normalizationVersion: COST_GUARD_VERSION,
    id: String(model.id || ''),
    name: String(model.name || model.id || ''),
    source: String(model.source || 'openrouter'),
    maxCompletionTokens,
    contextCapacityTokens,
    reasoning: model.reasoning || null,
    pricingOverrides: Array.isArray(pricing.overrides) ? structuredClone(pricing.overrides) : [],
    pricing: Object.freeze({ prompt, completion, request, internalReasoning }),
    pricingKnown: prompt.present
      && prompt.valid
      && completion.present
      && completion.valid
      && request.valid
      && internalReasoning.valid,
  });
}

function envelopePricing(model) {
  const pricing = model.pricing;
  return {
    prompt: pricing.prompt.valid && pricing.prompt.present ? pricing.prompt.value : null,
    completion: pricing.completion.valid && pricing.completion.present ? pricing.completion.value : null,
    request: pricing.request.present ? (pricing.request.valid ? pricing.request.value : null) : 0,
    ...(pricing.internalReasoning.present
      ? { internal_reasoning: pricing.internalReasoning.valid ? pricing.internalReasoning.value : null }
      : {}),
  };
}

export function calculateCostGuardEnvelope({
  model,
  messages,
  maxTokens,
  remainingBudgets,
  reasoningSelection = null,
  safetyFactor = SAFETY_FACTOR,
} = {}) {
  const normalized = normalizeCostGuardModel(model);
  const options = {
    model: {
      id: normalized.id,
      contextLength: normalized.contextCapacityTokens,
      maxCompletionTokens: normalized.maxCompletionTokens,
      pricing: envelopePricing(normalized),
      reasoning: normalized.reasoning,
    },
    messages,
    remainingBudgets,
    reasoningSelection,
    safetyFactor,
  };
  if (maxTokens !== undefined) options.max_tokens = maxTokens;
  return calculateGenerationEnvelope(options);
}

function ingestModels(payload) {
  const list = Array.isArray(payload) ? payload : payload?.models || payload?.data;
  if (!Array.isArray(list)) return;
  modelCatalog = new Map(filterLiveDreamModels(list)
    .filter(model => model?.id)
    .map(model => [model.id, normalizeCostGuardModel(model)]));
  catalogUpdatedAt = Number(payload?.savedAt) || Date.now();
  render();
}

function refreshDailySpend() {
  const date = todayKey();
  const stored = readJson(localStore, DAILY_SPEND_STORAGE, null);
  if (stored?.date === date && Number.isFinite(Number(stored.spent))) {
    daily = { date, spent: Math.max(0, Number(stored.spent)) };
    return;
  }
  if (daily.date !== date) {
    daily = { date, spent: 0 };
    writeJson(localStore, DAILY_SPEND_STORAGE, daily);
  }
}

function remainingBudgets({ newDream = false } = {}) {
  refreshDailySpend();
  const providerRemaining = keyInfo?.limit_remaining != null && Number.isFinite(Number(keyInfo.limit_remaining))
    ? Math.max(0, Number(keyInfo.limit_remaining))
    : Infinity;
  return {
    perDream: Math.max(0, settings.perDream - (newDream ? 0 : currentDreamSpent)),
    session: Math.max(0, settings.session - sessionSpent),
    daily: Math.max(0, settings.daily - daily.spent),
    provider: providerRemaining,
  };
}

function modelFitIdentity(model, reasoningSelection, promptProfile = loadPromptProfile(localStore)) {
  return {
    modelId: model.id,
    reasoningSelection,
    promptProfileId: promptProfile.id,
    promptVersion: PROMPT_VERSION,
    promptHash: promptProfile.briefHash,
    generationEnvelopeVersion: GENERATION_ENVELOPE_VERSION,
    audioApiVersion: AUDIO_API_VERSION,
    reliabilityVersion: RELIABILITY_SCHEMA,
    runtimeVersion: VISUALIZER_RUNTIME_VERSION,
  };
}

function empiricalPreview(model, reasoningSelection, promptProfile) {
  try {
    return empiricalModelFitCostPreview(
      modelFitEvidenceStore,
      modelFitIdentity(model, reasoningSelection, promptProfile),
    );
  } catch {
    return Object.freeze({ kind: 'none', label: 'No estimate yet', text: 'No estimate yet', estimateUsd: null });
  }
}

function empiricalPreviewForRequest(model, reasoningSelection, requestPolicy) {
  const prompt = requestPolicy?.prompt;
  if (!prompt?.profileId || !prompt?.hash || !prompt?.version) {
    return empiricalPreview(model, reasoningSelection, loadPromptProfile(localStore));
  }
  try {
    return empiricalModelFitCostPreview(modelFitEvidenceStore, {
      modelId: model.id,
      reasoningSelection,
      promptProfileId: prompt.profileId,
      promptVersion: prompt.version,
      promptHash: prompt.hash,
      generationEnvelopeVersion: requestPolicy.generationEnvelopeVersion || GENERATION_ENVELOPE_VERSION,
      audioApiVersion: prompt.audioApiVersion || AUDIO_API_VERSION,
      reliabilityVersion: RELIABILITY_SCHEMA,
      runtimeVersion: VISUALIZER_RUNTIME_VERSION,
    });
  } catch {
    return Object.freeze({ kind: 'none', label: 'No estimate yet', text: 'No estimate yet', estimateUsd: null });
  }
}

function previewFor(modelId, { model = null, messages = null, reasoningSelection = null, promptProfile = null } = {}) {
  const selectedModel = model ? normalizeCostGuardModel(model) : modelCatalog.get(modelId);
  if (!selectedModel) return {
    known: false,
    modelId,
    model: null,
    reasoningSelection: null,
    empirical: Object.freeze({ kind: 'none', label: 'No estimate yet', text: 'No estimate yet', estimateUsd: null }),
    envelope: null,
  };
  const profile = promptProfile || loadPromptProfile(localStore);
  const selection = reasoningSelection || reasoningSelectionStore.snapshot({
    id: selectedModel.id,
    source: selectedModel.source,
    reasoning: selectedModel.reasoning,
  });
  const promptMessages = messages || buildGenerationMessages(profile);
  const envelope = calculateCostGuardEnvelope({
    model: selectedModel,
    messages: promptMessages,
    remainingBudgets: remainingBudgets({ newDream: true }),
    reasoningSelection: selection,
  });
  return {
    known: envelope.pricingStatus === 'known',
    modelId,
    model: selectedModel,
    reasoningSelection: selection,
    empirical: empiricalPreview(selectedModel, selection, profile),
    envelope,
    dreamCostCeiling: maximumDreamCostCeiling(envelope),
  };
}

function formatRate(perToken) {
  if (!perToken) return '$0/M';
  const perMillion = perToken * 1e6;
  return `$${perMillion < 1 ? perMillion.toFixed(2) : perMillion.toFixed(perMillion < 10 ? 2 : 0)}/M`;
}

function notice(message, duration = 5200) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => { els.toast.hidden = true; }, duration);
}

function saveSpend() {
  sessionStore.setItem(SESSION_SPEND_STORAGE, String(sessionSpent));
  writeJson(sessionStore, SESSION_LEDGER_STORAGE, ledger.slice(0, MAX_LEDGER));
  writeJson(localStore, DAILY_SPEND_STORAGE, daily);
}

function adjustSpend(amount) {
  refreshDailySpend();
  currentDreamSpent = Math.max(0, currentDreamSpent + amount);
  sessionSpent = Math.max(0, sessionSpent + amount);
  daily.spent = Math.max(0, daily.spent + amount);
}

function reserveCost({ modelId, ceiling, repair }) {
  const amount = Number(ceiling);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  const id = globalThis.crypto?.randomUUID?.() || `reservation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  adjustSpend(amount);
  ledger.unshift({
    id,
    at: Date.now(),
    modelId,
    modelName: modelCatalog.get(modelId)?.name || modelId,
    cost: amount,
    repair: Boolean(repair),
    estimated: true,
    uncertain: true,
    promptTokens: null,
    completionTokens: null,
  });
  ledger = ledger.slice(0, MAX_LEDGER);
  saveSpend();
  render();
  scheduleKeyRefresh();
  return id;
}

function reconcileReservedCost(reservationId, { cost, usage, estimated = false }) {
  const amount = Number(cost);
  const entry = ledger.find(candidate => candidate.id === reservationId);
  if (!entry || !Number.isFinite(amount) || amount < 0) return;
  adjustSpend(amount - Number(entry.cost || 0));
  entry.cost = amount;
  entry.estimated = Boolean(estimated);
  entry.uncertain = false;
  entry.promptTokens = usage?.prompt_tokens ?? usage?.promptTokens ?? null;
  entry.completionTokens = usage?.completion_tokens ?? usage?.completionTokens ?? null;
  saveSpend();
  render();
  scheduleKeyRefresh();
}

async function refreshKeyInfo() {
  const key = sessionStore.getItem(OPENROUTER_KEY_STORAGE) || '';
  lastKey = key;
  if (!key) {
    keyInfo = null;
    render();
    return;
  }
  if (!nativeFetch) return;
  try {
    const response = await nativeFetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload?.data) keyInfo = payload.data;
  } catch {
    keyInfo = null;
  }
  render();
}

function scheduleKeyRefresh() {
  clearTimeout(keyRefreshTimer);
  keyRefreshTimer = setTimeout(refreshKeyInfo, 900);
}

function selectedPreview() {
  return previewFor(currentModelId());
}

function renderLedger() {
  if (!els.spendLedger) return;
  els.spendLedger.replaceChildren();
  if (!ledger.length) {
    const empty = documentRef.createElement('p');
    empty.className = 'spend-empty';
    empty.textContent = 'No paid Dreams in this browser session yet.';
    els.spendLedger.appendChild(empty);
    return;
  }
  ledger.slice(0, 12).forEach(entry => {
    const row = documentRef.createElement('div');
    row.className = 'spend-ledger__row';
    const left = documentRef.createElement('span');
    const right = documentRef.createElement('strong');
    left.textContent = `${entry.repair ? 'Repair · ' : ''}${entry.modelName}`;
    right.textContent = entry.uncertain ? `up to ${maximumMoney(entry.cost)}` : `${entry.estimated ? '~' : ''}${money(entry.cost)}`;
    row.append(left, right);
    els.spendLedger.appendChild(row);
  });
}

function render() {
  const preview = selectedPreview();
  const envelope = preview.envelope;
  const rawMaximum = envelope?.finalRequestCostCeiling;
  const maximum = Number(rawMaximum);
  const hasMaximum = rawMaximum !== null && rawMaximum !== undefined && Number.isFinite(maximum) && maximum >= 0;
  const rawDreamMaximum = preview.dreamCostCeiling;
  const dreamMaximum = Number(rawDreamMaximum);
  const hasDreamMaximum = rawDreamMaximum !== null && rawDreamMaximum !== undefined && Number.isFinite(dreamMaximum) && dreamMaximum >= 0;
  const empiricalText = preview.empirical?.text || 'No estimate yet';
  if (els.spendButtonValue) els.spendButtonValue.textContent = money(sessionSpent);
  if (els.billingSource) els.billingSource.textContent = 'Your OpenRouter credits';
  if (els.dreamCapSummary) els.dreamCapSummary.textContent = `${money(settings.perDream)} max`;
  if (els.sessionSpendSummary) els.sessionSpendSummary.textContent = `${money(sessionSpent)} / ${money(settings.session)}`;
  if (els.dailySpendSummary) els.dailySpendSummary.textContent = `${money(daily.spent)} / ${money(settings.daily)}`;
  if (els.keyBudgetSummary) {
    if (!lastKey) els.keyBudgetSummary.textContent = 'Not connected';
    else if (keyInfo?.limit_remaining != null && Number.isFinite(Number(keyInfo.limit_remaining))) els.keyBudgetSummary.textContent = `${money(keyInfo.limit_remaining)} remaining`;
    else els.keyBudgetSummary.textContent = 'No provider-side key cap';
  }
  if (els.keyBudgetCopy) {
    if (!lastKey) els.keyBudgetCopy.textContent = 'Connect OpenRouter to read the key’s provider-enforced limit.';
    else if (keyInfo?.limit != null && Number.isFinite(Number(keyInfo.limit))) els.keyBudgetCopy.textContent = `${money(keyInfo.usage)} used of a ${money(keyInfo.limit)} OpenRouter key limit${keyInfo.limit_reset ? ` · resets ${keyInfo.limit_reset}` : ''}.`;
    else els.keyBudgetCopy.textContent = 'This OpenRouter key reports no hard provider limit. The Visualizer app caps below still apply in this browser.';
  }
  const modelName = modelCatalog.get(currentModelId())?.name || els.selectedModelName?.textContent || 'Choose a model';
  if (els.currentCostModel) els.currentCostModel.textContent = modelName;
  if (els.currentCostTypical) els.currentCostTypical.textContent = empiricalText;
  if (els.currentCostCeiling) els.currentCostCeiling.textContent = hasDreamMaximum ? `max ${maximumMoney(dreamMaximum)}` : 'Maximum unavailable';
  if (els.currentRequestCeiling) els.currentRequestCeiling.textContent = hasMaximum ? `max ${maximumMoney(maximum)}` : 'Maximum unavailable';
  const catalogPricing = preview.model?.pricing;
  if (els.currentCostRates) {
    els.currentCostRates.textContent = catalogPricing?.prompt.valid && catalogPricing?.completion.valid
      ? `${formatRate(catalogPricing.prompt.value)} in · ${formatRate(catalogPricing.completion.value)} out`
      : 'Waiting for explicit OpenRouter prompt and completion pricing.';
  }
  if (els.dreamCost) {
    const evidenceCopy = preview.empirical?.kind === 'none' ? 'Cost unknown' : empiricalText;
    els.dreamCost.textContent = !currentModelId()
      ? ''
      : `${evidenceCopy}${hasDreamMaximum ? ` · max ${maximumMoney(dreamMaximum)}` : ''}`;
    els.dreamCost.title = !currentModelId()
      ? ''
      : `${empiricalText}${hasDreamMaximum ? ` · Maximum for this Dream ${maximumMoney(dreamMaximum)}` : ''}${hasMaximum ? ` · Initial request ${maximumMoney(maximum)}` : ''}`;
  }
  const syncInput = (input, value) => {
    if (input && documentRef?.activeElement !== input) input.value = value;
  };
  syncInput(els.perDreamInput, settings.perDream.toFixed(2));
  syncInput(els.sessionCapInput, settings.session.toFixed(2));
  syncInput(els.dailyCapInput, settings.daily.toFixed(2));
  syncInput(els.confirmAboveInput, settings.confirmAbove.toFixed(2));
  if (els.confirmExpensiveInput && documentRef?.activeElement !== els.confirmExpensiveInput) {
    els.confirmExpensiveInput.checked = settings.confirmExpensive;
  }
  renderLedger();
}

function openSpendDrawer() {
  spendReturnFocus = globalThis.HTMLElement && documentRef?.activeElement instanceof globalThis.HTMLElement
    ? documentRef.activeElement
    : null;
  documentRef?.querySelectorAll('.drawer.is-open').forEach(drawer => {
    if (drawer !== els.spendDrawer) drawer.inert = true;
  });
  els.spendDrawer?.classList.add('is-open');
  els.spendDrawer?.setAttribute('aria-hidden', 'false');
  if (els.spendDrawer) els.spendDrawer.inert = false;
  const stage = documentRef?.getElementById('stage');
  if (stage) stage.inert = true;
  if (els.drawerScrim) els.drawerScrim.hidden = false;
  documentRef?.body.classList.remove('ui-hidden');
  refreshKeyInfo();
  render();
  queueMicrotask(() => els.closeSpend?.focus());
}

function closeSpendDrawer() {
  els.spendDrawer?.classList.remove('is-open');
  els.spendDrawer?.setAttribute('aria-hidden', 'true');
  if (els.spendDrawer) els.spendDrawer.inert = true;
  documentRef?.querySelectorAll('.drawer.is-open').forEach(drawer => { drawer.inert = false; });
  if (els.drawerScrim && !documentRef?.querySelector('.drawer.is-open')) els.drawerScrim.hidden = true;
  const stage = documentRef?.getElementById('stage');
  if (stage && !documentRef?.querySelector('.drawer.is-open')) stage.inert = false;
  const target = spendReturnFocus?.isConnected ? spendReturnFocus : documentRef?.getElementById('modelButton');
  queueMicrotask(() => target?.focus());
  spendReturnFocus = null;
}

function saveSettingsFromUi() {
  settings.perDream = clampNumber(els.perDreamInput?.value, settings.perDream, 0.05, 100);
  settings.session = clampNumber(els.sessionCapInput?.value, settings.session, settings.perDream, 500);
  settings.daily = clampNumber(els.dailyCapInput?.value, settings.daily, settings.session, 2000);
  settings.confirmAbove = clampNumber(els.confirmAboveInput?.value, settings.confirmAbove, 0, settings.perDream);
  settings.confirmExpensive = Boolean(els.confirmExpensiveInput?.checked);
  writeJson(localStore, SETTINGS_STORAGE, settings);
  render();
  notice('Spend protection updated.');
  if (windowRef && typeof globalThis.CustomEvent === 'function') {
    windowRef.dispatchEvent(new globalThis.CustomEvent('visualizer:spend-settings-changed', { detail: { ...settings } }));
  }
}

function reasoningLabel(selection) {
  if (selection?.mode !== 'explicit' || !selection.effort) return 'Default';
  const effort = String(selection.effort);
  return `${effort[0].toUpperCase()}${effort.slice(1)}`;
}

function askCostConfirmation({ modelName, reasoningSelection, empirical, maximum, requestMaximum }) {
  const typical = empirical?.kind === 'none' ? 'Not enough data yet' : empirical.text;
  const reasoning = reasoningLabel(reasoningSelection);
  if (!els.confirmBackdrop) {
    return Promise.resolve(Boolean(windowRef?.confirm?.(
      `${modelName}\nReasoning: ${reasoning}\nTypical: ${typical}\nMaximum for this Dream: ${maximumMoney(maximum)}\nInitial request maximum: ${maximumMoney(requestMaximum)}\n\nContinue?`,
    )));
  }
  els.confirmModel.textContent = modelName;
  els.confirmEstimate.textContent = `Reasoning: ${reasoning} · Typical: ${typical}.`;
  els.confirmCap.textContent = `Maximum for this Dream, including one possible repair: ${maximumMoney(maximum)}. The initial request is capped at ${maximumMoney(requestMaximum)}.`;
  els.confirmContinue.textContent = `Dream up to ${maximumMoney(maximum)}`;
  const activeElement = globalThis.HTMLElement && documentRef?.activeElement instanceof globalThis.HTMLElement
    ? documentRef.activeElement
    : null;
  confirmationReturnFocus = activeElement && activeElement !== documentRef?.body
    ? activeElement
    : els.dreamButton;
  els.confirmBackdrop.hidden = false;
  return new Promise(resolve => {
    const focusable = () => [...els.confirmBackdrop.querySelectorAll(
      'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )].filter(element => !element.hidden);
    const finish = value => {
      els.confirmBackdrop.hidden = true;
      els.confirmContinue.onclick = null;
      els.confirmCancel.onclick = null;
      els.confirmBackdrop.removeEventListener('keydown', onKeyDown);
      els.confirmBackdrop.removeEventListener('click', onBackdropClick);
      els.confirmContinue.textContent = 'Dream';
      const target = confirmationReturnFocus?.isConnected ? confirmationReturnFocus : els.spendButton;
      confirmationReturnFocus = null;
      const restoreFocus = (attempt = 0) => {
        if (target?.disabled && attempt < 200) {
          setTimeout(() => restoreFocus(attempt + 1), 25);
          return;
        }
        target?.focus();
      };
      if (!value) setTimeout(restoreFocus, 0);
      else setTimeout(() => {
        const cancel = documentRef?.getElementById('dreamCancelButton');
        const progressTarget = cancel && !cancel.hidden
          ? cancel
          : documentRef?.getElementById('dreamJobPillButton');
        progressTarget?.focus();
      }, 0);
      resolve(value);
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const candidates = focusable();
      if (!candidates.length) {
        event.preventDefault();
        return;
      }
      const first = candidates[0];
      const last = candidates.at(-1);
      if (event.shiftKey && documentRef.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && documentRef.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onBackdropClick = event => {
      if (event.target === els.confirmBackdrop) finish(false);
    };
    els.confirmContinue.onclick = () => finish(true);
    els.confirmCancel.onclick = () => finish(false);
    els.confirmBackdrop.addEventListener('keydown', onKeyDown);
    els.confirmBackdrop.addEventListener('click', onBackdropClick);
    queueMicrotask(() => els.confirmCancel.focus());
  });
}

export function maximumDreamCostCeiling(envelope) {
  if (!envelope?.pricing || envelope.finalRequestCostCeiling == null) return null;
  if (envelope.free) return 0;
  const context = Number(envelope.contextCapacityTokens);
  const modelOutput = Number(envelope.modelCompletionCeiling);
  const inputRate = Number(envelope.pricing.prompt);
  const outputRate = Number(envelope.completionPriceCeiling);
  const requestFee = Number(envelope.pricing.request);
  if (![context, modelOutput, inputRate, outputRate, requestFee].every(Number.isFinite)) return null;
  const boundedOutput = Math.max(0, Math.min(context, modelOutput));
  const maximumSingleRepair = requestFee + (outputRate >= inputRate
    ? boundedOutput * outputRate + Math.max(0, context - boundedOutput) * inputRate
    : context * inputRate);
  return Math.min(
    Number(envelope.strictRemainingBudget),
    Number(envelope.finalRequestCostCeiling) + maximumSingleRepair,
  );
}

function isOpenRouterCompletion(input) {
  const url = typeof input === 'string' ? input : input?.url || '';
  return /^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions(?:\?|$)/.test(url);
}

function completionBody(init) {
  if (typeof init?.body !== 'string') return null;
  try { return JSON.parse(init.body); } catch { return null; }
}

function isRepairRequest(body) {
  return String(body?.messages?.[0]?.content || '').startsWith('Repair the visualizer');
}

function usageNumber(usage, paths) {
  for (const path of paths) {
    let value = usage;
    for (const key of path) value = value?.[key];
    if (value === '' || value === null || value === undefined) continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

export function calculateFallbackUsageCost(model, usage) {
  const normalized = normalizeCostGuardModel(model);
  if (!normalized.pricingKnown || !usage) return null;
  const promptTokens = usageNumber(usage, [['prompt_tokens'], ['promptTokens'], ['input_tokens'], ['inputTokens']]);
  const completionTokens = usageNumber(usage, [['completion_tokens'], ['completionTokens'], ['output_tokens'], ['outputTokens']]);
  if (promptTokens === null || completionTokens === null) return null;
  const reasoningTokens = usageNumber(usage, [
    ['reasoning_tokens'],
    ['reasoningTokens'],
    ['completion_tokens_details', 'reasoning_tokens'],
    ['completionTokensDetails', 'reasoningTokens'],
    ['output_tokens_details', 'reasoning_tokens'],
    ['outputTokensDetails', 'reasoningTokens'],
  ]) || 0;
  const pricing = normalized.pricing;
  return pricing.request.value
    + promptTokens * pricing.prompt.value
    + completionTokens * pricing.completion.value
    + reasoningTokens * pricing.internalReasoning.value;
}

function spendGuardError(code, message) {
  const error = new Error(message);
  error.name = 'SpendGuardError';
  error.code = code;
  return error;
}

function exactUsageCost(usage) {
  const raw = usage?.cost;
  if (raw === '' || raw === null || raw === undefined) return null;
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function upwardDecimal(value, scale = 1) {
  const number = Number(value) * scale;
  if (!Number.isFinite(number) || number < 0) return null;
  if (number === 0) return '0';
  const rounded = Math.ceil(number * 1e12) / 1e12;
  return rounded.toFixed(12).replace(/\.?0+$/, '');
}

function enforceProviderPriceCeiling(body, envelope) {
  const pricing = envelope?.pricing;
  if (!pricing) return;
  const maxPrice = {
    prompt: upwardDecimal(pricing.prompt, 1e6),
    completion: upwardDecimal(pricing.completion, 1e6),
    request: upwardDecimal(pricing.request),
  };
  if (Object.values(maxPrice).some(value => value === null)) return;
  body.provider = {
    ...(body.provider && typeof body.provider === 'object' ? body.provider : {}),
    require_parameters: true,
    max_price: maxPrice,
  };
}

async function executeGuardedCompletion(input, init, traceContext) {
  const body = completionBody(init);
  if (!body?.model) return nativeFetch(input, init);
  const requestPolicy = traceRequestPolicy(traceContext) || requestPolicyFromInit(init);
  const repair = requestPolicy?.attemptKind === 'repair' || isRepairRequest(body);
  const maxTokenParameter = owns(body, 'max_tokens')
    ? 'max_tokens'
    : owns(body, 'max_completion_tokens')
      ? 'max_completion_tokens'
      : requestPolicy?.maxTokenParameter || 'max_tokens';
  if (!repair) currentDreamSpent = 0;
  const policyModel = requestPolicy?.catalogModel || null;
  const model = normalizeCostGuardModel(policyModel || modelCatalog.get(body.model) || { id: body.model });
  if (policyModel) modelCatalog.set(body.model, model);
  const envelope = calculateCostGuardEnvelope({
    model,
    messages: body.messages,
    maxTokens: owns(body, maxTokenParameter) ? body[maxTokenParameter] : undefined,
    remainingBudgets: remainingBudgets(),
    reasoningSelection: requestPolicy?.appliedReasoningSelection || null,
  });
  captureRequestPolicy(traceContext, {
    generationEnvelopeVersion: envelope.schema,
    finalMaxTokens: envelope.finalMaxTokens,
    finalRequestCostCeiling: envelope.finalRequestCostCeiling,
    qualityDowngradeApplied: false,
    envelope: {
      schema: envelope.schema,
      safetyFactor: envelope.safetyFactor,
      minimumPracticalCompletionTokens: envelope.minimumPracticalCompletionTokens,
      minimumPracticalCompletionTokensForRequest: envelope.minimumPracticalCompletionTokensForRequest,
      practicalReasoningEffort: envelope.practicalReasoningEffort,
      qualityFloorBasis: envelope.qualityFloorBasis,
      practicalEnvelopeConstraint: envelope.practicalEnvelopeConstraint,
      conservativePromptTokens: envelope.conservativePromptTokens,
      modelCompletionCeiling: envelope.modelCompletionCeiling,
      contextCompletionCeiling: envelope.contextCompletionCeiling,
      rootMaxTokensCeiling: envelope.rootMaxTokensCeiling,
      remainingBudgets: envelope.remainingBudgets,
      finalMaxTokens: envelope.finalMaxTokens,
      finalRequestCostCeiling: envelope.finalRequestCostCeiling,
      pricing: envelope.pricing,
      reasons: envelope.reasons,
    },
  });
  if (!envelope.canDispatch) {
    if (envelope.insufficientPracticalEnvelope) {
      const selection = requestPolicy?.appliedReasoningSelection;
      const reasoning = reasoningLabel(selection);
      const budgetLimited = envelope.practicalEnvelopeConstraint === 'PRACTICAL_AFFORDABILITY_LIMIT';
      const message = budgetLimited
        ? `This model may need more generation room for a full-quality Dream. ${reasoning} reasoning is still selected, and no request was sent. Open Spend protection to raise the current ${money(envelope.strictRemainingBudget)} protected maximum.`
        : `This model's current completion limit cannot leave enough artifact room for ${reasoning} reasoning. No request was sent. Choose another supported reasoning level or another model.`;
      notice(message, 7600);
      throw spendGuardError(budgetLimited ? 'INSUFFICIENT_PRACTICAL_ENVELOPE' : 'MODEL_GENERATION_ENVELOPE_TOO_SMALL', message);
    }
    const pricingUnknown = envelope.pricingStatus !== 'known';
    const message = pricingUnknown
      ? 'OpenRouter did not publish explicit valid prompt and completion pricing for this model. Spend protection blocked the Dream before sending.'
      : 'Spend protection could not establish a safe model, context, and budget envelope. No request was sent.';
    notice(message, 7600);
    throw spendGuardError(pricingUnknown ? 'PRICING_UNKNOWN' : 'GENERATION_ENVELOPE_UNAVAILABLE', message);
  }
  const requestCeiling = envelope.finalRequestCostCeiling;
  const dreamCeiling = maximumDreamCostCeiling(envelope);
  captureRequestPolicy(traceContext, { dreamCostCeiling: dreamCeiling });
  const requestSelection = requestPolicy?.appliedReasoningSelection || null;
  const requestEmpirical = empiricalPreviewForRequest(model, requestSelection, requestPolicy);
  if (!repair && settings.confirmExpensive && dreamCeiling > settings.confirmAbove) {
    const approved = await askCostConfirmation({
      modelName: model.name,
      reasoningSelection: requestSelection,
      empirical: requestEmpirical,
      maximum: dreamCeiling,
      requestMaximum: requestCeiling,
    });
    if (!approved) throw spendGuardError('CANCELLED', 'Dream cancelled before spending anything.');
  }
  if (init?.signal?.aborted) throw new DOMException('Dream cancelled before spending anything.', 'AbortError');
  body[maxTokenParameter] = envelope.finalMaxTokens;
  body.usage = { ...(typeof body.usage === 'object' ? body.usage : {}), include: true };
  enforceProviderPriceCeiling(body, envelope);
  const serializedBody = JSON.stringify(body);
  captureFinalRequest(traceContext, {
    method: init?.method || 'POST',
    endpoint: 'openrouter.chat.completions',
    url: typeof input === 'string' ? input : input?.url || '',
    headers: init?.headers || {},
    body,
    serializedBody,
  });
  // Keep the private trace symbols through the lifecycle wrapper. That wrapper
  // owns the final strip immediately before native browser transport.
  const nextInit = { ...init, body: serializedBody };
  const reservationId = reserveCost({ modelId: body.model, ceiling: requestCeiling, repair });
  captureRequestDispatched(traceContext);
  const response = await nativeFetch(input, nextInit);
  if (response.ok) {
    try {
      const payload = await response.clone().json();
      const usage = payload?.usage || null;
      const exact = exactUsageCost(usage);
      const fallback = calculateFallbackUsageCost(model, usage);
      const cost = exact ?? fallback;
      if (Number.isFinite(cost)) reconcileReservedCost(reservationId, { cost, usage, estimated: exact === null });
    } catch {
      // Missing usage metadata must not turn a successful provider response into a retry.
    }
  }
  return response;
}

async function guardedCompletion(input, init) {
  const traceContext = traceContextFromInit(init);
  const execute = async () => {
    try {
      return await executeGuardedCompletion(input, init, traceContext);
    } catch (error) {
      captureTraceError(traceContext, error, { stage: 'spend-guard-or-transport' });
      throw error;
    }
  };
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return execute();
  return locks.request(SPEND_LOCK_NAME, {
    mode: 'exclusive',
    ...(init?.signal ? { signal: init.signal } : {}),
  }, execute);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function publicPreview() {
  const preview = selectedPreview();
  return deepFreeze(typeof structuredClone === 'function' ? structuredClone(preview) : JSON.parse(JSON.stringify(preview)));
}

function publicSettings() {
  return Object.freeze({ ...settings });
}

function publicTheoreticalModelCeilings() {
  const profile = loadPromptProfile(localStore);
  const messages = buildGenerationMessages(profile);
  return deepFreeze([...modelCatalog.values()].map(model => {
    const envelope = calculateCostGuardEnvelope({
      model,
      messages,
      remainingBudgets: {
        perDream: Number.POSITIVE_INFINITY,
        session: Number.POSITIVE_INFINITY,
        daily: Number.POSITIVE_INFINITY,
        provider: Number.POSITIVE_INFINITY,
      },
      safetyFactor: 1,
    });
    return {
      modelId: model.id,
      modelName: model.name,
      modelCompletionTokens: envelope.modelCompletionCeiling,
      theoreticalModelCeiling: envelope.theoreticalModelCeiling,
      pricingStatus: envelope.pricingStatus,
      isPrediction: false,
      consumerVisible: false,
    };
  }));
}

function installBrowserIntegration() {
  if (!windowRef || !nativeFetch) return;
  windowRef.fetch = function spendGuardedFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (isOpenRouterCompletion(input)) return guardedCompletion(input, init);
    const result = nativeFetch(input, init);
    if (/^https:\/\/openrouter\.ai\/api\/v1\/models(?:\?|$)/.test(url)) {
      result.then(response => response.clone().json().then(ingestModels).catch(() => {})).catch(() => {});
    }
    return result;
  };

  els.spendButton?.addEventListener('click', openSpendDrawer);
  els.closeSpend?.addEventListener('click', closeSpendDrawer);
  els.drawerScrim?.addEventListener('click', event => {
    if (!els.spendDrawer?.classList.contains('is-open')) return;
    event.stopImmediatePropagation();
    closeSpendDrawer();
  });
  windowRef.addEventListener('keydown', event => {
    if (event.key === 'Escape' && els.spendDrawer?.classList.contains('is-open')) closeSpendDrawer();
  });
  for (const input of [els.perDreamInput, els.sessionCapInput, els.dailyCapInput, els.confirmAboveInput, els.confirmExpensiveInput]) {
    input?.addEventListener('change', saveSettingsFromUi);
  }
  if (els.selectedModelName && typeof globalThis.MutationObserver === 'function') {
    new MutationObserver(render).observe(els.selectedModelName, { childList: true, subtree: true, characterData: true });
  }

  for (const eventName of [
    'visualizer:selected-model-changed',
    'visualizer:model-selected',
    'visualizer:prompt-profile-changed',
    'visualizer:reasoning-selection-changed',
    'visualizer:reasoning-selection-stale',
    'visualizer:model-fit-evidence-changed',
    'visualizer:model-fit-evidence',
    'visualizer:spend-settings-changed',
  ]) windowRef.addEventListener(eventName, render);
  windowRef.addEventListener('visualizer:model-catalog-updated', event => ingestModels(event.detail));

  windowRef.addEventListener('storage', event => {
    if (event.key === SETTINGS_STORAGE) {
      settings = { ...DEFAULTS, ...readJson(localStore, SETTINGS_STORAGE, {}) };
      settings.perDream = clampNumber(settings.perDream, DEFAULTS.perDream, 0.05, 100);
      settings.session = clampNumber(settings.session, DEFAULTS.session, settings.perDream, 500);
      settings.daily = clampNumber(settings.daily, DEFAULTS.daily, settings.session, 2000);
      settings.confirmAbove = clampNumber(settings.confirmAbove, DEFAULTS.confirmAbove, 0, settings.perDream);
      settings.confirmExpensive = settings.confirmExpensive !== false;
    }
    if (event.key === DAILY_SPEND_STORAGE) {
      daily = readJson(localStore, DAILY_SPEND_STORAGE, daily);
      if (daily.date !== todayKey()) daily = { date: todayKey(), spent: 0 };
    }
    if (
      event.key === SELECTED_MODEL_STORAGE
      || event.key === SETTINGS_STORAGE
      || event.key === DAILY_SPEND_STORAGE
      || event.key === MODEL_FIT_STORAGE_KEY
      || String(event.key || '').startsWith(REASONING_SELECTION_STORAGE_PREFIX)
      || event.key === PROMPT_STORAGE_KEY
    ) render();
  });

  windowRef.setInterval(() => {
    const key = sessionStore.getItem(OPENROUTER_KEY_STORAGE) || '';
    if (key !== lastKey) refreshKeyInfo();
  }, 1200);

  const api = {};
  Object.defineProperties(api, {
    version: { enumerable: true, value: COST_GUARD_VERSION },
    currentPreview: { enumerable: true, get: publicPreview },
    settings: { enumerable: true, get: publicSettings },
    getCurrentPreview: { enumerable: true, value: publicPreview },
    getSettings: { enumerable: true, value: publicSettings },
    catalogUpdatedAt: { enumerable: true, get: () => catalogUpdatedAt },
    theoreticalModelCeilings: { enumerable: true, value: publicTheoreticalModelCeilings },
    openSpendProtection: { enumerable: true, value: openSpendDrawer },
  });
  windowRef.VIZ_COST_GUARD = Object.freeze(api);

  render();
  refreshKeyInfo();
}

installBrowserIntegration();
