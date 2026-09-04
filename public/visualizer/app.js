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
import { PROMPT_VERSION, AUDIO_API_VERSION, loadPromptProfile } from './prompt.js';
import { VisualizerSandbox, validateVisualizerHtml } from './sandbox.js';
import {
  confirmSandboxLiveness,
  activeStallConfirmationDecision,
  DreamReliabilityHarness,
  DreamReliabilityError,
  FAILURE_CODES,
  latestCurrentVisualReport,
  RELIABILITY_SCHEMA,
} from './reliability.js';
import { GenerationStore, DiagnosticStore } from './storage.js';
import { createLiveIdentityController } from './live-identity.js';
import { createPlaybackController, EXTERNAL_CAPTURE_PAUSE_COPY } from './playback-state.js';
import {
  createDreamJobController,
  dreamJobOwnsReliabilityStage,
  DREAM_JOB_PHASES,
  mountDreamJobView,
} from './dream-job.js';
import { loadFeaturedDreams, createFeaturedExportPackage } from './featured-dreams.js';
import { buildDreamSwitcherGroups, localDreamKey, mountDreamSwitcher } from './dream-switcher.js';
import {
  dreamDisplayTitle,
  dreamPromptLabel,
  editableDreamDisplayTitle,
  htmlDocumentTitle,
} from './dream-metadata.js';
import { createDiagnosticDetailsState } from './diagnostic-details-state.js';
import { readPromptLibraryEntries } from './prompt-library.js';
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
  createReasoningSelectionStore,
  listReasoningOptions,
  normalizeReasoningMetadata,
} from './reasoning-settings.js';
import { GENERATION_ENVELOPE_VERSION } from './generation-envelope.js';
import {
  MODEL_FIT_RESULT_CATEGORIES,
  MODEL_FIT_STATUSES,
  createModelFitConfigurationIdentity,
  createModelFitEvidenceStore,
  modelFitConfigurationKey,
  modelFitMatrixText,
  modelFitObservationFromDreamTrace,
} from './model-fit-evidence.js';
import {
  GENERATION_FAILURE_CATEGORIES,
  generationFailureCopy,
} from './generation-failure.js';
import {
  applyAudioSensitivity,
  createAudioSensitivityController,
} from './audio-sensitivity.js';
import {
  favoriteTargetForArrow,
  globalArrowCommand,
} from './keyboard-transport.js';
import { createImmersiveUiController } from './immersive-ui.js';
import { modelSearchMatches } from './model-search.js';
import { VISUALIZER_RUNTIME_VERSION } from './runtime-version.js';
import {
  createCadenceGate,
  createRenderQualityController,
  resolveRenderQuality,
} from './render-quality.js';
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
const localSettingsStorage = (() => {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    return {
      getItem(key) { try { return storage.getItem(key); } catch { return null; } },
      setItem(key, value) { try { storage.setItem(key, value); } catch { /* Keep the page usable without persistence. */ } },
      removeItem(key) { try { storage.removeItem(key); } catch { /* Keep the page usable without persistence. */ } },
    };
  } catch {
    return null;
  }
})();
const els = {
  stage: $('#stage'),
  frame: $('#visualizerFrame'),
  preflightFrame: $('#preflightFrame'),
  topStatus: $('#topStatus'),
  playbackButton: $('#playbackButton'),
  pauseOverlay: $('#pauseOverlay'),
  pauseMessage: $('#pauseMessage'),
  liveIdentity: $('#liveIdentity'),
  liveIdentityName: $('#liveIdentityName'),
  modelButton: $('#modelButton'),
  selectedModelName: $('#selectedModelName'),
  reasoningControl: $('#reasoningControl'),
  reasoningSelect: $('#reasoningSelect'),
  reasoningState: $('#reasoningState'),
  reasoningHelp: $('#reasoningHelp'),
  switcherCurrent: $('#switcherCurrent'),
  switcherButton: $('#switcherButton'),
  dreamButton: $('#dreamButton'),
  favoriteButton: $('#favoriteButton'),
  audioButton: $('#audioButton'),
  audioButtonLabel: $('#audioButtonLabel'),
  audioDot: $('#audioDot'),
  audioPicker: $('#audioPicker'),
  audioDisplayOption: $('#audioDisplayOption'),
  audioMicrophoneOption: $('#audioMicrophoneOption'),
  audioUnavailable: $('#audioUnavailable'),
  sensitivityInput: $('#sensitivityInput'),
  sensitivityValue: $('#sensitivityValue'),
  resetSensitivity: $('#resetSensitivity'),
  sensitivityHud: $('#sensitivityHud'),
  renderQualityInputs: [...document.querySelectorAll('input[name="renderQuality"]')],
  renderQualityDetail: $('#renderQualityDetail'),
  favoriteOpeningStatus: $('#favoriteOpeningStatus'),
  libraryButton: $('#libraryButton'),
  fullscreenButton: $('#fullscreenButton'),
  infoButton: $('#infoButton'),
  diagnosticsButton: $('#diagnosticsButton'),
  centerStatus: $('#transientStatus'),
  centerStatusTitle: $('#transientStatusTitle'),
  centerStatusDetail: $('#transientStatusDetail'),
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
  exportFeaturedCandidate: $('#exportFeaturedCandidate'),
  retestCurrent: $('#retestCurrent'),
  transparencySelfTest: $('#transparencySelfTest'),
  copyModelTestMatrix: $('#copyModelTestMatrix'),
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
let modelCatalogError = '';
let selectedModel = null;
let currentGeneration = null;
let currentHtml = DEFAULT_VISUALIZER_HTML;
let currentDiagnosticId = '';
let fallbackGeneration = null;
let fallbackHtml = DEFAULT_VISUALIZER_HTML;
let pointer = { x: 0.5, y: 0.5, active: false, down: false };
let toastTimer = 0;
let diagnosticsRenderTimer = 0;
let favoritesOnly = false;
let battle = null;
let wakeLock = null;
let wakeLockRequest = null;
let wakeLockRevision = 0;
let generating = false;
let recovering = false;
let reopening = false;
let deletingGeneration = false;
let activeDreamController = null;
let activeDreamTraceId = '';
let immersiveUiController = null;
let lastKeyboardUiActivityAt = -Infinity;
let dprMediaQuery = null;
let promotion = null;
let devMode = false;
let runtimeRecoveryQueued = false;
let pendingActiveFailure = null;
let activeStallConfirmation = null;
let activeStallRecheck = null;
let visualPaused = false;
let candidateSlotTail = Promise.resolve();
const liveDiagnosticEvents = [];
const volatileDiagnostics = new Map();
const MAX_VOLATILE_DIAGNOSTICS = 8;
const identityController = createLiveIdentityController();
const playbackController = createPlaybackController();
const dreamJobController = createDreamJobController();
const reasoningSelectionStore = createReasoningSelectionStore({ storage: localSettingsStorage });
const sensitivityController = createAudioSensitivityController({ storage: localSettingsStorage });
const renderQualityController = createRenderQualityController({ storage: localSettingsStorage });
const modelFitEvidenceStore = createModelFitEvidenceStore({ storage: localSettingsStorage });
const fixtureDiagnostics = new Map();
const rawDiagnosticDetailsState = createDiagnosticDetailsState();
let dreamSwitcher = null;
let featuredDreams = [];
const featuredLoadFailures = [];
let currentDreamKey = 'featured:calibration-bloom';
let drawerReturnFocus = null;
let selectedReasoningSelection = null;
let sensitivityHudTimer = 0;
let openingStatusTimer = 0;
let openingStatusRevision = 0;
let sensitivityPercent = sensitivityController.snapshot().sensitivityPercent;
let renderQuality = resolveRenderQuality(renderQualityController.snapshot().mode, devicePixelRatio || 1);
const audioAnalysisGate = createCadenceGate(60);
const vizDeliveryGate = createCadenceGate(renderQuality.maxFps);
let latestAudioSample = null;
let lastDeliveredFrameAt = 0;
let audioAnalysisSamples = 0;
let vizFrameDeliveries = 0;
activeSlot.sandbox.setRenderQuality(renderQuality);
standbySlot.sandbox.setRenderQuality(renderQuality);

function renderIdentity(snapshot = identityController.snapshot()) {
  els.liveIdentityName.textContent = snapshot.live.displayName;
  els.liveIdentity.setAttribute('aria-label', `Live visualizer: ${snapshot.live.displayName}`);
  if (els.switcherCurrent) els.switcherCurrent.textContent = snapshot.live.displayName;
  els.selectedModelName.textContent = snapshot.next.displayName;
  return snapshot;
}

function renderFavoriteControl() {
  const available = Boolean(currentGeneration && currentGeneration.source !== 'featured');
  const favorite = available && Boolean(currentGeneration.favorite);
  els.favoriteButton.disabled = !available;
  els.favoriteButton.classList.toggle('is-active', favorite);
  els.favoriteButton.textContent = favorite ? '♥' : '♡';
  els.favoriteButton.setAttribute('aria-pressed', String(favorite));
  els.favoriteButton.setAttribute('aria-label', favorite ? 'Remove current Dream from favorites' : 'Save current Dream to favorites');
  els.favoriteButton.title = available ? (favorite ? 'Remove from favorites' : 'Save to favorites') : 'Featured Dreams are always available';
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

function updateLiveDisplayName(sourceId, displayName) {
  return renderIdentity(identityController.setLiveDisplayName(sourceId, displayName));
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
    artifactId: generation.artifactId || '',
    title: dreamDisplayTitle(generation),
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
    dpr: renderQuality.effectiveDpr,
  };
}

function renderQualityControl() {
  for (const input of els.renderQualityInputs) input.checked = input.value === renderQuality.mode;
  if (els.renderQualityDetail) {
    const dpr = Number.isInteger(renderQuality.effectiveDpr)
      ? String(renderQuality.effectiveDpr)
      : renderQuality.effectiveDpr.toFixed(1);
    els.renderQualityDetail.textContent = `${renderQuality.label} · up to ${renderQuality.maxFps} FPS · ${dpr}× effective DPR`;
  }
}

function applyRenderQuality(snapshot = renderQualityController.snapshot()) {
  renderQuality = resolveRenderQuality(snapshot.mode, devicePixelRatio || 1);
  vizDeliveryGate.setMaxFps(renderQuality.maxFps);
  activeSlot.sandbox.setRenderQuality(renderQuality);
  standbySlot.sandbox.setRenderQuality(renderQuality);
  renderQualityControl();
  window.dispatchEvent(new CustomEvent('visualizer:render-quality-changed', {
    detail: {
      mode: renderQuality.mode,
      maxFps: renderQuality.maxFps,
      effectiveDpr: renderQuality.effectiveDpr,
    },
  }));
  return renderQuality;
}

function nativeDprMediaChanged() {
  applyRenderQuality(renderQualityController.snapshot());
  watchNativeDpr();
}

function watchNativeDpr() {
  if (typeof matchMedia !== 'function') return;
  dprMediaQuery?.removeEventListener?.('change', nativeDprMediaChanged);
  dprMediaQuery = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`);
  dprMediaQuery.addEventListener?.('change', nativeDprMediaChanged, { once: true });
}

function updateConnectionUi() {
  const connected = isOpenRouterConnected();
  els.connectionTitle.textContent = connected ? 'OpenRouter connected' : 'Connect OpenRouter';
  els.connectionCopy.textContent = connected
    ? 'This key exists only for this browser session and is never exposed to generated visualizers.'
    : 'Authorize a session-only key to dream with hundreds of models.';
  els.connectOpenRouterButton.textContent = connected ? 'Disconnect' : 'Connect';
}

function renderPlayback(snapshot = playbackController.snapshot()) {
  visualPaused = snapshot.paused;
  audioAnalysisGate.reset();
  vizDeliveryGate.reset();
  if (!visualPaused) lastDeliveredFrameAt = 0;
  document.body.classList.toggle('visual-paused', visualPaused);
  els.stage.classList.toggle('is-visual-paused', visualPaused);
  if (els.playbackButton) {
    els.playbackButton.textContent = visualPaused ? '▶' : '⏸';
    els.playbackButton.setAttribute('aria-label', visualPaused ? 'Play visual' : 'Pause visual');
    els.playbackButton.setAttribute('aria-pressed', String(visualPaused));
    els.playbackButton.title = visualPaused ? 'Play visual' : 'Pause visual';
  }
  if (els.pauseMessage) {
    els.pauseMessage.textContent = visualPaused && audio.connected
      ? EXTERNAL_CAPTURE_PAUSE_COPY
      : 'Visual paused';
  }
  if (els.pauseOverlay) els.pauseOverlay.hidden = !visualPaused;
  activeSlot.sandbox.setPaused(visualPaused);
  if (promotion?.candidate && promotion.candidate !== activeSlot.sandbox) {
    promotion.candidate.setPaused(visualPaused);
  }
  immersiveUiController?.sync();
}

function updateAudioState(state) {
  const connected = Boolean(state.connected);
  els.audioDot.classList.toggle('is-live', connected);
  els.audioButtonLabel.textContent = connected
    ? state.sourceKind === 'microphone' ? 'Microphone connected' : 'Audio connected'
    : 'Connect audio';
  renderPlayback();
  if (!connected && state.label) showToast(state.label);
}

function effortLabel(effort) {
  const value = String(effort || '');
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : 'Default';
}

function announceReasoningSelection(selection) {
  window.dispatchEvent(new CustomEvent('visualizer:reasoning-selection-changed', {
    detail: {
      modelId: selection?.modelId || '',
      mode: selection?.mode || 'default',
      effort: selection?.effort || null,
    },
  }));
}

function renderReasoningControl({ announceStale = false } = {}) {
  if (!els.reasoningSelect || !els.reasoningState || !els.reasoningHelp) return null;
  if (!selectedModel) {
    selectedReasoningSelection = null;
    els.reasoningSelect.replaceChildren(new Option('Default', 'default'));
    els.reasoningSelect.disabled = true;
    els.reasoningState.textContent = 'Choose a model';
    els.reasoningHelp.textContent = 'Default preserves the exact model\'s native reasoning behavior.';
    return null;
  }

  const metadata = normalizeReasoningMetadata(selectedModel);
  let selection = reasoningSelectionStore.snapshot(selectedModel);
  if (selection.staleFallback) {
    selection = reasoningSelectionStore.save(selectedModel, { mode: 'default', effort: null });
    if (announceStale) showToast('That saved reasoning level is no longer supported. Reasoning returned to Default.');
  }
  selectedReasoningSelection = selection;
  const options = listReasoningOptions(selectedModel);
  els.reasoningSelect.replaceChildren(...options.map(option => new Option(option.label, option.value)));
  els.reasoningSelect.value = selection.mode === 'explicit' ? selection.effort : 'default';
  els.reasoningSelect.disabled = options.length === 1;
  els.reasoningState.textContent = metadata.hasEffortControls
    ? (selection.mode === 'explicit' ? effortLabel(selection.effort) : 'Native default')
    : metadata.source.reasoning || selectedModel.capabilities?.reasoning
      ? 'Model controlled'
      : 'Default only';
  els.reasoningHelp.textContent = metadata.hasEffortControls
    ? 'Default sends no override. Other choices use only levels this exact model advertises.'
    : 'This exact model does not advertise selectable reasoning levels.';
  return selection;
}

function setReasoningFromUi() {
  if (!selectedModel || !els.reasoningSelect) return;
  const value = els.reasoningSelect.value;
  const selection = reasoningSelectionStore.save(selectedModel, value === 'default'
    ? { mode: 'default', effort: null }
    : { mode: 'explicit', effort: value });
  selectedReasoningSelection = selection;
  renderReasoningControl();
  announceReasoningSelection(selection);
  showToast(`Reasoning set to ${selection.mode === 'explicit' ? effortLabel(selection.effort) : 'Default'}.`);
}

function renderSensitivity(snapshot = sensitivityController.snapshot()) {
  const percent = snapshot.sensitivityPercent;
  sensitivityPercent = percent;
  if (els.sensitivityInput) els.sensitivityInput.value = String(percent);
  if (els.sensitivityValue) els.sensitivityValue.textContent = `${percent}%`;
}

function showSensitivityHud(snapshot = sensitivityController.snapshot()) {
  if (!els.sensitivityHud) return;
  clearTimeout(sensitivityHudTimer);
  els.sensitivityHud.textContent = `Sensitivity · ${snapshot.sensitivityPercent}%`;
  els.sensitivityHud.hidden = false;
  sensitivityHudTimer = setTimeout(() => {
    els.sensitivityHud.hidden = true;
    els.sensitivityHud.textContent = '';
  }, 1400);
}

function beginOpeningStatus(generation) {
  const revision = ++openingStatusRevision;
  clearTimeout(openingStatusTimer);
  if (els.favoriteOpeningStatus) {
    els.favoriteOpeningStatus.hidden = true;
    els.favoriteOpeningStatus.textContent = '';
  }
  openingStatusTimer = setTimeout(() => {
    if (revision !== openingStatusRevision || !reopening || !els.favoriteOpeningStatus) return;
    const name = dreamDisplayTitle(generation);
    els.favoriteOpeningStatus.textContent = `Opening · ${name}`;
    els.favoriteOpeningStatus.hidden = false;
  }, 150);
  return revision;
}

function endOpeningStatus(revision) {
  if (revision !== openingStatusRevision) return;
  clearTimeout(openingStatusTimer);
  openingStatusRevision += 1;
  if (els.favoriteOpeningStatus) {
    els.favoriteOpeningStatus.hidden = true;
    els.favoriteOpeningStatus.textContent = '';
  }
}

sensitivityController.subscribe(renderSensitivity);
renderQualityController.subscribe(applyRenderQuality);

playbackController.subscribe(renderPlayback);

function dreamLifecycleDetail(phase, eventDetail = {}) {
  if (eventDetail.message) return eventDetail.message;
  if (phase === DREAM_JOB_PHASES.SENDING) return 'Request sent. Keep watching or collapse this panel.';
  if (phase === DREAM_JOB_PHASES.WORKING) {
    const waitingMs = performance.now() - Number(eventDetail.requestStartedAt || performance.now());
    return waitingMs >= 45000
      ? 'Still working. Some models take several minutes, and the request remains open.'
      : 'The model is creating your visual.';
  }
  if (phase === DREAM_JOB_PHASES.RECEIVING) return 'Response started. Waiting for the complete visual.';
  if (phase === DREAM_JOB_PHASES.CHECKING) return 'The response arrived. Checking it safely in the background.';
  return eventDetail.message || '';
}

window.addEventListener('visualizer:dream-lifecycle', event => {
  const detail = event.detail || {};
  const phase = ({
    sending: DREAM_JOB_PHASES.SENDING,
    working: DREAM_JOB_PHASES.WORKING,
    receiving: DREAM_JOB_PHASES.RECEIVING,
    checking: DREAM_JOB_PHASES.CHECKING,
  })[detail.phase];
  if (!phase) return;
  const job = dreamJobController.snapshot();
  if (!job.id || !generating || detail.modelId !== job.modelId) return;
  if (!detail.traceId || !activeDreamTraceId || detail.traceId !== activeDreamTraceId) return;
  try {
    const patch = { detail: dreamLifecycleDetail(phase, detail) };
    if (phase === DREAM_JOB_PHASES.CHECKING) patch.cancellable = false;
    dreamJobController.transition(job.id, phase, patch);
  } catch {
    // Late provider lifecycle events cannot mutate a completed or replaced job.
  }
});

function isFatalEvent(message) {
  return message?.type === 'diagnostic-event' && message.event?.severity === 'fatal';
}

function flushPendingActiveFailure() {
  if (!pendingActiveFailure || promotion || recovering || reopening || deletingGeneration) return;
  const pending = pendingActiveFailure;
  pendingActiveFailure = null;
  if (pending.sandbox === activeSlot.sandbox && pending.sessionId === activeSlot.sandbox.sessionId) {
    queueRuntimeRecovery(pending.event);
  }
}

function pushLiveDiagnostic(source, message) {
  if (!devMode) return;
  const event = message?.event || message?.heartbeat || message?.ready || null;
  if (!event && !['mode', 'render-quality-applied'].includes(message?.type)) return;
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
    if (message.trustedActivity === true) {
      const mode = performance.now() - lastKeyboardUiActivityAt < 200 ? 'keyboard' : 'pointer';
      showUi('iframe-pointer', mode);
    }
  }

  if (message.type === 'user-activity' && (sandbox === activeSlot.sandbox || promotion?.candidate === sandbox)) {
    const kind = ['keyboard', 'wheel', 'touch'].includes(message.kind) ? message.kind : 'pointer';
    if (kind === 'keyboard') lastKeyboardUiActivityAt = performance.now();
    showUi(`iframe-${kind}`, kind === 'keyboard' ? 'keyboard' : 'pointer');
  }

  if (promotion?.candidate === sandbox && isFatalEvent(message)) {
    promotion.resolveFatal?.({
      schema: RELIABILITY_SCHEMA,
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

  if (sandbox === activeSlot.sandbox && isFatalEvent(message)) {
    if (promotion || recovering || reopening || deletingGeneration) {
      pendingActiveFailure = { sandbox, sessionId: sandbox.sessionId, event: message.event };
    } else {
      queueRuntimeRecovery(message.event);
    }
  }
}

function setSelectedModel(model) {
  selectedModel = model;
  if (model) {
    localSettingsStorage?.setItem('ai-visualizer.selected-model', model.id);
    els.modelButton.title = `${model.id}${priceLabel(model) ? ` · ${priceLabel(model)}` : ''}`;
  } else {
    els.modelButton.removeAttribute('title');
  }
  setNextIdentity(model);
  renderReasoningControl({ announceStale: els.modelDrawer?.classList.contains('is-open') });
  renderModels();
  window.dispatchEvent(new CustomEvent('visualizer:selected-model-changed', {
    detail: { modelId: model?.id || '' },
  }));
}

function openDrawer(drawer) {
  if (!anyDrawerOpen() && document.activeElement instanceof HTMLElement) drawerReturnFocus = document.activeElement;
  drawerElements.forEach(candidate => {
    const open = candidate === drawer;
    candidate.classList.toggle('is-open', open);
    candidate.setAttribute('aria-hidden', String(!open));
    candidate.inert = !open;
  });
  els.stage.inert = true;
  els.drawerScrim.hidden = false;
  showUi('drawer-open');
  queueMicrotask(() => drawer.querySelector('button:not(:disabled), input:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')?.focus());
}

function closeDrawers({ restoreFocus = true } = {}) {
  drawerElements.forEach(drawer => {
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.inert = true;
  });
  els.drawerScrim.hidden = true;
  els.stage.inert = Boolean(document.querySelector('#spendDrawer.is-open'));
  if (restoreFocus) {
    const target = drawerReturnFocus?.isConnected && !drawerReturnFocus.closest('[hidden], [aria-hidden="true"]')
      ? drawerReturnFocus
      : els.switcherButton;
    queueMicrotask(() => target?.focus());
  }
  drawerReturnFocus = null;
  scheduleUiHide();
}

function trapDrawerFocus(event) {
  if (event.key !== 'Tab') return false;
  const drawer = [...document.querySelectorAll('.drawer.is-open:not([inert])')].at(-1);
  if (!drawer) return false;
  const focusable = [...drawer.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])')]
    .filter(element => element.getClientRects().length > 0);
  if (!focusable.length) return false;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!drawer.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

function anyDrawerOpen() {
  return Boolean(document.querySelector('.drawer.is-open'));
}

function visibleHostDialog() {
  if (document.querySelector('dialog[open]')) return 'dialog-open';
  for (const selector of ['#costConfirmBackdrop:not([hidden])']) {
    if (document.querySelector(selector)) return selector.slice(1).split(':')[0];
  }
  return '';
}

function keyboardFocusPinsUi() {
  if (immersiveUiController?.snapshot().inputMode !== 'keyboard') return false;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return false;
  return true;
}

function immersiveUiBlocker() {
  if (anyDrawerOpen()) return 'drawer-open';
  if (dreamSwitcher?.isOpen()) return 'dream-switcher-open';
  if (visualPaused) return 'playback-paused';
  const dialog = visibleHostDialog();
  if (dialog) return dialog;
  if (keyboardFocusPinsUi()) return 'keyboard-focus';
  return '';
}

immersiveUiController = createImmersiveUiController({
  getBlocker: immersiveUiBlocker,
  onChange(snapshot) {
    document.body.classList.toggle('ui-hidden', snapshot.hidden);
  },
});

function showUi(reason = 'host-activity', mode = immersiveUiController.snapshot().inputMode) {
  immersiveUiController.wake(reason, { mode });
}

function scheduleUiHide() {
  immersiveUiController.sync();
}

function renderModels() {
  const query = els.modelSearch.value;
  const filtered = models.filter(model => modelSearchMatches(model, query));
  const evidenceSnapshot = devMode ? modelFitEvidenceStore.snapshot() : null;
  const configurationEvidence = new Map((evidenceSnapshot?.configurations || []).map(entry => [entry.key, entry]));
  const modelEvidence = new Map((evidenceSnapshot?.models || []).map(entry => [entry.modelId, entry]));
  const promptProfile = devMode ? loadPromptProfile() : null;
  const fragment = document.createDocumentFragment();
  filtered.slice(0, 650).forEach(model => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'model-option';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(selectedModel?.id === model.id));
    const aggregateState = modelEvidence.get(model.id)?.status;
    const configuration = devMode
      ? modelFitConfiguration(model, promptProfile, reasoningSelectionStore.snapshot(model))
      : null;
    const fitState = aggregateState === MODEL_FIT_STATUSES.KNOWN_INCOMPATIBLE
      ? MODEL_FIT_STATUSES.KNOWN_INCOMPATIBLE
      : configurationEvidence.get(configuration ? modelFitConfigurationKey(configuration) : '')?.status
        || MODEL_FIT_STATUSES.UNTESTED;
    const modelMeta = [priceLabel(model), devMode ? fitState : ''].filter(Boolean).join(' · ');
    if (devMode) button.dataset.modelFitState = fitState;
    button.innerHTML = `<span><span class="model-option__name">${escapeHtml(model.name)}</span><br><span class="model-option__provider">${escapeHtml(model.provider)}</span></span><span class="model-option__meta">${escapeHtml(modelMeta)}</span>`;
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
    empty.textContent = modelCatalogError || 'No models match that search.';
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

function startTraceAttempt(diagnostic, kind, model, {
  reasoningSelection = null,
  generationConfiguration = null,
} = {}) {
  diagnostic.trace = appendDreamAttempt(diagnostic.trace, {
    kind,
    requestedModelId: model.id,
    displayName: model.name,
    providerId: diagnostic.providerId || 'openrouter',
    upstreamProvider: model.provider || '',
    diagnosticId: diagnostic.id,
  });
  const attempt = diagnostic.trace.attempts.at(-1);
  if (reasoningSelection || generationConfiguration) {
    diagnostic.trace = patchDreamAttempt(diagnostic.trace, attempt.id, {
      request: {
        policy: {
          userReasoningSelection: reasoningSelection,
          modelFitConfiguration: generationConfiguration,
          generationEnvelopeVersion: GENERATION_ENVELOPE_VERSION,
        },
      },
    });
  }
  const captureContext = beginTraceCapture({
    traceId: diagnostic.trace.id,
    attemptId: attempt.id,
    displayName: model.name,
    modelId: model.id,
    attemptNumber: attempt.number,
    kind,
    reasoningSelection,
    generationConfiguration,
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
      providerGenerationId: result.providerGenerationId || patch.response?.providerGenerationId || '',
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

function selectDiagnosticRecord(id) {
  const recordId = String(id || '');
  rawDiagnosticDetailsState.select(recordId);
  els.diagnosticsList?.querySelectorAll('details[open]').forEach(details => {
    if (details.closest('[data-diagnostic-id]')?.dataset.diagnosticId !== recordId) details.open = false;
  });
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
  selectDiagnosticRecord(record.id);
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

function createHarness(sandbox, diagnostic, traceAttempt = null, jobOwner = null) {
  return new DreamReliabilityHarness({
    sandbox,
    onStage: event => {
      const job = dreamJobController.snapshot();
      if (dreamJobOwnsReliabilityStage({
        generating,
        owner: jobOwner,
        diagnosticTraceId: diagnostic.trace.id,
        activeTraceId: activeDreamTraceId,
        job,
      })) {
        try {
          dreamJobController.transition(jobOwner.jobId, DREAM_JOB_PHASES.CHECKING, {
            detail: 'Checking the complete visual safely in the background.',
          });
        } catch {
          // A stale reliability stage cannot reopen a completed job.
        }
      }
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
    schema: RELIABILITY_SCHEMA,
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

async function withCandidateSlot(operation) {
  const previous = candidateSlotTail;
  let release;
  candidateSlotTail = new Promise(resolve => { release = resolve; });
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
  }
}

async function evaluateCandidate(result, diagnostic, attemptNumber, signal, traceAttempt = null, {
  quickReopen = false,
  jobOwner = null,
} = {}) {
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

  const candidateSandbox = standbySlot.sandbox;
  candidateSandbox.setPaused(false);
  const harness = createHarness(candidateSandbox, diagnostic, traceAttempt, jobOwner);
  const health = await (quickReopen ? harness.reopen(result.html, {
    viewport: currentViewport(),
    signal,
  }) : harness.preflight(result.html, {
    viewport: currentViewport(),
    signal,
  }));
  attempt.reliability = health;
  diagnostic.reliability = health;
  attempt.finishedAt = Date.now();
  if (traceAttempt) patchTraceAttempt(diagnostic, traceAttempt, { artifact: reliabilityEvidence(health) });
  await persistDiagnostic(diagnostic);
  return {
    passed: health.passed,
    health,
    attempt,
    harness,
    candidateSandbox,
    candidateSessionId: candidateSandbox.sessionId,
  };
}

function swapSlots() {
  const previousActive = activeSlot;
  activeSlot = standbySlot;
  standbySlot = previousActive;
  activeSlot.sandbox.setPresentation('active');
  standbySlot.sandbox.setPresentation('standby');
}

async function promoteCandidate({ harness, qualification, candidateSandbox, candidateSessionId, diagnostic, signal, traceAttempt = null, onCommit = () => {} }) {
  if (
    !candidateSandbox
    || standbySlot.sandbox !== candidateSandbox
    || candidateSandbox.sessionId !== candidateSessionId
  ) throw new Error('The Dream candidate slot changed before it could open safely.');
  const promotionStartedAt = Date.now();
  if (traceAttempt) patchTraceAttempt(diagnostic, traceAttempt, {
    timing: { promotionStartedAt, watchdogStartedAt: promotionStartedAt },
  });
  addDiagnosticTimeline(diagnostic, 'promotion:started');
  await persistDiagnostic(diagnostic);

  standbySlot.sandbox.setPaused(visualPaused);
  await standbySlot.sandbox.waitForPlayback(visualPaused);
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
      harness.watchdog({ durationMs: 3600, signal, previousReport: latestCurrentVisualReport(qualification) }),
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
  const retiredSandbox = standbySlot.sandbox;
  const retiredSessionId = retiredSandbox.sessionId;
  setTimeout(() => {
    if (retiredSandbox.sessionId === retiredSessionId) retiredSandbox.clear();
  }, 420);
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
      return `${prefix.toLowerCase()}did not respond to the music signal, so it stayed safely in the background.`;
    case FAILURE_CODES.WEBGL_CONTEXT_LOST:
    case FAILURE_CODES.RUNTIME_STALLED:
    case FAILURE_CODES.PERFORMANCE_COLLAPSE:
      return `${prefix.toLowerCase()}became unstable, so your previous visual is still here.`;
    case FAILURE_CODES.INVALID_HTML:
      return `${prefix.toLowerCase()}did not return a complete visualizer document, so your current Dream is still here.`;
    default:
      return `${prefix.toLowerCase()}could not open safely. Your previous visualizer is still here.`;
  }
}

function friendlyPipelineFailure(failure) {
  const classifiedCopy = generationFailureCopy(failure?.code);
  if (classifiedCopy) return classifiedCopy;
  const sanitized = String(sanitizeTraceValue(failure?.message || 'The AI service could not finish this Dream.'))
    .replace(/OpenRouter/gi, 'The AI service')
    .replace(/\bprovider\b/gi, 'AI service')
    .replace(/\bHTTP\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${sanitized.slice(0, 240)}${/[.!?]$/.test(sanitized) ? '' : '.'}`;
}

function modelFitConfiguration(model, promptProfile, reasoningSelection) {
  return createModelFitConfigurationIdentity({
    modelId: model.id,
    reasoningSelection,
    promptProfileId: promptProfile.id,
    promptVersion: PROMPT_VERSION,
    promptHash: promptProfile.briefHash,
    generationEnvelopeVersion: GENERATION_ENVELOPE_VERSION,
    audioApiVersion: AUDIO_API_VERSION,
    reliabilityVersion: RELIABILITY_SCHEMA,
    runtimeVersion: VISUALIZER_RUNTIME_VERSION,
  });
}

function modelFitConfigurationForTrace(diagnostic, model, promptProfile, fallbackSelection) {
  const appliedSelection = [...(diagnostic?.trace?.attempts || [])].reverse()
    .map(attempt => attempt?.request?.policy?.appliedReasoningSelection)
    .find(Boolean);
  return modelFitConfiguration(model, promptProfile, appliedSelection || fallbackSelection);
}

function modelFitVersions(promptProfile = loadPromptProfile()) {
  return {
    promptProfileId: promptProfile.id,
    promptVersion: PROMPT_VERSION,
    promptHash: promptProfile.briefHash,
    generationEnvelopeMajorVersion: 1,
    audioApiVersion: AUDIO_API_VERSION,
    reliabilityVersion: RELIABILITY_SCHEMA,
    runtimeVersion: VISUALIZER_RUNTIME_VERSION,
  };
}

function promptLibraryEntryIdFor(promptProfile) {
  const matches = readPromptLibraryEntries(localSettingsStorage).filter(entry => (
    entry.profileId === promptProfile?.id
    && entry.briefHash === promptProfile?.briefHash
    && entry.name === promptProfile?.name
  ));
  return matches.length === 1 ? matches[0].entryId : '';
}

function publishModelFitEvidence(modelId) {
  window.dispatchEvent(new CustomEvent('visualizer:model-fit-evidence-changed', {
    detail: { modelId },
  }));
  if (devMode) {
    renderModels();
    scheduleDiagnosticsRender();
  }
}

function recordDiagnosticModelFit(diagnostic, configuration, result = {}) {
  try {
    const observation = modelFitObservationFromDreamTrace(diagnostic.trace, configuration, result);
    const recorded = modelFitEvidenceStore.recordObservation(observation);
    if (recorded.recorded) publishModelFitEvidence(configuration.modelId);
    return recorded;
  } catch (error) {
    console.warn('Model-fit evidence could not be recorded:', error);
    return null;
  }
}

function recordOpenModelFit(generation, diagnostic, { succeeded, failureCode = '' } = {}) {
  const originalConfiguration = generation?.modelFitConfiguration;
  if (!originalConfiguration) return null;
  try {
    const configuration = createModelFitConfigurationIdentity({
      ...originalConfiguration,
      reliabilityVersion: RELIABILITY_SCHEMA,
      runtimeVersion: VISUALIZER_RUNTIME_VERSION,
    });
    const recorded = modelFitEvidenceStore.recordObservation({
      observationId: `${diagnostic.id}:${succeeded ? 'live-open' : 'open-failed'}`,
      configuration,
      attemptedAt: diagnostic.finishedAt || Date.now(),
      resultCategory: succeeded
        ? MODEL_FIT_RESULT_CATEGORIES.LIVE_OPEN
        : failureCode || MODEL_FIT_RESULT_CATEGORIES.RUNTIME_RELIABILITY_FAILURE,
      liveSuccess: Boolean(succeeded),
      openSuccess: Boolean(succeeded),
      providerAttemptCount: 0,
      artifactBytes: new TextEncoder().encode(String(generation.html || '')).byteLength,
    });
    if (recorded.recorded) publishModelFitEvidence(configuration.modelId);
    return recorded;
  } catch (error) {
    console.warn('Model Open evidence could not be recorded:', error);
    return null;
  }
}

function markDeterministicModelIncompatibility(error, model) {
  const deterministicReasons = new Set(['BATCH_ONLY', 'EXPIRED', 'NO_TEXT_OUTPUT', 'OUTPUT_TOO_SMALL', 'OUTPUT_LIMIT_UNENFORCEABLE']);
  if (error?.code !== 'MODEL_NOT_LIVE_DREAM_COMPATIBLE' || !deterministicReasons.has(error?.eligibilityReason)) return;
  try {
    modelFitEvidenceStore.markModelKnownIncompatible(model.id, {
      code: error.eligibilityReason,
      source: 'openrouter live catalog eligibility',
    });
    publishModelFitEvidence(model.id);
  } catch (evidenceError) {
    console.warn('Deterministic model incompatibility could not be recorded:', evidenceError);
  }
}

async function runRepair(result, failureReport, diagnostic, signal, requestedModel, promptProfile, reasoningSelection, generationConfiguration) {
  const problem = failureReport?.repairProblem
    || `${failureReport?.failure?.code || 'ARTIFACT_FAILURE'}\n${failureReport?.failure?.message || 'The candidate failed its runtime check.'}`;
  diagnostic.repairUsed = true;
  diagnostic.repairProblem = problem;
  const traceAttempt = startTraceAttempt(diagnostic, 'repair', requestedModel, {
    reasoningSelection,
    generationConfiguration,
  });
  patchTraceAttempt(diagnostic, traceAttempt, { artifact: { repairProblem: problem } });
  addDiagnosticTimeline(diagnostic, 'repair:requested', {
    failureCode: failureReport?.failure?.code || '',
  });
  await persistDiagnostic(diagnostic);
  let repaired;
  try {
    repaired = await repairVisualizer({
      modelId: requestedModel.id,
      raw: result.raw || result.html,
      problem,
      signal,
      traceContext: traceAttempt.captureContext,
      promptProfile,
      reasoningSelection,
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
  if (!store.persistent) {
    showToast('Local Dream storage is unavailable, so no paid request was sent. Check this browser’s site-storage settings.', 7200);
    return;
  }

  const requestedModel = structuredClone(selectedModel);
  const promptProfile = structuredClone(loadPromptProfile());
  const reasoningSelection = structuredClone(reasoningSelectionStore.snapshot(requestedModel));
  let generationConfiguration = modelFitConfiguration(requestedModel, promptProfile, reasoningSelection);
  const identityAtStart = identityController.snapshot();
  const generationId = crypto.randomUUID();
  const job = dreamJobController.start({
    model: requestedModel,
    promptProfile,
    reasoningSelection,
    generationConfiguration,
    detail: 'Your current Dream keeps playing while the model works.',
  });

  generating = true;
  showUi();
  els.dreamButton.disabled = true;
  activeDreamController = new AbortController();
  const signal = activeDreamController.signal;
  const diagnostic = createDiagnosticRecord({
    model: requestedModel,
    providerId: 'openrouter',
    liveSnapshot: identityAtStart,
    nextSnapshot: identityAtStart.next,
  });
  activeDreamTraceId = diagnostic.trace.id;
  const reliabilityOwner = Object.freeze({ jobId: job.id, traceId: diagnostic.trace.id });
  diagnostic.promptVersion = PROMPT_VERSION;
  diagnostic.promptProfile = sanitizeTraceValue(promptProfile);
  diagnostic.audioApiVersion = AUDIO_API_VERSION;
  diagnostic.reasoningSelection = sanitizeTraceValue(reasoningSelection);
  diagnostic.generationEnvelopeVersion = GENERATION_ENVELOPE_VERSION;
  diagnostic.modelFitConfiguration = sanitizeTraceValue(generationConfiguration);
  diagnostic.attempts = [];
  addDiagnosticTimeline(diagnostic, 'generation:started');
  let traceAttempt = startTraceAttempt(diagnostic, 'generation', requestedModel, {
    reasoningSelection,
    generationConfiguration,
  });
  await persistDiagnostic(diagnostic);

  let result;
  try {
    try {
      result = await generateVisualizer({
        modelId: requestedModel.id,
        signal,
        traceContext: traceAttempt.captureContext,
        promptProfile,
        reasoningSelection,
      });
      absorbTraceCapture(diagnostic, traceAttempt, result);
      generationConfiguration = modelFitConfigurationForTrace(
        diagnostic,
        requestedModel,
        promptProfile,
        result.reasoningSelection || reasoningSelection,
      );
      diagnostic.modelFitConfiguration = sanitizeTraceValue(generationConfiguration);
    } catch (error) {
      absorbTraceCapture(diagnostic, traceAttempt);
      closeTraceAttempt(diagnostic, traceAttempt, 'failed', { error });
      throw error;
    }
    applyProviderResult(diagnostic, result);
    addDiagnosticTimeline(diagnostic, 'generation:response-complete', {
      requestId: result.requestId || '',
      providerGenerationId: result.providerGenerationId || '',
      resolvedModel: result.resolvedModel || requestedModel.id,
      outputBytes: diagnostic.outputBytes,
    });
    await persistDiagnostic(diagnostic);

    for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
      dreamJobController.transition(job.id, DREAM_JOB_PHASES.CHECKING, {
        detail: 'Checking the complete visual safely in the background.',
      });
      const candidate = await withCandidateSlot(async () => {
        const candidateSandbox = standbySlot.sandbox;
        try {
          return await evaluateCandidate(result, diagnostic, attemptNumber, signal, traceAttempt, {
            jobOwner: reliabilityOwner,
          });
        } finally {
          if (standbySlot.sandbox === candidateSandbox) {
            candidateSandbox.setPresentation('standby');
            candidateSandbox.clear();
          }
        }
      });
      const failureReport = candidate.health;

      if (candidate.passed) {
        if (signal.aborted) throw new DOMException('Dream cancelled before its ready artifact was committed.', 'AbortError');
        dreamJobController.transition(job.id, DREAM_JOB_PHASES.CHECKING, { cancellable: false });
        const createdAt = Date.now();
        const generation = {
          schema: 'visualizer-generation-v1',
          id: generationId,
          source: 'local',
          jobId: job.id,
          modelId: requestedModel.id,
          modelName: requestedModel.name,
          provider: requestedModel.provider,
          providerId: 'openrouter',
          resolvedModel: result.resolvedModel,
          requestId: result.requestId || '',
          providerGenerationId: result.providerGenerationId || '',
          promptVersion: PROMPT_VERSION,
          promptProfileId: promptProfile.id,
          promptProfileName: promptProfile.name,
          promptProfile: sanitizeTraceValue(promptProfile),
          promptLibraryEntryId: promptLibraryEntryIdFor(promptProfile),
          reasoningSelection: sanitizeTraceValue(result.reasoningSelection || reasoningSelection),
          generationEnvelopeVersion: GENERATION_ENVELOPE_VERSION,
          modelFitConfiguration: sanitizeTraceValue(generationConfiguration),
          modelFitConfigurationKey: modelFitConfigurationKey(generationConfiguration),
          audioApiVersion: AUDIO_API_VERSION,
          createdAt,
          readyAt: createdAt,
          favorite: false,
          battleWins: 0,
          battleLosses: 0,
          attempt: result.attempt,
          usage: result.usage,
          html: result.html,
          artifactTitle: htmlDocumentTitle(result.html),
          diagnosticId: diagnostic.id,
          traceId: diagnostic.trace.id,
          healthStatus: 'ready',
          openStatus: 'ready-to-open',
          healthSummary: candidate.health.summary,
          preflightEvidence: {
            schema: candidate.health.schema,
            passed: true,
            summary: candidate.health.summary,
            warnings: candidate.health.warnings || [],
            checkedAt: createdAt,
          },
        };
        try {
          await store.put(generation);
        } catch (storageError) {
          console.warn('A ready Dream could not be saved:', storageError);
          throw new Error('The Dream passed its checks, but this browser could not save it safely. Your current Dream is unchanged.', { cause: storageError });
        }
        closeTraceAttempt(diagnostic, traceAttempt, 'ready', {
          identity: { generationId: generation.id, openStatus: generation.openStatus },
          artifact: reliabilityEvidence(candidate.health),
        });
        finalizeDiagnosticTrace(diagnostic, 'ready', { generationId: generation.id });
        diagnostic.generationId = generation.id;
        finishDiagnostic(diagnostic, { status: 'ready', generationId: generation.id });
        await persistDiagnostic(diagnostic);
        recordDiagnosticModelFit(diagnostic, generationConfiguration, { readySuccess: true });
        dreamJobController.transition(job.id, DREAM_JOB_PHASES.READY, {
          artifact: {
            generationId: generation.id,
            favorite: false,
            displayTitle: dreamDisplayTitle(generation),
            promptLabel: dreamPromptLabel(generation),
          },
          detail: 'Ready whenever you are. Open it now or find it later in Recent.',
          cancellable: false,
        });
        showToast('Dream ready', 4200);
        await renderLibrary();
        return;
      }

      if (attemptNumber === 2 || diagnostic.repairUsed) {
        closeTraceAttempt(diagnostic, traceAttempt, 'failed', {
          artifact: { ...reliabilityEvidence(failureReport), repairProblem: failureReport?.repairProblem || '' },
        });
        throw new DreamReliabilityError(failureReport.failure, failureReport);
      }
      closeTraceAttempt(diagnostic, traceAttempt, 'repair-required', {
        artifact: { ...reliabilityEvidence(failureReport), repairProblem: failureReport?.repairProblem || '' },
      });
      const repair = await runRepair(
        result,
        failureReport,
        diagnostic,
        signal,
        requestedModel,
        promptProfile,
        reasoningSelection,
        generationConfiguration,
      );
      result = repair.result;
      traceAttempt = repair.traceAttempt;
    }
  } catch (error) {
    const cancelled = error?.name === 'AbortError' || error?.code === 'CANCELLED';
    const failureCode = cancelled
      ? GENERATION_FAILURE_CATEGORIES.CANCELLED
      : ['DREAM_TIMEOUT', 'DREAM_IDLE_TIMEOUT', 'DREAM_HARD_TIMEOUT'].includes(error?.code)
        ? GENERATION_FAILURE_CATEGORIES.PROVIDER_TIMEOUT
        : error?.code || 'PROVIDER_OR_PIPELINE_FAILURE';
    const failure = error instanceof DreamReliabilityError
      ? error.failure
      : {
          code: failureCode,
          message: error?.message || 'That Dream failed.',
        };
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
    generationConfiguration = modelFitConfigurationForTrace(
      diagnostic,
      requestedModel,
      promptProfile,
      reasoningSelection,
    );
    recordDiagnosticModelFit(diagnostic, generationConfiguration);
    markDeterministicModelIncompatibility(error, requestedModel);
    const message = error instanceof DreamReliabilityError
      ? friendlyFailure(failure, diagnostic.repairUsed)
      : friendlyPipelineFailure(failure);
    const suffix = devMode ? ` Diagnostic ${shortDiagnosticId(diagnostic.id)}.` : '';
    const latestJob = dreamJobController.snapshot();
    try {
      dreamJobController.transition(job.id, cancelled ? DREAM_JOB_PHASES.CANCELLED : DREAM_JOB_PHASES.FAILED, {
        detail: cancelled ? 'No further request will be sent. Your current Dream is unchanged.' : message,
        failure,
        cancellable: false,
      });
    } catch {
      // A stale failure cannot replace a newer job state.
    }
    if (latestJob.id === job.id) showToast(`${cancelled ? 'Dream cancelled' : 'Dream failed safely'}.${suffix}`, 6200);
    else showToast(`${message}${suffix}`, 7600);
  } finally {
    window.dispatchEvent(new CustomEvent('visualizer:dream-job-terminal'));
    activeDreamController = null;
    activeDreamTraceId = '';
    generating = false;
    els.dreamButton.disabled = false;
    scheduleUiHide();
  }
}

async function openGeneration(generation, { close = true, jobId = '', source = 'local', quiet = false } = {}) {
  if (recovering || reopening || deletingGeneration || promotion) return false;
  const visibleJob = dreamJobController.snapshot();
  if (!jobId && source === 'local' && visibleJob.phase === DREAM_JOB_PHASES.READY && visibleJob.artifact?.generationId === generation.id) {
    jobId = visibleJob.id;
  }
  reopening = true;
  const openingRevision = beginOpeningStatus(generation);
  const model = models.find(candidate => candidate.id === generation.modelId) || {
    id: generation.modelId,
    name: generation.modelName || generation.modelId,
    provider: generation.provider || 'saved',
  };
  const identityAtStart = identityController.snapshot();
  const diagnostic = createDiagnosticRecord({
    model,
    providerId: generation.providerId || 'openrouter',
    kind: source === 'featured' ? 'featured-open' : 'library-reopen',
    liveSnapshot: identityAtStart,
    nextSnapshot: identityAtStart.next,
  });
  let identityToken = '';
  diagnostic.promptVersion = generation.promptVersion || '';
  diagnostic.promptProfile = generation.promptProfile || null;
  diagnostic.audioApiVersion = generation.audioApiVersion || '';
  diagnostic.html = generation.html;
  diagnostic.outputBytes = new TextEncoder().encode(String(generation.html || '')).byteLength;
  diagnostic.attempts = [];
  addDiagnosticTimeline(diagnostic, 'library-reopen:started', { generationId: generation.id });
  await persistDiagnostic(diagnostic);

  if (jobId) {
    try {
      dreamJobController.transition(jobId, DREAM_JOB_PHASES.OPENING, {
        detail: 'Opening carefully. Your current Dream stays visible until this one is ready to take over.',
        cancellable: false,
      });
    } catch {
      reopening = false;
      flushPendingActiveFailure();
      return false;
    }
  }
  try {
    const result = {
      html: generation.html,
      raw: generation.html,
      resolvedModel: generation.resolvedModel || generation.modelId,
      requestId: generation.requestId || '',
      usage: generation.usage || null,
      attempt: generation.attempt || 1,
    };
    const quickReopen = ['ready', 'verified'].includes(generation.healthStatus)
      && generation.preflightEvidence?.passed === true
      && generation.preflightEvidence?.schema === RELIABILITY_SCHEMA;
    const candidate = await withCandidateSlot(async () => {
      const candidateSandbox = standbySlot.sandbox;
      identityToken = stageLiveCandidate(liveIdentityForGeneration(generation, {
        kind: source === 'featured' ? 'featured' : 'saved',
        diagnosticId: diagnostic.id,
      }));
      try {
        const checked = await evaluateCandidate(result, diagnostic, 1, null, null, { quickReopen });
        if (!checked.passed) throw new DreamReliabilityError(checked.health.failure, checked.health);
        const watchdog = await promoteCandidate({
          harness: checked.harness,
          qualification: checked.health,
          candidateSandbox: checked.candidateSandbox,
          candidateSessionId: checked.candidateSessionId,
          diagnostic,
          signal: null,
          onCommit: () => {
            commitLiveCandidate(identityToken);
            identityToken = '';
            currentGeneration = generation;
            currentHtml = generation.html;
            currentDiagnosticId = diagnostic.id;
            currentDreamKey = source === 'featured' ? generation.key : localDreamKey(generation);
          },
        });
        if (!watchdog.passed) throw new DreamReliabilityError(watchdog.failure, watchdog);
        return checked;
      } catch (error) {
        if (standbySlot.sandbox === candidateSandbox) {
          candidateSandbox.setPresentation('standby');
          candidateSandbox.clear();
        }
        throw error;
      }
    });
    if (source === 'local') {
      try {
        const updated = await store.update(generation.id, {
          healthStatus: 'verified',
          openStatus: 'verified-live',
          healthSummary: candidate.health.summary,
          preflightEvidence: {
            schema: RELIABILITY_SCHEMA,
            passed: true,
            checkedAt: Date.now(),
            source: quickReopen ? 'safe-reopen' : 'full-revalidation',
          },
          lastDiagnosticId: diagnostic.id,
          lastOpenedAt: Date.now(),
        });
        if (updated) currentGeneration = updated;
      } catch (storageError) {
        console.warn('Saved Dream opened, but its health metadata could not be updated:', storageError);
      }
    }
    finalizeDiagnosticTrace(diagnostic, 'succeeded', { generationId: generation.id });
    finishDiagnostic(diagnostic, { status: 'succeeded', generationId: generation.id });
    await persistDiagnostic(diagnostic);
    recordOpenModelFit(generation, diagnostic, { succeeded: true });
    renderFavoriteControl();
    els.topStatus.textContent = 'Playing';
    if (jobId) {
      const job = dreamJobController.snapshot();
      dreamJobController.transition(jobId, DREAM_JOB_PHASES.LIVE, {
        artifact: {
          ...job.artifact,
          generationId: generation.id,
          favorite: Boolean(currentGeneration?.favorite),
          displayTitle: dreamDisplayTitle(currentGeneration || generation),
          promptLabel: dreamPromptLabel(currentGeneration || generation),
        },
        detail: 'This Dream is now LIVE.',
        cancellable: false,
      });
    }
    if (close) closeDrawers();
    if (!quiet) showToast('Dream opened');
    await renderLibrary();
    return true;
  } catch (error) {
    activeSlot.sandbox.setPresentation('active');
    const failure = error instanceof DreamReliabilityError
      ? error.failure
      : { code: 'REOPEN_FAILED', message: error?.message || 'The saved Dream could not be opened.' };
    if (identityToken) {
      discardLiveCandidate(identityToken);
      identityToken = '';
    }
    if (source === 'local') {
      try {
        await store.update(generation.id, {
          healthStatus: generation.healthStatus === 'ready' ? 'ready' : 'failed-on-device',
          openStatus: 'failed-to-open',
          lastOpenFailure: { code: failure.code, message: failure.message, at: Date.now() },
          lastDiagnosticId: diagnostic.id,
        });
      } catch (storageError) {
        console.warn('Failed Open evidence could not be updated in local storage:', storageError);
      }
    }
    finishDiagnostic(diagnostic, {
      status: 'failed',
      failureCode: failure.code,
      failureMessage: failure.message,
      generationId: generation.id,
    });
    finalizeDiagnosticTrace(diagnostic, 'failed', { failure });
    await persistDiagnostic(diagnostic);
    recordOpenModelFit(generation, diagnostic, { succeeded: false, failureCode: failure.code });
    if (jobId) {
      dreamJobController.transition(jobId, DREAM_JOB_PHASES.FAILED_OPEN, {
        detail: 'The previous Dream stayed LIVE. You can try this Dream again from Recent.',
        failure,
        cancellable: false,
      });
    }
    showToast(`Could not open safely. Your current Dream stayed LIVE.${devMode ? ` Diagnostic ${shortDiagnosticId(diagnostic.id)}.` : ''}`, 7000);
    await renderLibrary();
    return false;
  } finally {
    if (identityToken) discardLiveCandidate(identityToken);
    endOpeningStatus(openingRevision);
    reopening = false;
    flushPendingActiveFailure();
    scheduleUiHide();
  }
}

function featuredArtifact(featured) {
  return {
    ...featured,
    id: `featured:${featured.id}`,
    key: featured.key || `featured:${featured.id}`,
    source: 'featured',
    artifactId: featured.id,
    modelId: featured.modelId,
    modelName: featured.modelName,
    provider: featured.provenance?.generatedByModel ? String(featured.modelId).split('/')[0] : 'built-in',
    providerId: featured.provenance?.generatedByModel ? 'openrouter' : 'built-in',
    promptProfileId: featured.promptProfileId,
    promptVersion: featured.promptVersion,
    audioApiVersion: featured.audioApiVersion,
    createdAt: 0,
    favorite: false,
    healthStatus: 'verified',
    openStatus: 'ready-to-open',
    preflightEvidence: {
      passed: true,
      schema: featured.reliability?.contract || 'dream-reliability-v1',
      source: 'featured-manifest',
    },
  };
}

async function openSwitcherItem(item) {
  if (item.active) {
    dreamSwitcher?.close({ restoreFocus: true });
    return true;
  }
  const opened = item.source === 'featured'
    ? await openGeneration(featuredArtifact(item.featured), { close: false, source: 'featured' })
    : await openGeneration(item.generation, { close: false });
  if (opened) dreamSwitcher?.close({ restoreFocus: true });
  return opened;
}

async function toggleSwitcherFavorite(item) {
  if (item.source !== 'local') return;
  const updated = await store.toggleFavorite(item.id);
  if (!updated) return;
  if (currentGeneration?.id === item.id) {
    currentGeneration = updated;
    renderFavoriteControl();
  }
  const job = dreamJobController.snapshot();
  if (job.artifact?.generationId === item.id) {
    dreamJobController.transition(job.id, job.phase, {
      artifact: { ...job.artifact, generationId: item.id, favorite: Boolean(updated.favorite) },
    });
  }
  await renderLibrary();
}

async function refreshDreamSwitcher(generations = null) {
  if (!dreamSwitcher) return;
  const localDreams = generations || await store.list();
  dreamSwitcher.render(buildDreamSwitcherGroups({
    featured: featuredDreams,
    generations: localDreams,
    activeKey: currentDreamKey,
    savedPrompts: readPromptLibraryEntries(localSettingsStorage),
  }));
}

async function renderLibrary() {
  const all = await store.list();
  const list = favoritesOnly ? all.filter(generation => generation.favorite) : all;
  const savedPrompts = readPromptLibraryEntries(localSettingsStorage);
  const battleEligible = all.filter(generation => generation.healthStatus !== 'failed-on-device');
  els.battleButton.disabled = battleEligible.length < 2;
  const fragment = document.createDocumentFragment();

  list.forEach(generation => {
    const article = document.createElement('article');
    article.dataset.generationId = generation.id;
    const usage = generation.usage || {};
    const displayTitle = dreamDisplayTitle(generation);
    const promptLabel = dreamPromptLabel(generation, { savedPrompts });
    const healthLabel = generation.healthStatus === 'verified'
      ? 'opened safely'
      : generation.healthStatus === 'failed-on-device'
        ? 'failed safely'
        : generation.openStatus === 'failed-to-open'
          ? 'needs attention'
          : generation.openStatus === 'ready-to-open'
            ? 'ready to open'
            : 'legacy · rechecked on open';
    article.className = 'library-item';
    const promptVersion = generation.promptVersion || 'Not captured by this app version.';
    const audioApiVersion = generation.audioApiVersion || 'Not captured by this app version.';
    article.innerHTML = `<div class="library-item__top"><div style="min-width:0"><div class="library-item__name">${escapeHtml(displayTitle)}</div><div class="library-item__time">${escapeHtml(generation.modelName || generation.modelId)} · ${humanTime(generation.createdAt)} · ${generation.favorite ? '♥ favorite' : 'saved dream'} · ${escapeHtml(healthLabel)}</div></div><span class="eyebrow">${generation.battleWins || 0}W</span></div><div class="library-item__actions"><button data-action="open">Open</button><button data-action="favorite">${generation.favorite ? '♥' : '♡'}</button><button data-action="rename">Rename</button><button data-action="delete">Delete</button>${devMode && (generation.traceId || generation.diagnosticId || generation.lastDiagnosticId) ? '<button data-action="diagnostics">Trace</button>' : ''}</div><details><summary>Details</summary><p><code>${escapeHtml(generation.modelId)}</code><br>${escapeHtml(generation.resolvedModel || '')}<br>Prompt: ${escapeHtml(promptLabel)} · ${escapeHtml(generation.promptProfileId || 'not captured')}<br>${escapeHtml(promptVersion)} · ${escapeHtml(audioApiVersion)}<br>${Math.round((generation.html?.length || 0) / 1024)} KB · ${generation.battleWins || 0} wins / ${generation.battleLosses || 0} losses<br>${usage.prompt_tokens || usage.promptTokens || '—'} input tokens · ${usage.completion_tokens || usage.completionTokens || '—'} output tokens${generation.healthSummary?.rendererTypes?.length ? `<br>Renderer: ${escapeHtml(generation.healthSummary.rendererTypes.join(', '))} · ~${generation.healthSummary.approximateFps || '—'} FPS monitor` : ''}${generation.diagnosticId ? `<br>Diagnostic: <code>${escapeHtml(shortDiagnosticId(generation.diagnosticId))}</code>` : ''}</p></details>`;

    article.querySelector('[data-action="open"]').addEventListener('click', () => openGeneration(generation));
    article.querySelector('[data-action="favorite"]').addEventListener('click', async () => {
      await store.toggleFavorite(generation.id);
      if (currentGeneration?.id === generation.id) {
        currentGeneration = await store.get(generation.id);
        renderFavoriteControl();
      }
      await renderLibrary();
    });
    article.querySelector('[data-action="rename"]').addEventListener('click', async () => {
      const requested = window.prompt('Dream title. Leave blank to use its original title.', generation.displayTitle || displayTitle);
      if (requested === null) return;
      try {
        const nextDisplayTitle = editableDreamDisplayTitle(requested);
        const updated = await store.setDisplayTitle(generation.id, nextDisplayTitle);
        if (!updated) return;
        const resolvedTitle = dreamDisplayTitle(updated);
        if (currentGeneration?.id === generation.id) {
          currentGeneration = updated;
          updateLiveDisplayName(updated.id, resolvedTitle);
        }
        if (fallbackGeneration?.id === generation.id) fallbackGeneration = updated;
        const job = dreamJobController.snapshot();
        if (job.artifact?.generationId === generation.id) {
          dreamJobController.transition(job.id, job.phase, {
            artifact: {
              ...job.artifact,
              displayTitle: resolvedTitle,
              promptLabel: dreamPromptLabel(updated),
            },
          });
        }
        showToast(nextDisplayTitle ? `Renamed to ${resolvedTitle}.` : `Using original title: ${resolvedTitle}.`);
        await renderLibrary();
      } catch (error) {
        showToast(error?.message || 'That Dream could not be renamed.');
      }
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
          activeSlot.sandbox.setPaused(visualPaused);
          await activeSlot.sandbox.waitForPlayback(visualPaused);
          activeSlot.sandbox.setPresentation('active');
          activeSlot.sandbox.enterPassiveMode();
          currentGeneration = null;
          currentHtml = DEFAULT_VISUALIZER_HTML;
          currentDiagnosticId = '';
          currentDreamKey = 'featured:calibration-bloom';
          fallbackGeneration = null;
          fallbackHtml = DEFAULT_VISUALIZER_HTML;
          restoreBuiltInIdentity();
          renderFavoriteControl();
          els.topStatus.textContent = 'Built-in visualizer restored';
        }
        await renderLibrary();
      } finally {
        deletingGeneration = false;
        flushPendingActiveFailure();
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
      : 'Nothing here yet. Choose a model and press Dream; it will appear in Recent when it is ready.';
    els.libraryList.appendChild(empty);
  }
  await refreshDreamSwitcher(all);
}

function renderAudioCapabilities() {
  const capabilities = AudioEngine.capabilities();
  els.audioDisplayOption.hidden = !capabilities.display.supported;
  els.audioMicrophoneOption.hidden = !capabilities.microphone.supported;
  els.audioUnavailable.hidden = capabilities.display.supported || capabilities.microphone.supported;
  return capabilities;
}

function closeAudioPicker() {
  if (els.audioPicker.open) els.audioPicker.close();
}

function openAudioPicker() {
  const capabilities = renderAudioCapabilities();
  closeDrawers({ restoreFocus: false });
  dreamSwitcher?.close();
  els.audioButton.setAttribute('aria-expanded', 'true');
  els.audioPicker.showModal();
  showUi('dialog-open');
  const mobile = matchMedia('(max-width: 820px)').matches;
  const preferred = mobile ? els.audioMicrophoneOption : els.audioDisplayOption;
  const fallback = mobile ? els.audioDisplayOption : els.audioMicrophoneOption;
  const first = !preferred.hidden ? preferred : !fallback.hidden ? fallback : document.getElementById('audioPickerClose');
  queueMicrotask(() => first?.focus());
  return capabilities;
}

async function connectAudioSource(sourceKind) {
  const sourceButtons = [els.audioDisplayOption, els.audioMicrophoneOption];
  sourceButtons.forEach(button => { button.disabled = true; });
  els.audioPicker.setAttribute('aria-busy', 'true');
  showCenter(
    sourceKind === 'microphone' ? 'Listening for microphone permission.' : 'Choose what to share.',
    sourceKind === 'microphone'
      ? 'The microphone hears nearby physical audio. It does not capture internal phone audio.'
      : 'Choose a source with audio enabled. Video is ignored.',
  );
  try {
    if (sourceKind === 'microphone') await audio.connectMicrophone();
    else await audio.connectDisplayAudio();
    closeAudioPicker();
    hideCenter();
    showToast(sourceKind === 'microphone'
      ? 'Microphone connected. Audio stays on this device.'
      : 'Audio connected. The visualizer can see the music now.');
  } catch (error) {
    closeAudioPicker();
    hideCenter();
    showToast(error?.message || 'Audio could not be connected.', 6500);
  } finally {
    sourceButtons.forEach(button => { button.disabled = false; });
    els.audioPicker.removeAttribute('aria-busy');
  }
}

async function toggleAudio() {
  showUi();
  if (audio.connected) {
    await audio.stop();
    return;
  }
  openAudioPicker();
}

async function toggleFavorite() {
  if (!currentGeneration || currentGeneration.source === 'featured') {
    showToast(currentGeneration?.source === 'featured' ? 'Featured Dreams are always here.' : 'Open a saved Dream to favorite it.');
    return;
  }
  const next = await store.toggleFavorite(currentGeneration.id);
  if (!next) return;
  currentGeneration = next;
  renderFavoriteControl();
  showToast(next.favorite ? 'Saved to favorites.' : 'Removed from favorites. It stays in your history.');
  await renderLibrary();
}

async function openFavoriteFromKeyboard(direction) {
  if (recovering || reopening || deletingGeneration || promotion) return false;
  const groups = buildDreamSwitcherGroups({
    featured: featuredDreams,
    generations: await store.list(),
    activeKey: currentDreamKey,
  });
  const target = favoriteTargetForArrow(
    groups.favorites,
    currentDreamKey,
    direction < 0 ? 'favorite-previous' : 'favorite-next',
  );
  if (!target) {
    showToast('No favorites yet.', 2200);
    return false;
  }
  if (target.key === currentDreamKey) return true;
  return openGeneration(target.generation, { close: false, quiet: true });
}

async function toggleReadyJobFavorite(jobSnapshot) {
  const generationId = jobSnapshot?.artifact?.generationId;
  if (!generationId) return;
  const next = await store.toggleFavorite(generationId);
  if (!next) return;
  dreamJobController.transition(jobSnapshot.id, jobSnapshot.phase, {
    artifact: { ...jobSnapshot.artifact, generationId, favorite: Boolean(next.favorite) },
  });
  showToast(next.favorite ? 'Saved to favorites.' : 'Removed from favorites.');
  await renderLibrary();
}

async function openReadyJob(jobSnapshot) {
  const generationId = jobSnapshot?.artifact?.generationId;
  if (!generationId) return;
  const generation = await store.get(generationId);
  if (!generation) {
    dreamJobController.transition(jobSnapshot.id, DREAM_JOB_PHASES.OPENING, { cancellable: false });
    dreamJobController.transition(jobSnapshot.id, DREAM_JOB_PHASES.FAILED_OPEN, {
      detail: 'This saved Dream is no longer available in this browser.',
      cancellable: false,
    });
    return;
  }
  await openGeneration(generation, { close: false, jobId: jobSnapshot.id });
}

async function exportFeaturedCandidate(generationId = '') {
  let generation = generationId ? await store.get(generationId) : null;
  if (!generation && currentGeneration?.source !== 'featured') generation = currentGeneration;
  if (!generation) generation = (await store.list()).find(item => ['ready', 'verified'].includes(item.healthStatus));
  if (!generation) throw new Error('No saved local Dream is available to package.');
  const payload = await createFeaturedExportPackage(generation);
  downloadJson(`featured-candidate-${payload.manifestEntry.id}.json`, payload);
  return payload;
}

async function toggleFullscreen() {
  showUi();
  if (document.body.classList.contains('pseudo-fullscreen')) {
    document.body.classList.remove('pseudo-fullscreen');
    syncFullscreenControl();
    return;
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      await document.documentElement.requestFullscreen();
      document.body.classList.remove('pseudo-fullscreen');
    }
  } catch {
    document.body.classList.add('pseudo-fullscreen');
    syncFullscreenControl();
  }
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator)
    || !document.fullscreenElement
    || document.visibilityState !== 'visible'
    || wakeLock
    || wakeLockRequest) return;
  const revision = ++wakeLockRevision;
  let request;
  let reacquire = false;
  try {
    request = navigator.wakeLock.request('screen');
    wakeLockRequest = request;
    const sentinel = await request;
    if (revision !== wakeLockRevision || !document.fullscreenElement || document.visibilityState !== 'visible') {
      await sentinel.release().catch(() => {});
      reacquire = Boolean(document.fullscreenElement && document.visibilityState === 'visible');
      return;
    }
    wakeLock = sentinel;
    sentinel.addEventListener?.('release', () => {
      if (wakeLock === sentinel) wakeLock = null;
    }, { once: true });
  } catch {
    // Wake lock support is optional and must not interrupt the visualizer.
    reacquire = revision !== wakeLockRevision
      && Boolean(document.fullscreenElement && document.visibilityState === 'visible');
  } finally {
    if (request && wakeLockRequest === request) wakeLockRequest = null;
    if (reacquire && !wakeLock) queueMicrotask(() => void requestWakeLock());
  }
}

async function releaseWakeLock() {
  wakeLockRevision += 1;
  const sentinel = wakeLock;
  wakeLock = null;
  try {
    await sentinel?.release();
  } catch {
    // A lost wake lock has already been released by the browser.
  }
}

function syncFullscreenControl() {
  const active = Boolean(document.fullscreenElement || document.body.classList.contains('pseudo-fullscreen'));
  els.fullscreenButton.textContent = active ? '×' : '⛶';
  els.fullscreenButton.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
  els.fullscreenButton.setAttribute('aria-pressed', String(active));
}

function composeHostFrame(timestamp, sample) {
  const deliveryDeltaTime = lastDeliveredFrameAt
    ? Math.min(0.12, Math.max(0, (timestamp - lastDeliveredFrameAt) / 1000))
    : sample.deltaTime;
  return {
    version: AUDIO_API_VERSION,
    time: sample.time,
    deltaTime: deliveryDeltaTime,
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
  if (visualPaused) return;
  if (audioAnalysisGate.shouldRun(timestamp) || !latestAudioSample) {
    latestAudioSample = applyAudioSensitivity(audio.sample(timestamp), sensitivityPercent);
    audioAnalysisSamples += 1;
  }
  if (!vizDeliveryGate.shouldRun(timestamp)) return;
  const frame = composeHostFrame(timestamp, latestAudioSample);
  lastDeliveredFrameAt = timestamp;
  vizFrameDeliveries += 1;
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
  showToast(`${dreamDisplayTitle(winner)} wins this round.`);
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
    const candidate = await withCandidateSlot(async () => {
      const candidateSandbox = standbySlot.sandbox;
      try {
        return await evaluateCandidate(result, diagnostic, 1, null);
      } finally {
        if (standbySlot.sandbox === candidateSandbox) candidateSandbox.clear();
      }
    });
    if (!candidate.passed) throw new DreamReliabilityError(candidate.health.failure, candidate.health);
    finalizeDiagnosticTrace(diagnostic, 'succeeded');
    finishDiagnostic(diagnostic, { status: 'succeeded' });
    await persistDiagnostic(diagnostic);
    hideCenter();
    showToast(`HTML test passed. Diagnostic ${shortDiagnosticId(diagnostic.id)}.`);
  } catch (error) {
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
  if (params.get('dev') === '1') localSettingsStorage?.setItem('ai-visualizer.dev-mode', '1');
  if (params.get('dev') === '0') localSettingsStorage?.removeItem('ai-visualizer.dev-mode');
  return localSettingsStorage?.getItem('ai-visualizer.dev-mode') === '1';
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
  if (models.length) renderModels();
  window.dispatchEvent(new CustomEvent('visualizer:dev-mode-changed', { detail: { enabled: devMode } }));
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
    audio: audio.diagnostics(),
    featuredLoadFailures: structuredClone(featuredLoadFailures),
    sensitivityPercent,
    renderQuality: {
      ...renderQuality,
      audioAnalysisTargetFps: 60,
      audioAnalysisSamples,
      vizFrameDeliveries,
      deliveryGate: vizDeliveryGate.snapshot(),
    },
    immersive: immersiveUiController.snapshot(),
    generationTransport: window.VIZ_DREAM_STATUS?.snapshot?.() || null,
    reasoningSelection: selectedReasoningSelection,
    generationEnvelope: window.VIZ_COST_GUARD?.currentPreview?.envelope || null,
    generating,
    recovering,
    reopening,
    deletingGeneration,
    promotionActive: Boolean(promotion),
    playback: playbackController.snapshot(),
    job: dreamJobController.snapshot(),
    activeSessionId: activeSlot.sandbox.sessionId,
    sandboxRenderQuality: activeSlot.sandbox.appliedRenderQuality,
    frameDelivery: activeSlot.sandbox.frameDeliverySnapshot(),
    activeEvents: activeSlot.sandbox.events.slice(-10),
  };
}

async function renderDiagnostics(focusId = '') {
  if (!devMode || !els.diagnosticsList) return;
  const records = await listDiagnosticRecords(40);
  if (focusId) rawDiagnosticDetailsState.select(focusId);
  rawDiagnosticDetailsState.reconcile(records.map(record => record.id));
  const failed = records.filter(record => record.status === 'failed' || record.status === 'rolled-back').length;
  els.diagnosticsSummary.textContent = `${records.length} local records · ${failed} failed/rolled back · active heartbeat ${Math.round(activeSlot.sandbox.heartbeatAgeMs())}ms ago`;
  els.diagnosticsLive.textContent = liveDiagnosticEvents.length
    ? liveDiagnosticEvents.slice(-8).map(item => `${new Date(item.at).toLocaleTimeString()} · ${item.source} · ${item.type}${item.value?.code ? ` · ${item.value.code}` : ''}`).join('\n')
    : 'No live diagnostic events yet.';

  const fragment = document.createDocumentFragment();
  records.forEach(record => {
    const article = document.createElement('article');
    article.className = 'diagnostic-item';
    article.dataset.diagnosticId = record.id;
    if (record.id === focusId) article.classList.add('is-focused');
    const latestAttempt = record.attempts?.at(-1);
    const reliability = latestAttempt?.reliability || record.reliability;
    const renderer = reliability?.summary?.rendererTypes?.join(', ')
      || reliability?.stages?.at(-1)?.report?.renderer?.types?.join(', ')
      || 'unknown';
    article.innerHTML = `<div class="diagnostic-item__top"><div><strong>${escapeHtml(record.modelName || record.modelId)}</strong><small>${escapeHtml(diagnosticStatusLabel(record))} · ${humanTime(record.createdAt)} · <code>${escapeHtml(shortDiagnosticId(record.id))}</code></small></div><span class="diagnostic-item__code">${escapeHtml(record.failureCode || 'OK')}</span></div><p>${escapeHtml(record.failureMessage || `Renderer ${renderer} · ${record.outputBytes ? `${Math.round(record.outputBytes / 1024)} KB` : 'no output yet'}`)}</p><div class="diagnostic-item__actions"><button data-action="open-trace">Open Trace</button><button data-action="copy-json">Copy JSON</button><button data-action="copy-html" ${record.html ? '' : 'disabled'}>Copy HTML</button><button data-action="retest-html" ${record.html ? '' : 'disabled'}>Retest</button><button data-action="delete">Delete</button></div><details><summary>Raw diagnostic JSON</summary></details>`;
    article.querySelector('[data-action="open-trace"]').addEventListener('click', () => {
      selectDiagnosticRecord(record.id);
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
      rawDiagnosticDetailsState.close(record.id);
      await diagnosticStore.remove(record.id);
      await renderDiagnostics();
    });
    const rawDetails = article.querySelector('details');
    const populateRawDetails = () => {
      if (rawDetails.querySelector('pre')) return;
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(diagnosticForExport(record, { includeHtml: false }), null, 2);
      rawDetails.appendChild(pre);
    };
    rawDetails.addEventListener('toggle', () => {
      if (!rawDetails.open) {
        rawDiagnosticDetailsState.close(record.id);
        return;
      }
      rawDiagnosticDetailsState.open(record.id);
      els.diagnosticsList.querySelectorAll('details[open]').forEach(details => {
        if (details !== rawDetails) details.open = false;
      });
      populateRawDetails();
    });
    if (rawDiagnosticDetailsState.isOpen(record.id)) {
      rawDetails.open = true;
      populateRawDetails();
    }
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
    const candidate = await withCandidateSlot(async () => {
      const candidateSandbox = standbySlot.sandbox;
      try {
        return await evaluateCandidate(result, diagnostic, 1, null);
      } finally {
        if (standbySlot.sandbox === candidateSandbox) candidateSandbox.clear();
      }
    });
    if (!candidate.passed) throw new DreamReliabilityError(candidate.health.failure, candidate.health);
    finalizeDiagnosticTrace(diagnostic, 'succeeded', { generationId: currentGeneration?.id || '' });
    finishDiagnostic(diagnostic, { status: 'succeeded', generationId: currentGeneration?.id || '' });
    await persistDiagnostic(diagnostic);
    hideCenter();
    showToast(`Retest passed. Diagnostic ${shortDiagnosticId(diagnostic.id)}.`);
    await renderDiagnostics(diagnostic.id);
    return diagnostic;
  } catch (error) {
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

async function confirmActiveRuntimeLiveness() {
  if (activeStallConfirmation) return activeStallConfirmation;
  const sandbox = activeSlot.sandbox;
  const sessionId = sandbox.sessionId;
  const confirmation = confirmSandboxLiveness(sandbox, {
    label: 'active-runtime-stall-confirmation',
    staleAfterMs: 8000,
    timeoutMs: 2600,
    fatalSince: sandbox.events.length,
  }).then(result => {
    if (activeSlot.sandbox !== sandbox || sandbox.sessionId !== sessionId) return result;
    if (result.status === 'fatal') {
      queueRuntimeRecovery(result.fatal);
    } else if (result.status === 'stalled') {
      queueRuntimeRecovery({
        code: FAILURE_CODES.RUNTIME_STALLED,
        message: 'The active visualizer failed its heartbeat and bounded confirmation probe.',
        liveness: result.evidence,
      });
    } else if (result.status === 'probe-failed') {
      queueRuntimeRecovery({
        code: FAILURE_CODES.PROBE_FAILED,
        message: 'The active visualizer heartbeat resumed, but bounded confirmation probes failed.',
        liveness: result.evidence,
      });
    } else {
      activeStallRecheck = {
        sessionId,
        heartbeat: result.evidence.heartbeat.end,
        recheckAt: performance.now() + 30000,
      };
    }
    return result;
  }).finally(() => {
    if (activeStallConfirmation === confirmation) activeStallConfirmation = null;
  });
  activeStallConfirmation = confirmation;
  return confirmation;
}

async function recoverFromRuntimeFailure(event) {
  if (recovering || reopening || deletingGeneration || promotion) return;
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
    if (failedGeneration && failedGeneration.source !== 'featured') {
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
    recoveryDiagnostic.html = targetHtml;
    recoveryDiagnostic.outputBytes = new TextEncoder().encode(targetHtml).byteLength;
    recoveryDiagnostic.attempts = [];
    const result = { html: targetHtml, raw: targetHtml, attempt: 1 };
    const watchdog = await withCandidateSlot(async () => {
      recoveryIdentityToken = stageLiveCandidate(targetGeneration
        ? liveIdentityForGeneration(targetGeneration, {
            kind: targetGeneration.source === 'featured' ? 'featured' : 'saved',
            diagnosticId: recoveryDiagnostic.id,
          })
        : { kind: 'built-in' });
      const candidate = await evaluateCandidate(result, recoveryDiagnostic, 1, null, null, {
        quickReopen: Boolean(
          targetGeneration
          && ['ready', 'verified'].includes(targetGeneration.healthStatus)
          && targetGeneration.preflightEvidence?.passed === true
          && targetGeneration.preflightEvidence?.schema === RELIABILITY_SCHEMA
        ),
      });
      if (!candidate.passed) throw new DreamReliabilityError(candidate.health.failure, candidate.health);
      return promoteCandidate({
        harness: candidate.harness,
        qualification: candidate.health,
        candidateSandbox: candidate.candidateSandbox,
        candidateSessionId: candidate.candidateSessionId,
        diagnostic: recoveryDiagnostic,
        signal: null,
        onCommit: () => {
          commitLiveCandidate(recoveryIdentityToken);
          recoveryIdentityToken = '';
          currentHtml = targetHtml;
          currentGeneration = targetGeneration;
          currentDiagnosticId = recoveryDiagnostic.id;
          currentDreamKey = targetGeneration?.source === 'featured'
            ? targetGeneration.key
            : targetGeneration
              ? localDreamKey(targetGeneration)
              : 'featured:calibration-bloom';
        },
      });
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
    renderFavoriteControl();
    await renderLibrary();
    hideCenter();
    showToast('The unstable Dream was rolled back. Your last known-good visualizer is live again.', 6500);
  } catch (recoveryError) {
    if (recoveryIdentityToken) {
      discardLiveCandidate(recoveryIdentityToken);
      recoveryIdentityToken = '';
    }
    console.warn('Automatic rollback target also failed; restoring built-in visualizer.', recoveryError);
    await withCandidateSlot(async () => {
      await standbySlot.sandbox.load(DEFAULT_VISUALIZER_HTML, { viewport: currentViewport(), readyTimeoutMs: 2000 });
      standbySlot.sandbox.setPaused(visualPaused);
      await standbySlot.sandbox.waitForPlayback(visualPaused);
      standbySlot.sandbox.setPresentation('promoting');
      activeSlot.sandbox.setPresentation('retiring');
      await new Promise(resolve => setTimeout(resolve, 180));
      swapSlots();
      activeSlot.sandbox.enterPassiveMode();
    });
    currentHtml = DEFAULT_VISUALIZER_HTML;
    currentGeneration = null;
    currentDiagnosticId = '';
    currentDreamKey = 'featured:calibration-bloom';
    fallbackHtml = DEFAULT_VISUALIZER_HTML;
    fallbackGeneration = null;
    restoreBuiltInIdentity();
    renderFavoriteControl();
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
    await renderLibrary();
    hideCenter();
    showToast('Recovered to the built-in visualizer after a runtime failure.', 6500);
  } finally {
    if (recoveryIdentityToken) discardLiveCandidate(recoveryIdentityToken);
    recovering = false;
    flushPendingActiveFailure();
  }
}

function installDevApi() {
  const api = {
    enable() {
      localSettingsStorage?.setItem('ai-visualizer.dev-mode', '1');
      setDevMode(true);
    },
    disable() {
      localSettingsStorage?.removeItem('ai-visualizer.dev-mode');
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
    async exportFeatured(generationId = '') {
      return exportFeaturedCandidate(generationId);
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
    modelFit() {
      return modelFitEvidenceStore.snapshot();
    },
    modelTestMatrix() {
      return modelFitEvidenceStore.matrix({
        currentVersions: modelFitVersions(),
        catalogUpdatedAt: window.VIZ_COST_GUARD?.catalogUpdatedAt || null,
      });
    },
    async copyModelTestMatrix() {
      const bundle = modelFitEvidenceStore.matrix({
        currentVersions: modelFitVersions(),
        catalogUpdatedAt: window.VIZ_COST_GUARD?.catalogUpdatedAt || null,
      });
      await copyText(modelFitMatrixText(bundle));
      return bundle;
    },
    theoreticalModelCeilings() {
      return window.VIZ_COST_GUARD?.theoreticalModelCeilings?.() || [];
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
    playback() {
      return playbackController.snapshot();
    },
    quality() {
      return structuredClone(renderQuality);
    },
    setQuality(mode) {
      renderQualityController.setMode(mode);
      return structuredClone(renderQuality);
    },
    immersive() {
      return immersiveUiController.snapshot();
    },
    setPaused(paused) {
      return playbackController.setPaused(paused);
    },
    async probeActive(label = 'developer-active-probe') {
      return activeSlot.sandbox.probe(label);
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
  syncFullscreenControl();
  els.playbackButton?.addEventListener('click', () => {
    playbackController.toggle();
    showUi();
  });
  els.modelButton.addEventListener('click', () => {
    updateConnectionUi();
    renderReasoningControl({ announceStale: true });
    renderModels();
    openDrawer(els.modelDrawer);
  });
  els.reasoningSelect?.addEventListener('change', setReasoningFromUi);
  els.dreamButton.addEventListener('click', dream);
  els.favoriteButton.addEventListener('click', toggleFavorite);
  els.audioButton.addEventListener('click', toggleAudio);
  els.audioDisplayOption.addEventListener('click', () => { void connectAudioSource('display'); });
  els.audioMicrophoneOption.addEventListener('click', () => { void connectAudioSource('microphone'); });
  els.audioPicker.addEventListener('click', event => {
    if (event.target === els.audioPicker) closeAudioPicker();
  });
  els.audioPicker.addEventListener('close', () => {
    els.audioButton.setAttribute('aria-expanded', 'false');
    showUi('dialog-close');
    queueMicrotask(() => els.audioButton.focus());
  });
  els.sensitivityInput?.addEventListener('input', () => {
    const snapshot = sensitivityController.setSensitivity(els.sensitivityInput.value);
    showSensitivityHud(snapshot);
  });
  els.resetSensitivity?.addEventListener('click', () => {
    const snapshot = sensitivityController.reset();
    showSensitivityHud(snapshot);
  });
  for (const input of els.renderQualityInputs) {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const selected = renderQualityController.setMode(input.value);
      showToast(`${selected.profile.label} render quality applied. The Dream and AI output are unchanged.`);
    });
  }
  els.libraryButton.addEventListener('click', async () => {
    dreamSwitcher?.close();
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
    if (document.fullscreenElement) document.body.classList.remove('pseudo-fullscreen');
    syncFullscreenControl();
    if (document.fullscreenElement) await requestWakeLock();
    else await releaseWakeLock();
    showUi();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && document.fullscreenElement) void requestWakeLock();
    else if (document.visibilityState !== 'visible') void releaseWakeLock();
  });
  window.addEventListener('resize', () => applyRenderQuality(renderQualityController.snapshot()), { passive: true });
  watchNativeDpr();
  for (const eventName of ['pointermove', 'pointerdown', 'touchstart', 'wheel']) {
    document.addEventListener(eventName, event => {
      if (event.isTrusted) showUi(`host-${eventName}`, 'pointer');
    }, { passive: true, capture: true });
  }
  document.addEventListener('keydown', event => {
    if (!event.isTrusted) return;
    lastKeyboardUiActivityAt = performance.now();
    showUi('host-keyboard', 'keyboard');
  }, { capture: true });
  document.addEventListener('focusin', event => {
    if (event.isTrusted) showUi('host-focus', immersiveUiController.snapshot().inputMode);
  }, { capture: true });
  document.addEventListener('focusout', () => queueMicrotask(scheduleUiHide), { capture: true });
  const blockerObserver = new MutationObserver(scheduleUiHide);
  document.querySelectorAll('.drawer, dialog, #costConfirmBackdrop, #audioPicker').forEach(element => {
    blockerObserver.observe(element, { attributes: true, attributeFilter: ['class', 'hidden', 'open'] });
  });
  document.addEventListener('keydown', event => {
    if (trapDrawerFocus(event)) return;
    const transportCommand = globalArrowCommand(event, { document });
    if (transportCommand) {
      event.preventDefault();
      showUi();
      if (transportCommand === 'favorite-previous') void openFavoriteFromKeyboard(-1);
      if (transportCommand === 'favorite-next') void openFavoriteFromKeyboard(1);
      if (transportCommand === 'sensitivity-increase') showSensitivityHud(sensitivityController.increase());
      if (transportCommand === 'sensitivity-decrease') showSensitivityHud(sensitivityController.decrease());
      return;
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      if (devMode) {
        localSettingsStorage?.removeItem('ai-visualizer.dev-mode');
        setDevMode(false);
      } else {
        localSettingsStorage?.setItem('ai-visualizer.dev-mode', '1');
        setDevMode(true);
      }
    }
    if (event.key === 'Escape' && !document.querySelector('#spendDrawer.is-open')) closeDrawers();
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
  els.exportFeaturedCandidate?.addEventListener('click', async () => {
    try {
      await exportFeaturedCandidate();
      showToast('Featured candidate package exported for operator review.');
    } catch (error) {
      showToast(error?.message || 'No saved Dream is available to package.', 5200);
    }
  });
  els.retestCurrent?.addEventListener('click', retestCurrentVisualizer);
  els.transparencySelfTest?.addEventListener('click', () => void runTransparencySelfTest());
  els.copyModelTestMatrix?.addEventListener('click', async () => {
    const bundle = modelFitEvidenceStore.matrix({
      currentVersions: modelFitVersions(),
      catalogUpdatedAt: window.VIZ_COST_GUARD?.catalogUpdatedAt || null,
    });
    await copyText(modelFitMatrixText(bundle));
    showToast('Copied sanitized model test matrix.');
  });
  els.pickDiagnosticModel?.addEventListener('click', chooseCheapDiagnosticModel);
  els.clearDiagnostics?.addEventListener('click', async () => {
    if (!confirm('Clear all local Visualizer diagnostics? Saved Dreams are not deleted.')) return;
    dreamTraceViewer.close();
    rawDiagnosticDetailsState.close();
    fixtureDiagnostics.clear();
    volatileDiagnostics.clear();
    await diagnosticStore.clear();
    await renderDiagnostics();
  });
  window.addEventListener('visualizer:reasoning-selection-stale', event => {
    const model = models.find(candidate => candidate.id === event.detail?.modelId);
    if (!model) return;
    const current = reasoningSelectionStore.snapshot(model);
    const requested = event.detail?.requested || {};
    const stillMatches = current.mode === requested.mode
      && current.effort === (requested.effort ?? null)
      && current.selectedAt === (requested.selectedAt ?? null);
    if (!stillMatches) return;
    const selection = reasoningSelectionStore.save(model, { mode: 'default', effort: null });
    if (model.id !== selectedModel?.id) return;
    selectedReasoningSelection = selection;
    renderReasoningControl();
    announceReasoningSelection(selection);
    showToast('That reasoning level is no longer supported. Future Dreams will use the model\'s native Default.', 6200);
  });
}

async function initialize() {
  devMode = devModeFromLocation();
  setDevMode(devMode);
  installDevApi();
  mountDreamJobView({
    controller: dreamJobController,
    onCancel: () => activeDreamController?.abort(),
    onOpen: snapshot => { void openReadyJob(snapshot); },
    onFavorite: snapshot => { void toggleReadyJobFavorite(snapshot); },
    onSpend: () => window.VIZ_COST_GUARD?.openSpendProtection?.(),
  });
  const recordFeaturedFailure = failure => {
    if (!featuredLoadFailures.some(item => item.id === failure.id && item.code === failure.code)) {
      featuredLoadFailures.push({ id: failure.id, code: failure.code });
    }
    console.warn(`Featured Dream ${failure.id} was skipped safely (${failure.code}).`);
  };
  try {
    featuredDreams = await loadFeaturedDreams({ onFailure: recordFeaturedFailure });
  } catch (error) {
    console.warn('Featured manifest could not load from its static HTML path:', error);
    featuredDreams = await loadFeaturedDreams({ fetchImpl: null, onFailure: recordFeaturedFailure });
  }
  currentDreamKey = featuredDreams.find(item => item.startup)?.key || currentDreamKey;
  dreamSwitcher = mountDreamSwitcher({
    onOpen: item => { void openSwitcherItem(item); },
    onFavorite: item => { void toggleSwitcherFavorite(item); },
    onVisibilityChange: open => {
      if (open && dreamJobController.snapshot().expanded) dreamJobController.collapse();
      if (open) showUi('dream-switcher-open');
      else scheduleUiHide();
    },
  });
  renderFavoriteControl();
  wireEvents();
  updateConnectionUi();

  let startupFeatured = featuredDreams.find(item => item.startup);
  currentHtml = startupFeatured?.html || DEFAULT_VISUALIZER_HTML;
  try {
    const startupBoot = await activeSlot.sandbox.load(currentHtml, {
      viewport: currentViewport(),
      readyTimeoutMs: 2200,
    });
    if (!startupBoot.ready || startupBoot.fatalEvents.length) throw new Error('Featured startup did not become ready.');
  } catch {
    if (startupFeatured) recordFeaturedFailure({ id: startupFeatured.id, code: 'FEATURED_STARTUP_FAILED' });
    startupFeatured = null;
    currentHtml = DEFAULT_VISUALIZER_HTML;
    await activeSlot.sandbox.load(currentHtml, {
      viewport: currentViewport(),
      readyTimeoutMs: 2200,
    });
  }
  if (startupFeatured) {
    const startupArtifact = featuredArtifact(startupFeatured);
    const startupToken = stageLiveCandidate(liveIdentityForGeneration(startupArtifact, { kind: 'featured' }));
    commitLiveCandidate(startupToken);
    currentGeneration = startupArtifact;
    currentDreamKey = startupFeatured.key;
  }
  renderFavoriteControl();
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
    modelCatalogError = '';
    const storedModelId = localSettingsStorage?.getItem('ai-visualizer.selected-model') || '';
    const storedModel = models.find(model => model.id === storedModelId);
    if (storedModel) setSelectedModel(storedModel);
    else renderModels();
  } catch (error) {
    console.warn('The model catalog could not be loaded:', error);
    modelCatalogError = 'AI choices could not load. Check your connection and refresh when you are ready to Dream.';
    renderModels();
  }

  await renderLibrary();
  const readyArtifact = (await store.list()).find(generation => generation.openStatus === 'ready-to-open');
  if (readyArtifact) dreamJobController.restoreReady(readyArtifact);
  requestAnimationFrame(hostLoop);
  scheduleUiHide();

  setInterval(() => {
    if (document.hidden || visualPaused || recovering || reopening || deletingGeneration || promotion || !activeSlot.sandbox.ready) return;
    const decision = activeStallConfirmationDecision({
      heartbeat: activeSlot.sandbox.heartbeatSnapshot(),
      previousConfirmation: activeStallRecheck,
    });
    if (decision.due) void confirmActiveRuntimeLiveness();
  }, 1800);
}

await initialize();
