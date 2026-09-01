import { AudioEngine } from './audio-engine.js';
import { DEFAULT_VISUALIZER_HTML } from './default-visualizer.js';
import {
  beginOpenRouterAuth,
  consumeOpenRouterCallback,
  disconnectOpenRouter,
  fetchModels,
  generateVisualizer,
  getOpenRouterKey,
  isOpenRouterConnected,
  repairVisualizer,
} from './openrouter.js';
import { PROMPT_VERSION, AUDIO_API_VERSION } from './prompt.js';
import { VisualizerSandbox, validateVisualizerHtml } from './sandbox.js';
import { DreamReliabilityHarness, DreamReliabilityError, FAILURE_CODES } from './reliability.js';
import { GenerationStore, DiagnosticStore } from './storage.js';
import {
  addDiagnosticTimeline,
  applyProviderResult,
  copyText,
  createDiagnosticRecord,
  diagnosticForExport,
  diagnosticStatusLabel,
  diagnosticsForExport,
  downloadJson,
  finishDiagnostic,
  shortDiagnosticId,
} from './diagnostics.js';

const $ = selector => document.querySelector(selector);
const els = {
  stage: $('#stage'),
  frame: $('#visualizerFrame'),
  preflightFrame: $('#preflightFrame'),
  topStatus: $('#topStatus'),
  modelButton: $('#modelButton'),
  selectedModelName: $('#selectedModelName'),
  dreamButton: $('#dreamButton'),
  favoriteButton: $('#favoriteButton'),
  audioButton: $('#audioButton'),
  audioButtonLabel: $('#audioButtonLabel'),
  audioDot: $('#audioDot'),
  libraryButton: $('#libraryButton'),
  fullscreenButton: $('#fullscreenButton'),
  infoButton: $('#infoButton'),
  diagnosticsButton: $('#diagnosticsButton'),
  centerStatus: $('#centerStatus'),
  centerStatusTitle: $('#centerStatusTitle'),
  centerStatusDetail: $('#centerStatusDetail'),
  dreamCancelButton: $('#dreamCancelButton'),
  dreamProgress: $('#dreamStatusProgressFill'),
  dreamStatusLive: $('#dreamStatusLive'),
  dreamSteps: [...document.querySelectorAll('[data-dream-step]')],
  modelDrawer: $('#modelDrawer'),
  libraryDrawer: $('#libraryDrawer'),
  aboutDrawer: $('#aboutDrawer'),
  diagnosticsDrawer: $('#diagnosticsDrawer'),
  drawerScrim: $('#drawerScrim'),
  connectionTitle: $('#connectionTitle'),
  connectionCopy: $('#connectionCopy'),
  connectOpenRouterButton: $('#connectOpenRouterButton'),
  modelSearch: $('#modelSearch'),
  modelList: $('#modelList'),
  libraryList: $('#libraryList'),
  battleButton: $('#battleButton'),
  battlePanel: $('#battlePanel'),
  battleAButton: $('#battleAButton'),
  battleBButton: $('#battleBButton'),
  voteAButton: $('#voteAButton'),
  voteBButton: $('#voteBButton'),
  endBattleButton: $('#endBattleButton'),
  favoritesOnlyButton: $('#favoritesOnlyButton'),
  diagnosticsSummary: $('#diagnosticsSummary'),
  diagnosticsLive: $('#diagnosticsLive'),
  diagnosticsList: $('#diagnosticsList'),
  copyLatestDiagnostics: $('#copyLatestDiagnostics'),
  exportDiagnostics: $('#exportDiagnostics'),
  copyCurrentHtml: $('#copyCurrentHtml'),
  retestCurrent: $('#retestCurrent'),
  pickDiagnosticModel: $('#pickDiagnosticModel'),
  clearDiagnostics: $('#clearDiagnostics'),
  toast: $('#toast'),
};

const drawerElements = [els.modelDrawer, els.libraryDrawer, els.aboutDrawer, els.diagnosticsDrawer].filter(Boolean);
const store = await new GenerationStore().init();
const diagnosticStore = await new DiagnosticStore().init();
const audio = new AudioEngine(updateAudioState);

const sandboxA = new VisualizerSandbox(els.frame, message => handleSandboxEvent(sandboxA, message));
const sandboxB = new VisualizerSandbox(els.preflightFrame, message => handleSandboxEvent(sandboxB, message));
let activeSlot = { sandbox: sandboxA, frame: els.frame };
let standbySlot = { sandbox: sandboxB, frame: els.preflightFrame };
activeSlot.sandbox.setPresentation('active');
standbySlot.sandbox.setPresentation('standby');

let models = [];
let selectedModel = null;
let currentGeneration = null;
let currentHtml = DEFAULT_VISUALIZER_HTML;
let currentDiagnosticId = '';
let fallbackGeneration = null;
let fallbackHtml = DEFAULT_VISUALIZER_HTML;
let fallbackDiagnosticId = '';
let pointer = { x: 0.5, y: 0.5, active: false, down: false };
let lastHostFrame = 0;
let hideUiTimer = 0;
let toastTimer = 0;
let diagnosticsRenderTimer = 0;
let favoritesOnly = false;
let battle = null;
let wakeLock = null;
let generating = false;
let recovering = false;
let activeDreamController = null;
let promotion = null;
let devMode = false;
let runtimeRecoveryQueued = false;
const liveDiagnosticEvents = [];

function showToast(message, duration = 3600) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, duration);
}

function showCenter(title, detail = '') {
  els.centerStatusTitle.textContent = title;
  els.centerStatusDetail.textContent = detail;
  els.centerStatus.hidden = false;
}

function hideCenter() {
  els.centerStatus.hidden = true;
}


function setArtifactProgress(progress, currentStep, liveText = '') {
  if (els.dreamProgress) els.dreamProgress.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  els.dreamSteps.forEach((step, index) => {
    step.classList.toggle('is-done', index < currentStep);
    step.classList.toggle('is-current', index === currentStep);
  });
  if (liveText && els.dreamStatusLive) els.dreamStatusLive.textContent = liveText;
}

function humanTime(timestamp) {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : new Date(timestamp).toLocaleDateString();
}

function priceLabel(model) {
  if (!model) return '';
  const output = Number(model.outputPrice || 0) * 1e6;
  return output ? `$${output < 0.01 ? output.toFixed(3) : output.toFixed(2)}/M out` : '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

function currentViewport() {
  return {
    width: Math.max(1, els.stage.clientWidth || innerWidth),
    height: Math.max(1, els.stage.clientHeight || innerHeight),
    dpr: Math.min(devicePixelRatio || 1, 2),
  };
}

function updateConnectionUi() {
  const connected = isOpenRouterConnected();
  els.connectionTitle.textContent = connected ? 'OpenRouter connected' : 'Connect OpenRouter';
  els.connectionCopy.textContent = connected
    ? 'This key exists only for this browser session and is never exposed to generated visualizers.'
    : 'Authorize a session-only key to dream with hundreds of models.';
  els.connectOpenRouterButton.textContent = connected ? 'Disconnect' : 'Connect';
}

function updateAudioState(state) {
  const connected = Boolean(state.connected);
  els.audioDot.classList.toggle('is-live', connected);
  els.audioButtonLabel.textContent = connected ? 'Audio connected' : 'Connect audio';
  els.topStatus.textContent = connected ? 'Listening to shared device audio · local only' : 'Audio not connected';
  if (!connected && state.label) showToast(state.label);
}

function isFatalEvent(message) {
  return message?.type === 'diagnostic-event' && message.event?.severity === 'fatal';
}

function pushLiveDiagnostic(source, message) {
  if (!devMode) return;
  const event = message?.event || message?.heartbeat || message?.ready || null;
  if (!event && message?.type !== 'mode') return;
  liveDiagnosticEvents.push({
    at: Date.now(),
    source,
    type: message.type,
    value: event || { mode: message.mode },
  });
  if (liveDiagnosticEvents.length > 30) liveDiagnosticEvents.shift();
  scheduleDiagnosticsRender();
}

function handleSandboxEvent(sandbox, message) {
  const source = sandbox === activeSlot.sandbox
    ? 'active'
    : promotion?.candidate === sandbox
      ? 'candidate-live'
      : 'candidate';
  pushLiveDiagnostic(source, message);

  if (message.type === 'pointer' && (sandbox === activeSlot.sandbox || promotion?.candidate === sandbox)) {
    pointer = { ...pointer, ...message.pointer };
  }

  if (promotion?.candidate === sandbox && isFatalEvent(message)) {
    promotion.resolveFatal?.({
      schema: 'dream-reliability-v1',
      passed: false,
      failure: {
        code: message.event.code || FAILURE_CODES.RUNTIME_ERROR,
        message: message.event.message || 'The candidate raised a fatal error after launch.',
        detail: message.event,
      },
      warnings: [],
      stages: [{ name: 'post-launch-immediate-failure', event: message.event }],
    });
    return;
  }

  if (sandbox === activeSlot.sandbox && isFatalEvent(message) && !promotion && !generating && !recovering) {
    queueRuntimeRecovery(message.event);
  }
}

function setSelectedModel(model) {
  selectedModel = model;
  if (model) {
    localStorage.setItem('ai-visualizer.selected-model', model.id);
    els.selectedModelName.textContent = model.name;
    els.modelButton.title = `${model.id}${priceLabel(model) ? ` · ${priceLabel(model)}` : ''}`;
  } else {
    els.selectedModelName.textContent = 'Choose a model';
    els.modelButton.removeAttribute('title');
  }
  renderModels();
}

function openDrawer(drawer) {
  drawerElements.forEach(candidate => {
    const open = candidate === drawer;
    candidate.classList.toggle('is-open', open);
    candidate.setAttribute('aria-hidden', String(!open));
  });
  els.drawerScrim.hidden = false;
  document.body.classList.remove('ui-hidden');
  clearTimeout(hideUiTimer);
}

function closeDrawers() {
  drawerElements.forEach(drawer => {
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
  });
  els.drawerScrim.hidden = true;
  scheduleUiHide();
}

function anyDrawerOpen() {
  return drawerElements.some(drawer => drawer.classList.contains('is-open'));
}

function showUi() {
  document.body.classList.remove('ui-hidden');
  scheduleUiHide();
}

function scheduleUiHide() {
  clearTimeout(hideUiTimer);
  if (anyDrawerOpen()) return;
  hideUiTimer = setTimeout(() => {
    if (!generating && !document.activeElement?.matches('input, button, summary')) {
      document.body.classList.add('ui-hidden');
    }
  }, 3000);
}

function renderModels() {
  const query = els.modelSearch.value.trim().toLowerCase();
  const filtered = models.filter(model => !query || `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(query));
  const fragment = document.createDocumentFragment();
  filtered.slice(0, 650).forEach(model => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'model-option';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(selectedModel?.id === model.id));
    button.innerHTML = `<span><span class="model-option__name">${escapeHtml(model.name)}</span><br><span class="model-option__provider">${escapeHtml(model.provider)}</span></span><span class="model-option__meta">${escapeHtml(priceLabel(model))}</span>`;
    button.addEventListener('click', () => {
      setSelectedModel(model);
      closeDrawers();
      showToast(`${model.name} selected. Press Dream when you want a new world.`);
    });
    fragment.appendChild(button);
  });
  els.modelList.replaceChildren(fragment);
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'model-empty';
    empty.textContent = 'No models match that search.';
    els.modelList.appendChild(empty);
  }
}

async function persistDiagnostic(record) {
  try {
    await diagnosticStore.put(structuredClone(record));
    scheduleDiagnosticsRender();
  } catch (error) {
    console.warn('Could not persist Dream diagnostics:', error);
  }
}

function stageCopy(stage) {
  const copies = {
    booting: ['Booting the candidate…', 'Starting it inside an isolated browser sandbox.'],
    'probing-baseline': ['Checking the first frame…', 'Looking for runtime errors and credible visual output.'],
    stimulating: ['Testing music response…', 'Feeding the same deterministic synthetic music signals used for every candidate.'],
    'proving-visible-output': ['Proving the artwork is visible…', 'Checking Canvas, WebGL, SVG, DOM and CSS output without prescribing an aesthetic.'],
    'canary-viewport': ['Testing your screen size…', 'Running the candidate at the real viewport before it can replace the current visualizer.'],
    'post-launch-watchdog': ['Launching with rollback armed…', 'The previous visualizer stays warm while this one proves it can survive live playback.'],
  };
  return copies[stage] || ['Checking the visualizer…', 'Running the Dream reliability harness.'];
}

function createHarness(sandbox, diagnostic) {
  return new DreamReliabilityHarness({
    sandbox,
    onStage: event => {
      const [title, detail] = stageCopy(event.name);
      showCenter(title, detail);
      const progress = {
        booting: 72,
        'probing-baseline': 76,
        stimulating: 81,
        'proving-visible-output': 86,
        'canary-viewport': 91,
        'post-launch-watchdog': 96,
      }[event.name] || 74;
      const step = event.name === 'post-launch-watchdog' ? 4 : 3;
      setArtifactProgress(progress, step, event.name === 'post-launch-watchdog' ? 'Candidate visible · rollback armed' : 'Model response complete ✓ · reliability harness running');
      if (generating && activeDreamController && els.dreamCancelButton) els.dreamCancelButton.disabled = false;
      addDiagnosticTimeline(diagnostic, `artifact:${event.name}`, event);
      void persistDiagnostic(diagnostic);
    },
  });
}

function staticFailure(problems) {
  return {
    schema: 'dream-reliability-v1',
    passed: false,
    failure: {
      code: FAILURE_CODES.INVALID_HTML,
      message: problems[0] || 'The model did not return a complete visualizer document.',
      detail: { problems },
    },
    warnings: [],
    stages: [{ name: 'static-validation', problems }],
    repairProblem: `Failure code: ${FAILURE_CODES.INVALID_HTML}\n${problems.join('\n')}\nReturn one complete self-contained HTML document and preserve the intended artistic idea.`,
  };
}

async function evaluateCandidate(result, diagnostic, attemptNumber, signal) {
  const attempt = {
    number: attemptNumber,
    kind: attemptNumber === 1 ? 'initial' : 'repair',
    startedAt: Date.now(),
    outputBytes: new TextEncoder().encode(String(result.html || '')).byteLength,
    staticValidation: [],
    reliability: null,
    promotionWatchdog: null,
  };
  diagnostic.attempts.push(attempt);

  const problems = validateVisualizerHtml(result.html);
  attempt.staticValidation = problems;
  diagnostic.staticValidation = problems;
  addDiagnosticTimeline(diagnostic, `attempt:${attemptNumber}:static-validation`, { problems });
  await persistDiagnostic(diagnostic);
  if (problems.length) {
    const failure = staticFailure(problems);
    attempt.reliability = failure;
    attempt.finishedAt = Date.now();
    return { passed: false, health: failure, attempt };
  }

  const harness = createHarness(standbySlot.sandbox, diagnostic);
  const health = await harness.preflight(result.html, {
    viewport: currentViewport(),
    signal,
  });
  attempt.reliability = health;
  diagnostic.reliability = health;
  attempt.finishedAt = Date.now();
  await persistDiagnostic(diagnostic);
  return { passed: health.passed, health, attempt, harness };
}

function swapSlots() {
  const previousActive = activeSlot;
  activeSlot = standbySlot;
  standbySlot = previousActive;
  activeSlot.sandbox.setPresentation('active');
  standbySlot.sandbox.setPresentation('standby');
}

async function promoteCandidate({ harness, diagnostic, signal }) {
  showCenter('Launching the dream…', 'The candidate is visible now, but instant rollback remains armed.');
  addDiagnosticTimeline(diagnostic, 'promotion:started');
  await persistDiagnostic(diagnostic);

  standbySlot.sandbox.setPresentation('promoting');
  activeSlot.sandbox.setPresentation('retiring');

  let resolveFatal;
  const immediateFailure = new Promise(resolve => {
    resolveFatal = resolve;
  });
  promotion = {
    candidate: standbySlot.sandbox,
    previous: activeSlot.sandbox,
    resolveFatal,
  };

  let watchdog;
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    watchdog = await Promise.race([
      harness.watchdog({ durationMs: 3600, signal }),
      immediateFailure,
    ]);
  } catch (error) {
    promotion = null;
    activeSlot.sandbox.setPresentation('active');
    standbySlot.sandbox.setPresentation('standby');
    standbySlot.sandbox.clear();
    throw error;
  }

  promotion = null;
  if (!watchdog.passed) {
    activeSlot.sandbox.setPresentation('active');
    standbySlot.sandbox.setPresentation('standby');
    await new Promise(resolve => setTimeout(resolve, 220));
    standbySlot.sandbox.clear();
    addDiagnosticTimeline(diagnostic, 'promotion:rolled-back', {
      failure: watchdog.failure,
    });
    diagnostic.rollback = watchdog.failure;
    diagnostic.promotionWatchdog = watchdog;
    await persistDiagnostic(diagnostic);
    return watchdog;
  }

  const previousHtml = currentHtml;
  const previousGeneration = currentGeneration;
  const previousDiagnosticId = currentDiagnosticId;
  swapSlots();
  activeSlot.sandbox.enterPassiveMode();
  fallbackHtml = previousHtml;
  fallbackGeneration = previousGeneration;
  fallbackDiagnosticId = previousDiagnosticId;
  diagnostic.promotionWatchdog = watchdog;
  addDiagnosticTimeline(diagnostic, 'promotion:committed', {
    watchdogDurationMs: watchdog.durationMs,
  });
  await persistDiagnostic(diagnostic);
  setTimeout(() => standbySlot.sandbox.clear(), 420);
  return watchdog;
}

function friendlyFailure(failure, repairUsed) {
  const prefix = repairUsed ? 'The Dream was repaired once, but ' : 'The Dream ';
  switch (failure?.code) {
    case FAILURE_CODES.NO_VISIBLE_OUTPUT:
      return `${prefix.toLowerCase()}still produced no visible artwork, so the current visualizer stayed live.`;
    case FAILURE_CODES.SHADER_COMPILE_FAILED:
    case FAILURE_CODES.PROGRAM_LINK_FAILED:
      return `${prefix.toLowerCase()}could not start its graphics on this device, so the current visualizer stayed live.`;
    case FAILURE_CODES.VIZ_NOT_CONSUMED:
      return `${prefix.toLowerCase()}did not connect to the music API, so it was not promoted.`;
    case FAILURE_CODES.WEBGL_CONTEXT_LOST:
    case FAILURE_CODES.RUNTIME_STALLED:
    case FAILURE_CODES.PERFORMANCE_COLLAPSE:
      return `${prefix.toLowerCase()}became unstable, so it was rolled back automatically.`;
    case FAILURE_CODES.INVALID_HTML:
      return `${prefix.toLowerCase()}did not return a complete visualizer document.`;
    default:
      return `${prefix.toLowerCase()}could not pass the reliability checks. Your previous visualizer is still safe.`;
  }
}

async function runRepair(result, failureReport, diagnostic, signal) {
  const problem = failureReport?.repairProblem
    || `${failureReport?.failure?.code || 'ARTIFACT_FAILURE'}\n${failureReport?.failure?.message || 'The candidate failed its runtime check.'}`;
  diagnostic.repairUsed = true;
  diagnostic.repairProblem = problem;
  addDiagnosticTimeline(diagnostic, 'repair:requested', {
    failureCode: failureReport?.failure?.code || '',
  });
  await persistDiagnostic(diagnostic);
  showCenter(`${selectedModel.name} is repairing its dream…`, failureReport?.failure?.message || 'Preserving the artistic idea while fixing the runtime failure.');
  const repaired = await repairVisualizer({
    modelId: selectedModel.id,
    raw: result.raw || result.html,
    problem,
    signal,
  });
  applyProviderResult(diagnostic, repaired, { repaired: true });
  addDiagnosticTimeline(diagnostic, 'repair:response-complete', {
    requestId: repaired.requestId || '',
    outputBytes: diagnostic.outputBytes,
  });
  await persistDiagnostic(diagnostic);
  return repaired;
}

async function dream() {
  if (generating) return;
  if (!selectedModel) {
    openDrawer(els.modelDrawer);
    els.modelSearch.focus();
    showToast('Choose a model first.');
    return;
  }
  if (!getOpenRouterKey()) {
    openDrawer(els.modelDrawer);
    showToast('Connect OpenRouter first. The key is session-only.');
    return;
  }

  generating = true;
  showUi();
  showCenter(`${selectedModel.name} is dreaming…`, 'Your current visualizer keeps playing while the model invents a new one.');
  els.dreamButton.disabled = true;
  activeDreamController = new AbortController();
  const signal = activeDreamController.signal;
  const diagnostic = createDiagnosticRecord({ model: selectedModel, providerId: 'openrouter' });
  diagnostic.promptVersion = PROMPT_VERSION;
  diagnostic.audioApiVersion = AUDIO_API_VERSION;
  diagnostic.attempts = [];
  addDiagnosticTimeline(diagnostic, 'generation:started');
  await persistDiagnostic(diagnostic);

  let result = null;
  let promoted = false;
  try {
    result = await generateVisualizer({ modelId: selectedModel.id, signal });
    applyProviderResult(diagnostic, result);
    addDiagnosticTimeline(diagnostic, 'generation:response-complete', {
      requestId: result.requestId || '',
      resolvedModel: result.resolvedModel || selectedModel.id,
      outputBytes: diagnostic.outputBytes,
    });
    await persistDiagnostic(diagnostic);

    for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
      const candidate = await evaluateCandidate(result, diagnostic, attemptNumber, signal);
      let failureReport = candidate.health;

      if (candidate.passed) {
        const watchdog = await promoteCandidate({
          harness: candidate.harness,
          diagnostic,
          signal,
        });
        candidate.attempt.promotionWatchdog = watchdog;
        diagnostic.promotionWatchdog = watchdog;
        await persistDiagnostic(diagnostic);
        if (watchdog.passed) {
          promoted = true;
          const generation = {
            id: crypto.randomUUID(),
            modelId: selectedModel.id,
            modelName: selectedModel.name,
            provider: selectedModel.provider,
            providerId: 'openrouter',
            resolvedModel: result.resolvedModel,
            requestId: result.requestId || '',
            promptVersion: PROMPT_VERSION,
            audioApiVersion: AUDIO_API_VERSION,
            createdAt: Date.now(),
            favorite: false,
            battleWins: 0,
            battleLosses: 0,
            attempt: result.attempt,
            usage: result.usage,
            html: result.html,
            diagnosticId: diagnostic.id,
            healthStatus: 'verified',
            healthSummary: candidate.health.summary,
          };
          currentGeneration = generation;
          currentHtml = generation.html;
          currentDiagnosticId = diagnostic.id;
          diagnostic.generationId = generation.id;
          finishDiagnostic(diagnostic, { status: 'succeeded', generationId: generation.id });
          await persistDiagnostic(diagnostic);
          try {
            await store.put(generation);
          } catch (storageError) {
            console.warn('Dream rendered but could not be saved:', storageError);
            showToast(`${selectedModel.name} is live, but this browser could not save it.`, 6000);
          }
          els.favoriteButton.classList.remove('is-active');
          els.favoriteButton.textContent = '♡';
          els.topStatus.textContent = `${selectedModel.name} · verified live`;
          setArtifactProgress(100, 4, 'Dream verified ✓ · rollback window passed');
          showCenter(`${selectedModel.name} is live`, 'Rendering, music-API, viewport and post-launch checks all passed.');
          await new Promise(resolve => setTimeout(resolve, 520));
          hideCenter();
          showToast(`${selectedModel.name} made this. It passed rendering, music-API, viewport and rollback checks.`);
          await renderLibrary();
          return;
        }
        failureReport = watchdog;
      }

      if (attemptNumber === 2 || diagnostic.repairUsed) {
        throw new DreamReliabilityError(failureReport.failure, failureReport);
      }
      result = await runRepair(result, failureReport, diagnostic, signal);
    }
  } catch (error) {
    standbySlot.sandbox.setPresentation('standby');
    if (promotion) {
      activeSlot.sandbox.setPresentation('active');
      promotion = null;
    }
    standbySlot.sandbox.clear();

    const cancelled = error?.name === 'AbortError' || /cancel/i.test(error?.message || '');
    const failure = error instanceof DreamReliabilityError
      ? error.failure
      : {
          code: cancelled ? 'CANCELLED' : 'PROVIDER_OR_PIPELINE_FAILURE',
          message: error?.message || 'That Dream failed.',
        };
    finishDiagnostic(diagnostic, {
      status: cancelled ? 'cancelled' : 'failed',
      failureCode: failure.code,
      failureMessage: failure.message,
    });
    await persistDiagnostic(diagnostic);
    hideCenter();
    const message = error instanceof DreamReliabilityError
      ? friendlyFailure(failure, diagnostic.repairUsed)
      : failure.message;
    const suffix = devMode ? ` Diagnostic ${shortDiagnosticId(diagnostic.id)}.` : '';
    showToast(`${message}${suffix}`, 7600);
  } finally {
    activeDreamController = null;
    generating = false;
    els.dreamButton.disabled = false;
    if (!promoted) activeSlot.sandbox.setPresentation('active');
    scheduleUiHide();
  }
}

async function openGeneration(generation, { close = true } = {}) {
  if (generating || recovering) return false;
  const model = models.find(candidate => candidate.id === generation.modelId) || {
    id: generation.modelId,
    name: generation.modelName || generation.modelId,
    provider: generation.provider || 'saved',
  };
  const diagnostic = createDiagnosticRecord({ model, providerId: generation.providerId || 'openrouter', kind: 'library-reopen' });
  diagnostic.promptVersion = generation.promptVersion || PROMPT_VERSION;
  diagnostic.audioApiVersion = generation.audioApiVersion || AUDIO_API_VERSION;
  diagnostic.html = generation.html;
  diagnostic.outputBytes = new TextEncoder().encode(String(generation.html || '')).byteLength;
  diagnostic.attempts = [];
  addDiagnosticTimeline(diagnostic, 'library-reopen:started', { generationId: generation.id });
  await persistDiagnostic(diagnostic);

  showCenter('Rechecking the saved dream…', 'Legacy and saved visualizers must prove they still render before replacing the current one.');
  try {
    const result = {
      html: generation.html,
      raw: generation.html,
      resolvedModel: generation.resolvedModel || generation.modelId,
      requestId: generation.requestId || '',
      usage: generation.usage || null,
      attempt: generation.attempt || 1,
    };
    const candidate = await evaluateCandidate(result, diagnostic, 1, null);
    if (!candidate.passed) throw new DreamReliabilityError(candidate.health.failure, candidate.health);
    const watchdog = await promoteCandidate({ harness: candidate.harness, diagnostic, signal: null });
    if (!watchdog.passed) throw new DreamReliabilityError(watchdog.failure, watchdog);

    currentGeneration = generation;
    currentHtml = generation.html;
    currentDiagnosticId = diagnostic.id;
    try {
      const updated = await store.update(generation.id, {
        healthStatus: 'verified',
        healthSummary: candidate.health.summary,
        lastDiagnosticId: diagnostic.id,
      });
      if (updated) currentGeneration = updated;
    } catch (storageError) {
      console.warn('Saved Dream opened, but its health metadata could not be updated:', storageError);
    }
    finishDiagnostic(diagnostic, { status: 'succeeded', generationId: generation.id });
    await persistDiagnostic(diagnostic);
    setSelectedModel(model);
    els.favoriteButton.classList.toggle('is-active', Boolean(generation.favorite));
    els.favoriteButton.textContent = generation.favorite ? '♥' : '♡';
    els.topStatus.textContent = `${generation.modelName || generation.modelId} · verified ${humanTime(generation.createdAt)}`;
    hideCenter();
    if (close) closeDrawers();
    return true;
  } catch (error) {
    standbySlot.sandbox.setPresentation('standby');
    standbySlot.sandbox.clear();
    activeSlot.sandbox.setPresentation('active');
    const failure = error instanceof DreamReliabilityError
      ? error.failure
      : { code: 'REOPEN_FAILED', message: error?.message || 'The saved Dream could not be opened.' };
    await store.update(generation.id, {
      healthStatus: 'failed-on-device',
      lastDiagnosticId: diagnostic.id,
    });
    finishDiagnostic(diagnostic, {
      status: 'failed',
      failureCode: failure.code,
      failureMessage: failure.message,
      generationId: generation.id,
    });
    await persistDiagnostic(diagnostic);
    hideCenter();
    showToast(`That saved Dream is not healthy on this device, so the current visualizer stayed live.${devMode ? ` Diagnostic ${shortDiagnosticId(diagnostic.id)}.` : ''}`, 7000);
    await renderLibrary();
    return false;
  }
}

async function renderLibrary() {
  const all = await store.list();
  const list = favoritesOnly ? all.filter(generation => generation.favorite) : all;
  const battleEligible = all.filter(generation => generation.healthStatus !== 'failed-on-device');
  els.battleButton.disabled = battleEligible.length < 2;
  const fragment = document.createDocumentFragment();

  list.forEach(generation => {
    const article = document.createElement('article');
    const usage = generation.usage || {};
    const healthLabel = generation.healthStatus === 'verified'
      ? 'verified'
      : generation.healthStatus === 'failed-on-device'
        ? 'failed safely'
        : 'legacy · rechecked on open';
    article.className = 'library-item';
    article.innerHTML = `<div class="library-item__top"><div style="min-width:0"><div class="library-item__name">${escapeHtml(generation.modelName || generation.modelId)}</div><div class="library-item__time">${humanTime(generation.createdAt)} · ${generation.favorite ? '♥ favorite' : 'saved dream'} · ${escapeHtml(healthLabel)}</div></div><span class="eyebrow">${generation.battleWins || 0}W</span></div><div class="library-item__actions"><button data-action="open">Open</button><button data-action="favorite">${generation.favorite ? '♥' : '♡'}</button><button data-action="delete">Delete</button>${devMode && (generation.diagnosticId || generation.lastDiagnosticId) ? '<button data-action="diagnostics">Diagnostics</button>' : ''}</div><details><summary>Details</summary><p><code>${escapeHtml(generation.modelId)}</code><br>${escapeHtml(generation.resolvedModel || '')}<br>${escapeHtml(generation.promptVersion || PROMPT_VERSION)} · ${escapeHtml(generation.audioApiVersion || AUDIO_API_VERSION)}<br>${Math.round((generation.html?.length || 0) / 1024)} KB · ${generation.battleWins || 0} wins / ${generation.battleLosses || 0} losses<br>${usage.prompt_tokens || usage.promptTokens || '—'} input tokens · ${usage.completion_tokens || usage.completionTokens || '—'} output tokens${generation.healthSummary?.rendererTypes?.length ? `<br>Renderer: ${escapeHtml(generation.healthSummary.rendererTypes.join(', '))} · ~${generation.healthSummary.approximateFps || '—'} FPS monitor` : ''}${generation.diagnosticId ? `<br>Diagnostic: <code>${escapeHtml(shortDiagnosticId(generation.diagnosticId))}</code>` : ''}</p></details>`;

    article.querySelector('[data-action="open"]').addEventListener('click', () => openGeneration(generation));
    article.querySelector('[data-action="favorite"]').addEventListener('click', async () => {
      await store.toggleFavorite(generation.id);
      if (currentGeneration?.id === generation.id) {
        currentGeneration = await store.get(generation.id);
        els.favoriteButton.classList.toggle('is-active', Boolean(currentGeneration.favorite));
        els.favoriteButton.textContent = currentGeneration.favorite ? '♥' : '♡';
      }
      await renderLibrary();
    });
    article.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      await store.remove(generation.id);
      if (currentGeneration?.id === generation.id) {
        currentGeneration = null;
        currentHtml = DEFAULT_VISUALIZER_HTML;
        currentDiagnosticId = '';
        els.favoriteButton.classList.remove('is-active');
        els.favoriteButton.textContent = '♡';
        await activeSlot.sandbox.load(DEFAULT_VISUALIZER_HTML, { viewport: currentViewport(), readyTimeoutMs: 1800 });
        activeSlot.sandbox.setPresentation('active');
        activeSlot.sandbox.enterPassiveMode();
      }
      await renderLibrary();
    });
    article.querySelector('[data-action="diagnostics"]')?.addEventListener('click', async () => {
      await renderDiagnostics(generation.diagnosticId || generation.lastDiagnosticId);
      openDrawer(els.diagnosticsDrawer);
    });
    fragment.appendChild(article);
  });

  els.libraryList.replaceChildren(fragment);
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'library-empty';
    empty.textContent = favoritesOnly
      ? 'No favorites yet. Heart a visualizer when one really hits.'
      : 'Nothing here yet. Choose a model, press Dream, and the first verified generation will appear here automatically.';
    els.libraryList.appendChild(empty);
  }
}

async function toggleAudio() {
  showUi();
  if (audio.connected) {
    await audio.stop();
    return;
  }
  showCenter('Choose what to listen to.', 'Share a tab/window/system source with audio. Video is ignored; the audio is analyzed locally and never sent to the AI.');
  try {
    await audio.connect();
    hideCenter();
    showToast('Audio connected. The visualizer can see the music now.');
  } catch (error) {
    hideCenter();
    showToast(error?.message || 'Audio could not be connected.', 6500);
  }
}

async function toggleFavorite() {
  if (!currentGeneration) {
    showToast('Generate a verified Dream first.');
    return;
  }
  const next = await store.toggleFavorite(currentGeneration.id);
  if (!next) return;
  currentGeneration = next;
  els.favoriteButton.classList.toggle('is-active', Boolean(next.favorite));
  els.favoriteButton.textContent = next.favorite ? '♥' : '♡';
  showToast(next.favorite ? 'Saved to favorites.' : 'Removed from favorites. It stays in your history.');
  await renderLibrary();
}

async function toggleFullscreen() {
  showUi();
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    document.body.classList.toggle('pseudo-fullscreen');
  }
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || !document.fullscreenElement) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}

async function releaseWakeLock() {
  try {
    await wakeLock?.release();
  } catch {}
  wakeLock = null;
}

function composeHostFrame(timestamp) {
  const sample = audio.sample(timestamp);
  return {
    version: AUDIO_API_VERSION,
    time: sample.time,
    deltaTime: sample.deltaTime,
    audio: {
      connected: sample.connected,
      silence: sample.silence,
      volume: sample.volume,
      peak: sample.peak,
      transient: sample.transient,
      beat: sample.beat,
      tempo: sample.tempo,
      tempoConfidence: sample.tempoConfidence,
      spectralFlux: sample.spectralFlux,
      spectralCentroid: sample.spectralCentroid,
      bands: sample.bands,
      stereo: sample.stereo,
      waveform: sample.waveform,
      spectrum: sample.spectrum,
    },
    pointer: { ...pointer },
    viewport: currentViewport(),
  };
}

function hostLoop(timestamp) {
  requestAnimationFrame(hostLoop);
  if (timestamp - lastHostFrame < 1000 / 60) return;
  lastHostFrame = timestamp;
  const frame = composeHostFrame(timestamp);
  activeSlot.sandbox.sendFrame(frame);
  if (promotion?.candidate && promotion.candidate !== activeSlot.sandbox) {
    promotion.candidate.sendFrame(frame);
  }
}

async function startBattle() {
  const generations = (await store.list()).filter(generation => generation.healthStatus !== 'failed-on-device');
  if (generations.length < 2) {
    showToast('You need at least two usable Dreams to battle.');
    return;
  }
  const shuffled = [...generations].sort(() => Math.random() - 0.5);
  battle = { a: shuffled[0], b: shuffled[1], viewing: 'a' };
  els.battlePanel.hidden = false;
  renderBattle();
  await openGeneration(battle.a, { close: false });
}

function renderBattle() {
  if (!battle) return;
  els.battleAButton.textContent = `A · ${battle.a.modelName || battle.a.modelId}`;
  els.battleBButton.textContent = `B · ${battle.b.modelName || battle.b.modelId}`;
  els.battleAButton.style.outline = battle.viewing === 'a' ? '1px solid rgba(255,255,255,.7)' : '';
  els.battleBButton.style.outline = battle.viewing === 'b' ? '1px solid rgba(255,255,255,.7)' : '';
}

async function viewBattle(side) {
  if (!battle) return;
  battle.viewing = side;
  renderBattle();
  await openGeneration(battle[side], { close: false });
}

async function voteBattle(side) {
  if (!battle) return;
  const winner = battle[side];
  const loser = battle[side === 'a' ? 'b' : 'a'];
  await store.recordBattle(winner.id, loser.id);
  showToast(`${winner.modelName || winner.modelId} wins this round.`);
  await renderLibrary();
  await startBattle();
}

function endBattle() {
  battle = null;
  els.battlePanel.hidden = true;
}


function chooseCheapDiagnosticModel() {
  if (!models.length) {
    showToast('The model catalog is still loading.');
    return null;
  }
  const fastPattern = /\b(flash|spark|mini|fast|instant|lite|turbo)\b/i;
  const candidates = models
    .filter(model => fastPattern.test(`${model.id} ${model.name}`))
    .sort((a, b) => {
      const aGeminiFlash = /google\/gemini.*flash/i.test(a.id) ? 0 : 1;
      const bGeminiFlash = /google\/gemini.*flash/i.test(b.id) ? 0 : 1;
      if (aGeminiFlash !== bGeminiFlash) return aGeminiFlash - bGeminiFlash;
      const aCost = Number(a.inputPrice || 0) * 1800 + Number(a.outputPrice || 0) * 5000;
      const bCost = Number(b.inputPrice || 0) * 1800 + Number(b.outputPrice || 0) * 5000;
      return aCost - bCost || Number(b.created || 0) - Number(a.created || 0);
    });
  const model = candidates[0] || [...models].sort((a, b) => Number(a.outputPrice || 0) - Number(b.outputPrice || 0))[0];
  if (!model) return null;
  setSelectedModel(model);
  closeDrawers();
  showToast(`${model.name} selected as the cheap fast-family diagnostic model.`);
  return model;
}

async function testDiagnosticHtml(html, label = 'manual HTML') {
  if (generating || recovering) throw new Error('Wait for the current operation to finish.');
  const model = { id: 'developer/manual-html', name: label, provider: 'developer' };
  const diagnostic = createDiagnosticRecord({ model, providerId: 'developer', kind: 'manual-html-test' });
  diagnostic.promptVersion = PROMPT_VERSION;
  diagnostic.audioApiVersion = AUDIO_API_VERSION;
  diagnostic.html = String(html || '');
  diagnostic.rawOutput = diagnostic.html;
  diagnostic.outputBytes = new TextEncoder().encode(diagnostic.html).byteLength;
  diagnostic.attempts = [];
  addDiagnosticTimeline(diagnostic, 'manual-html-test:started');
  await persistDiagnostic(diagnostic);
  showCenter('Testing supplied visualizer HTML…', 'Running the complete hidden reliability harness without changing the active artwork.');
  try {
    const result = { html: diagnostic.html, raw: diagnostic.html, attempt: 1 };
    const candidate = await evaluateCandidate(result, diagnostic, 1, null);
    standbySlot.sandbox.clear();
    if (!candidate.passed) throw new DreamReliabilityError(candidate.health.failure, candidate.health);
    finishDiagnostic(diagnostic, { status: 'succeeded' });
    await persistDiagnostic(diagnostic);
    hideCenter();
    showToast(`HTML test passed. Diagnostic ${shortDiagnosticId(diagnostic.id)}.`);
  } catch (error) {
    standbySlot.sandbox.clear();
    const failure = error instanceof DreamReliabilityError ? error.failure : { code: 'HTML_TEST_FAILED', message: error?.message || 'HTML test failed.' };
    finishDiagnostic(diagnostic, { status: 'failed', failureCode: failure.code, failureMessage: failure.message });
    await persistDiagnostic(diagnostic);
    hideCenter();
    showToast(`HTML test failed safely. Diagnostic ${shortDiagnosticId(diagnostic.id)}.`, 6500);
  }
  await renderDiagnostics(diagnostic.id);
  return diagnosticForExport(diagnostic);
}

function devModeFromLocation() {
  const params = new URLSearchParams(location.search);
  if (params.get('dev') === '1') localStorage.setItem('ai-visualizer.dev-mode', '1');
  if (params.get('dev') === '0') localStorage.removeItem('ai-visualizer.dev-mode');
  return localStorage.getItem('ai-visualizer.dev-mode') === '1';
}

function setDevMode(enabled) {
  devMode = Boolean(enabled);
  document.body.classList.toggle('dev-mode', devMode);
  if (els.diagnosticsButton) els.diagnosticsButton.hidden = !devMode;
  if (!devMode && els.diagnosticsDrawer?.classList.contains('is-open')) closeDrawers();
  if (devMode) {
    scheduleDiagnosticsRender();
    showToast('Visualizer developer diagnostics enabled. Ctrl+Shift+D toggles this mode.');
  }
}

function scheduleDiagnosticsRender() {
  if (!devMode) return;
  clearTimeout(diagnosticsRenderTimer);
  diagnosticsRenderTimer = setTimeout(() => void renderDiagnostics(), 80);
}

function runtimeSummary() {
  const heartbeatAge = Math.round(activeSlot.sandbox.heartbeatAgeMs());
  return {
    currentModel: currentGeneration?.modelName || 'Calibration Bloom',
    generationId: currentGeneration?.id || '',
    diagnosticId: currentDiagnosticId,
    heartbeatAgeMs: heartbeatAge,
    audioConnected: Boolean(audio.connected),
    generating,
    recovering,
    promotionActive: Boolean(promotion),
    activeSessionId: activeSlot.sandbox.sessionId,
    activeEvents: activeSlot.sandbox.events.slice(-10),
  };
}

async function renderDiagnostics(focusId = '') {
  if (!devMode || !els.diagnosticsList) return;
  const records = await diagnosticStore.list(40);
  const failed = records.filter(record => record.status === 'failed' || record.status === 'rolled-back').length;
  els.diagnosticsSummary.textContent = `${records.length} local records · ${failed} failed/rolled back · active heartbeat ${Math.round(activeSlot.sandbox.heartbeatAgeMs())}ms ago`;
  els.diagnosticsLive.textContent = liveDiagnosticEvents.length
    ? liveDiagnosticEvents.slice(-8).map(item => `${new Date(item.at).toLocaleTimeString()} · ${item.source} · ${item.type}${item.value?.code ? ` · ${item.value.code}` : ''}`).join('\n')
    : 'No live diagnostic events yet.';

  const fragment = document.createDocumentFragment();
  records.forEach(record => {
    const article = document.createElement('article');
    article.className = 'diagnostic-item';
    if (record.id === focusId) article.classList.add('is-focused');
    const latestAttempt = record.attempts?.at(-1);
    const reliability = latestAttempt?.reliability || record.reliability;
    const renderer = reliability?.summary?.rendererTypes?.join(', ')
      || reliability?.stages?.at(-1)?.report?.renderer?.types?.join(', ')
      || 'unknown';
    article.innerHTML = `<div class="diagnostic-item__top"><div><strong>${escapeHtml(record.modelName || record.modelId)}</strong><small>${escapeHtml(diagnosticStatusLabel(record))} · ${humanTime(record.createdAt)} · <code>${escapeHtml(shortDiagnosticId(record.id))}</code></small></div><span class="diagnostic-item__code">${escapeHtml(record.failureCode || 'OK')}</span></div><p>${escapeHtml(record.failureMessage || `Renderer ${renderer} · ${record.outputBytes ? `${Math.round(record.outputBytes / 1024)} KB` : 'no output yet'}`)}</p><div class="diagnostic-item__actions"><button data-action="copy-json">Copy JSON</button><button data-action="copy-html" ${record.html ? '' : 'disabled'}>Copy HTML</button><button data-action="retest-html" ${record.html ? '' : 'disabled'}>Retest</button><button data-action="delete">Delete</button></div><details><summary>Timeline and health</summary><pre>${escapeHtml(JSON.stringify(diagnosticForExport(record, { includeHtml: false }), null, 2))}</pre></details>`;
    article.querySelector('[data-action="copy-json"]').addEventListener('click', async () => {
      await copyText(JSON.stringify(diagnosticForExport(record), null, 2));
      showToast(`Copied diagnostic ${shortDiagnosticId(record.id)}.`);
    });
    article.querySelector('[data-action="copy-html"]').addEventListener('click', async () => {
      await copyText(record.html || record.rawOutput || '');
      showToast(`Copied HTML from diagnostic ${shortDiagnosticId(record.id)}.`);
    });
    article.querySelector('[data-action="retest-html"]').addEventListener('click', async () => {
      if (!record.html) return;
      await testDiagnosticHtml(record.html, `${record.modelName || record.modelId} replay`);
    });
    article.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      await diagnosticStore.remove(record.id);
      await renderDiagnostics();
    });
    fragment.appendChild(article);
  });
  els.diagnosticsList.replaceChildren(fragment);
  if (!records.length) {
    const empty = document.createElement('p');
    empty.className = 'diagnostics-empty';
    empty.textContent = 'No diagnostics yet. Every Dream attempt, including safe failures, will appear here.';
    els.diagnosticsList.appendChild(empty);
  }
  if (focusId) {
    requestAnimationFrame(() => els.diagnosticsList.querySelector('.is-focused')?.scrollIntoView({ block: 'center' }));
  }
}

async function retestCurrentVisualizer() {
  if (generating || recovering) {
    showToast('Wait for the current operation to finish.');
    return null;
  }
  const model = currentGeneration
    ? { id: currentGeneration.modelId, name: currentGeneration.modelName, provider: currentGeneration.provider }
    : { id: 'built-in/calibration-bloom', name: 'Calibration Bloom', provider: 'built-in' };
  const diagnostic = createDiagnosticRecord({ model, providerId: currentGeneration?.providerId || 'built-in', kind: 'manual-retest' });
  diagnostic.promptVersion = currentGeneration?.promptVersion || PROMPT_VERSION;
  diagnostic.audioApiVersion = currentGeneration?.audioApiVersion || AUDIO_API_VERSION;
  diagnostic.html = currentHtml;
  diagnostic.outputBytes = new TextEncoder().encode(currentHtml).byteLength;
  diagnostic.attempts = [];
  addDiagnosticTimeline(diagnostic, 'manual-retest:started');
  await persistDiagnostic(diagnostic);
  showCenter('Retesting the active visualizer…', 'This runs in the hidden candidate slot and does not interrupt the live artwork.');
  try {
    const result = { html: currentHtml, raw: currentHtml, attempt: 1 };
    const candidate = await evaluateCandidate(result, diagnostic, 1, null);
    standbySlot.sandbox.clear();
    if (!candidate.passed) throw new DreamReliabilityError(candidate.health.failure, candidate.health);
    finishDiagnostic(diagnostic, { status: 'succeeded', generationId: currentGeneration?.id || '' });
    await persistDiagnostic(diagnostic);
    hideCenter();
    showToast(`Retest passed. Diagnostic ${shortDiagnosticId(diagnostic.id)}.`);
    await renderDiagnostics(diagnostic.id);
    return diagnostic;
  } catch (error) {
    standbySlot.sandbox.clear();
    const failure = error instanceof DreamReliabilityError
      ? error.failure
      : { code: 'RETEST_FAILED', message: error?.message || 'Retest failed.' };
    finishDiagnostic(diagnostic, {
      status: 'failed',
      failureCode: failure.code,
      failureMessage: failure.message,
      generationId: currentGeneration?.id || '',
    });
    await persistDiagnostic(diagnostic);
    hideCenter();
    showToast(`Retest failed safely. Diagnostic ${shortDiagnosticId(diagnostic.id)}.`, 6500);
    await renderDiagnostics(diagnostic.id);
    return diagnostic;
  }
}

function queueRuntimeRecovery(event) {
  if (runtimeRecoveryQueued) return;
  runtimeRecoveryQueued = true;
  setTimeout(async () => {
    runtimeRecoveryQueued = false;
    await recoverFromRuntimeFailure(event);
  }, 0);
}

async function recoverFromRuntimeFailure(event) {
  if (recovering || generating || promotion) return;
  recovering = true;
  const failedGeneration = currentGeneration;
  const failedDiagnosticId = currentDiagnosticId;
  const targetHtml = fallbackHtml || DEFAULT_VISUALIZER_HTML;
  const targetGeneration = fallbackGeneration;
  const targetDiagnosticId = fallbackDiagnosticId;
  showCenter('Rolling back safely…', 'The active Dream became unstable. Restoring the last known-good visualizer.');

  try {
    if (failedGeneration) {
      try { await store.update(failedGeneration.id, { healthStatus: 'failed-on-device' }); } catch {}
    }
    if (failedDiagnosticId) {
      try {
        const record = await diagnosticStore.get(failedDiagnosticId);
        if (record) {
          record.rollback = event;
          finishDiagnostic(record, {
            status: 'rolled-back',
            failureCode: event?.code || 'RUNTIME_FAILURE',
            failureMessage: event?.message || 'The visualizer failed after launch.',
            generationId: failedGeneration?.id || '',
          });
          await persistDiagnostic(record);
        }
      } catch {}
    }

    const model = targetGeneration
      ? { id: targetGeneration.modelId, name: targetGeneration.modelName, provider: targetGeneration.provider }
      : { id: 'built-in/calibration-bloom', name: 'Calibration Bloom', provider: 'built-in' };
    const recoveryDiagnostic = createDiagnosticRecord({ model, providerId: targetGeneration?.providerId || 'built-in', kind: 'automatic-recovery' });
    recoveryDiagnostic.html = targetHtml;
    recoveryDiagnostic.outputBytes = new TextEncoder().encode(targetHtml).byteLength;
    recoveryDiagnostic.attempts = [];
    const result = { html: targetHtml, raw: targetHtml, attempt: 1 };
    const candidate = await evaluateCandidate(result, recoveryDiagnostic, 1, null);
    if (!candidate.passed) throw new DreamReliabilityError(candidate.health.failure, candidate.health);
    const watchdog = await promoteCandidate({ harness: candidate.harness, diagnostic: recoveryDiagnostic, signal: null });
    if (!watchdog.passed) throw new DreamReliabilityError(watchdog.failure, watchdog);
    currentHtml = targetHtml;
    currentGeneration = targetGeneration;
    currentDiagnosticId = targetDiagnosticId;
    // Never make the just-failed artwork the next rollback target.
    fallbackHtml = DEFAULT_VISUALIZER_HTML;
    fallbackGeneration = null;
    fallbackDiagnosticId = '';
    finishDiagnostic(recoveryDiagnostic, { status: 'succeeded', generationId: targetGeneration?.id || '' });
    await persistDiagnostic(recoveryDiagnostic);
    hideCenter();
    showToast('The unstable Dream was rolled back. Your last known-good visualizer is live again.', 6500);
  } catch (recoveryError) {
    console.warn('Automatic rollback target also failed; restoring built-in visualizer.', recoveryError);
    await standbySlot.sandbox.load(DEFAULT_VISUALIZER_HTML, { viewport: currentViewport(), readyTimeoutMs: 2000 });
    standbySlot.sandbox.setPresentation('promoting');
    activeSlot.sandbox.setPresentation('retiring');
    await new Promise(resolve => setTimeout(resolve, 180));
    swapSlots();
    activeSlot.sandbox.enterPassiveMode();
    currentHtml = DEFAULT_VISUALIZER_HTML;
    currentGeneration = null;
    currentDiagnosticId = '';
    fallbackHtml = DEFAULT_VISUALIZER_HTML;
    fallbackGeneration = null;
    fallbackDiagnosticId = '';
    hideCenter();
    showToast('Recovered to the built-in visualizer after a runtime failure.', 6500);
  } finally {
    recovering = false;
  }
}

function installDevApi() {
  const api = {
    enable() {
      localStorage.setItem('ai-visualizer.dev-mode', '1');
      setDevMode(true);
    },
    disable() {
      localStorage.removeItem('ai-visualizer.dev-mode');
      setDevMode(false);
    },
    async latest() {
      return diagnosticForExport(await diagnosticStore.latest());
    },
    async list() {
      return diagnosticsForExport(await diagnosticStore.list());
    },
    async copyLatest() {
      const latest = await diagnosticStore.latest();
      if (!latest) return false;
      await copyText(JSON.stringify(diagnosticForExport(latest), null, 2));
      return true;
    },
    async copyCurrentHtml() {
      await copyText(currentHtml);
      return true;
    },
    async retestCurrent() {
      return retestCurrentVisualizer();
    },
    async testHtml(html, label = 'manual HTML') {
      return testDiagnosticHtml(html, label);
    },
    async replay(id) {
      const record = await diagnosticStore.get(id);
      if (!record?.html) throw new Error('That diagnostic has no stored HTML.');
      return testDiagnosticHtml(record.html, `${record.modelName || record.modelId} replay`);
    },
    async exportAll() {
      const records = await diagnosticStore.list();
      const payload = diagnosticsForExport(records);
      downloadJson(`ai-visualizer-diagnostics-${Date.now()}.json`, payload);
      return payload;
    },
    open() {
      setDevMode(true);
      void renderDiagnostics();
      openDrawer(els.diagnosticsDrawer);
    },
    state() {
      return structuredClone(runtimeSummary());
    },
  };
  Object.defineProperty(window, 'VIZ_DEV', {
    value: Object.freeze(api),
    configurable: false,
    writable: false,
  });
}

function wireEvents() {
  els.modelButton.addEventListener('click', () => {
    updateConnectionUi();
    renderModels();
    openDrawer(els.modelDrawer);
  });
  els.dreamButton.addEventListener('click', dream);
  els.dreamCancelButton?.addEventListener('click', () => activeDreamController?.abort());
  els.favoriteButton.addEventListener('click', toggleFavorite);
  els.audioButton.addEventListener('click', toggleAudio);
  els.libraryButton.addEventListener('click', async () => {
    await renderLibrary();
    openDrawer(els.libraryDrawer);
  });
  els.fullscreenButton.addEventListener('click', toggleFullscreen);
  els.infoButton.addEventListener('click', () => openDrawer(els.aboutDrawer));
  els.diagnosticsButton?.addEventListener('click', async () => {
    await renderDiagnostics();
    openDrawer(els.diagnosticsDrawer);
  });
  els.drawerScrim.addEventListener('click', closeDrawers);
  document.querySelectorAll('[data-close-drawer]').forEach(button => button.addEventListener('click', closeDrawers));
  els.modelSearch.addEventListener('input', renderModels);
  els.connectOpenRouterButton.addEventListener('click', async () => {
    if (isOpenRouterConnected()) {
      disconnectOpenRouter();
      updateConnectionUi();
      showToast('OpenRouter disconnected from this session.');
      return;
    }
    await beginOpenRouterAuth(`${location.origin}${location.pathname}`);
  });
  els.favoritesOnlyButton.addEventListener('click', async () => {
    favoritesOnly = !favoritesOnly;
    els.favoritesOnlyButton.setAttribute('aria-pressed', String(favoritesOnly));
    els.favoritesOnlyButton.textContent = favoritesOnly ? 'Show all' : 'Favorites only';
    await renderLibrary();
  });
  els.battleButton.addEventListener('click', startBattle);
  els.endBattleButton.addEventListener('click', endBattle);
  els.battleAButton.addEventListener('click', () => viewBattle('a'));
  els.battleBButton.addEventListener('click', () => viewBattle('b'));
  els.voteAButton.addEventListener('click', () => voteBattle('a'));
  els.voteBButton.addEventListener('click', () => voteBattle('b'));
  els.stage.addEventListener('pointermove', event => {
    const rect = els.stage.getBoundingClientRect();
    pointer = {
      x: (event.clientX - rect.left) / Math.max(1, rect.width),
      y: (event.clientY - rect.top) / Math.max(1, rect.height),
      active: true,
      down: event.buttons > 0,
    };
  });
  els.stage.addEventListener('pointerleave', () => {
    pointer.active = false;
    pointer.down = false;
  });
  document.addEventListener('fullscreenchange', async () => {
    els.fullscreenButton.textContent = document.fullscreenElement ? '×' : '⛶';
    els.fullscreenButton.setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
    if (document.fullscreenElement) await requestWakeLock();
    else await releaseWakeLock();
    showUi();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && document.fullscreenElement) void requestWakeLock();
  });
  for (const eventName of ['pointermove', 'pointerdown', 'keydown', 'touchstart']) {
    document.addEventListener(eventName, showUi, { passive: eventName !== 'keydown' });
  }
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      if (devMode) {
        localStorage.removeItem('ai-visualizer.dev-mode');
        setDevMode(false);
      } else {
        localStorage.setItem('ai-visualizer.dev-mode', '1');
        setDevMode(true);
      }
    }
    if (event.key === 'Escape') closeDrawers();
  });
  els.copyLatestDiagnostics?.addEventListener('click', async () => {
    const latest = await diagnosticStore.latest();
    if (!latest) {
      showToast('No diagnostics yet.');
      return;
    }
    await copyText(JSON.stringify(diagnosticForExport(latest), null, 2));
    showToast(`Copied diagnostic ${shortDiagnosticId(latest.id)}.`);
  });
  els.exportDiagnostics?.addEventListener('click', async () => {
    const records = await diagnosticStore.list();
    downloadJson(`ai-visualizer-diagnostics-${Date.now()}.json`, diagnosticsForExport(records));
  });
  els.copyCurrentHtml?.addEventListener('click', async () => {
    await copyText(currentHtml);
    showToast('Copied the active visualizer HTML.');
  });
  els.retestCurrent?.addEventListener('click', retestCurrentVisualizer);
  els.pickDiagnosticModel?.addEventListener('click', chooseCheapDiagnosticModel);
  els.clearDiagnostics?.addEventListener('click', async () => {
    if (!confirm('Clear all local Visualizer diagnostics? Saved Dreams are not deleted.')) return;
    await diagnosticStore.clear();
    await renderDiagnostics();
  });
}

async function initialize() {
  devMode = devModeFromLocation();
  setDevMode(devMode);
  installDevApi();
  wireEvents();
  updateConnectionUi();

  await activeSlot.sandbox.load(DEFAULT_VISUALIZER_HTML, {
    viewport: currentViewport(),
    readyTimeoutMs: 2200,
  });
  activeSlot.sandbox.setPresentation('active');
  activeSlot.sandbox.enterPassiveMode();
  standbySlot.sandbox.setPresentation('standby');

  try {
    const callback = await consumeOpenRouterCallback();
    if (callback?.changed) showToast('OpenRouter connected. Choose a model and Dream.');
  } catch (error) {
    showToast(error?.message || 'OpenRouter could not be connected.', 6500);
  }
  updateConnectionUi();

  try {
    models = await fetchModels();
    const storedModelId = localStorage.getItem('ai-visualizer.selected-model');
    const storedModel = models.find(model => model.id === storedModelId);
    if (storedModel) setSelectedModel(storedModel);
    else renderModels();
  } catch (error) {
    showToast(error?.message || 'The model catalog could not be loaded.', 6500);
  }

  await renderLibrary();
  requestAnimationFrame(hostLoop);
  scheduleUiHide();

  setInterval(() => {
    if (document.hidden || generating || recovering || promotion || !activeSlot.sandbox.ready) return;
    if (activeSlot.sandbox.heartbeatAgeMs() > 8000) {
      queueRuntimeRecovery({
        code: FAILURE_CODES.RUNTIME_STALLED,
        message: 'The active visualizer stopped responding to its heartbeat.',
        heartbeatAgeMs: Math.round(activeSlot.sandbox.heartbeatAgeMs()),
      });
    }
  }, 1800);
}

await initialize();
