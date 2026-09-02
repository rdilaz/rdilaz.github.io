import {
  captureResponseBodyComplete,
  captureResponseHeaders,
  captureTraceError,
  stripTraceContext,
  traceContextFromInit,
  traceDisplayName,
} from './trace-bridge.js';

(() => {
  'use strict';

  const OPENROUTER_KEY_STORAGE = 'ai-visualizer.openrouter.key';
  const COMPLETION_RE = /^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions(?:\?|$)/;
  const DREAM_TIMEOUT_MS = 360000;
  const LIFECYCLE_EVENT = 'visualizer:dream-lifecycle';
  const baseFetch = window.fetch.bind(window);

  const dreamButton = document.getElementById('dreamButton');

  const state = {
    active: false,
    startedAt: 0,
    requestStartedAt: 0,
    modelId: '',
    modelName: '',
    phase: 'preparing',
    controller: null,
    timeout: 0,
    tick: 0,
    userCancelled: false,
    timedOut: false,
    bodyComplete: false,
    slowBand: 0,
    externalAbortCleanup: null,
  };

  function isCompletion(input) {
    const url = typeof input === 'string' ? input : input?.url || '';
    return COMPLETION_RE.test(url);
  }

  function parseBody(init) {
    if (typeof init?.body !== 'string') return null;
    try { return JSON.parse(init.body); } catch { return null; }
  }

  function modelLabel(modelId) {
    return String(modelId || '').split('/').pop() || 'the model';
  }

  function elapsedLabel(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function setPhase(phase, { title, detail, live } = {}) {
    state.phase = phase;
    const publicPhase = ({ sent: 'sending', repair: 'sending', response: 'checking', opening: 'checking', done: 'ready' })[phase] || phase;
    window.dispatchEvent(new CustomEvent(LIFECYCLE_EVENT, {
      detail: {
        phase: publicPhase,
        modelId: state.modelId,
        modelName: state.modelName,
        startedAt: state.startedAt,
        requestStartedAt: state.requestStartedAt,
        message: detail || live || title || '',
      },
    }));
  }

  function startClock() {
    clearInterval(state.tick);
    state.tick = setInterval(() => {
      if (!state.active) return;
      const now = performance.now();
      if (!['sent', 'working', 'receiving'].includes(state.phase)) return;
      const waiting = now - state.requestStartedAt;
      if (state.phase === 'receiving') return;
      const slowBand = waiting >= 300000 ? 5 : waiting >= 180000 ? 4 : waiting >= 90000 ? 3 : waiting >= 45000 ? 2 : waiting >= 20000 ? 1 : 0;
      if (!slowBand || slowBand === state.slowBand) return;
      state.slowBand = slowBand;
      if (waiting >= 300000) {
        setPhase('working', {
          title: `${state.modelName} is very slow, but still connected`,
          detail: 'The request is still open after five minutes. Some large coding models can take this long; you can keep waiting or cancel without replacing your current visualizer.',
          live: `Request live · ${elapsedLabel(waiting)} waiting on model`,
          progress: 47,
        });
      } else if (waiting >= 180000) {
        setPhase('working', {
          title: `${state.modelName} is still generating`,
          detail: 'Three minutes is slow, but not automatically a failure for a large visual-coding response. The request is still open.',
          live: `Request live · ${elapsedLabel(waiting)} waiting on model`,
          progress: 46,
        });
      } else if (waiting >= 90000) {
        setPhase('working', {
          title: `${state.modelName} is still working`,
          detail: 'The request is still open. This is unusually slow, but it has not been declared stuck.',
          live: `Request live · ${elapsedLabel(waiting)} waiting on model`,
          progress: 44,
        });
      } else if (waiting >= 45000) {
        setPhase('working', {
          title: `${state.modelName} is taking a while`,
          detail: 'Still connected and waiting for the model response. Your current visualizer keeps running.',
          live: `Request live · ${elapsedLabel(waiting)} waiting on model`,
          progress: 42,
        });
      } else if (waiting >= 20000) {
        setPhase('working', {
          title: `${state.modelName} is working`,
          detail: 'Still waiting for the model to finish. Nothing has failed; the request remains open.',
          live: `Request live · ${elapsedLabel(waiting)} waiting on model`,
          progress: 40,
        });
      }
    }, 250);
  }

  function beginPreparation() {
    const key = sessionStorage.getItem(OPENROUTER_KEY_STORAGE) || '';
    const modelId = localStorage.getItem('ai-visualizer.selected-model') || '';
    if (!key || !modelId || dreamButton?.disabled) return;
    state.active = true;
    state.startedAt = performance.now();
    state.requestStartedAt = 0;
    state.modelId = modelId;
    state.modelName = modelLabel(modelId);
    state.controller = null;
    state.userCancelled = false;
    state.timedOut = false;
    state.bodyComplete = false;
    state.slowBand = 0;
    setPhase('preparing', {
      title: `Preparing ${state.modelName}`,
      detail: 'Checking your spend guard and preparing the exact model request.',
      live: 'Connected ✓ · not sent yet',
    });
    startClock();
  }

  function requestSent(modelId, repair, controller, traceContext) {
    state.active = true;
    if (!state.startedAt) state.startedAt = performance.now();
    state.requestStartedAt = performance.now();
    state.modelId = modelId;
    state.modelName = traceDisplayName(traceContext) || modelLabel(modelId);
    state.controller = controller;
    state.userCancelled = false;
    state.timedOut = false;
    state.bodyComplete = false;
    state.slowBand = 0;
    setPhase(repair ? 'repair' : 'sent', {
      title: repair ? `${state.modelName} is repairing its dream` : `${state.modelName} is generating the visualizer`,
      detail: repair ? 'The first output needed a fix. A bounded repair request was sent to the same model.' : 'Request sent successfully. Waiting for the model to return its visualizer code.',
      live: repair ? 'Repair request sent ✓' : 'Request sent ✓ · model working',
    });
    setTimeout(() => {
      if (!state.active || state.controller !== controller || !['sent', 'repair'].includes(state.phase)) return;
      setPhase('working', {
        title: `${state.modelName} is working`,
        detail: 'The request remains open while the model creates the visualizer.',
        live: 'Request live · model working',
      });
    }, 650);
    startClock();
  }

  function responseHeaders(response, repair, traceContext) {
    captureResponseHeaders(traceContext, response);
    const status = response?.status ? `HTTP ${response.status}` : 'response';
    setPhase('receiving', {
      title: `${state.modelName} started responding`,
      detail: repair ? 'OpenRouter started returning the repair. The full repaired visualizer is still arriving.' : 'OpenRouter started returning data. The full visualizer code has not been received yet.',
      live: `OpenRouter response started ✓ · ${status} · receiving body`,
    });
  }

  function responseBodyComplete(repair, traceContext) {
    if (state.bodyComplete) return;
    state.bodyComplete = true;
    captureResponseBodyComplete(traceContext);
    clearRequestTimer();
    clearExternalAbort();
    state.controller = null;
    setPhase('response', {
      title: `${state.modelName} response received`,
      detail: repair ? 'The full repair arrived. Checking the repaired visualizer now.' : 'The full model response arrived. Checking the returned visualizer before anything replaces your screen.',
      live: 'OpenRouter responded ✓ · full response body received',
    });
    setTimeout(() => {
      if (state.active && state.phase === 'response') {
        setPhase('checking', {
          title: 'Checking the visualizer',
          detail: 'Validating the returned code and preparing the isolated test sandbox.',
          live: 'Model response received ✓ · validating',
        });
      }
    }, 180);
  }

  function dreamTimeoutError() {
    const error = new Error('Dream timed out after 6 minutes. Your previous visualizer is still safe; try again or choose a faster model.');
    error.code = 'DREAM_TIMEOUT';
    return error;
  }

  function wrapResponseBody(response, repair, traceContext) {
    if (!response || response.__dreamBodyTracked) return response;
    try {
      Object.defineProperty(response, '__dreamBodyTracked', { value: true });
    } catch {
      // Some Response implementations are non-extensible; method wrapping remains best-effort.
    }

    for (const method of ['json', 'text', 'arrayBuffer', 'blob', 'formData']) {
      const original = response[method]?.bind(response);
      if (!original) continue;
      try {
        Object.defineProperty(response, method, {
          configurable: true,
          value: async (...args) => {
            try {
              const value = await original(...args);
              responseBodyComplete(repair, traceContext);
              return value;
            } catch (error) {
              if (!state.timedOut) throw error;
              const timeoutError = dreamTimeoutError();
              captureTraceError(traceContext, timeoutError, { stage: 'dream-lifecycle-timeout' });
              throw timeoutError;
            }
          },
        });
      } catch {
        // Non-configurable body methods still work; only the secondary status timing is omitted.
      }
    }

    const originalClone = response.clone?.bind(response);
    if (originalClone) {
      try {
        Object.defineProperty(response, 'clone', {
          configurable: true,
          value: () => wrapResponseBody(originalClone(), repair, traceContext),
        });
      } catch {
        // A non-configurable clone method does not affect the original response body.
      }
    }
    return response;
  }

  function clearRequestTimer() {
    clearTimeout(state.timeout);
    state.timeout = 0;
  }

  function clearExternalAbort() {
    state.externalAbortCleanup?.();
    state.externalAbortCleanup = null;
  }

  function finishLifecycle({ delay = 0 } = {}) {
    clearRequestTimer();
    clearExternalAbort();
    state.controller = null;
    setTimeout(() => {
      if (!state.active) return;
      state.active = false;
      clearInterval(state.tick);
      state.tick = 0;
    }, delay);
  }

  dreamButton?.addEventListener('click', beginPreparation);
  window.addEventListener('visualizer:dream-job-terminal', () => finishLifecycle());

  window.fetch = async function dreamLifecycleFetch(input, init = {}) {
    if (!isCompletion(input)) return baseFetch(input, init);
    const body = parseBody(init);
    if (!body?.model) return baseFetch(input, init);
    const traceContext = traceContextFromInit(init);

    const repair = String(body?.messages?.[0]?.content || '').startsWith('Repair the visualizer');
    const controller = new AbortController();
    const externalSignal = init?.signal;
    const forwardAbort = () => controller.abort(externalSignal?.reason);
    clearExternalAbort();
    if (externalSignal?.aborted) forwardAbort();
    else externalSignal?.addEventListener?.('abort', forwardAbort, { once: true });
    state.externalAbortCleanup = () => externalSignal?.removeEventListener?.('abort', forwardAbort);

    requestSent(body.model, repair, controller, traceContext);
    clearRequestTimer();
    state.timeout = setTimeout(() => {
      state.timedOut = true;
      controller.abort();
    }, DREAM_TIMEOUT_MS);

    let responseHandedOff = false;
    try {
      const response = await baseFetch(input, { ...stripTraceContext(init), signal: controller.signal });
      responseHeaders(response, repair, traceContext);
      responseHandedOff = true;
      return wrapResponseBody(response, repair, traceContext);
    } catch (error) {
      clearRequestTimer();
      state.controller = null;
      if (state.timedOut) {
        window.dispatchEvent(new CustomEvent(LIFECYCLE_EVENT, { detail: { phase: 'failed', modelId: state.modelId, modelName: state.modelName } }));
        const timeoutError = dreamTimeoutError();
        captureTraceError(traceContext, timeoutError, { stage: 'dream-lifecycle-timeout' });
        throw timeoutError;
      }
      if (state.userCancelled || controller.signal.aborted) {
        window.dispatchEvent(new CustomEvent(LIFECYCLE_EVENT, { detail: { phase: 'cancelled', modelId: state.modelId, modelName: state.modelName } }));
        const cancellationError = new Error('Dream cancelled. Your previous visualizer is still running. OpenRouter may still bill work completed before cancellation.');
        captureTraceError(traceContext, cancellationError, { stage: 'dream-lifecycle-cancelled' });
        throw cancellationError;
      }
      window.dispatchEvent(new CustomEvent(LIFECYCLE_EVENT, { detail: { phase: 'failed', modelId: state.modelId, modelName: state.modelName } }));
      captureTraceError(traceContext, error, { stage: 'dream-lifecycle-fetch' });
      throw error;
    } finally {
      if (!responseHandedOff) clearExternalAbort();
    }
  };
})();
