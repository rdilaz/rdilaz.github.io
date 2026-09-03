import {
  captureFinalRequest,
  captureRequestPolicy,
  captureRequestDispatched,
  captureTraceError,
  requestPolicyFromInit,
  traceCaptureIdentity,
  traceRequestPolicy,
  traceContextFromInit,
} from './trace-bridge.js';
import { registerCompletionAccounting } from './completion-accounting.js';
import { VISUALIZER_RUNTIME_VERSION } from './runtime-version.js';
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
export { VISUALIZER_RUNTIME_VERSION } from './runtime-version.js';

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
const SESSION_ID_STORAGE = 'ai-visualizer.spend.session-id.v1';
const RECONCILIATION_STORAGE = 'ai-visualizer.spend.reconciliation.v1';
const RECONCILIATION_SCHEMA = 'visualizer-spend-reconciliation-v1';
const DEFAULTS = Object.freeze({ perDream: 0.75, session: 5, daily: 10, confirmAbove: 0.15, confirmExpensive: true });
const MAX_LEDGER = 50;
const MAX_PENDING_RECONCILIATIONS = 50;
const MAX_SETTLED_RECONCILIATIONS = 25;
export const GENERATION_METADATA_RETRY_DELAYS_MS = Object.freeze([0, 1500, 5000, 15000, 30000, 60000]);
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
const todayKey = (date = new Date()) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const readJson = (storage, key, fallback) => {
  try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const writeJson = (storage, key, value) => storage.setItem(key, JSON.stringify(value));

function memoryStorage() {
  const values = new Map();
  return {
    persistent: false,
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
      persistent: true,
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

function randomId(prefix) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

let spendSessionId = String(sessionStore.getItem(SESSION_ID_STORAGE) || '').trim();
if (!spendSessionId) {
  spendSessionId = randomId('spend-session');
  sessionStore.setItem(SESSION_ID_STORAGE, spendSessionId);
}

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
let reconciliationJournal = readJson(localStore, RECONCILIATION_STORAGE, { schema: RECONCILIATION_SCHEMA, entries: [] });
if (reconciliationJournal?.schema !== RECONCILIATION_SCHEMA || !Array.isArray(reconciliationJournal.entries)) {
  reconciliationJournal = { schema: RECONCILIATION_SCHEMA, entries: [] };
}
const activeReconciliations = new Map();
let modelCatalog = new Map();
let keyInfo = null;
let lastKey = '';
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
  pendingSpendVerification: documentRef?.getElementById('pendingSpendVerification'),
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

function dreamSpend(traceId) {
  if (!traceId) return 0;
  return ledger.reduce((sum, entry) => entry?.traceId === traceId ? sum + Math.max(0, Number(entry.cost) || 0) : sum, 0);
}

function remainingBudgets({ newDream = false, traceId = '' } = {}) {
  refreshDailySpend();
  const providerRemaining = keyInfo?.limit_remaining != null && Number.isFinite(Number(keyInfo.limit_remaining))
    ? Math.max(0, Number(keyInfo.limit_remaining))
    : Infinity;
  return {
    perDream: Math.max(0, settings.perDream - (newDream ? 0 : dreamSpend(traceId))),
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

function persistedValue(storage, key, value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  storage.setItem(key, serialized);
  return storage.getItem(key) === serialized;
}

function saveSpend({ dailyChanged = false } = {}) {
  if (!dailyChanged) refreshDailySpend();
  const journalSaved = persistedValue(localStore, RECONCILIATION_STORAGE, reconciliationJournal);
  const dailySaved = persistedValue(localStore, DAILY_SPEND_STORAGE, daily);
  const sessionSaved = persistedValue(sessionStore, SESSION_SPEND_STORAGE, String(sessionSpent));
  const ledgerSaved = persistedValue(sessionStore, SESSION_LEDGER_STORAGE, ledger.slice(0, MAX_LEDGER));
  return journalSaved && dailySaved && sessionSaved && ledgerSaved;
}

function spendStateSnapshot() {
  return structuredClone({ sessionSpent, ledger, daily, reconciliationJournal });
}

function restoreSpendState(snapshot) {
  sessionSpent = snapshot.sessionSpent;
  ledger = snapshot.ledger;
  daily = snapshot.daily;
  reconciliationJournal = snapshot.reconciliationJournal;
  saveSpend({ dailyChanged: true });
}

function refreshReconciliationJournal() {
  const stored = readJson(localStore, RECONCILIATION_STORAGE, null);
  if (stored?.schema === RECONCILIATION_SCHEMA && Array.isArray(stored.entries)) {
    reconciliationJournal = stored;
  }
  return reconciliationJournal;
}

function compactReconciliationJournal(entries) {
  const pending = entries.filter(entry => entry?.state === 'pending');
  const settled = entries.filter(entry => entry?.state === 'settled').slice(0, MAX_SETTLED_RECONCILIATIONS);
  return { schema: RECONCILIATION_SCHEMA, entries: [...pending, ...settled] };
}

function adjustSessionSpend(amount) {
  sessionSpent = Math.max(0, sessionSpent + amount);
}

function adjustDailySpend(amount) {
  refreshDailySpend();
  daily.spent = Math.max(0, daily.spent + amount);
}

function reserveCost({ modelId, ceiling, repair, traceId = '', attemptId = '' }) {
  const amount = Number(ceiling);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  if (!localStore.persistent || !sessionStore.persistent) {
    throw spendGuardError('SPEND_RECONCILIATION_UNAVAILABLE', 'Spend protection cannot persist an authoritative reconciliation record. No request was sent.');
  }
  refreshReconciliationJournal();
  if (reconciliationJournal.entries.filter(entry => entry?.state === 'pending').length >= MAX_PENDING_RECONCILIATIONS) {
    throw spendGuardError('SPEND_RECONCILIATION_FULL', 'Spend protection has too many unresolved reservations to safely send another request. No request was sent.');
  }
  const id = randomId('reservation');
  const at = Date.now();
  const reservationDate = todayKey(new Date(at));
  sessionSpent = clampNumber(sessionStore.getItem(SESSION_SPEND_STORAGE), sessionSpent, 0, 100000);
  refreshDailySpend();
  const before = spendStateSnapshot();
  adjustSessionSpend(amount);
  adjustDailySpend(amount);
  ledger.unshift({
    id,
    at,
    modelId,
    modelName: modelCatalog.get(modelId)?.name || modelId,
    traceId,
    attemptId,
    cost: amount,
    repair: Boolean(repair),
    estimated: true,
    uncertain: true,
    promptTokens: null,
    completionTokens: null,
    providerGenerationId: '',
    reconciliationState: 'pending',
  });
  ledger = ledger.slice(0, MAX_LEDGER);
  reconciliationJournal = compactReconciliationJournal([{
    reservationId: id,
    state: 'pending',
    reservedAt: at,
    reservationDate,
    reservedCost: amount,
    sessionId: spendSessionId,
    sessionAdjustmentApplied: false,
    dailyAdjustmentApplied: false,
    providerGenerationId: '',
    attemptCount: 0,
    lastAttemptAt: null,
    lastResult: 'reserved',
    settlementSource: '',
    settledCost: null,
    settledAt: null,
  }, ...reconciliationJournal.entries.filter(entry => entry?.reservationId !== id)]);
  if (!saveSpend({ dailyChanged: true })) {
    restoreSpendState(before);
    throw spendGuardError('SPEND_RECONCILIATION_UNAVAILABLE', 'Spend protection could not persist the reservation safely. No request was sent.');
  }
  render();
  scheduleKeyRefresh();
  return id;
}

function updateLedgerSettlement(reservationId, { cost, usage, estimated, source, providerGenerationId }) {
  const entry = ledger.find(candidate => candidate.id === reservationId);
  if (!entry || !entry.uncertain) return false;
  entry.cost = cost;
  entry.estimated = Boolean(estimated);
  entry.uncertain = false;
  entry.promptTokens = usage?.prompt_tokens ?? usage?.promptTokens ?? null;
  entry.completionTokens = usage?.completion_tokens ?? usage?.completionTokens ?? null;
  entry.settlementSource = source;
  entry.providerGenerationId = providerGenerationId || usage?.providerGenerationId || entry.providerGenerationId || '';
  entry.reconciliationState = 'settled';
  entry.lastReconciliationResult = source;
  return true;
}

function applyJournalSettlement(entry, { cost, usage, estimated = false, source = 'stream-usage', providerGenerationId = '' }) {
  const amount = Number(cost);
  const reservedCost = Number(entry?.reservedCost);
  if (!entry || entry.state !== 'pending' || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(reservedCost) || reservedCost < 0) return false;
  const adjustment = amount - reservedCost;
  sessionSpent = clampNumber(sessionStore.getItem(SESSION_SPEND_STORAGE), sessionSpent, 0, 100000);
  refreshDailySpend();
  const before = spendStateSnapshot();
  const ledgerEntry = ledger.find(candidate => candidate?.id === entry.reservationId);
  if (entry.sessionId === spendSessionId && (ledgerEntry?.uncertain === true || (!ledgerEntry && entry.sessionAdjustmentApplied !== true))) {
    adjustSessionSpend(adjustment);
    entry.sessionAdjustmentApplied = true;
    entry.sessionAdjustmentResult = 'applied';
  }
  if (entry.dailyAdjustmentApplied !== true) {
    if (entry.reservationDate === todayKey() && daily.date === todayKey()) {
      adjustDailySpend(adjustment);
      entry.dailyAdjustmentResult = 'applied';
    } else {
      entry.dailyAdjustmentResult = 'skipped-old-day';
    }
    entry.dailyAdjustmentApplied = true;
  }
  entry.state = 'settled';
  entry.settledCost = amount;
  entry.estimated = Boolean(estimated);
  entry.settlementSource = source;
  entry.providerGenerationId = providerGenerationId || usage?.providerGenerationId || entry.providerGenerationId || '';
  entry.settledAt = Date.now();
  entry.lastResult = source;
  updateLedgerSettlement(entry.reservationId, {
    cost: amount,
    usage,
    estimated,
    source,
    providerGenerationId: entry.providerGenerationId,
  });
  reconciliationJournal = compactReconciliationJournal(reconciliationJournal.entries);
  if (!saveSpend({ dailyChanged: true })) {
    restoreSpendState(before);
    render();
    return false;
  }
  render();
  scheduleKeyRefresh();
  return true;
}

function reconcileReservedCost(reservationId, detail) {
  const amount = Number(detail?.cost);
  if (!Number.isFinite(amount) || amount < 0) return false;
  refreshReconciliationJournal();
  const journalEntry = reconciliationJournal.entries.find(entry => entry?.reservationId === reservationId);
  if (journalEntry) return applyJournalSettlement(journalEntry, detail);

  // Reservations created before this schema remain session-only and can still
  // settle from exact response usage without fabricating persistent identity.
  const legacyEntry = ledger.find(candidate => candidate.id === reservationId);
  if (!legacyEntry || !legacyEntry.uncertain) return false;
  sessionSpent = clampNumber(sessionStore.getItem(SESSION_SPEND_STORAGE), sessionSpent, 0, 100000);
  refreshDailySpend();
  const before = spendStateSnapshot();
  const adjustment = amount - Number(legacyEntry.cost || 0);
  adjustSessionSpend(adjustment);
  adjustDailySpend(adjustment);
  updateLedgerSettlement(reservationId, { ...detail, cost: amount });
  if (!saveSpend({ dailyChanged: true })) {
    restoreSpendState(before);
    render();
    return false;
  }
  render();
  scheduleKeyRefresh();
  return true;
}

async function withSpendLock(operation) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return operation();
  return locks.request(SPEND_LOCK_NAME, { mode: 'exclusive' }, operation);
}

function attachProviderGenerationId(reservationId, providerGenerationId) {
  const id = String(providerGenerationId || '').trim();
  if (!reservationId || !id) return false;
  refreshReconciliationJournal();
  const journalEntry = reconciliationJournal.entries.find(entry => entry?.reservationId === reservationId);
  const ledgerEntry = ledger.find(entry => entry?.id === reservationId);
  if (!journalEntry) {
    if (ledgerEntry && !ledgerEntry.providerGenerationId) {
      ledgerEntry.providerGenerationId = id;
      ledgerEntry.reconciliationState = 'pending';
      if (!saveSpend()) return false;
      render();
      return true;
    }
    return ledgerEntry?.providerGenerationId === id;
  }
  if (journalEntry.providerGenerationId && journalEntry.providerGenerationId !== id) {
    journalEntry.lastResult = 'generation-id-mismatch';
    journalEntry.updatedAt = Date.now();
    saveSpend();
    render();
    return false;
  }
  journalEntry.providerGenerationId = id;
  journalEntry.lastResult = journalEntry.lastResult === 'reserved' ? 'generation-id-linked' : journalEntry.lastResult;
  journalEntry.updatedAt = Date.now();
  if (ledgerEntry) {
    ledgerEntry.providerGenerationId = id;
    ledgerEntry.reconciliationState = 'pending';
    ledgerEntry.lastReconciliationResult = journalEntry.lastResult;
  }
  if (!saveSpend()) return false;
  render();
  return true;
}

function recordReconciliationResult(reservationId, result, { attempted = false } = {}) {
  refreshReconciliationJournal();
  const entry = reconciliationJournal.entries.find(candidate => candidate?.reservationId === reservationId);
  if (!entry || entry.state !== 'pending') return false;
  const now = Date.now();
  if (attempted) {
    entry.attemptCount = Math.max(0, Number(entry.attemptCount) || 0) + 1;
    entry.lastAttemptAt = now;
  }
  entry.lastResult = String(result || 'unknown');
  entry.updatedAt = now;
  const ledgerEntry = ledger.find(candidate => candidate?.id === reservationId);
  if (ledgerEntry) {
    ledgerEntry.reconciliationAttempts = entry.attemptCount;
    ledgerEntry.lastReconciliationAt = entry.lastAttemptAt;
    ledgerEntry.lastReconciliationResult = entry.lastResult;
  }
  if (!saveSpend()) return false;
  render();
  return true;
}

export function usageFromGenerationMetadata(data, providerGenerationId) {
  const metadataNumber = value => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const promptTokens = metadataNumber(data?.tokens_prompt ?? data?.native_tokens_prompt);
  const completionTokens = metadataNumber(data?.tokens_completion ?? data?.native_tokens_completion);
  const reasoningTokens = metadataNumber(data?.native_tokens_reasoning);
  const totalTokens = promptTokens !== null && completionTokens !== null
    ? promptTokens + completionTokens
    : null;
  const costValue = data?.total_cost ?? (typeof data?.usage === 'number' ? data.usage : null);
  const cost = metadataNumber(costValue);
  return {
    ...(promptTokens !== null ? { prompt_tokens: promptTokens } : {}),
    ...(completionTokens !== null ? { completion_tokens: completionTokens } : {}),
    ...(totalTokens !== null ? { total_tokens: totalTokens } : {}),
    ...(reasoningTokens !== null ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } } : {}),
    ...(cost !== null && cost >= 0 ? { cost } : {}),
    providerGenerationId,
  };
}

export function authoritativeGenerationMetadata(payload, expectedGenerationId) {
  const id = String(expectedGenerationId || '').trim();
  if (!id || String(payload?.data?.id || '') !== id) {
    return { accepted: false, reason: 'metadata-generation-id-mismatch', usage: null, cost: null };
  }
  const usage = usageFromGenerationMetadata(payload.data, id);
  const cost = exactUsageCost(usage);
  if (!Number.isFinite(cost)) return { accepted: false, reason: 'metadata-cost-unavailable', usage, cost: null };
  return { accepted: true, reason: 'generation-metadata', usage, cost };
}

export function qualifiesForDocumentedTerminal429(evidence = {}) {
  return Number(evidence.status) === 429
    && evidence.responseParsed === true
    && !String(evidence.providerGenerationId || '').trim()
    && evidence.usagePresent === false
    && Number(evidence.contentBytes) === 0
    && Number(evidence.reasoningBytes) === 0
    && evidence.partialArtifact === false
    && evidence.terminal === true
    && evidence.cancelled === false
    && evidence.timedOut === false
    && evidence.auxiliaryServices === false;
}

export async function runBoundedGenerationReconciliation({
  delays = GENERATION_METADATA_RETRY_DELAYS_MS,
  wait = delay => new Promise(resolve => setTimeout(resolve, delay)),
  attempt,
} = {}) {
  const schedule = Array.isArray(delays) ? delays.filter(delay => Number.isFinite(Number(delay)) && Number(delay) >= 0) : [];
  if (typeof attempt !== 'function' || schedule.length === 0) return { settled: false, reason: 'invalid-reconciliation-schedule', attempts: 0 };
  let attempts = 0;
  let last = { settled: false, reason: 'not-attempted' };
  for (const delay of schedule) {
    if (Number(delay) > 0) await wait(Number(delay));
    attempts += 1;
    last = await attempt(attempts);
    if (last?.settled === true || last?.terminal === true) return { ...last, attempts };
  }
  return { ...last, settled: false, reason: last?.reason || 'metadata-retries-exhausted', attempts };
}

async function generationMetadataAttempt(reservationId, providerGenerationId) {
  const id = String(providerGenerationId || '').trim();
  if (!reservationId || !id || !nativeFetch) return { settled: false, reason: 'missing-generation-id' };
  const pending = refreshReconciliationJournal().entries.find(entry => entry?.reservationId === reservationId);
  if (!pending || pending.state !== 'pending') return { settled: false, reason: 'already-settled', terminal: true };
  if (String(pending.providerGenerationId || '') !== id) return { settled: false, reason: 'generation-id-changed', terminal: true };
  const key = sessionStore.getItem(OPENROUTER_KEY_STORAGE) || '';
  if (!key) {
    await withSpendLock(() => recordReconciliationResult(reservationId, 'missing-key'));
    return { settled: false, reason: 'missing-key', terminal: true };
  }
  await withSpendLock(() => recordReconciliationResult(reservationId, 'metadata-requesting', { attempted: true }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await nativeFetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      const reason = `metadata-http-${response.status}`;
      await withSpendLock(() => recordReconciliationResult(reservationId, reason));
      return { settled: false, reason };
    }
    const payload = await response.json().catch(() => null);
    const authoritative = authoritativeGenerationMetadata(payload, id);
    if (!authoritative.accepted) {
      await withSpendLock(() => recordReconciliationResult(reservationId, authoritative.reason));
      return { settled: false, reason: authoritative.reason, terminal: authoritative.reason === 'metadata-generation-id-mismatch' };
    }
    const { usage, cost: exact } = authoritative;
    const settled = await withSpendLock(() => reconcileReservedCost(reservationId, {
      cost: exact,
      usage,
      estimated: false,
      source: 'generation-metadata',
      providerGenerationId: id,
    }));
    if (settled) {
      windowRef?.dispatchEvent(new CustomEvent('visualizer:generation-reconciled', {
        detail: {
          providerGenerationId: id,
          cost: exact,
          finishReason: payload?.data?.finish_reason || null,
          model: payload?.data?.model || '',
          provider: payload?.data?.provider_name || '',
        },
      }));
    }
    return { settled: Boolean(settled), source: 'generation-metadata', terminal: true };
  } catch {
    await withSpendLock(() => recordReconciliationResult(reservationId, 'metadata-fetch-failed'));
    return { settled: false, reason: 'metadata-fetch-failed' };
  } finally {
    clearTimeout(timeout);
  }
}

function reconcileGenerationMetadata(reservationId, providerGenerationId) {
  const id = String(providerGenerationId || '').trim();
  if (!reservationId || !id) return Promise.resolve({ settled: false, reason: 'missing-generation-id' });
  const active = activeReconciliations.get(reservationId);
  if (active) return active;
  const reconciliation = runBoundedGenerationReconciliation({
    attempt: () => generationMetadataAttempt(reservationId, id),
  }).finally(() => activeReconciliations.delete(reservationId));
  activeReconciliations.set(reservationId, reconciliation);
  return reconciliation;
}

async function settleDocumentedTerminal429(reservationId, evidence) {
  if (!qualifiesForDocumentedTerminal429(evidence)) {
    await withSpendLock(() => recordReconciliationResult(reservationId, 'terminal-evidence-remains-uncertain'));
    return { settled: false, reason: 'terminal-evidence-remains-uncertain' };
  }
  const settled = await withSpendLock(() => reconcileReservedCost(reservationId, {
    cost: 0,
    usage: null,
    estimated: false,
    source: 'documented-terminal-429-no-generation',
    providerGenerationId: '',
  }));
  return { settled: Boolean(settled), source: 'documented-terminal-429-no-generation' };
}

function applyOutstandingSettledCorrections() {
  refreshReconciliationJournal();
  sessionSpent = clampNumber(sessionStore.getItem(SESSION_SPEND_STORAGE), sessionSpent, 0, 100000);
  refreshDailySpend();
  const before = spendStateSnapshot();
  let changed = false;
  for (const entry of reconciliationJournal.entries) {
    if (entry?.state !== 'settled') continue;
    const settledCost = Number(entry.settledCost);
    const reservedCost = Number(entry.reservedCost);
    if (!Number.isFinite(settledCost) || settledCost < 0 || !Number.isFinite(reservedCost) || reservedCost < 0) continue;
    const adjustment = settledCost - reservedCost;
    const ledgerEntry = ledger.find(candidate => candidate?.id === entry.reservationId);
    if (entry.sessionId === spendSessionId && (ledgerEntry?.uncertain === true || (!ledgerEntry && entry.sessionAdjustmentApplied !== true))) {
      adjustSessionSpend(adjustment);
      entry.sessionAdjustmentApplied = true;
      entry.sessionAdjustmentResult = 'applied-after-reload';
      changed = true;
    }
    if (entry.dailyAdjustmentApplied !== true) {
      if (entry.reservationDate === todayKey() && daily.date === todayKey()) {
        adjustDailySpend(adjustment);
        entry.dailyAdjustmentResult = 'applied-after-reload';
      } else {
        entry.dailyAdjustmentResult = 'skipped-old-day';
      }
      entry.dailyAdjustmentApplied = true;
      changed = true;
    }
    const ledgerChanged = updateLedgerSettlement(entry.reservationId, {
      cost: settledCost,
      usage: null,
      estimated: entry.estimated === true,
      source: entry.settlementSource || 'generation-metadata',
      providerGenerationId: entry.providerGenerationId || '',
    });
    changed ||= ledgerChanged;
  }
  if (changed && !saveSpend({ dailyChanged: true })) {
    restoreSpendState(before);
    return false;
  }
  return changed;
}

async function reconcilePendingReservations() {
  await withSpendLock(applyOutstandingSettledCorrections);
  refreshReconciliationJournal();
  const pending = reconciliationJournal.entries
    .filter(entry => entry?.state === 'pending' && String(entry.providerGenerationId || '').trim())
    .map(entry => ({ reservationId: entry.reservationId, providerGenerationId: entry.providerGenerationId }));
  return Promise.allSettled(pending.map(entry => reconcileGenerationMetadata(entry.reservationId, entry.providerGenerationId)));
}

function safeGenerationId(value) {
  const id = String(value || '').trim().slice(0, 180);
  return /^[a-zA-Z0-9._:-]+$/.test(id) ? id : '';
}

function reconciliationDiagnostics() {
  refreshReconciliationJournal();
  const journalIds = new Set(reconciliationJournal.entries.map(entry => entry?.reservationId));
  const entries = reconciliationJournal.entries
    .filter(entry => entry?.state === 'pending')
    .map(entry => ({
      reservationId: String(entry.reservationId || ''),
      reservedAmount: Math.max(0, Number(entry.reservedCost) || 0),
      reservationDate: String(entry.reservationDate || ''),
      providerGenerationId: safeGenerationId(entry.providerGenerationId),
      attemptCount: Math.max(0, Number(entry.attemptCount) || 0),
      lastAttemptAt: Number(entry.lastAttemptAt) || null,
      lastResult: String(entry.lastResult || ''),
      settlementSource: String(entry.settlementSource || ''),
    }));
  for (const entry of ledger) {
    if (!entry?.uncertain || journalIds.has(entry.id)) continue;
    entries.push({
      reservationId: String(entry.id || ''),
      reservedAmount: Math.max(0, Number(entry.cost) || 0),
      reservationDate: '',
      providerGenerationId: safeGenerationId(entry.providerGenerationId),
      attemptCount: Math.max(0, Number(entry.reconciliationAttempts) || 0),
      lastAttemptAt: Number(entry.lastReconciliationAt) || null,
      lastResult: String(entry.lastReconciliationResult || 'legacy-unlinked-reservation'),
      settlementSource: String(entry.settlementSource || ''),
    });
  }
  return deepFreeze({
    schema: RECONCILIATION_SCHEMA,
    pendingCount: entries.length,
    pendingReservedAmount: entries.reduce((sum, entry) => sum + entry.reservedAmount, 0),
    activeSweepCount: activeReconciliations.size,
    retryDelaysMs: [...GENERATION_METADATA_RETRY_DELAYS_MS],
    entries,
  });
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
  const pending = reconciliationDiagnostics();
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
  if (els.pendingSpendVerification) {
    els.pendingSpendVerification.hidden = pending.pendingCount === 0;
    els.pendingSpendVerification.textContent = pending.pendingCount
      ? `Pending verification: ${maximumMoney(pending.pendingReservedAmount)} across ${pending.pendingCount} reservation${pending.pendingCount === 1 ? '' : 's'}.`
      : '';
  }
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
  void reconcilePendingReservations();
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

function requestUsesAuxiliaryServices(body) {
  return (Array.isArray(body?.plugins) && body.plugins.length > 0)
    || (Array.isArray(body?.tools) && body.tools.length > 0)
    || Boolean(body?.web_search_options);
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
  const traceIdentity = traceCaptureIdentity(traceContext) || {};
  const policyModel = requestPolicy?.catalogModel || null;
  const model = normalizeCostGuardModel(policyModel || modelCatalog.get(body.model) || { id: body.model });
  if (policyModel) modelCatalog.set(body.model, model);
  const envelope = calculateCostGuardEnvelope({
    model,
    messages: body.messages,
    maxTokens: owns(body, maxTokenParameter) ? body[maxTokenParameter] : undefined,
    remainingBudgets: remainingBudgets({ traceId: traceIdentity.traceId || '' }),
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
  const reservationId = reserveCost({
    modelId: body.model,
    ceiling: requestCeiling,
    repair,
    traceId: traceIdentity.traceId || '',
    attemptId: traceIdentity.attemptId || '',
  });
  if (reservationId) {
    registerCompletionAccounting(traceContext, {
      link({ providerGenerationId = '' } = {}) {
        return withSpendLock(() => attachProviderGenerationId(reservationId, providerGenerationId));
      },
      async settle({ usage, providerGenerationId = '' } = {}) {
        const exact = exactUsageCost(usage);
        const fallback = calculateFallbackUsageCost(model, usage);
        const cost = exact ?? fallback;
        if (!Number.isFinite(cost)) return { settled: false, reason: 'usage-cost-unavailable' };
        const usageWithId = usage && typeof usage === 'object'
          ? { ...usage, providerGenerationId }
          : { providerGenerationId };
        const settled = await withSpendLock(() => reconcileReservedCost(reservationId, {
          cost,
          usage: usageWithId,
          estimated: exact === null,
          source: exact === null ? 'stream-usage-estimate' : 'stream-usage',
        }));
        return { settled: Boolean(settled), estimated: exact === null };
      },
      async reconcile({ providerGenerationId = '', ...evidence } = {}) {
        const id = String(providerGenerationId || '').trim();
        if (id) {
          const linked = await withSpendLock(() => attachProviderGenerationId(reservationId, id));
          if (!linked) return { settled: false, reason: 'generation-id-link-failed' };
          return reconcileGenerationMetadata(reservationId, id);
        }
        return settleDocumentedTerminal429(reservationId, {
          ...evidence,
          providerGenerationId: '',
          auxiliaryServices: requestUsesAuxiliaryServices(body),
        });
      },
    });
  }
  captureRequestDispatched(traceContext);
  return nativeFetch(input, nextInit);
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
    if (event.key === RECONCILIATION_STORAGE) {
      refreshReconciliationJournal();
      void withSpendLock(applyOutstandingSettledCorrections).then(render);
    }
    if (
      event.key === SELECTED_MODEL_STORAGE
      || event.key === SETTINGS_STORAGE
      || event.key === DAILY_SPEND_STORAGE
      || event.key === RECONCILIATION_STORAGE
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
    reconciliation: { enumerable: true, get: reconciliationDiagnostics },
    reconcilePending: { enumerable: true, value: reconcilePendingReservations },
  });
  windowRef.VIZ_COST_GUARD = Object.freeze(api);

  render();
  refreshKeyInfo();
  void reconcilePendingReservations();
}

installBrowserIntegration();
