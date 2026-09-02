import { filterLiveDreamModels, isLiveDreamModel } from './model-eligibility.js';
import {
  MODEL_FIT_STATUSES,
  MODEL_FIT_STORAGE_KEY,
  createModelFitEvidenceStore,
} from './model-fit-evidence.js';
import { MODEL_PRODUCT_CATALOG } from './model-product-catalog.js';
import { GENERATION_ENVELOPE_VERSION } from './generation-envelope.js';
import { AUDIO_API_VERSION, PROMPT_VERSION, loadPromptProfile } from './prompt.js';
import { RELIABILITY_SCHEMA } from './reliability.js';

const $ = selector => document.querySelector(selector);
const els = {
  drawer: $('#modelDrawer'),
  guide: $('#modelGuidePicks')?.closest('.model-guide'),
  heading: $('#model-guide-heading'),
  intro: $('.model-guide__hero p'),
  picks: $('#modelGuidePicks'),
  surprise: $('#modelSurpriseButton'),
  browse: $('#browseAllModels'),
  count: $('#modelGuideCount'),
  allPanel: $('#allModelsPanel'),
  search: $('#modelSearch'),
  list: $('#modelList'),
  why: $('#modelGuideWhy'),
  whyDetails: $('#modelGuideWhy')?.closest('details'),
  whySummary: $('#modelGuideWhy')?.closest('details')?.querySelector('summary'),
};
const MODEL_ENDPOINT='https://openrouter.ai/api/v1/models';
const TYPICAL_PROMPT_TOKENS = 1450;
const TYPICAL_OUTPUT_TOKENS = 4500;
const EXPLORE_LABEL = 'Explore experimental models';
const RUNTIME_VERSION = 'visualizer-runtime-v1';

let rawModels = [];
let pickerModels = [];
let recommendations = [];
let catalogState = 'loading';
let consumerDisclosed = false;
let developerMode = developerModeEnabled();
let appCatalogReceived = false;

function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

const localStore = browserStorage();
const evidenceStore = createModelFitEvidenceStore({ storage: localStore });

function developerModeEnabled() {
  let queryEnabled = false;
  try {
    queryEnabled = new URLSearchParams(globalThis.location?.search || '').get('dev') === '1';
  } catch {
    // A missing or restricted location leaves body.dev-mode as the source of truth.
  }
  return queryEnabled || document.body?.classList.contains('dev-mode');
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function publishedNumber(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function providerFor(model) {
  return String(model?.provider || model?.id || '').split('/')[0] || 'model';
}

function typicalCost(model) {
  const pricing = model?.pricing || {};
  const prompt = publishedNumber(pricing.prompt);
  const completion = publishedNumber(pricing.completion);
  if (prompt == null || completion == null) return null;
  return (publishedNumber(pricing.request) || 0)
    + TYPICAL_PROMPT_TOKENS * prompt
    + TYPICAL_OUTPUT_TOKENS * completion;
}

function catalogRateLabel(model) {
  const prompt = publishedNumber(model?.pricing?.prompt);
  const completion = publishedNumber(model?.pricing?.completion);
  if (prompt === 0 && completion === 0) return 'free';
  if (completion == null) return 'price n/a';
  const perMillion = completion * 1e6;
  return `$${perMillion < 1 ? perMillion.toFixed(2) : perMillion.toFixed(perMillion < 10 ? 2 : 0)}/M out`;
}

function maxOutput(model) {
  return finiteNumber(
    model?.top_provider?.max_completion_tokens
      || model?.topProvider?.maxCompletionTokens
      || model?.maxCompletionTokens
      || model?.context_length
      || model?.contextLength,
  );
}

function specialized(model) {
  const text = `${model?.id || ''} ${model?.name || ''} ${model?.description || ''}`.toLowerCase();
  return /\b(embedding|rerank|moderation|translation|translator|finance-focused|speech-to-text|text-to-speech|tts\b|ocr\b|guard model)\b/.test(text);
}

function viableExperimentalModel(model) {
  if (!isLiveDreamModel(model) || String(model.id).startsWith('~') || specialized(model)) return false;
  const outputModalities = model?.architecture?.output_modalities || [];
  if (outputModalities.length && !outputModalities.includes('text')) return false;
  return maxOutput(model) >= 3500;
}

function designScore(model) {
  const arenas = model?.benchmarks?.design_arena || [];
  const wanted = new Set(['3d', 'dataviz', 'gamedev', 'uicomponent', 'website', 'codecategories', 'webapps', 'fullstack', 'agenticgamedev']);
  const elos = arenas
    .filter(item => wanted.has(String(item.category || '').toLowerCase()))
    .map(item => finiteNumber(item.elo))
    .filter(Boolean)
    .sort((a, b) => b - a)
    .slice(0, 4);
  if (!elos.length) return 0;
  return elos.reduce((sum, value) => sum + Math.max(0, value - 1000), 0) / elos.length;
}

function experimentalScore(model) {
  const analysis = model?.benchmarks?.artificial_analysis || {};
  const coding = finiteNumber(analysis.coding_index);
  const intelligence = finiteNumber(analysis.intelligence_index);
  const design = designScore(model);
  const description = String(model?.description || '').toLowerCase();
  let score = design * 2 + coding * 5 + intelligence * 1.5;
  if (/coding|software|web app|frontend|game|creative/.test(description)) score += 35;
  return score;
}

function isFastFamily(model) {
  return /\b(flash|turbo|spark|mini|fast|instant|lite)\b/i.test(`${model?.id || ''} ${model?.name || ''}`);
}

function sortExperimental(models) {
  return [...models].sort((a, b) => experimentalScore(b) - experimentalScore(a) || finiteNumber(b.created) - finiteNumber(a.created));
}

function chooseDistinct(candidates, used) {
  const pick = candidates.find(model => !used.has(model.id));
  if (pick) used.add(pick.id);
  return pick || null;
}

function catalogEntryId(entry) {
  if (typeof entry === 'string') return entry.trim();
  return String(entry?.modelId || entry?.id || '').trim();
}

function localModelEvidence() {
  try {
    const profile = loadPromptProfile(localStore);
    const envelopeMajor = Number(GENERATION_ENVELOPE_VERSION.match(/v(\d+)/)?.[1] || 0);
    const compatible = evidenceStore.snapshot().configurations.filter(entry => (
      entry.status === MODEL_FIT_STATUSES.PROVEN
      && entry.identity.promptProfileId === profile.id
      && entry.identity.promptVersion === PROMPT_VERSION
      && entry.identity.promptHash === profile.briefHash
      && entry.identity.generationEnvelopeMajorVersion === envelopeMajor
      && entry.identity.audioApiVersion === AUDIO_API_VERSION
      && entry.identity.reliabilityVersion === RELIABILITY_SCHEMA
      && entry.identity.runtimeVersion === RUNTIME_VERSION
    ));
    const byModel = new Map();
    compatible.forEach(entry => {
      const current = byModel.get(entry.identity.modelId);
      if (!current || Number(entry.aggregate.lastSuccessAt || 0) > Number(current.lastSuccessAt || 0)) {
        byModel.set(entry.identity.modelId, {
          modelId: entry.identity.modelId,
          status: MODEL_FIT_STATUSES.PROVEN,
          lastSuccessAt: entry.aggregate.lastSuccessAt,
        });
      }
    });
    return [...byModel.values()];
  } catch {
    return [];
  }
}

function buildRecommendations(models) {
  const liveById = new Map(
    models
      .filter(isLiveDreamModel)
      .map(model => [String(model.id || '').trim(), model])
      .filter(([id]) => id),
  );
  const catalogIds = [...new Set(MODEL_PRODUCT_CATALOG.map(catalogEntryId).filter(Boolean))];
  const localRows = localModelEvidence()
    .filter(row => row.status === MODEL_FIT_STATUSES.PROVEN && liveById.has(row.modelId))
    .sort((a, b) => finiteNumber(b.lastSuccessAt) - finiteNumber(a.lastSuccessAt) || a.modelId.localeCompare(b.modelId));
  const localIds = new Set(localRows.map(row => row.modelId));
  const orderedIds = [...catalogIds.filter(id => liveById.has(id)), ...localRows.map(row => row.modelId)];
  const used = new Set();

  return orderedIds.flatMap(id => {
    if (used.has(id)) return [];
    used.add(id);
    const fromCatalog = catalogIds.includes(id);
    const workedHere = localIds.has(id);
    let label = 'Recommended';
    let copy = 'This exact live model is listed in the product starting catalog.';
    if (workedHere && !fromCatalog) {
      label = 'Worked here before';
      copy = 'This exact live model has completed a visualizer successfully in this browser.';
    } else if (workedHere) {
      copy = 'This exact live model is listed in the product catalog and has completed successfully here.';
    }
    return [{
      kind: workedHere ? 'local' : 'catalog',
      icon: workedHere ? '✓' : '✦',
      label,
      copy,
      model: liveById.get(id),
    }];
  }).slice(0, 4);
}

function buildExperimentalSignals(models) {
  const strong = sortExperimental(models.filter(viableExperimentalModel));
  const used = new Set();
  const paid = strong.filter(model => typicalCost(model) != null && typicalCost(model) > 0);
  const free = strong.filter(model => typicalCost(model) === 0);
  const fast = strong.filter(model => {
    const cost = typicalCost(model);
    return isFastFamily(model) && cost != null && cost <= 0.25;
  });
  const value = paid.filter(model => typicalCost(model) <= 0.05);
  const result = [];

  const benchmarkPick = chooseDistinct(strong.filter(model => {
    const cost = typicalCost(model);
    return cost != null && cost <= 0.75;
  }), used);
  if (benchmarkPick) result.push({
    kind: 'experimental',
    icon: '✦',
    label: 'Visual + coding signal',
    copy: 'Ranks highly on available benchmark and catalog signals. It may not be verified here.',
    model: benchmarkPick,
  });

  const fastPick = chooseDistinct(fast, used);
  if (fastPick) result.push({
    kind: 'experimental',
    icon: '⚡',
    label: 'Fast-family signal',
    copy: 'A lower-cost fast-family discovery signal. It may not be verified here.',
    model: fastPick,
  });

  const valuePick = chooseDistinct(value, used);
  if (valuePick) result.push({
    kind: 'experimental',
    icon: '◎',
    label: 'Lower-cost signal',
    copy: 'A lower-cost option with stronger available catalog signals. It may not be verified here.',
    model: valuePick,
  });

  const freePick = chooseDistinct(free, used);
  if (freePick) result.push({
    kind: 'experimental',
    icon: '◌',
    label: 'Free experiment',
    copy: 'The current catalog price is zero. This model may not be verified here.',
    model: freePick,
  });

  while (result.length < 4) {
    const wildcard = chooseDistinct(strong.filter(model => {
      const cost = typicalCost(model);
      return cost != null && cost <= 0.35;
    }), used);
    if (!wildcard) break;
    result.push({
      kind: 'experimental',
      icon: '✧',
      label: 'Catalog signal',
      copy: 'Another automated discovery signal from the live catalog. It may not be verified here.',
      model: wildcard,
    });
  }
  return result;
}

function pickerCatalog() {
  if (pickerModels.length) return pickerModels;
  return [...rawModels].sort((a, b) => (
    providerFor(a).localeCompare(providerFor(b))
      || String(a.name || a.id).localeCompare(String(b.name || b.id))
  ));
}

function pickerSearchMatches(model, query) {
  return `${model?.name || model?.id || ''} ${model?.id || ''} ${providerFor(model)}`.toLowerCase().includes(query);
}

function exactPickerButton(model) {
  if (!els.list || !els.search) return null;
  const query = els.search.value.trim().toLowerCase();
  const visibleModels = pickerCatalog().filter(candidate => !query || pickerSearchMatches(candidate, query));
  const targetIndex = visibleModels.findIndex(candidate => candidate.id === model.id);
  if (targetIndex < 0) return null;
  const button = els.list.querySelectorAll('.model-option')[targetIndex];
  const renderedName = button?.querySelector('.model-option__name')?.textContent.trim();
  const renderedProvider = button?.querySelector('.model-option__provider')?.textContent.trim().toLowerCase();
  if (
    renderedName !== String(model.name || model.id).trim()
    || renderedProvider !== providerFor(model).toLowerCase()
  ) return null;
  return button;
}

function notify(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.hidden = true; }, 3600);
}

async function selectModel(model) {
  if (!els.search || !els.list || !model?.id) return;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    els.search.value = model.id;
    els.search.dispatchEvent(new Event('input', { bubbles: true }));
    const button = exactPickerButton(model);
    if (button) {
      button.click();
      queueMicrotask(() => {
        els.search.value = '';
        els.search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  notify('That exact model is no longer available for a live Dream. Try another model.');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function cardFor(recommendation) {
  const { model } = recommendation;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `model-pick model-pick--${recommendation.kind}`;
  button.dataset.modelId = model.id;
  button.innerHTML = `<span class="model-pick__top"><span class="model-pick__icon">${escapeHtml(recommendation.icon)}</span><span class="model-pick__price">${escapeHtml(catalogRateLabel(model))}</span></span><strong>${escapeHtml(recommendation.label)}</strong><span class="model-pick__model">${escapeHtml(model.name || model.id)}</span><small>${escapeHtml(recommendation.copy)}</small>`;
  button.addEventListener('click', () => { void selectModel(model); });
  return button;
}

function loadingMessage(copy) {
  const message = document.createElement('p');
  message.className = 'model-guide__loading';
  message.textContent = copy;
  return message;
}

function emptyRecommendations() {
  const empty = document.createElement('div');
  empty.className = 'model-guide__empty';
  const title = document.createElement('strong');
  title.textContent = catalogState === 'error' ? 'Recommendations could not be checked.' : 'No recommended models yet.';
  const copy = document.createElement('p');
  copy.textContent = catalogState === 'error'
    ? 'The live recommendation check failed. The app-owned model list may still be available below.'
    : 'No exact model in the live catalog is currently backed by the product starting list or a successful run in this browser.';
  empty.append(title, copy);
  return empty;
}

function createSupplementalUi() {
  if (!els.browse) return {};
  const caveat = document.createElement('p');
  caveat.className = 'model-guide__experimental-caveat';
  caveat.id = 'modelGuideExperimentalCaveat';
  els.browse.before(caveat);
  els.browse.setAttribute('aria-describedby', caveat.id);
  els.browse.setAttribute('aria-controls', 'modelGuideExperimentalSignals allModelsPanel');

  const section = document.createElement('section');
  section.className = 'model-guide__experimental';
  section.id = 'modelGuideExperimentalSignals';
  section.hidden = true;
  section.setAttribute('aria-labelledby', 'modelGuideExperimentalHeading');

  const head = document.createElement('div');
  head.className = 'model-guide__experimental-head';
  const heading = document.createElement('h4');
  heading.id = 'modelGuideExperimentalHeading';
  const note = document.createElement('p');
  head.append(heading, note);

  const grid = document.createElement('div');
  grid.className = 'model-guide__grid model-guide__grid--experimental';
  grid.setAttribute('aria-live', 'polite');
  section.append(head, grid);
  els.browse.after(section);
  return { caveat, section, heading, note, grid };
}

const supplemental = createSupplementalUi();

function renderRecommended() {
  if (!els.picks) return;
  recommendations = buildRecommendations(rawModels);
  els.picks.classList.toggle('model-guide__grid--empty', catalogState !== 'loading' && !recommendations.length);

  if (catalogState === 'loading') {
    els.picks.replaceChildren(loadingMessage('Checking the live catalog for grounded recommendations…'));
  } else if (!recommendations.length) {
    els.picks.replaceChildren(emptyRecommendations());
  } else {
    els.picks.replaceChildren(...recommendations.map(cardFor));
  }

  if (els.heading) els.heading.textContent = 'Recommended AIs';
  if (els.intro) {
    els.intro.textContent = recommendations.length
      ? 'Exact live choices backed by the product starting list or successful use in this browser.'
      : 'Nothing is promoted automatically. Experimental models remain available when you choose to explore.';
  }
  if (els.whySummary) els.whySummary.textContent = 'How recommendations work';
  if (els.why) {
    els.why.textContent = 'Rankings do not create recommendations. An exact model ID must be in the current eligible catalog and either in the static product starting list or backed by a successful visualizer run stored in this browser.';
  }
}

function renderExperimental() {
  if (!supplemental.grid || !supplemental.heading || !supplemental.note) return;
  supplemental.heading.textContent = developerMode ? 'Experimental catalog signals' : 'Experimental starting points';
  supplemental.note.textContent = 'Automated ordering uses available visual/design/coding signals, catalog metadata, price and recency. It is discovery, not verification.';

  if (catalogState === 'loading') {
    supplemental.grid.replaceChildren(loadingMessage('Loading experimental catalog signals…'));
    return;
  }
  if (catalogState === 'error') {
    supplemental.grid.replaceChildren(loadingMessage('Experimental signals could not load. Search the app catalog below if it is available.'));
    return;
  }

  const signals = buildExperimentalSignals(rawModels);
  supplemental.grid.replaceChildren(...signals.map(cardFor));
  if (!signals.length) {
    supplemental.grid.replaceChildren(loadingMessage('No experimental starting points are available from the current eligible catalog.'));
  }
}

function disclosureOpen() {
  return developerMode || consumerDisclosed;
}

function renderDisclosure({ focus = false } = {}) {
  const open = disclosureOpen();
  els.allPanel?.classList.toggle('is-open', open);
  els.browse?.setAttribute('aria-expanded', String(open));
  els.guide?.classList.toggle('is-experimental-open', open);
  els.guide?.classList.toggle('is-developer-discovery', developerMode);

  if (supplemental.section) supplemental.section.hidden = !open;
  if (supplemental.caveat) {
    supplemental.caveat.textContent = developerMode
      ? 'Developer view: the broad live eligible catalog is open. Any technical evidence shown by the app is local state, not approval.'
      : 'These live catalog models may not be verified for this visualizer.';
  }

  if (els.count) {
    els.count.textContent = catalogState === 'loading' ? '' : `${rawModels.length} live`;
  }
  if (els.browse) {
    const label = open
      ? (developerMode ? 'Experimental models are open' : 'Hide experimental models')
      : EXPLORE_LABEL;
    els.browse.replaceChildren(document.createTextNode(`${label} `), els.count || document.createElement('span'));
  }
  if (els.search) els.search.placeholder = developerMode ? 'Search eligible models…' : 'Search experimental models…';
  if (els.list) els.list.setAttribute('aria-label', developerMode ? 'Eligible live models' : 'Experimental live models');

  if (open) renderExperimental();
  else supplemental.grid?.replaceChildren();
  if (open && focus) setTimeout(() => els.search?.focus(), 30);
}

function render(options) {
  renderRecommended();
  renderDisclosure(options);
  const hasSurprisePool = recommendations.length || (disclosureOpen() && buildExperimentalSignals(rawModels).length);
  if (els.surprise) {
    els.surprise.hidden = catalogState !== 'loading' && !hasSurprisePool;
    els.surprise.disabled = catalogState === 'loading';
  }
}

function setBrowse(open, { focus = false } = {}) {
  if (!developerMode) consumerDisclosed = Boolean(open);
  render({ focus: open && focus });
}

async function surprise() {
  const pool = recommendations.length
    ? recommendations.map(recommendation => recommendation.model)
    : disclosureOpen() ? buildExperimentalSignals(rawModels).map(signal => signal.model) : [];
  if (!pool.length) {
    notify(catalogState === 'loading' ? 'The model catalog is still loading.' : `Use “${EXPLORE_LABEL}” to inspect the live catalog.`);
    return;
  }
  let current = '';
  try {
    current = localStore?.getItem('ai-visualizer.selected-model') || '';
  } catch {
    // Selection still works when browser storage is unavailable.
  }
  const choices = pool.filter(model => model.id !== current);
  const available = choices.length ? choices : pool;
  await selectModel(available[Math.floor(Math.random() * available.length)]);
}

function catalogArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.models)) return value.models;
  return Array.isArray(value?.data) ? value.data : [];
}

function ingestPickerCatalog(value) {
  pickerModels = filterLiveDreamModels(catalogArray(value));
  appCatalogReceived = true;
  const recoveredFromError = catalogState === 'error';
  rawModels = pickerModels;
  catalogState = 'ready';
  if (recoveredFromError && !developerMode) consumerDisclosed = false;
  render();
}

async function load() {
  try {
    const response = await fetch(MODEL_ENDPOINT, { cache: 'no-store' });
    if (!response.ok) throw new Error('Model catalog request failed.');
    const payload = await response.json();
    if (!appCatalogReceived) {
      rawModels = filterLiveDreamModels(catalogArray(payload));
      catalogState = 'ready';
    }
    render();
  } catch {
    if (!appCatalogReceived && !rawModels.length) {
      catalogState = 'error';
    }
    render();
  }
}

function syncDeveloperMode() {
  const next = developerModeEnabled();
  if (next === developerMode) return;
  developerMode = next;
  render();
}

els.surprise?.addEventListener('click', () => { void surprise(); });
els.browse?.addEventListener('click', () => {
  if (developerMode) renderDisclosure({ focus: true });
  else setBrowse(!consumerDisclosed, { focus: !consumerDisclosed });
});
els.search?.addEventListener('input', () => {
  if (els.search.value.trim() && !disclosureOpen()) setBrowse(true);
});

for (const eventName of ['visualizer:model-fit-evidence-changed', 'visualizer:model-fit-evidence']) {
  globalThis.addEventListener(eventName, () => render());
}
globalThis.addEventListener('visualizer:model-catalog-updated', event => ingestPickerCatalog(event.detail));
globalThis.addEventListener('visualizer:dev-mode-changed', syncDeveloperMode);
globalThis.addEventListener('popstate', syncDeveloperMode);
globalThis.addEventListener('storage', event => {
  if (event.key === MODEL_FIT_STORAGE_KEY) render();
});

if (typeof MutationObserver === 'function' && document.body) {
  new MutationObserver(syncDeveloperMode).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

if (typeof MutationObserver === 'function' && els.drawer) {
  let drawerWasOpen = els.drawer.classList.contains('is-open');
  new MutationObserver(() => {
    const drawerIsOpen = els.drawer.classList.contains('is-open');
    if (drawerIsOpen && !drawerWasOpen && !developerMode && !els.search?.value.trim()) {
      consumerDisclosed = false;
      render();
    }
    drawerWasOpen = drawerIsOpen;
  }).observe(els.drawer, { attributes: true, attributeFilter: ['class'] });
}

render();
void load();
