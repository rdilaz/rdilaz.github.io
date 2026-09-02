import {
  captureResponseBodyComplete,
  captureResponseHeaders,
  captureTraceError,
  stripTraceContext,
  traceCaptureIdentity,
  traceContextFromInit,
  traceDisplayName,
} from './trace-bridge.js';
import {
  DREAM_STREAM_HARD_TIMEOUT_MS,
  DREAM_STREAM_IDLE_TIMEOUT_MS,
  createActivityTimeoutController,
  dreamTransportError,
} from './dream-transport.js';
import {
  OPENROUTER_STREAM_COMPLETE_REASON,
  OPENROUTER_STREAM_SCHEMA,
} from './openrouter-sse.js';

(() => {
  'use strict';

  const OPENROUTER_KEY_STORAGE = 'ai-visualizer.openrouter.key';
  const COMPLETION_RE = /^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions(?:\?|$)/;
  const LIFECYCLE_EVENT = 'visualizer:dream-lifecycle';
  const STREAM_PROGRESS_EVENT = 'visualizer:dream-stream-progress';
  const baseFetch = window.fetch.bind(window);
  const dreamButton = document.getElementById('dreamButton');
  let current = null;
  let preparation = null;
  let tick = 0;
  let lastSnapshot = {
    active: false,
    phase: 'idle',
    terminal: null,
    idleTimeoutMs: DREAM_STREAM_IDLE_TIMEOUT_MS,
    hardTimeoutMs: DREAM_STREAM_HARD_TIMEOUT_MS,
  };

  function storageValue(name, key) {
    try { return globalThis[name]?.getItem?.(key) || ''; } catch { return ''; }
  }

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
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function transportEvidence(transaction, outcome, timeoutKind = null) {
    const now = Date.now();
    return {
      schema: OPENROUTER_STREAM_SCHEMA,
      streamed: true,
      outcome,
      timeoutKind,
      chunkCount: transaction.chunkCount,
      eventCount: transaction.eventCount,
      commentCount: transaction.commentCount,
      contentDeltaCount: transaction.contentDeltaCount,
      reasoningDeltaCount: transaction.reasoningDeltaCount,
      bytesReceived: transaction.bytesReceived,
      doneReceived: transaction.doneReceived,
      usageReceived: transaction.usageReceived,
      providerGenerationId: transaction.providerGenerationId,
      firstActivityAt: transaction.firstActivityAt,
      firstEventAt: transaction.firstEventAt,
      firstReasoningDeltaAt: transaction.firstReasoningDeltaAt,
      firstContentDeltaAt: transaction.firstContentDeltaAt,
      lastActivityAt: transaction.lastActivityAt,
      streamCompletedAt: outcome === 'completed' ? now : null,
      terminatedAt: now,
    };
  }

  function publicSnapshot(transaction = current) {
    if (!transaction) return structuredClone(lastSnapshot);
    const now = performance.now();
    return {
      active: !transaction.terminal && !transaction.bodyComplete,
      phase: transaction.phase,
      terminal: transaction.terminal,
      modelId: transaction.modelId,
      modelName: transaction.modelName,
      traceId: transaction.identity?.traceId || '',
      attemptId: transaction.identity?.attemptId || '',
      requestStartedAt: transaction.requestStartedEpoch,
      headersReceivedAt: transaction.headersReceivedAt,
      lastActivityAt: transaction.lastActivityAt,
      elapsedMs: Math.max(0, now - transaction.requestStartedPerformance),
      idleForMs: Math.max(0, now - transaction.lastActivityPerformance),
      chunkCount: transaction.chunkCount,
      eventCount: transaction.eventCount,
      commentCount: transaction.commentCount,
      contentDeltaCount: transaction.contentDeltaCount,
      reasoningDeltaCount: transaction.reasoningDeltaCount,
      bytesReceived: transaction.bytesReceived,
      providerGenerationId: transaction.providerGenerationId,
      idleTimeoutMs: DREAM_STREAM_IDLE_TIMEOUT_MS,
      hardTimeoutMs: DREAM_STREAM_HARD_TIMEOUT_MS,
    };
  }

  function publish(transaction, phase, detail = '') {
    if (!transaction || current !== transaction) return;
    transaction.phase = phase;
    lastSnapshot = publicSnapshot(transaction);
    window.dispatchEvent(new CustomEvent(LIFECYCLE_EVENT, {
      detail: {
        phase,
        modelId: transaction.modelId,
        modelName: transaction.modelName,
        traceId: transaction.identity?.traceId || '',
        attemptId: transaction.identity?.attemptId || '',
        correlationId: transaction.identity?.correlationId || '',
        startedAt: transaction.startedAt,
        requestStartedAt: transaction.requestStartedPerformance,
        message: detail,
        transport: publicSnapshot(transaction),
      },
    }));
  }

  function clearExternalAbort(transaction) {
    transaction.externalAbortCleanup?.();
    transaction.externalAbortCleanup = null;
  }

  function stopClockWhenIdle() {
    if (current && !current.terminal && !current.bodyComplete) return;
    clearInterval(tick);
    tick = 0;
  }

  function terminalError(transaction, fallback) {
    if (transaction.terminal === 'idle-timeout') {
      return dreamTransportError('idle', transportEvidence(transaction, 'idle-timeout', 'idle'));
    }
    if (transaction.terminal === 'hard-timeout') {
      return dreamTransportError('hard', transportEvidence(transaction, 'hard-timeout', 'hard'));
    }
    if (transaction.terminal === 'cancelled') {
      return dreamTransportError('cancelled', transportEvidence(transaction, 'cancelled'));
    }
    return fallback;
  }

  function finishTransport(transaction, { protocolComplete = false } = {}) {
    if (transaction.bodyComplete) return;
    transaction.bodyComplete = true;
    transaction.timeout.stop(protocolComplete ? 'protocol-complete' : 'body-complete');
    clearExternalAbort(transaction);
    transaction.controller = null;
    captureResponseBodyComplete(transaction.traceContext, { protocolComplete });
    const streamComplete = protocolComplete || transaction.doneReceived || !transaction.expectsStream;
    if (!transaction.terminal || transaction.terminal === 'incomplete') {
      transaction.terminal = streamComplete ? 'completed' : 'incomplete';
    }
    if (streamComplete) {
      publish(transaction, 'checking', 'The complete streamed response arrived. Checking the visual safely in the background.');
    } else {
      publish(transaction, 'failed', 'The provider body ended before the stream completion marker. No partial visual will open.');
    }
    lastSnapshot = publicSnapshot(transaction);
    stopClockWhenIdle();
  }

  function markActivity(transaction, bytes = 0) {
    if (transaction.terminal || transaction.bodyComplete) return;
    const now = Date.now();
    transaction.chunkCount += 1;
    transaction.bytesReceived += Math.max(0, Number(bytes) || 0);
    transaction.firstActivityAt ??= now;
    transaction.lastActivityAt = now;
    transaction.lastActivityPerformance = performance.now();
    transaction.timeout.activity(now);
    lastSnapshot = publicSnapshot(transaction);
  }

  function wrapResponseBody(response, transaction) {
    if (!response?.body?.getReader) {
      finishTransport(transaction);
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            finishTransport(transaction);
            controller.close();
            return;
          }
          if (value?.byteLength) markActivity(transaction, value.byteLength);
          controller.enqueue(value);
        } catch (error) {
          const mapped = terminalError(transaction, error);
          if (!transaction.terminal) transaction.terminal = 'failed';
          transaction.timeout.stop(transaction.terminal);
          clearExternalAbort(transaction);
          captureTraceError(transaction.traceContext, mapped, {
            stage: transaction.terminal || 'provider-response-body',
            status: response.status,
            transport: mapped?.transport || transportEvidence(transaction, 'transport-error'),
          });
          controller.error(mapped);
        }
      },
      async cancel(reason) {
        if (reason === OPENROUTER_STREAM_COMPLETE_REASON) {
          transaction.doneReceived = true;
          finishTransport(transaction, { protocolComplete: true });
        } else {
          if (!transaction.terminal) {
            transaction.terminal = reason?.name === 'AbortError' || reason?.code === 'CANCELLED' ? 'cancelled' : 'failed';
          }
          transaction.timeout.stop(transaction.terminal);
          clearExternalAbort(transaction);
          transaction.controller = null;
          lastSnapshot = publicSnapshot(transaction);
          stopClockWhenIdle();
        }
        try { await reader.cancel(reason); } catch { /* The transport is already terminal. */ }
      },
    });
    const tracked = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    for (const property of ['url', 'redirected', 'type']) {
      try { Object.defineProperty(tracked, property, { configurable: true, get: () => response[property] }); } catch { /* Metadata is optional. */ }
    }
    return tracked;
  }

  function setSlowStatus(transaction) {
    if (current !== transaction || transaction.terminal || transaction.bodyComplete) return;
    const elapsed = performance.now() - transaction.requestStartedPerformance;
    const band = elapsed >= 600000 ? 6 : elapsed >= 300000 ? 5 : elapsed >= 180000 ? 4 : elapsed >= 90000 ? 3 : elapsed >= 45000 ? 2 : elapsed >= 20000 ? 1 : 0;
    if (!band || band === transaction.slowBand) return;
    transaction.slowBand = band;
    const activityAge = Math.max(0, performance.now() - transaction.lastActivityPerformance);
    const activityCopy = transaction.chunkCount
      ? ` Last stream activity ${elapsedLabel(activityAge)} ago.`
      : '';
    if (transaction.contentDeltaCount) {
      publish(transaction, 'receiving', `Still creating after ${elapsedLabel(elapsed)}.${activityCopy} The complete visual remains private until the stream finishes.`);
    } else if (transaction.reasoningDeltaCount) {
      publish(transaction, 'working', `Still thinking after ${elapsedLabel(elapsed)}.${activityCopy} The stream remains active.`);
    } else if (transaction.headersReceivedAt) {
      publish(transaction, 'working', `Connected and still waiting after ${elapsedLabel(elapsed)}.${activityCopy} OpenRouter keep-alives count as healthy activity.`);
    } else {
      publish(transaction, 'working', `Still connecting after ${elapsedLabel(elapsed)}. Your current Dream keeps playing.`);
    }
  }

  function startClock() {
    clearInterval(tick);
    tick = setInterval(() => {
      if (current) setSlowStatus(current);
    }, 1000);
  }

  function beginPreparation() {
    const key = storageValue('sessionStorage', OPENROUTER_KEY_STORAGE);
    const modelId = storageValue('localStorage', 'ai-visualizer.selected-model');
    if (!key || !modelId || dreamButton?.disabled) return;
    preparation = {
      startedAt: performance.now(),
      modelId,
      modelName: modelLabel(modelId),
    };
    window.dispatchEvent(new CustomEvent(LIFECYCLE_EVENT, {
      detail: {
        phase: 'preparing',
        modelId,
        modelName: preparation.modelName,
        startedAt: preparation.startedAt,
        message: 'Checking spend protection and preparing the exact model request.',
      },
    }));
  }

  function createTransaction(body, repair, traceContext, externalSignal) {
    const identity = traceCaptureIdentity(traceContext);
    const controller = new AbortController();
    const startedAt = preparation?.startedAt || performance.now();
    const requestStartedPerformance = performance.now();
    const requestStartedEpoch = Date.now();
    const transaction = {
      identity,
      traceContext,
      modelId: String(body.model),
      modelName: traceDisplayName(traceContext) || modelLabel(body.model),
      repair,
      startedAt,
      requestStartedPerformance,
      requestStartedEpoch,
      headersReceivedAt: null,
      lastActivityAt: requestStartedEpoch,
      lastActivityPerformance: requestStartedPerformance,
      firstActivityAt: null,
      firstEventAt: null,
      firstReasoningDeltaAt: null,
      firstContentDeltaAt: null,
      providerGenerationId: '',
      chunkCount: 0,
      eventCount: 0,
      commentCount: 0,
      contentDeltaCount: 0,
      reasoningDeltaCount: 0,
      bytesReceived: 0,
      doneReceived: false,
      usageReceived: false,
      phase: repair ? 'sending' : 'sending',
      slowBand: 0,
      terminal: null,
      bodyComplete: false,
      expectsStream: false,
      controller,
      externalAbortCleanup: null,
      timeout: null,
    };
    transaction.timeout = createActivityTimeoutController({
      onTimeout(kind, evidence) {
        if (transaction.terminal || transaction.bodyComplete) return;
        transaction.terminal = `${kind}-timeout`;
        const error = dreamTransportError(kind, {
          ...transportEvidence(transaction, `${kind}-timeout`, kind),
          timeout: evidence,
        });
        transaction.controller?.abort(error);
        publish(transaction, 'failed', kind === 'idle'
          ? 'The stream stopped producing activity and was ended safely.'
          : 'The generation reached its secondary safety ceiling and was ended safely.');
      },
    });
    transaction.timeout.start(requestStartedEpoch);
    const forwardAbort = () => {
      if (transaction.terminal || transaction.bodyComplete) return;
      transaction.terminal = 'cancelled';
      transaction.timeout.stop('cancelled');
      const error = dreamTransportError('cancelled', transportEvidence(transaction, 'cancelled'));
      transaction.controller?.abort(error);
      publish(transaction, 'cancelled', 'Dream cancelled. No retry will be sent, and your current Dream is unchanged.');
    };
    if (externalSignal?.aborted) forwardAbort();
    else externalSignal?.addEventListener?.('abort', forwardAbort, { once: true });
    transaction.externalAbortCleanup = () => externalSignal?.removeEventListener?.('abort', forwardAbort);
    preparation = null;
    return transaction;
  }

  function requestSent(transaction) {
    if (current && current !== transaction) {
      current.timeout.stop('superseded');
      clearExternalAbort(current);
    }
    current = transaction;
    publish(transaction, 'sending', transaction.repair
      ? 'A bounded repair request was sent to the same model.'
      : 'Request sent. Waiting for OpenRouter to connect the model stream.');
    setTimeout(() => {
      if (current === transaction && transaction.phase === 'sending' && !transaction.terminal) {
        publish(transaction, 'working', 'The request is connected and waiting for provider response headers.');
      }
    }, 650);
    startClock();
  }

  function responseHeaders(response, transaction) {
    captureResponseHeaders(transaction.traceContext, response);
    const now = Date.now();
    transaction.headersReceivedAt = now;
    transaction.expectsStream = response.ok;
    transaction.providerGenerationId = response.headers.get('x-generation-id') || '';
    transaction.timeout.activity(now);
    transaction.lastActivityAt = now;
    transaction.lastActivityPerformance = performance.now();
    publish(transaction, 'working', response.ok
      ? 'Connected. Waiting for the model’s first streamed activity.'
      : `The AI service returned ${response.status}. Reading its error safely.`);
  }

  function finishLifecycle() {
    preparation = null;
    if (current) {
      current.timeout.stop(current.terminal || 'job-terminal');
      clearExternalAbort(current);
      lastSnapshot = { ...publicSnapshot(current), active: false };
    }
    current = null;
    stopClockWhenIdle();
  }

  dreamButton?.addEventListener('click', beginPreparation);
  window.addEventListener('visualizer:dream-job-terminal', finishLifecycle);
  window.addEventListener(STREAM_PROGRESS_EVENT, event => {
    const detail = event.detail || {};
    const transaction = current;
    if (!transaction || detail.correlationId !== transaction.identity?.correlationId) return;
    if (detail.providerGenerationId) transaction.providerGenerationId = String(detail.providerGenerationId);
    transaction.eventCount = Math.max(transaction.eventCount, Number(detail.eventCount) || 0);
    transaction.commentCount = Math.max(transaction.commentCount, Number(detail.commentCount) || 0);
    transaction.contentDeltaCount = Math.max(transaction.contentDeltaCount, Number(detail.contentDeltaCount) || 0);
    transaction.reasoningDeltaCount = Math.max(transaction.reasoningDeltaCount, Number(detail.reasoningDeltaCount) || 0);
    if (detail.kind === 'event') transaction.firstEventAt ??= Number(detail.at) || Date.now();
    if (detail.kind === 'reasoning') {
      transaction.firstReasoningDeltaAt ??= Number(detail.at) || Date.now();
      if (transaction.reasoningDeltaCount === 1) publish(transaction, 'working', 'Thinking. The stream is active, and no partial visual is shown.');
    }
    if (detail.kind === 'content') {
      transaction.firstContentDeltaAt ??= Number(detail.at) || Date.now();
      if (transaction.contentDeltaCount === 1) publish(transaction, 'receiving', 'Creating the visual. It becomes openable only after the full stream and safety checks finish.');
    }
    if (detail.kind === 'done') {
      transaction.doneReceived = true;
      if (transaction.bodyComplete && transaction.terminal === 'incomplete') {
        transaction.terminal = 'completed';
        publish(transaction, 'checking', 'The complete streamed response arrived. Checking the visual safely in the background.');
      }
    }
    if (detail.kind === 'terminated') {
      transaction.terminal = detail.outcome || 'transport-error';
      publish(transaction, transaction.terminal === 'cancelled' ? 'cancelled' : 'failed',
        transaction.terminal === 'incomplete'
          ? 'The provider stream ended before its completion marker. No partial visual will open.'
          : 'The provider stream ended without a complete visual.');
    }
    if (detail.usageReceived === true) transaction.usageReceived = true;
    lastSnapshot = publicSnapshot(transaction);
  });

  window.fetch = async function dreamLifecycleFetch(input, init = {}) {
    if (!isCompletion(input)) return baseFetch(input, init);
    const body = parseBody(init);
    if (!body?.model) return baseFetch(input, init);
    const traceContext = traceContextFromInit(init);
    const repair = String(body?.messages?.[0]?.content || '').startsWith('Repair the visualizer');
    const transaction = createTransaction(body, repair, traceContext, init?.signal);
    requestSent(transaction);
    let responseHandedOff = false;
    try {
      const response = await baseFetch(input, {
        ...stripTraceContext(init),
        signal: transaction.controller.signal,
      });
      responseHeaders(response, transaction);
      responseHandedOff = true;
      return wrapResponseBody(response, transaction);
    } catch (error) {
      const mapped = terminalError(transaction, error);
      if (!transaction.terminal) transaction.terminal = 'failed';
      transaction.timeout.stop(transaction.terminal);
      clearExternalAbort(transaction);
      mapped.streamTransport ||= transportEvidence(transaction, transaction.terminal === 'failed' ? 'transport-error' : transaction.terminal);
      captureTraceError(traceContext, mapped, {
        stage: transaction.terminal,
        transport: mapped.streamTransport,
      });
      publish(transaction, transaction.terminal === 'cancelled' ? 'cancelled' : 'failed', mapped.message);
      lastSnapshot = publicSnapshot(transaction);
      stopClockWhenIdle();
      throw mapped;
    } finally {
      if (!responseHandedOff && current !== transaction) clearExternalAbort(transaction);
    }
  };

  const statusApi = Object.freeze({
    version: 'visualizer-dream-status-v2',
    snapshot: () => structuredClone(publicSnapshot()),
  });
  Object.defineProperty(window, 'VIZ_DREAM_STATUS', {
    value: statusApi,
    configurable: false,
    writable: false,
  });
})();
