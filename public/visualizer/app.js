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
import { createLiveIdentityController } from './live-identity.js';
import {
  appendDreamAttempt,
  closeDreamAttempt,
  createDreamTraceFixtures,
  dreamTraceForExport,
  finalizeDreamTrace,
  legacyDiagnosticToTrace,
  patchDreamAttempt,
  recordDreamTraceRollback,
  sanitizeTraceValue,
} from './dream-trace.js';
import { beginTraceCapture, consumeTraceCapture } from './trace-bridge.js';
import { DreamTraceViewer } from './trace-viewer.js';
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
  liveIdentity: $('#liveIdentity'),
  liveIdentityName: $('#liveIdentityName'),
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
  transparencySelfTest: $('#transparencySelfTest'),
  pickDiagnosticModel: $('#pickDiagnosticModel'),
  clearDiagnostics: $('#clearDiagnostics'),
  traceViewer: $('#traceViewer'),
  traceViewerTitle: $('#traceViewerTitle'),
  traceViewerContent: $('#traceViewerContent'),
  closeTraceViewer: $('#closeTraceViewer'),
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
let reopening = false;
let deletingGeneration = false;
let activeDreamController = null;
let promotion = null;
let devMode = false;
let runtimeRecoveryQueued = false;
const liveDiagnosticEvents = [];
const volatileDiagnostics = new Map();
const MAX_VOLATILE_DIAGNOSTICS = 8;
const identityController = createLiveIdentityController();
const fixtureDiagnostics = new Map();

function renderIdentity(snapshot = identityController.snapshot()) {
  els.liveIdentityName.textContent = snapshot.live.displayName;
  els.liveIdentity.setAttribute('aria-label', `Live visualizer: ${snapshot.live.displayName}`);
  els.selectedModelName.textContent = snapshot.next.displayName;
  return snapshot;
}

function setNextIdentity(model) {
  return renderIdentity(identityController.setNext(model));
}

function stageLiveCandidate(identity) {
  const snapshot = renderIdentity(identityController.stageCandidate(identity));
  return snapshot.candidate.token;
}

function commitLiveCandidate(token) {
  return renderIdentity(identityController.commitPromotion(token));
}

function discardLiveCandidate(token) {
  if (!token || !identityController.snapshot().candidate) return identityController.snapshot();
  return renderIdentity(identityController.discardCandidate(token));
}

function restoreBuiltInIdentity() {
  return renderIdentity(identityController.restoreBuiltIn());
}

function liveIdentityForGeneration(generation, { kind = 'generated', diagnosticId = '' } = {}) {
  return {
    identity: identityController.snapshot(),
    kind,
    modelId: generation.modelId,
    modelName: generation.modelName || generation.modelId,
    providerId: generation.providerId || 'openrouter',
    upstreamProvider: generation.provider || '',
    resolvedModel: generation.resolvedModel || '',
    generationId: generation.id,
    traceId: generation.traceId || generation.diagnosticId || diagnosticId,
    diagnosticId: diagnosticId || generation.diagnosticId || '',
  };
}

renderIdentity();

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

  if (sandbox === activeSlot.sandbox && isFatalEvent(message) && !promotion && !generating && !recovering && !reopening && !deletingGeneration) {
    queueRuntimeRecovery(message.event);
  }
}

function setSelectedModel(model) {
  selectedModel = model;
  if (model) {
    localStorage.setItem('ai-visualizer.selected-model', model.id);
    els.modelButton.title = `${model.id}${priceLabel(model) ? ` · ${priceLabel(model)}` : ''}`;
  } else {
    els.modelButton.removeAttribute('title');
  }
  setNextIdentity(model);
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
  const copy = sanitizeTraceValue(record);
  try {
    await diagnosticStore.put(copy);
    volatileDiagnostics.delete(record.id);
    scheduleDiagnosticsRender();
    return diagnosticStore.persistent;
  } catch (error) {
    try {
      await diagnosticStore.prune(30);
      await diagnosticStore.put(copy);
      volatileDiagnostics.delete(record.id);
      scheduleDiagnosticsRender();
      return diagnosticStore.persistent;
    } catch (retryError) {
      volatileDiagnostics.set(record.id, copy);
      const stale = [...volatileDiagnostics.values()]
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0) || String(b.id).localeCompare(String(a.id)))
        .slice(MAX_VOLATILE_DIAGNOSTICS);
      stale.forEach(item => volatileDiagnostics.delete(item.id));
      console.warn('Could not persist Dream diagnostics; retaining a bounded in-memory trace:', retryError || error);
      scheduleDiagnosticsRender();
      return false;
    }
  }
}

async function listDiagnosticRecords(limit = 60) {
  const persistent = await diagnosticStore.list(limit);
  const merged = new Map(persistent.map(record => [record.id, record]));
  volatileDiagnostics.forEach((record, id) => merged.set(id, record));
  fixtureDiagnostics.forEach((record, id) => merged.set(id, record));
  return [...merged.values()]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || String(b.id).localeCompare(String(a.id)))
    .slice(0, Math.max(0, limit));
}

async function getDiagnosticRecord(id) {
  return fixtureDiagnostics.get(id) || volatileDiagnostics.get(id) || diagnosticStore.get(id);
}

function diagnosticIsDurable(id) {
  return diagnosticStore.persistent && !volatileDiagnostics.has(id);
}

function startTraceAttempt(diagnostic, kind, model) {
  diagnostic.trace = appendDreamAttempt(diagnostic.trace, {
    kind,
    requestedModelId: model.id,
    displayName: model.name,
    providerId: diagnostic.providerId || 'openrouter',
    upstreamProvider: model.provider || '',
    diagnosticId: diagnostic.id,
  });
  const attempt = diagnostic.trace.attempts.at(-1);
  const captureContext = beginTraceCapture({
    traceId: diagnostic.trace.id,
    attemptId: attempt.id,
    displayName: model.name,
    modelId: model.id,
    attemptNumber: attempt.number,
    kind,
  });
  return { id: attempt.id, number: attempt.number, kind, captureContext, absorbed: false, closed: false };
}

function patchTraceAttempt(diagnostic, attempt, patch) {
  if (!attempt || attempt.closed) return;
  diagnostic.trace = patchDreamAttempt(diagnostic.trace, attempt.id, patch);
}

function absorbTraceCapture(diagnostic, attempt, result = null) {
  if (!attempt || attempt.absorbed) return null;
  const capture = consumeTraceCapture(attempt.captureContext);
  attempt.absorbed = true;
  if (!capture) return null;
  const patch = {
    timing: capture.timing || {},
    artifact: {
      availability: capture.availability || null,
      providerErrors: capture.errors || [],
    },
    timeline: capture.timeline || [],
  };
  if (capture.request) patch.request = capture.request;
  if (capture.response) patch.response = capture.response;
  if (result) {
    patch.response = {
      ...(patch.response || {}),
      rawOutput: result.raw || '',
      extractedHtml: result.html || '',
      resolvedModel: result.resolvedModel || patch.response?.resolvedModel || '',
      requestId: result.requestId || patch.response?.requestId || '',
      usage: result.usage || patch.response?.usage || null,
    };
  }
  patchTraceAttempt(diagnostic, attempt, patch);
  return capture;
}

function closeTraceAttempt(diagnostic, attempt, outcome, options = {}) {
  if (!attempt || attempt.closed) return;
  diagnostic.trace = closeDreamAttempt(diagnostic.trace, attempt.id, {
    outcome,
    error: options.error,
    artifact: options.artifact,
    timing: options.timing,
    identity: options.identity,
  });
  attempt.closed = true;
}

function finalizeDiagnosticTrace(diagnostic, outcome, {
  generationId = '',
  failure = null,
} = {}) {
  if (diagnostic.trace.state === 'closed') return;
  diagnostic.trace = finalizeDreamTrace(diagnostic.trace, {
    outcome,
    generationId,
    finalLiveIdentity: identityController.snapshot(),
    failure,
  });
}

function reliabilityEvidence(report) {
  const stages = Array.isArray(report?.stages) ? report.stages : [];
  const probes = stages.map(stage => stage?.report).filter(Boolean);
  return {
    reliability: report || null,
    rendererEvidence: report?.summary || probes.map(probe => probe.renderer).filter(Boolean),
    consoleErrors: probes.flatMap(probe => probe.logs?.consoleErrors || []),
    consoleWarnings: probes.flatMap(probe => probe.logs?.consoleWarnings || []),
    shaderFailures: probes.flatMap(probe => probe.renderer?.shaderFailures || []),
    vizConsumption: report?.summary?.vizConsumed ?? probes.at(-1)?.viz?.consumed ?? null,
    visibleOutput: report?.summary?.visible ?? probes.at(-1)?.visual?.visibleProof ?? null,
    viewportCanary: stages.find(stage => stage.name === 'viewport-canary') || null,
    performanceWarnings: (report?.warnings || []).filter(warning => warning.code === 'HEAVY_RENDERER'),
    runtimeEvents: probes.flatMap(probe => probe.events || []),
  };
}

function traceForDiagnostic(record) {
  if (!record) return null;
  const trace = dreamTraceForExport(record.trace || legacyDiagnosticToTrace(record));
  if (record.status === 'rolled-back' && trace.status !== 'rolled-back') {
    trace.originalOutcome = trace.outcome;
    trace.status = 'rolled-back';
    trace.outcome = 'rolled-back';
    trace.failureCode = record.failureCode || trace.failureCode || 'RUNTIME_FAILURE';
    trace.failureMessage = record.failureMessage || trace.failureMessage || 'The visualizer failed after launch.';
    trace.rollback = record.rollback || null;
    trace.timeline = [...(trace.timeline || []), {
      stage: 'runtime:rolled-back',
      at: record.finishedAt || record.updatedAt || record.createdAt || 0,
      failureCode: trace.failureCode,
    }];
  }
  return trace;
}

async function findTraceRecord(id) {
  const direct = await getDiagnosticRecord(id);
  if (direct) return direct;
  return (await listDiagnosticRecords()).find(record => record.trace?.id === id) || null;
}

function attemptFor(trace, attemptNumber) {
  const attempts = trace?.attempts || [];
  if (!attempts.length) return null;
  if (attemptNumber == null) return attempts.at(-1);
  return attempts.find(attempt => Number(attempt.number) === Number(attemptNumber)) || null;
}

async function openTraceById(id) {
  const record = await findTraceRecord(id);
  if (!record) throw new Error('That local Dream Trace is no longer available.');
  const trace = traceForDiagnostic(record);
  dreamTraceViewer.open(trace, { diagnostic: record });
  return trace;
}

const dreamTraceViewer = new DreamTraceViewer({
  root: els.traceViewer,
  title: els.traceViewerTitle,
  content: els.traceViewerContent,
  onCopy: text => copyText(text),
  onExport: trace => downloadJson(`dream-trace-${trace.id || Date.now()}.json`, dreamTraceForExport(trace)),
  onRetest: (html, attempt) => testDiagnosticHtml(html, `trace attempt ${attempt?.number || '?'}`),
  onOpenGeneration: async generationId => {
    const generation = await store.get(generationId);
    if (!generation) throw new Error('That saved Dream is no longer in the Library.');
    return openGeneration(generation, { close: false });
  },
  notify: message => showToast(message),
});

async function runTransparencySelfTest() {
  if (!devMode) throw new Error('Dream Transparency self-test is available only in developer mode.');
  const fixtures = createDreamTraceFixtures();
  const now = Date.now();
  const records = [fixtures.repaired, fixtures.rolledBack].map((trace, index) => ({
    schema: 'dream-diagnostic-v1',
    id: trace.diagnosticId,
    createdAt: now + index,
    updatedAt: now + index,
    kind: 'transparency-self-test',
    status: trace.status,
    modelId: trace.modelId,
    modelName: trace.modelName,
    providerId: trace.providerId,
    generationId: trace.finalGenerationId || '',
    trace,
  }));
  records.forEach(record => fixtureDiagnostics.set(record.id, record));
  await renderDiagnostics(records[0].id);
  openDrawer(els.diagnosticsDrawer);
  dreamTraceViewer.open(dreamTraceForExport(fixtures.repaired), { diagnostic: records[0] });
  return {
    traceIds: records.map(record => record.trace.id),
    exposedReasoningTraceId: fixtures.repaired.id,
    hiddenReasoningTraceId: fixtures.rolledBack.id,
  };
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

function createHarness(sandbox, diagnostic, traceAttempt = null) {
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
      if (traceAttempt && !traceAttempt.closed) {
        patchTraceAttempt(diagnostic, traceAttempt, {
          timeline: [{ stage: `artifact:${event.name}`, ...event }],
        });
      }
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

async function evaluateCandidate(result, diagnostic, attemptNumber, signal, traceAttempt = null) {
  const validationStartedAt = Date.now();
  if (traceAttempt) patchTraceAttempt(diagnostic, traceAttempt, { timing: { artifactValidationStartedAt: validationStartedAt } });
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
  const validationEndedAt = Date.now();
  attempt.staticValidation = problems;
  diagnostic.staticValidation = problems;
  addDiagnosticTimeline(diagnostic, `attempt:${attemptNumber}:static-validation`, { problems });
  if (traceAttempt) {
    patchTraceAttempt(diagnostic, traceAttempt, {
      timing: { artifactValidationEndedAt: validationEndedAt },
      response: { rawOutput: result.raw || '', extractedHtml: result.html || '' },
      artifact: {
        staticValidation: { passed: problems.length === 0, problems, startedAt: validationStartedAt, finishedAt: validationEndedAt },
      },
    });
  }
  await persistDiagnostic(diagnostic);
  if (problems.length) {
    const failure = staticFailure(problems);
    attempt.reliability = failure;
    attempt.finishedAt = Date.now();
    if (traceAttempt) patchTraceAttempt(diagnostic, traceAttempt, { artifact: reliabilityEvidence(failure) });
    return { passed: false, health: failure, attempt };
  }

  const harness = createHarness(standbySlot.sandbox, diagnostic, traceAttempt);
  const health = await harness.preflight(result.html, {
    viewport: currentViewport(),
    signal,
  });
  attempt.reliability = health;
  diagnostic.reliability = health;
  attempt.finishedAt = Date.now();
  if (traceAttempt) patchTraceAttempt(diagnostic, traceAttempt, { artifact: reliabilityEvidence(health) });
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

async function promoteCandidate({ harness, diagnostic, signal, traceAttempt = null, onCommit = () => {} }) {
  const promotionStartedAt = Date.now();
  if (traceAttempt) patchTraceAttempt(diagnostic, traceAttempt, {
    timing: { promotionStartedAt, watchdogStartedAt: promotionStartedAt },
  });
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
    if (traceAttempt) patchTraceAttempt(diagnostic, traceAttempt, {
      timing: { watchdogEndedAt: Date.now(), rollbackAt: Date.now(), promotionEndedAt: Date.now() },
      artifact: { promotionWatchdog: watchdog, rollbackReason: watchdog.failure || null },
    });
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
  onCommit({
    previousHtml,
    previousGeneration,
    previousDiagnosticId,
  });
  diagnostic.promotionWatchdog = watchdog;
  if (traceAttempt) patchTraceAttempt(diagnostic, traceAttempt, {
    timing: { watchdogEndedAt: Date.now(), promotionEndedAt: Date.now() },
    artifact: { promotionWatchdog: watchdog },
  });
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

async function runRepair(result, failureReport, diagnostic, signal, requestedModel) {
  const problem = failureReport?.repairProblem
    || `${failureReport?.failure?.code || 'ARTIFACT_FAILURE'}\n${failureReport?.failure?.message || 'The candidate failed its runtime check.'}`;
  diagnostic.repairUsed = true;
  diagnostic.repairProblem = problem;
  const traceAttempt = startTraceAttempt(diagnostic, 'repair', requestedModel);
  patchTraceAttempt(diagnostic, traceAttempt, { artifact: { repairProblem: problem } });
  addDiagnosticTimeline(diagnostic, 'repair:requested', {
    failureCode: failureReport?.failure?.code || '',
  });
  await persistDiagnostic(diagnostic);
  showCenter(`${requestedModel.name} is repairing its dream…`, failureReport?.failure?.message || 'Preserving the artistic idea while fixing the runtime failure.');
  let repaired;
  try {
    repaired = await repairVisualizer({
      modelId: requestedModel.id,
      raw: result.raw || result.html,
      problem,
      signal,
      traceContext: traceAttempt.captureContext,
    });
    absorbTraceCapture(diagnostic, traceAttempt, repaired);
  } catch (error) {
    absorbTraceCapture(diagnostic, traceAttempt);
    closeTraceAttempt(diagnostic, traceAttempt, 'failed', { error, artifact: { repairProblem: problem } });
    throw error;
  }
  applyProviderResult(diagnostic, repaired, { repaired: true });
  addDiagnosticTimeline(diagnostic, 'repair:response-complete', {
    requestId: repaired.requestId || '',
    outputBytes: diagnostic.outputBytes,
  });
  await persistDiagnostic(diagnostic);
  return { result: repaired, traceAttempt };
}

async function dream() {
  if (generating || reopening || recovering || deletingGeneration || promotion) return;
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

  const requestedModel = structuredClone(selectedModel);
  const identityAtStart = identityController.snapshot();
  const generationId = crypto.randomUUID();

  generating = true;
  showUi();
  showCenter(`${requestedModel.name} is dreaming…`, 'Your current visualizer keeps playing while the model invents a new one.');
  els.dreamButton.disabled = true;
  activeDreamController = new AbortController();
  const signal = activeDreamController.signal;
  const diagnostic = createDiagnosticRecord({
    model: requestedModel,
    providerId: 'openrouter',
    liveSnapshot: identityAtStart,
    nextSnapshot: identityAtStart.next,
  });
  diagnostic.promptVersion = PROMPT_VERSION;
  diagnostic.audioApiVersion = AUDIO_API_VERSION;
  diagnostic.attempts = [];
  addDiagnosticTimeline(diagnostic, 'generation:started');
  let traceAttempt = startTraceAttempt(diagnostic, 'generation', requestedModel);
  let identityToken = stageLiveCandidate({
    modelId: requestedModel.id,
    modelName: requestedModel.name,
    providerId: 'openrouter',
    upstreamProvider: requestedModel.provider || '',
    generationId,
    traceId: diagnostic.trace.id,
    diagnosticId: diagnostic.id,
  });
  await persistDiagnostic(diagnostic);

  let result;
  let promoted = false;
  try {
    try {
      result = await generateVisualizer({
        modelId: requestedModel.id,
        signal,
        traceContext: traceAttempt.captureContext,
      });
      absorbTraceCapture(diagnostic, traceAttempt, result);
    } catch (error) {
      absorbTraceCapture(diagnostic, traceAttempt);
      closeTraceAttempt(diagnostic, traceAttempt, 'failed', { error });
      throw error;
    }
    applyProviderResult(diagnostic, result);
    addDiagnosticTimeline(diagnostic, 'generation:response-complete', {
      requestId: result.requestId || '',
      resolvedModel: result.resolvedModel || requestedModel.id,
      outputBytes: diagnostic.outputBytes,
    });
    await persistDiagnostic(diagnostic);

    for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
      const candidate = await evaluateCandidate(result, diagnostic, attemptNumber, signal, traceAttempt);
      let failureReport = candidate.health;
      let attemptRolledBack = false;

      if (candidate.passed) {
        const generation = {
          schema: 'visualizer-generation-v1',
          id: generationId,
          modelId: requestedModel.id,
          modelName: requestedModel.name,
          provider: requestedModel.provider,
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
          traceId: diagnostic.trace.id,
          healthStatus: 'verified',
          healthSummary: candidate.health.summary,
        };
        const watchdog = await promoteCandidate({
          harness: candidate.harness,
          diagnostic,
          signal,
          traceAttempt,
          onCommit: () => {
            commitLiveCandidate(identityToken);
            identityToken = '';
            currentGeneration = generation;
            currentHtml = generation.html;
            currentDiagnosticId = diagnostic.id;
          },
        });
        candidate.attempt.promotionWatchdog = watchdog;
        diagnostic.promotionWatchdog = watchdog;
        await persistDiagnostic(diagnostic);
        if (watchdog.passed) {
          promoted = true;
          closeTraceAttempt(diagnostic, traceAttempt, 'succeeded', {
            identity: { generationId: generation.id },
            artifact: { promotionWatchdog: watchdog },
          });
          finalizeDiagnosticTrace(diagnostic, 'succeeded', { generationId: generation.id });
          diagnostic.generationId = generation.id;
          finishDiagnostic(diagnostic, { status: 'succeeded', generationId: generation.id });
          await persistDiagnostic(diagnostic);
          try {
            await store.put(generation);
          } catch (storageError) {
            console.warn('Dream rendered but could not be saved:', storageError);
            showToast(`${requestedModel.name} is live, but this browser could not save it.`, 6000);
          }
          els.favoriteButton.classList.remove('is-active');
          els.favoriteButton.textContent = '♡';
          els.topStatus.textContent = 'Verified · rollback window passed';
          setArtifactProgress(100, 4, 'Dream verified ✓ · rollback window passed');
          showCenter(`${requestedModel.name} is live`, 'Rendering, music-API, viewport and post-launch checks all passed.');
          await new Promise(resolve => setTimeout(resolve, 520));
          hideCenter();
          const traceWarning = diagnosticIsDurable(diagnostic.id)
            ? ''
            : ' Its trace is available only for this tab because durable local storage failed.';
          showToast(`${requestedModel.name} made this. It passed rendering, music-API, viewport and rollback checks.${traceWarning}`, traceWarning ? 7600 : 3600);
          await renderLibrary();
          return;
        }
        failureReport = watchdog;
        attemptRolledBack = true;
      }

      if (attemptNumber === 2 || diagnostic.repairUsed) {
        closeTraceAttempt(diagnostic, traceAttempt, attemptRolledBack ? 'rolled-back' : 'failed', {
          artifact: { ...reliabilityEvidence(failureReport), repairProblem: failureReport?.repairProblem || '' },
        });
        throw new DreamReliabilityError(failureReport.failure, failureReport);
      }
      closeTraceAttempt(diagnostic, traceAttempt, attemptRolledBack ? 'rolled-back' : 'repair-required', {
        artifact: { ...reliabilityEvidence(failureReport), repairProblem: failureReport?.repairProblem || '' },
      });
      const repair = await runRepair(result, failureReport, diagnostic, signal, requestedModel);
      result = repair.result;
      traceAttempt = repair.traceAttempt;
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
          code: cancelled ? 'CANCELLED' : error?.code || 'PROVIDER_OR_PIPELINE_FAILURE',
          message: error?.message || 'That Dream failed.',
        };
    if (!promoted && identityToken) {
      discardLiveCandidate(identityToken);
      identityToken = '';
    }
    absorbTraceCapture(diagnostic, traceAttempt);
    if (traceAttempt && !traceAttempt.closed) {
      closeTraceAttempt(diagnostic, traceAttempt, cancelled ? 'cancelled' : 'failed', { error });
    }
    const rolledBack = diagnostic.trace.attempts.at(-1)?.outcome === 'rolled-back';
    const outcome = cancelled ? 'cancelled' : rolledBack ? 'rolled-back' : 'failed';
    finalizeDiagnosticTrace(diagnostic, outcome, { failure });
    finishDiagnostic(diagnostic, {
      status: outcome,
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
    if (!promoted && identityToken) discardLiveCandidate(identityToken);
    activeDreamController = null;
    generating = false;
    els.dreamButton.disabled = false;
    if (!promoted) activeSlot.sandbox.setPresentation('active');
    scheduleUiHide();
  }
}

async function openGeneration(generation, { close = true } = {}) {
  if (generating || recovering || reopening || deletingGeneration || promotion) return false;
  reopening = true;
  const model = models.find(candidate => candidate.id === generation.modelId) || {
    id: generation.modelId,
    name: generation.modelName || generation.modelId,
    provider: generation.provider || 'saved',
  };
  const identityAtStart = identityController.snapshot();
  const diagnostic = createDiagnosticRecord({
    model,
    providerId: generation.providerId || 'openrouter',
    kind: 'library-reopen',
    liveSnapshot: identityAtStart,
    nextSnapshot: identityAtStart.next,
  });
  let identityToken = stageLiveCandidate(liveIdentityForGeneration(generation, { kind: 'saved', diagnosticId: diagnostic.id }));
  diagnostic.promptVersion = generation.promptVersion || '';
  diagnostic.audioApiVersion = generation.audioApiVersion || '';
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
    const watchdog = await promoteCandidate({
      harness: candidate.harness,
      diagnostic,
      signal: null,
      onCommit: () => {
        commitLiveCandidate(identityToken);
        identityToken = '';
        currentGeneration = generation;
        currentHtml = generation.html;
        currentDiagnosticId = diagnostic.id;
      },
    });
    if (!watchdog.passed) throw new DreamReliabilityError(watchdog.failure, watchdog);
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
    finalizeDiagnosticTrace(diagnostic, 'succeeded', { generationId: generation.id });
    finishDiagnostic(diagnostic, { status: 'succeeded', generationId: generation.id });
    await persistDiagnostic(diagnostic);
    els.favoriteButton.classList.toggle('is-active', Boolean(generation.favorite));
    els.favoriteButton.textContent = generation.favorite ? '♥' : '♡';
    els.topStatus.textContent = `Saved Dream verified · ${humanTime(generation.createdAt)}`;
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
    if (identityToken) {
      discardLiveCandidate(identityToken);
      identityToken = '';
    }
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
    finalizeDiagnosticTrace(diagnostic, 'failed', { failure });
    await persistDiagnostic(diagnostic);
    hideCenter();
    showToast(`That saved Dream is not healthy on this device, so the current visualizer stayed live.${devMode ? ` Diagnostic ${shortDiagnosticId(diagnostic.id)}.` : ''}`, 7000);
    await renderLibrary();
    return false;
  } finally {
    if (identityToken) discardLiveCandidate(identityToken);
    reopening = false;
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
    const promptVersion = generation.promptVersion || 'Not captured by this app version.';
    const audioApiVersion = generation.audioApiVersion || 'Not captured by this app version.';
    article.innerHTML = `<div class="library-item__top"><div style="min-width:0"><div class="library-item__name">${escapeHtml(generation.modelName || generation.modelId)}</div><div class="library-item__time">${humanTime(generation.createdAt)} · ${generation.favorite ? '♥ favorite' : 'saved dream'} · ${escapeHtml(healthLabel)}</div></div><span class="eyebrow">${generation.battleWins || 0}W</span></div><div class="library-item__actions"><button data-action="open">Open</button><button data-action="favorite">${generation.favorite ? '♥' : '♡'}</button><button data-action="delete">Delete</button>${devMode && (generation.traceId || generation.diagnosticId || generation.lastDiagnosticId) ? '<button data-action="diagnostics">Trace</button>' : ''}</div><details><summary>Details</summary><p><code>${escapeHtml(generation.modelId)}</code><br>${escapeHtml(generation.resolvedModel || '')}<br>${escapeHtml(promptVersion)} · ${escapeHtml(audioApiVersion)}<br>${Math.round((generation.html?.length || 0) / 1024)} KB · ${generation.battleWins || 0} wins / ${generation.battleLosses || 0} losses<br>${usage.prompt_tokens || usage.promptTokens || '—'} input tokens · ${usage.completion_tokens || usage.completionTokens || '—'} output tokens${generation.healthSummary?.rendererTypes?.length ? `<br>Renderer: ${escapeHtml(generation.healthSummary.rendererTypes.join(', '))} · ~${generation.healthSummary.approximateFps || '—'} FPS monitor` : ''}${generation.diagnosticId ? `<br>Diagnostic: <code>${escapeHtml(shortDiagnosticId(generation.diagnosticId))}</code>` : ''}</p></details>`;

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
      if (generating || recovering || reopening || deletingGeneration || promotion) {
        showToast('Wait for the current Dream operation to finish before deleting a saved visualizer.');
        return;
      }
      deletingGeneration = true;
      try {
        await store.remove(generation.id);
        if (fallbackGeneration?.id === generation.id) {
          fallbackGeneration = null;
          fallbackHtml = DEFAULT_VISUALIZER_HTML;
        }
        if (currentGeneration?.id === generation.id) {
          await activeSlot.sandbox.load(DEFAULT_VISUALIZER_HTML, { viewport: currentViewport(), readyTimeoutMs: 1800 });
          activeSlot.sandbox.setPresentation('active');
          activeSlot.sandbox.enterPassiveMode();
          currentGeneration = null;
          currentHtml = DEFAULT_VISUALIZER_HTML;
          currentDiagnosticId = '';
          fallbackGeneration = null;
          fallbackHtml = DEFAULT_VISUALIZER_HTML;
          restoreBuiltInIdentity();
          els.favoriteButton.classList.remove('is-active');
          els.favoriteButton.textContent = '♡';
          els.topStatus.textContent = 'Built-in visualizer restored';
        }
        await renderLibrary();
      } finally {
        deletingGeneration = false;
      }
    });
    article.querySelector('[data-action="diagnostics"]')?.addEventListener('click', async () => {
      const diagnosticId = generation.healthStatus === 'failed-on-device'
        ? generation.lastDiagnosticId || generation.traceId || generation.diagnosticId
        : generation.traceId || generation.diagnosticId || generation.lastDiagnosticId;
      await renderDiagnostics(diagnosticId);
      openDrawer(els.diagnosticsDrawer);
      const record = await getDiagnosticRecord(diagnosticId);
      if (record) dreamTraceViewer.open(traceForDiagnostic(record), { diagnostic: record });
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
  } catch {
    // Wake lock support is optional and must not interrupt the visualizer.
  }
}

async function releaseWakeLock() {
  try {
    await wakeLock?.release();
  } catch {
    // A lost wake lock has already been released by the browser.
  }
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
  if (generating || recovering || reopening || deletingGeneration || promotion) throw new Error('Wait for the current operation to finish.');
  const model = { id: 'developer/manual-html', name: label, provider: 'developer' };
  const identityAtStart = identityController.snapshot();
  const diagnostic = createDiagnosticRecord({ model, providerId: 'developer', kind: 'manual-html-test', liveSnapshot: identityAtStart, nextSnapshot: identityAtStart.next });
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
    finalizeDiagnosticTrace(diagnostic, 'succeeded');
    finishDiagnostic(diagnostic, { status: 'succeeded' });
    await persistDiagnostic(diagnostic);
    hideCenter();
    showToast(`HTML test passed. Diagnostic ${shortDiagnosticId(diagnostic.id)}.`);
  } catch (error) {
    standbySlot.sandbox.clear();
    const failure = error instanceof DreamReliabilityError ? error.failure : { code: 'HTML_TEST_FAILED', message: error?.message || 'HTML test failed.' };
    finalizeDiagnosticTrace(diagnostic, 'failed', { failure });
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
  if (!devMode) {
    dreamTraceViewer.close();
    if (els.diagnosticsDrawer?.classList.contains('is-open')) closeDrawers();
  }
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
    reopening,
    deletingGeneration,
    promotionActive: Boolean(promotion),
    activeSessionId: activeSlot.sandbox.sessionId,
    activeEvents: activeSlot.sandbox.events.slice(-10),
  };
}

async function renderDiagnostics(focusId = '') {
  if (!devMode || !els.diagnosticsList) return;
  const records = await listDiagnosticRecords(40);
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
    article.innerHTML = `<div class="diagnostic-item__top"><div><strong>${escapeHtml(record.modelName || record.modelId)}</strong><small>${escapeHtml(diagnosticStatusLabel(record))} · ${humanTime(record.createdAt)} · <code>${escapeHtml(shortDiagnosticId(record.id))}</code></small></div><span class="diagnostic-item__code">${escapeHtml(record.failureCode || 'OK')}</span></div><p>${escapeHtml(record.failureMessage || `Renderer ${renderer} · ${record.outputBytes ? `${Math.round(record.outputBytes / 1024)} KB` : 'no output yet'}`)}</p><div class="diagnostic-item__actions"><button data-action="open-trace">Open Trace</button><button data-action="copy-json">Copy JSON</button><button data-action="copy-html" ${record.html ? '' : 'disabled'}>Copy HTML</button><button data-action="retest-html" ${record.html ? '' : 'disabled'}>Retest</button><button data-action="delete">Delete</button></div><details><summary>Raw diagnostic JSON</summary></details>`;
    article.querySelector('[data-action="open-trace"]').addEventListener('click', () => {
      dreamTraceViewer.open(traceForDiagnostic(record), { diagnostic: record });
    });
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
      fixtureDiagnostics.delete(record.id);
      volatileDiagnostics.delete(record.id);
      await diagnosticStore.remove(record.id);
      await renderDiagnostics();
    });
    const rawDetails = article.querySelector('details');
    rawDetails.addEventListener('toggle', () => {
      if (!rawDetails.open || rawDetails.querySelector('pre')) return;
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(diagnosticForExport(record, { includeHtml: false }), null, 2);
      rawDetails.appendChild(pre);
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
  if (generating || recovering || reopening || deletingGeneration || promotion) {
    showToast('Wait for the current operation to finish.');
    return null;
  }
  const model = currentGeneration
    ? { id: currentGeneration.modelId, name: currentGeneration.modelName, provider: currentGeneration.provider }
    : { id: 'built-in/calibration-bloom', name: 'Calibration Bloom', provider: 'built-in' };
  const identityAtStart = identityController.snapshot();
  const diagnostic = createDiagnosticRecord({ model, providerId: currentGeneration?.providerId || 'built-in', kind: 'manual-retest', liveSnapshot: identityAtStart, nextSnapshot: identityAtStart.next });
  diagnostic.promptVersion = currentGeneration?.promptVersion || '';
  diagnostic.audioApiVersion = currentGeneration?.audioApiVersion || '';
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
    finalizeDiagnosticTrace(diagnostic, 'succeeded', { generationId: currentGeneration?.id || '' });
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
    finalizeDiagnosticTrace(diagnostic, 'failed', { failure });
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
  if (recovering || generating || reopening || deletingGeneration || promotion) return;
  recovering = true;
  const failedGeneration = currentGeneration;
  const failedDiagnosticId = currentDiagnosticId;
  const targetHtml = fallbackHtml || DEFAULT_VISUALIZER_HTML;
  const targetGeneration = fallbackGeneration;
  let recoveryIdentityToken = '';
  let recoveryDiagnostic = null;
  let failedDiagnosticRecord = null;
  showCenter('Rolling back safely…', 'The active Dream became unstable. Restoring the last known-good visualizer.');

  try {
    if (failedGeneration) {
      try {
        await store.update(failedGeneration.id, { healthStatus: 'failed-on-device' });
      } catch {
        // Runtime recovery must continue even if health metadata cannot be saved.
      }
    }
    if (failedDiagnosticId) {
      try {
        const record = await getDiagnosticRecord(failedDiagnosticId);
        if (record) {
          failedDiagnosticRecord = record;
          record.rollback = event;
          finishDiagnostic(record, {
            status: 'rolled-back',
            failureCode: event?.code || 'RUNTIME_FAILURE',
            failureMessage: event?.message || 'The visualizer failed after launch.',
            generationId: failedGeneration?.id || '',
          });
          await persistDiagnostic(record);
        }
      } catch {
        // Runtime recovery remains higher priority than diagnostic persistence.
      }
    }

    const model = targetGeneration
      ? { id: targetGeneration.modelId, name: targetGeneration.modelName, provider: targetGeneration.provider }
      : { id: 'built-in/calibration-bloom', name: 'Calibration Bloom', provider: 'built-in' };
    const identityAtStart = identityController.snapshot();
    recoveryDiagnostic = createDiagnosticRecord({
      model,
      providerId: targetGeneration?.providerId || 'built-in',
      kind: 'automatic-recovery',
      liveSnapshot: identityAtStart,
      nextSnapshot: identityAtStart.next,
    });
    recoveryIdentityToken = stageLiveCandidate(targetGeneration
      ? liveIdentityForGeneration(targetGeneration, { kind: 'saved', diagnosticId: recoveryDiagnostic.id })
      : { kind: 'built-in' });
    recoveryDiagnostic.html = targetHtml;
    recoveryDiagnostic.outputBytes = new TextEncoder().encode(targetHtml).byteLength;
    recoveryDiagnostic.attempts = [];
    const result = { html: targetHtml, raw: targetHtml, attempt: 1 };
    const candidate = await evaluateCandidate(result, recoveryDiagnostic, 1, null);
    if (!candidate.passed) throw new DreamReliabilityError(candidate.health.failure, candidate.health);
    const watchdog = await promoteCandidate({
      harness: candidate.harness,
      diagnostic: recoveryDiagnostic,
      signal: null,
      onCommit: () => {
        commitLiveCandidate(recoveryIdentityToken);
        recoveryIdentityToken = '';
        currentHtml = targetHtml;
        currentGeneration = targetGeneration;
        currentDiagnosticId = recoveryDiagnostic.id;
      },
    });
    if (!watchdog.passed) throw new DreamReliabilityError(watchdog.failure, watchdog);
    // Never make the just-failed artwork the next rollback target.
    fallbackHtml = DEFAULT_VISUALIZER_HTML;
    fallbackGeneration = null;
    if (failedDiagnosticRecord?.trace?.state === 'closed') {
      failedDiagnosticRecord.trace = recordDreamTraceRollback(failedDiagnosticRecord.trace, {
        failure: event,
        finalLiveIdentity: identityController.snapshot(),
      });
      await persistDiagnostic(failedDiagnosticRecord);
    }
    finalizeDiagnosticTrace(recoveryDiagnostic, 'succeeded', { generationId: targetGeneration?.id || '' });
    finishDiagnostic(recoveryDiagnostic, { status: 'succeeded', generationId: targetGeneration?.id || '' });
    await persistDiagnostic(recoveryDiagnostic);
    hideCenter();
    showToast('The unstable Dream was rolled back. Your last known-good visualizer is live again.', 6500);
  } catch (recoveryError) {
    if (recoveryIdentityToken) {
      discardLiveCandidate(recoveryIdentityToken);
      recoveryIdentityToken = '';
    }
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
    restoreBuiltInIdentity();
    if (failedDiagnosticRecord?.trace?.state === 'closed') {
      failedDiagnosticRecord.trace = recordDreamTraceRollback(failedDiagnosticRecord.trace, {
        failure: event,
        finalLiveIdentity: identityController.snapshot(),
      });
      await persistDiagnostic(failedDiagnosticRecord);
    }
    if (recoveryDiagnostic) {
      const failure = recoveryError instanceof DreamReliabilityError
        ? recoveryError.failure
        : { code: 'RECOVERY_FAILED', message: recoveryError?.message || 'The rollback target failed revalidation.' };
      finalizeDiagnosticTrace(recoveryDiagnostic, 'failed', { failure });
      finishDiagnostic(recoveryDiagnostic, { status: 'failed', failureCode: failure.code, failureMessage: failure.message });
      await persistDiagnostic(recoveryDiagnostic);
    }
    hideCenter();
    showToast('Recovered to the built-in visualizer after a runtime failure.', 6500);
  } finally {
    if (recoveryIdentityToken) discardLiveCandidate(recoveryIdentityToken);
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
      return diagnosticForExport((await listDiagnosticRecords(1))[0] || null);
    },
    async list() {
      return diagnosticsForExport(await listDiagnosticRecords());
    },
    async copyLatest() {
      const latest = (await listDiagnosticRecords(1))[0];
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
      const record = await getDiagnosticRecord(id);
      if (!record?.html) throw new Error('That diagnostic has no stored HTML.');
      return testDiagnosticHtml(record.html, `${record.modelName || record.modelId} replay`);
    },
    async exportAll() {
      const records = await listDiagnosticRecords();
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
    identity() {
      return identityController.snapshot();
    },
    async latestTrace() {
      const record = (await listDiagnosticRecords(1))[0];
      return traceForDiagnostic(record);
    },
    async listTraces() {
      return (await listDiagnosticRecords()).map(traceForDiagnostic).filter(Boolean);
    },
    async openTrace(id) {
      setDevMode(true);
      openDrawer(els.diagnosticsDrawer);
      return openTraceById(id);
    },
    async copyTrace(id) {
      const record = await findTraceRecord(id);
      if (!record) return false;
      await copyText(JSON.stringify(traceForDiagnostic(record), null, 2));
      return true;
    },
    async copyPrompt(id, attemptNumber) {
      const record = await findTraceRecord(id);
      const attempt = attemptFor(traceForDiagnostic(record), attemptNumber);
      if (!attempt?.request?.messages) return false;
      await copyText(JSON.stringify(attempt.request.messages, null, 2));
      return true;
    },
    async copyResponse(id, attemptNumber) {
      const record = await findTraceRecord(id);
      const attempt = attemptFor(traceForDiagnostic(record), attemptNumber);
      const response = attempt?.response?.assistantText ?? attempt?.response?.rawOutput;
      if (response == null) return false;
      await copyText(response);
      return true;
    },
    async copyHtml(id, attemptNumber) {
      const record = await findTraceRecord(id);
      const attempt = attemptFor(traceForDiagnostic(record), attemptNumber);
      if (!attempt?.response?.extractedHtml) return false;
      await copyText(attempt.response.extractedHtml);
      return true;
    },
    async exportTrace(id) {
      const record = await findTraceRecord(id);
      if (!record) return null;
      const trace = traceForDiagnostic(record);
      downloadJson(`dream-trace-${trace.id}.json`, dreamTraceForExport(trace));
      return trace;
    },
    async retestTrace(id, attemptNumber) {
      const record = await findTraceRecord(id);
      const attempt = attemptFor(traceForDiagnostic(record), attemptNumber);
      if (!attempt?.response?.extractedHtml) throw new Error('That trace attempt has no captured HTML.');
      return testDiagnosticHtml(attempt.response.extractedHtml, `trace attempt ${attempt.number}`);
    },
    runTransparencySelfTest,
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
    const latest = (await listDiagnosticRecords(1))[0];
    if (!latest) {
      showToast('No diagnostics yet.');
      return;
    }
    await copyText(JSON.stringify(diagnosticForExport(latest), null, 2));
    showToast(`Copied diagnostic ${shortDiagnosticId(latest.id)}.`);
  });
  els.exportDiagnostics?.addEventListener('click', async () => {
    const records = await listDiagnosticRecords();
    downloadJson(`ai-visualizer-diagnostics-${Date.now()}.json`, diagnosticsForExport(records));
  });
  els.copyCurrentHtml?.addEventListener('click', async () => {
    await copyText(currentHtml);
    showToast('Copied the active visualizer HTML.');
  });
  els.retestCurrent?.addEventListener('click', retestCurrentVisualizer);
  els.transparencySelfTest?.addEventListener('click', () => void runTransparencySelfTest());
  els.pickDiagnosticModel?.addEventListener('click', chooseCheapDiagnosticModel);
  els.clearDiagnostics?.addEventListener('click', async () => {
    if (!confirm('Clear all local Visualizer diagnostics? Saved Dreams are not deleted.')) return;
    dreamTraceViewer.close();
    fixtureDiagnostics.clear();
    volatileDiagnostics.clear();
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
    if (document.hidden || generating || recovering || reopening || deletingGeneration || promotion || !activeSlot.sandbox.ready) return;
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
