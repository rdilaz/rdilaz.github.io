import { dreamDisplayTitle, dreamPromptLabel } from './dream-metadata.js';

export const DREAM_JOB_SCHEMA = 'visualizer-dream-job-v1';

export const DREAM_JOB_PHASES = Object.freeze({
  IDLE: 'idle',
  PREPARING: 'preparing',
  SENDING: 'sending',
  WORKING: 'working',
  RECEIVING: 'receiving',
  CHECKING: 'checking',
  READY: 'ready',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  OPENING: 'opening',
  LIVE: 'live',
  FAILED_OPEN: 'failed-open',
});

const EXECUTING_PHASES = new Set([
  DREAM_JOB_PHASES.PREPARING,
  DREAM_JOB_PHASES.SENDING,
  DREAM_JOB_PHASES.WORKING,
  DREAM_JOB_PHASES.RECEIVING,
  DREAM_JOB_PHASES.CHECKING,
]);

const TERMINAL_PHASES = new Set([
  DREAM_JOB_PHASES.READY,
  DREAM_JOB_PHASES.FAILED,
  DREAM_JOB_PHASES.CANCELLED,
  DREAM_JOB_PHASES.LIVE,
  DREAM_JOB_PHASES.FAILED_OPEN,
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  [DREAM_JOB_PHASES.PREPARING]: new Set(['sending', 'working', 'receiving', 'checking', 'failed', 'cancelled']),
  [DREAM_JOB_PHASES.SENDING]: new Set(['working', 'receiving', 'checking', 'failed', 'cancelled']),
  [DREAM_JOB_PHASES.WORKING]: new Set(['sending', 'receiving', 'checking', 'failed', 'cancelled']),
  [DREAM_JOB_PHASES.RECEIVING]: new Set(['sending', 'working', 'checking', 'failed', 'cancelled']),
  [DREAM_JOB_PHASES.CHECKING]: new Set(['sending', 'working', 'receiving', 'ready', 'failed', 'cancelled']),
  [DREAM_JOB_PHASES.READY]: new Set(['opening']),
  [DREAM_JOB_PHASES.OPENING]: new Set(['live', 'failed-open']),
});

const clone = value => structuredClone(value);

function initialState() {
  return {
    schema: DREAM_JOB_SCHEMA,
    id: '',
    phase: DREAM_JOB_PHASES.IDLE,
    modelId: '',
    modelName: '',
    input: null,
    artifact: null,
    detail: '',
    failure: null,
    cancellable: false,
    expanded: false,
    visible: false,
    startedAt: null,
    updatedAt: null,
    revision: 0,
  };
}

export function dreamJobPhaseLabel(phase) {
  return ({
    preparing: 'Preparing',
    sending: 'Sending',
    working: 'Model working',
    receiving: 'Receiving',
    checking: 'Checking',
    ready: 'Dream ready',
    failed: 'Dream failed safely',
    cancelled: 'Cancelled',
    opening: 'Opening Dream',
    live: 'Dream is live',
    'failed-open': 'Could not open safely',
  })[phase] || 'Dream';
}

export function isExecutingDreamJob(snapshot) {
  return EXECUTING_PHASES.has(snapshot?.phase);
}

export function dreamJobOwnsReliabilityStage({
  generating = false,
  owner = null,
  diagnosticTraceId = '',
  activeTraceId = '',
  job = null,
} = {}) {
  const ownerJobId = String(owner?.jobId || '');
  const ownerTraceId = String(owner?.traceId || '');
  return generating === true
    && Boolean(ownerJobId && ownerTraceId && diagnosticTraceId && activeTraceId)
    && ownerJobId === String(job?.id || '')
    && ownerTraceId === String(diagnosticTraceId)
    && ownerTraceId === String(activeTraceId)
    && isExecutingDreamJob(job);
}

export function createDreamJobController({
  idFactory = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
  clock = () => Date.now(),
} = {}) {
  if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function.');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function.');

  let state = initialState();
  const listeners = new Set();

  function snapshot() {
    return clone(state);
  }

  function publish(patch) {
    state = {
      ...state,
      ...clone(patch),
      updatedAt: clock(),
      revision: state.revision + 1,
    };
    const current = snapshot();
    listeners.forEach(listener => listener(clone(current)));
    return current;
  }

  function start({ model, promptProfile, reasoningSelection = null, generationConfiguration = null, id = idFactory(), detail = '' } = {}) {
    if (isExecutingDreamJob(state) || state.phase === DREAM_JOB_PHASES.OPENING) {
      throw new Error('Only one Dream job can execute at a time.');
    }
    const modelId = String(model?.id || '').trim();
    const modelName = String(model?.name || modelId).trim();
    if (!modelId || !modelName) throw new TypeError('A Dream job requires an exact model identity.');
    const startedAt = clock();
    state = {
      ...initialState(),
      id: String(id),
      phase: DREAM_JOB_PHASES.PREPARING,
      modelId,
      modelName,
      input: clone({ model, promptProfile, reasoningSelection, generationConfiguration }),
      detail,
      cancellable: true,
      expanded: true,
      visible: true,
      startedAt,
      updatedAt: startedAt,
      revision: state.revision + 1,
    };
    const current = snapshot();
    listeners.forEach(listener => listener(clone(current)));
    return current;
  }

  function transition(jobId, phase, patch = {}) {
    if (!state.id || String(jobId) !== state.id) return snapshot();
    if (phase === state.phase) return publish(patch);
    const allowed = ALLOWED_TRANSITIONS[state.phase];
    if (!allowed?.has(phase)) throw new Error(`Dream job cannot transition from ${state.phase} to ${phase}.`);
    const terminal = TERMINAL_PHASES.has(phase);
    return publish({
      ...patch,
      phase,
      visible: patch.visible ?? true,
      cancellable: patch.cancellable ?? (!terminal && phase !== DREAM_JOB_PHASES.OPENING),
    });
  }

  function restoreReady(artifact, { expanded = false } = {}) {
    if (!artifact?.id || !artifact?.modelId) throw new TypeError('A persisted ready artifact is required.');
    if (isExecutingDreamJob(state) || state.phase === DREAM_JOB_PHASES.OPENING) return snapshot();
    const timestamp = Number(artifact.readyAt || artifact.createdAt || clock());
    state = {
      ...initialState(),
      id: String(artifact.jobId || artifact.id),
      phase: DREAM_JOB_PHASES.READY,
      modelId: String(artifact.modelId),
      modelName: String(artifact.modelName || artifact.modelId),
      artifact: {
        generationId: artifact.id,
        favorite: Boolean(artifact.favorite),
        displayTitle: dreamDisplayTitle(artifact),
        promptLabel: dreamPromptLabel(artifact),
      },
      detail: 'Ready whenever you are.',
      expanded: Boolean(expanded),
      visible: true,
      startedAt: timestamp,
      updatedAt: clock(),
      revision: state.revision + 1,
    };
    const current = snapshot();
    listeners.forEach(listener => listener(clone(current)));
    return current;
  }

  function setExpanded(expanded) {
    if (!state.id || state.phase === DREAM_JOB_PHASES.IDLE) return snapshot();
    return publish({ expanded: Boolean(expanded), visible: true });
  }

  function dismiss() {
    if (!TERMINAL_PHASES.has(state.phase)) return snapshot();
    return publish({ expanded: false, visible: false });
  }

  function show() {
    if (!state.id || state.phase === DREAM_JOB_PHASES.IDLE) return snapshot();
    return publish({ visible: true });
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Dream job listener must be a function.');
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    version: DREAM_JOB_SCHEMA,
    snapshot,
    subscribe,
    start,
    transition,
    restoreReady,
    setExpanded,
    collapse: () => setExpanded(false),
    expand: () => setExpanded(true),
    dismiss,
    show,
  });
}

function elapsedLabel(startedAt, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - Number(startedAt || now)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function mountDreamJobView({
  controller,
  root = document,
  onCancel = () => {},
  onOpen = () => {},
  onFavorite = () => {},
  onSpend = () => {},
  onDismiss = () => {},
} = {}) {
  if (!controller?.subscribe) throw new TypeError('Dream job view requires a controller.');
  const element = id => root.getElementById(id);
  const els = {
    panel: element('dreamJobPanel'),
    pill: element('dreamJobPill'),
    pillButton: element('dreamJobPillButton'),
    pillPhase: element('dreamJobPillPhase'),
    pillModel: element('dreamJobPillModel'),
    pillElapsed: element('dreamJobPillElapsed'),
    pillOpen: element('dreamJobPillOpen'),
    phase: element('dreamJobPhase'),
    model: element('dreamJobModel'),
    detail: element('dreamJobDetail'),
    elapsed: element('dreamJobElapsed'),
    announcement: element('dreamJobAnnouncement'),
    collapse: element('dreamJobCollapse'),
    cancel: element('dreamCancelButton'),
    open: element('dreamJobOpen'),
    favorite: element('dreamJobFavorite'),
    spend: element('dreamJobSpend'),
    dismiss: element('dreamJobDismiss'),
  };
  let current = controller.snapshot();
  let lastAnnouncedPhase = '';

  function renderTime() {
    const value = elapsedLabel(current.startedAt);
    if (els.elapsed) els.elapsed.textContent = value;
    if (els.pillElapsed) els.pillElapsed.textContent = value;
  }

  function render(snapshot) {
    current = snapshot;
    const idle = snapshot.phase === DREAM_JOB_PHASES.IDLE || !snapshot.id;
    const ready = snapshot.phase === DREAM_JOB_PHASES.READY;
    const terminal = TERMINAL_PHASES.has(snapshot.phase);
    const label = dreamJobPhaseLabel(snapshot.phase);
    if (els.panel) {
      els.panel.hidden = idle || !snapshot.visible || !snapshot.expanded;
      els.panel.setAttribute('aria-hidden', String(idle || !snapshot.visible || !snapshot.expanded));
      els.panel.dataset.jobPhase = snapshot.phase;
    }
    if (els.pill) {
      els.pill.hidden = idle || !snapshot.visible;
      els.pill.dataset.jobPhase = snapshot.phase;
    }
    document.body.classList.toggle('has-dream-job', !idle && snapshot.visible);
    els.pillButton?.setAttribute('aria-expanded', String(!idle && snapshot.visible && snapshot.expanded));
    if (els.phase) els.phase.textContent = label;
    if (els.pillPhase) els.pillPhase.textContent = label;
    const displayTitle = snapshot.artifact?.displayTitle || snapshot.modelName;
    const promptLabel = snapshot.artifact?.promptLabel;
    if (els.model) els.model.textContent = promptLabel ? `${displayTitle} · Prompt: ${promptLabel}` : displayTitle;
    if (els.pillModel) els.pillModel.textContent = displayTitle;
    if (els.detail) els.detail.textContent = snapshot.detail || '';
    if (els.cancel) els.cancel.hidden = !snapshot.cancellable;
    if (els.open) els.open.hidden = !ready;
    if (els.pillOpen) els.pillOpen.hidden = !ready;
    if (els.favorite) {
      els.favorite.hidden = !ready;
      const favorite = Boolean(snapshot.artifact?.favorite);
      els.favorite.textContent = favorite ? '♥ Saved' : '♡ Save';
      els.favorite.setAttribute('aria-pressed', String(favorite));
    }
    if (els.dismiss) els.dismiss.hidden = !terminal;
    if (els.spend) els.spend.hidden = snapshot.failure?.code !== 'INSUFFICIENT_PRACTICAL_ENVELOPE';
    if (els.collapse) els.collapse.hidden = idle;
    if (els.announcement && snapshot.phase !== lastAnnouncedPhase) {
      const terminalDetail = ['failed', 'failed-open', 'cancelled'].includes(snapshot.phase) && snapshot.detail
        ? `. ${snapshot.detail}`
        : '';
      els.announcement.textContent = `${label}${snapshot.modelName ? ` · ${snapshot.modelName}` : ''}${terminalDetail}`;
      lastAnnouncedPhase = snapshot.phase;
    }
    renderTime();
  }

  els.pillButton?.addEventListener('click', () => controller.expand());
  els.collapse?.addEventListener('click', () => {
    controller.collapse();
    els.pillButton?.focus();
  });
  els.cancel?.addEventListener('click', () => onCancel(controller.snapshot()));
  els.open?.addEventListener('click', () => onOpen(controller.snapshot()));
  els.pillOpen?.addEventListener('click', () => onOpen(controller.snapshot()));
  els.favorite?.addEventListener('click', () => onFavorite(controller.snapshot()));
  els.spend?.addEventListener('click', () => onSpend(controller.snapshot()));
  els.dismiss?.addEventListener('click', () => {
    onDismiss(controller.snapshot());
    controller.dismiss();
  });
  els.panel?.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    controller.collapse();
    els.pillButton?.focus();
  });

  const unsubscribe = controller.subscribe(render);
  const tick = setInterval(renderTime, 1000);
  return Object.freeze({
    render,
    destroy() {
      unsubscribe();
      clearInterval(tick);
    },
  });
}
