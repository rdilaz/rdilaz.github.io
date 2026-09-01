import {
  captureFinalRequest,
  captureRequestDispatched,
  captureTraceError,
  traceContextFromInit,
} from './trace-bridge.js';

const nativeFetch = window.fetch.bind(window);

const OPENROUTER_KEY_STORAGE = 'ai-visualizer.openrouter.key';
const SETTINGS_STORAGE = 'ai-visualizer.spend.settings.v1';
const SESSION_SPEND_STORAGE = 'ai-visualizer.spend.session.v1';
const SESSION_LEDGER_STORAGE = 'ai-visualizer.spend.ledger.v1';
const DAILY_SPEND_STORAGE = 'ai-visualizer.spend.daily.v1';
const DEFAULTS = Object.freeze({ perDream: 0.75, session: 5, daily: 10, confirmAbove: 0.15, confirmExpensive: true });
const MIN_VISUALIZER_OUTPUT_TOKENS = 2200;
const TYPICAL_VISUALIZER_OUTPUT_TOKENS = 4500;
const MAX_LEDGER = 50;
const SAFETY_FACTOR = 0.9;

const money = (value) => {
  const number = Number(value || 0);
  if (number === 0) return '$0.00';
  if (number < 0.01) return '<$0.01';
  return `$${number.toFixed(2)}`;
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

let settings = { ...DEFAULTS, ...readJson(localStorage, SETTINGS_STORAGE, {}) };
settings.perDream = clampNumber(settings.perDream, DEFAULTS.perDream, 0.05, 100);
settings.session = clampNumber(settings.session, DEFAULTS.session, settings.perDream, 500);
settings.daily = clampNumber(settings.daily, DEFAULTS.daily, settings.session, 2000);
settings.confirmAbove = clampNumber(settings.confirmAbove, DEFAULTS.confirmAbove, 0, settings.perDream);
settings.confirmExpensive = settings.confirmExpensive !== false;

let sessionSpent = clampNumber(sessionStorage.getItem(SESSION_SPEND_STORAGE), 0, 0, 100000);
let ledger = readJson(sessionStorage, SESSION_LEDGER_STORAGE, []);
if (!Array.isArray(ledger)) ledger = [];
let daily = readJson(localStorage, DAILY_SPEND_STORAGE, { date: todayKey(), spent: 0 });
if (daily.date !== todayKey()) daily = { date: todayKey(), spent: 0 };
let modelCatalog = new Map();
let keyInfo = null;
let lastKey = '';
let currentDreamSpent = 0;
let keyRefreshTimer = 0;

const els = {
  spendButton: document.getElementById('spendButton'),
  spendButtonValue: document.getElementById('spendButtonValue'),
  spendDrawer: document.getElementById('spendDrawer'),
  drawerScrim: document.getElementById('drawerScrim'),
  closeSpend: document.getElementById('closeSpendDrawer'),
  billingSource: document.getElementById('billingSource'),
  dreamCapSummary: document.getElementById('dreamCapSummary'),
  sessionSpendSummary: document.getElementById('sessionSpendSummary'),
  dailySpendSummary: document.getElementById('dailySpendSummary'),
  keyBudgetSummary: document.getElementById('keyBudgetSummary'),
  keyBudgetCopy: document.getElementById('keyBudgetCopy'),
  currentCostModel: document.getElementById('currentCostModel'),
  currentCostTypical: document.getElementById('currentCostTypical'),
  currentCostCeiling: document.getElementById('currentCostCeiling'),
  currentCostRates: document.getElementById('currentCostRates'),
  perDreamInput: document.getElementById('perDreamInput'),
  sessionCapInput: document.getElementById('sessionCapInput'),
  dailyCapInput: document.getElementById('dailyCapInput'),
  confirmAboveInput: document.getElementById('confirmAboveInput'),
  confirmExpensiveInput: document.getElementById('confirmExpensiveInput'),
  spendLedger: document.getElementById('spendLedger'),
  selectedModelName: document.getElementById('selectedModelName'),
  dreamCost: document.getElementById('dreamCost'),
  toast: document.getElementById('toast'),
  confirmBackdrop: document.getElementById('costConfirmBackdrop'),
  confirmModel: document.getElementById('costConfirmModel'),
  confirmEstimate: document.getElementById('costConfirmEstimate'),
  confirmCap: document.getElementById('costConfirmCap'),
  confirmContinue: document.getElementById('costConfirmContinue'),
  confirmCancel: document.getElementById('costConfirmCancel'),
};

function currentModelId() {
  return localStorage.getItem('ai-visualizer.selected-model') || '';
}

function normalizePrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function ingestModels(payload) {
  const list = payload?.data;
  if (!Array.isArray(list)) return;
  modelCatalog = new Map(list.filter(model => model?.id).map(model => [model.id, {
    id: model.id,
    name: model.name || model.id,
    input: normalizePrice(model?.pricing?.prompt),
    output: normalizePrice(model?.pricing?.completion),
    request: normalizePrice(model?.pricing?.request),
  }]));
  render();
}

function estimatePromptTokens(messages) {
  const chars = (messages || []).reduce((sum, message) => sum + String(message?.content || '').length, 0);
  return Math.max(300, Math.ceil(chars / 3.7) + 180);
}

function estimateFor(modelId, messages = null, requestedMaxTokens = 14000) {
  const pricing = modelCatalog.get(modelId);
  if (!pricing) return { known: false, modelId, typical: null, ceiling: null, inputCost: 0, pricing: null };
  const promptTokens = messages ? estimatePromptTokens(messages) : 1450;
  const inputCost = pricing.request + promptTokens * pricing.input;
  if (!pricing.input && !pricing.output && !pricing.request) {
    return { known: true, free: true, modelId, pricing, promptTokens, inputCost: 0, typical: 0, ceiling: 0 };
  }
  const typical = inputCost + TYPICAL_VISUALIZER_OUTPUT_TOKENS * pricing.output;
  const ceiling = inputCost + requestedMaxTokens * pricing.output;
  return { known: true, free: false, modelId, pricing, promptTokens, inputCost, typical, ceiling };
}

function availableBudget() {
  const providerRemaining = keyInfo?.limit_remaining != null && Number.isFinite(Number(keyInfo.limit_remaining))
    ? Math.max(0, Number(keyInfo.limit_remaining))
    : Infinity;
  return Math.max(0, Math.min(
    settings.perDream - currentDreamSpent,
    settings.session - sessionSpent,
    settings.daily - daily.spent,
    providerRemaining,
  ));
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
  sessionStorage.setItem(SESSION_SPEND_STORAGE, String(sessionSpent));
  writeJson(sessionStorage, SESSION_LEDGER_STORAGE, ledger.slice(0, MAX_LEDGER));
  writeJson(localStorage, DAILY_SPEND_STORAGE, daily);
}

function recordCost({ modelId, cost, usage, repair, estimated = false }) {
  const amount = Number(cost);
  if (!Number.isFinite(amount) || amount < 0) return;
  currentDreamSpent += amount;
  sessionSpent += amount;
  if (daily.date !== todayKey()) daily = { date: todayKey(), spent: 0 };
  daily.spent += amount;
  ledger.unshift({
    at: Date.now(),
    modelId,
    modelName: modelCatalog.get(modelId)?.name || modelId,
    cost: amount,
    repair: Boolean(repair),
    estimated,
    promptTokens: usage?.prompt_tokens ?? usage?.promptTokens ?? null,
    completionTokens: usage?.completion_tokens ?? usage?.completionTokens ?? null,
  });
  ledger = ledger.slice(0, MAX_LEDGER);
  saveSpend();
  render();
  scheduleKeyRefresh();
}

async function refreshKeyInfo() {
  const key = sessionStorage.getItem(OPENROUTER_KEY_STORAGE) || '';
  lastKey = key;
  if (!key) {
    keyInfo = null;
    render();
    return;
  }
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

function selectedEstimate() {
  return estimateFor(currentModelId());
}

function renderLedger() {
  if (!els.spendLedger) return;
  els.spendLedger.replaceChildren();
  if (!ledger.length) {
    const empty = document.createElement('p');
    empty.className = 'spend-empty';
    empty.textContent = 'No paid Dreams in this browser session yet.';
    els.spendLedger.appendChild(empty);
    return;
  }
  ledger.slice(0, 12).forEach(entry => {
    const row = document.createElement('div');
    row.className = 'spend-ledger__row';
    const left = document.createElement('span');
    const right = document.createElement('strong');
    left.textContent = `${entry.repair ? 'Repair · ' : ''}${entry.modelName}`;
    right.textContent = `${entry.estimated ? '~' : ''}${money(entry.cost)}`;
    row.append(left, right);
    els.spendLedger.appendChild(row);
  });
}

function render() {
  const estimate = selectedEstimate();
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
  if (els.currentCostTypical) els.currentCostTypical.textContent = estimate.known ? (estimate.free ? 'Free' : `~${money(estimate.typical)} typical`) : 'Pricing unavailable';
  if (els.currentCostCeiling) els.currentCostCeiling.textContent = estimate.known ? (estimate.free ? '$0 request ceiling' : `${money(Math.min(settings.perDream, estimate.ceiling))} request ceiling`) : `${money(settings.perDream)} app cap`;
  if (els.currentCostRates) els.currentCostRates.textContent = estimate.pricing ? `${formatRate(estimate.pricing.input)} in · ${formatRate(estimate.pricing.output)} out` : 'Waiting for OpenRouter model pricing.';
  if (els.dreamCost) {
    els.dreamCost.textContent = !currentModelId() ? '' : estimate.known ? (estimate.free ? 'free' : `~${money(estimate.typical)}`) : 'cost ?';
    els.dreamCost.title = estimate.known && !estimate.free ? `Typical estimate ${money(estimate.typical)} · Dream app cap ${money(settings.perDream)} including repair` : '';
  }
  if (els.perDreamInput) els.perDreamInput.value = settings.perDream.toFixed(2);
  if (els.sessionCapInput) els.sessionCapInput.value = settings.session.toFixed(2);
  if (els.dailyCapInput) els.dailyCapInput.value = settings.daily.toFixed(2);
  if (els.confirmAboveInput) els.confirmAboveInput.value = settings.confirmAbove.toFixed(2);
  if (els.confirmExpensiveInput) els.confirmExpensiveInput.checked = settings.confirmExpensive;
  renderLedger();
}

function openSpendDrawer() {
  els.spendDrawer?.classList.add('is-open');
  els.spendDrawer?.setAttribute('aria-hidden', 'false');
  if (els.drawerScrim) els.drawerScrim.hidden = false;
  document.body.classList.remove('ui-hidden');
  refreshKeyInfo();
  render();
}

function closeSpendDrawer() {
  els.spendDrawer?.classList.remove('is-open');
  els.spendDrawer?.setAttribute('aria-hidden', 'true');
  if (els.drawerScrim && !document.querySelector('.drawer.is-open')) els.drawerScrim.hidden = true;
}

function saveSettingsFromUi() {
  settings.perDream = clampNumber(els.perDreamInput?.value, settings.perDream, 0.05, 100);
  settings.session = clampNumber(els.sessionCapInput?.value, settings.session, settings.perDream, 500);
  settings.daily = clampNumber(els.dailyCapInput?.value, settings.daily, settings.session, 2000);
  settings.confirmAbove = clampNumber(els.confirmAboveInput?.value, settings.confirmAbove, 0, settings.perDream);
  settings.confirmExpensive = Boolean(els.confirmExpensiveInput?.checked);
  writeJson(localStorage, SETTINGS_STORAGE, settings);
  render();
  notice('Spend protection updated.');
}

function askCostConfirmation({ modelName, typical, ceiling, cap }) {
  if (!els.confirmBackdrop) return Promise.resolve(window.confirm(`${modelName}\nTypical estimate: ${money(typical)}\nDream app cap: ${money(cap)}\n\nContinue?`));
  els.confirmModel.textContent = modelName;
  els.confirmEstimate.textContent = `Typical one-pass estimate ${money(typical)} · current request ceiling ${money(ceiling)}.`;
  els.confirmCap.textContent = `The Visualizer will constrain this Dream to the ${money(cap)} browser-side budget, including any automatic repair.`;
  els.confirmBackdrop.hidden = false;
  return new Promise(resolve => {
    const finish = value => {
      els.confirmBackdrop.hidden = true;
      els.confirmContinue.onclick = null;
      els.confirmCancel.onclick = null;
      resolve(value);
    };
    els.confirmContinue.onclick = () => finish(true);
    els.confirmCancel.onclick = () => finish(false);
  });
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

function fallbackUsageCost(body, usage) {
  const pricing = modelCatalog.get(body?.model);
  if (!pricing || !usage) return null;
  const promptTokens = Number(usage.prompt_tokens ?? usage.promptTokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? usage.completionTokens ?? 0);
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return null;
  return pricing.request + promptTokens * pricing.input + completionTokens * pricing.output;
}

async function executeGuardedCompletion(input, init, traceContext) {
  const body = completionBody(init);
  if (!body?.model) return nativeFetch(input, init);
  const repair = isRepairRequest(body);
  if (!repair) currentDreamSpent = 0;
  const pricingEstimate = estimateFor(body.model, body.messages, Number(body.max_tokens || 14000));
  if (!pricingEstimate.known) {
    notice('OpenRouter did not publish usable pricing for this model, so the spend guard blocked the Dream.', 6500);
    throw new Error('Pricing is unavailable for this model; choose a priced/free model or wait for its catalog pricing before spending.');
  }
  const remaining = availableBudget();
  if (remaining <= 0.0001) {
    notice('Spend cap reached. Open $ in the corner to adjust it.', 6500);
    throw new Error('Visualizer spend cap reached before this request.');
  }
  const originalMax = Math.max(MIN_VISUALIZER_OUTPUT_TOKENS, Number(body.max_tokens || 14000));
  let callBudget = remaining;
  if (!repair && !pricingEstimate.free) {
    const reserve = Math.min(0.20, remaining * 0.30);
    const minimumCost = pricingEstimate.inputCost + MIN_VISUALIZER_OUTPUT_TOKENS * pricingEstimate.pricing.output;
    if (remaining - reserve >= minimumCost) callBudget = remaining - reserve;
  }
  if (!pricingEstimate.free && pricingEstimate.inputCost > callBudget * SAFETY_FACTOR) {
    notice(`The prompt alone would exceed the remaining ${money(callBudget)} budget for this Dream. Raise the cap or choose another model.`, 7500);
    throw new Error(`Current spend cap is too low for the input cost of ${pricingEstimate.pricing.name}.`);
  }
  let allowedMax = originalMax;
  if (!pricingEstimate.free && pricingEstimate.pricing.output > 0) {
    allowedMax = Math.floor((callBudget * SAFETY_FACTOR - pricingEstimate.inputCost) / pricingEstimate.pricing.output);
    allowedMax = Math.min(originalMax, allowedMax);
    if (allowedMax < MIN_VISUALIZER_OUTPUT_TOKENS) {
      const required = pricingEstimate.inputCost + MIN_VISUALIZER_OUTPUT_TOKENS * pricingEstimate.pricing.output;
      notice(`This model needs roughly ${money(required)} just to allow a viable visualizer. Raise the Dream cap or choose another model.`, 7500);
      throw new Error(`Current ${money(settings.perDream)} Dream cap is too low for a viable response from ${pricingEstimate.pricing.name}.`);
    }
  }
  const requestCeiling = pricingEstimate.inputCost + allowedMax * pricingEstimate.pricing.output;
  if (!repair && settings.confirmExpensive && pricingEstimate.typical >= settings.confirmAbove) {
    const approved = await askCostConfirmation({ modelName: pricingEstimate.pricing.name, typical: Math.min(pricingEstimate.typical, requestCeiling), ceiling: requestCeiling, cap: settings.perDream });
    if (!approved) throw new Error('Dream cancelled before spending anything.');
  }
  body.max_tokens = allowedMax;
  body.usage = { ...(typeof body.usage === 'object' ? body.usage : {}), include: true };
  const serializedBody = JSON.stringify(body);
  captureFinalRequest(traceContext, {
    method: init?.method || 'POST',
    endpoint: 'openrouter.chat.completions',
    url: typeof input === 'string' ? input : input?.url || '',
    headers: init?.headers || {},
    body,
    serializedBody,
  });
  const nextInit = { ...init, body: serializedBody };
  captureRequestDispatched(traceContext);
  const response = await nativeFetch(input, nextInit);
  if (response.ok) {
    try {
      const payload = await response.clone().json();
      const usage = payload?.usage || null;
      const exact = Number(usage?.cost);
      const fallback = fallbackUsageCost(body, usage);
      const cost = Number.isFinite(exact) ? exact : fallback;
      if (Number.isFinite(cost)) recordCost({ modelId: body.model, cost, usage, repair, estimated: !Number.isFinite(exact) });
    } catch {
      // Missing usage metadata must not turn a successful provider response into a retry.
    }
  }
  return response;
}

async function guardedCompletion(input, init) {
  const traceContext = traceContextFromInit(init);
  try {
    return await executeGuardedCompletion(input, init, traceContext);
  } catch (error) {
    captureTraceError(traceContext, error, { stage: 'spend-guard-or-transport' });
    throw error;
  }
}

window.fetch = function spendGuardedFetch(input, init) {
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
els.drawerScrim?.addEventListener('click', closeSpendDrawer);
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && els.spendDrawer?.classList.contains('is-open')) closeSpendDrawer();
});
for (const input of [els.perDreamInput, els.sessionCapInput, els.dailyCapInput, els.confirmAboveInput, els.confirmExpensiveInput]) {
  input?.addEventListener('change', saveSettingsFromUi);
}
if (els.selectedModelName) new MutationObserver(render).observe(els.selectedModelName, { childList: true, subtree: true, characterData: true });

setInterval(() => {
  const key = sessionStorage.getItem(OPENROUTER_KEY_STORAGE) || '';
  if (key !== lastKey) refreshKeyInfo();
}, 1200);

render();
refreshKeyInfo();
