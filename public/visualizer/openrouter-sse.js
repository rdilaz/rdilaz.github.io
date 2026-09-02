export const OPENROUTER_STREAM_SCHEMA = 'openrouter-chat-sse-v1';
export const OPENROUTER_STREAM_COMPLETE_REASON = 'openrouter-sse-protocol-complete';

const MAX_CAPTURED_STREAM_CHARS = 600000;
const MAX_ASSISTANT_CHARS = 700000;
const MAX_REASONING_CHARS = 300000;
const MAX_REASONING_DETAILS = 256;
const MAX_PENDING_SSE_CHARS = 1000000;

function textDelta(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(part => typeof part === 'string' ? part : part?.text || '').join('');
}

function streamError(code, message, detail = {}) {
  const error = new Error(message);
  error.name = 'OpenRouterStreamError';
  error.code = code;
  Object.assign(error, detail);
  return error;
}

function appendBounded(current, addition, maximum, code, label) {
  const next = `${current}${addition}`;
  if (next.length <= maximum) return next;
  throw streamError(code, `${label} exceeded the bounded browser transport limit.`);
}

function appendCaptured(state, text) {
  if (!text || state.rawBodyTruncated) return;
  const remaining = MAX_CAPTURED_STREAM_CHARS - state.rawBodyText.length;
  if (text.length <= remaining) {
    state.rawBodyText += text;
    return;
  }
  state.rawBodyText += text.slice(0, Math.max(0, remaining));
  state.rawBodyTruncated = true;
}

export function createOpenRouterSseDecoder({ onEvent = () => {}, onComment = () => {} } = {}) {
  let pending = '';
  let dataLines = [];
  let eventType = '';
  let eventId = '';
  let stopped = false;

  function dispatch() {
    if (!dataLines.length) {
      eventType = '';
      return;
    }
    const event = {
      data: dataLines.join('\n'),
      event: eventType || 'message',
      id: eventId,
    };
    dataLines = [];
    eventType = '';
    if (onEvent(event) === false) stopped = true;
  }

  function line(value) {
    if (stopped) return;
    const input = value.endsWith('\r') ? value.slice(0, -1) : value;
    if (!input) {
      dispatch();
      return;
    }
    if (input.startsWith(':')) {
      onComment(input.slice(1).trimStart());
      return;
    }
    const colon = input.indexOf(':');
    const field = colon < 0 ? input : input.slice(0, colon);
    let fieldValue = colon < 0 ? '' : input.slice(colon + 1);
    if (fieldValue.startsWith(' ')) fieldValue = fieldValue.slice(1);
    if (field === 'data') dataLines.push(fieldValue);
    else if (field === 'event') eventType = fieldValue;
    else if (field === 'id' && !fieldValue.includes('\0')) eventId = fieldValue;
  }

  return Object.freeze({
    feed(value) {
      pending += String(value || '');
      if (pending.length > MAX_PENDING_SSE_CHARS && !pending.includes('\n')) {
        throw streamError('PROVIDER_STREAM_PROTOCOL_ERROR', 'The provider sent an invalid oversized SSE line.');
      }
      let newline = pending.indexOf('\n');
      while (newline >= 0 && !stopped) {
        line(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
      if (stopped) pending = '';
    },
    finish() {
      if (stopped) return;
      if (pending) line(pending);
      pending = '';
      dispatch();
    },
  });
}

function normalizedAggregate(state) {
  const message = {
    role: state.role || 'assistant',
    content: state.assistantText || null,
  };
  if (state.reasoningText) message.reasoning = state.reasoningText;
  if (state.reasoningDetails.length) message.reasoning_details = state.reasoningDetails;
  const choice = {
    index: 0,
    message,
    finish_reason: state.finishReason,
    native_finish_reason: state.nativeFinishReason,
  };
  return {
    ...(state.providerGenerationId ? { id: state.providerGenerationId } : {}),
    object: 'chat.completion',
    ...(state.created != null ? { created: state.created } : {}),
    ...(state.resolvedModel ? { model: state.resolvedModel } : {}),
    ...(state.resolvedProvider ? { provider: state.resolvedProvider } : {}),
    choices: [choice],
    ...(state.usage ? { usage: state.usage } : {}),
  };
}

function transportSnapshot(state, outcome, clock, detail = {}) {
  const terminatedAt = clock();
  return {
    schema: OPENROUTER_STREAM_SCHEMA,
    streamed: true,
    outcome,
    timeoutKind: detail.timeoutKind || null,
    chunkCount: state.chunkCount,
    eventCount: state.eventCount,
    commentCount: state.commentCount,
    contentDeltaCount: state.contentDeltaCount,
    reasoningDeltaCount: state.reasoningDeltaCount,
    bytesReceived: state.bytesReceived,
    doneReceived: state.doneReceived,
    usageReceived: Boolean(state.usage),
    rawBodyTruncated: state.rawBodyTruncated,
    reasoningDetailsTruncated: state.reasoningDetailsTruncated,
    providerGenerationId: state.providerGenerationId || '',
    generationIdMismatch: state.generationIdMismatch,
    firstActivityAt: state.firstActivityAt,
    firstEventAt: state.firstEventAt,
    firstReasoningDeltaAt: state.firstReasoningDeltaAt,
    firstContentDeltaAt: state.firstContentDeltaAt,
    lastActivityAt: state.lastActivityAt,
    streamCompletedAt: outcome === 'completed' ? terminatedAt : null,
    terminatedAt,
  };
}

function outcomeForError(error) {
  if (error?.code === 'DREAM_IDLE_TIMEOUT') return { outcome: 'idle-timeout', timeoutKind: 'idle' };
  if (error?.code === 'DREAM_HARD_TIMEOUT') return { outcome: 'hard-timeout', timeoutKind: 'hard' };
  if (error?.name === 'AbortError' || error?.code === 'CANCELLED') return { outcome: 'cancelled', timeoutKind: null };
  if (error?.code === 'PROVIDER_STREAM_ERROR') {
    const providerError = error?.providerPayload?.error || error?.providerPayload?.choices?.[0]?.error || null;
    const providerType = String(providerError?.metadata?.error_type || providerError?.error_type || providerError?.type || '');
    const providerCode = String(providerError?.code || '');
    if (/timeout|timed_out/i.test(providerType) || /^(408|504|524)$/.test(providerCode)) {
      return { outcome: 'provider-timeout', timeoutKind: 'provider' };
    }
    return { outcome: 'provider-error', timeoutKind: null };
  }
  if (error?.code === 'PROVIDER_GENERATION_ID_MISMATCH') return { outcome: 'protocol-error', timeoutKind: null };
  if (error?.code === 'PROVIDER_STREAM_INCOMPLETE') return { outcome: 'incomplete', timeoutKind: null };
  if (error?.code === 'PROVIDER_STREAM_PROTOCOL_ERROR' || error?.code === 'PROVIDER_STREAM_TOO_LARGE') {
    return { outcome: 'protocol-error', timeoutKind: null };
  }
  return { outcome: 'transport-error', timeoutKind: null };
}

/**
 * Consumes one OpenRouter Chat Completions SSE response. It returns only after
 * the protocol-level [DONE] marker and never exposes incremental content.
 */
export async function consumeOpenRouterChatStream(response, {
  signal = null,
  clock = () => Date.now(),
  providerGenerationId = '',
  collectContent = true,
  captureRaw = true,
  onProgress = () => {},
} = {}) {
  if (!response?.body?.getReader) {
    throw streamError('PROVIDER_STREAM_PROTOCOL_ERROR', 'The provider streaming response had no readable body.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const headerGenerationId = String(providerGenerationId || '').trim();
  const state = {
    assistantText: '',
    reasoningText: '',
    reasoningDetails: [],
    reasoningDetailChars: 0,
    reasoningDetailsTruncated: false,
    rawBodyText: '',
    rawBodyTruncated: false,
    role: '',
    finishReason: null,
    nativeFinishReason: null,
    usage: null,
    resolvedModel: '',
    resolvedProvider: '',
    providerGenerationId: headerGenerationId,
    generationIdMismatch: false,
    created: null,
    chunkCount: 0,
    eventCount: 0,
    commentCount: 0,
    contentDeltaCount: 0,
    reasoningDeltaCount: 0,
    bytesReceived: 0,
    doneReceived: false,
    firstActivityAt: null,
    firstEventAt: null,
    firstReasoningDeltaAt: null,
    firstContentDeltaAt: null,
    lastActivityAt: null,
  };

  function result(outcome = 'completed', detail = {}) {
    return {
      assistantText: state.assistantText,
      rawBodyText: state.rawBodyText,
      streamAggregate: normalizedAggregate(state),
      usage: state.usage,
      resolvedModel: state.resolvedModel,
      resolvedProvider: state.resolvedProvider,
      providerGenerationId: state.providerGenerationId,
      finishReason: state.finishReason,
      nativeFinishReason: state.nativeFinishReason,
      transport: transportSnapshot(state, outcome, clock, detail),
    };
  }

  function noteGenerationId(value) {
    const id = String(value || '').trim();
    if (!id) return;
    if (state.providerGenerationId && state.providerGenerationId !== id) {
      state.generationIdMismatch = true;
      throw streamError(
        'PROVIDER_GENERATION_ID_MISMATCH',
        'The provider stream changed generation identity before completion.',
      );
    }
    state.providerGenerationId = id;
  }

  const sse = createOpenRouterSseDecoder({
    onComment() {
      state.commentCount += 1;
      onProgress({ kind: 'keepalive', at: clock(), commentCount: state.commentCount });
    },
    onEvent(event) {
      if (event.data.trim() === '[DONE]') {
        state.doneReceived = true;
        onProgress({
          kind: 'done',
          at: clock(),
          eventCount: state.eventCount,
          usageReceived: Boolean(state.usage),
          providerGenerationId: state.providerGenerationId,
        });
        return false;
      }
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (cause) {
        throw streamError('PROVIDER_STREAM_PROTOCOL_ERROR', 'The provider returned a malformed SSE data event.', {
          cause,
        });
      }
      const eventAt = clock();
      state.eventCount += 1;
      state.firstEventAt ??= eventAt;
      noteGenerationId(payload?.id);
      if (payload?.model) state.resolvedModel = String(payload.model);
      if (payload?.provider) state.resolvedProvider = String(payload.provider);
      if (payload?.created != null && Number.isFinite(Number(payload.created))) state.created = Number(payload.created);
      if (payload?.usage && typeof payload.usage === 'object') state.usage = payload.usage;
      const choice = payload?.choices?.[0] || null;
      if (choice?.finish_reason != null) state.finishReason = String(choice.finish_reason);
      if (choice?.native_finish_reason != null) state.nativeFinishReason = String(choice.native_finish_reason);
      if (payload?.error || choice?.error) {
        const providerError = payload.error || choice.error;
        throw streamError('PROVIDER_STREAM_ERROR', String(providerError?.message || 'The provider ended the stream with an explicit error.'), {
          providerPayload: payload,
        });
      }
      const delta = choice?.delta || {};
      const content = textDelta(delta.content);
      if (content) {
        state.contentDeltaCount += 1;
        state.firstContentDeltaAt ??= eventAt;
        if (collectContent) {
          state.assistantText = appendBounded(
            state.assistantText,
            content,
            MAX_ASSISTANT_CHARS,
            'PROVIDER_STREAM_TOO_LARGE',
            'The streamed assistant response',
          );
        }
        onProgress({
          kind: 'content',
          at: eventAt,
          contentDeltaCount: state.contentDeltaCount,
          providerGenerationId: state.providerGenerationId,
        });
      }
      const reasoning = textDelta(delta.reasoning ?? delta.reasoning_content);
      const reasoningDetails = Array.isArray(delta.reasoning_details) ? delta.reasoning_details : [];
      if (reasoning || reasoningDetails.length) {
        state.reasoningDeltaCount += 1;
        state.firstReasoningDeltaAt ??= eventAt;
        if (collectContent && reasoning) {
          state.reasoningText = appendBounded(
            state.reasoningText,
            reasoning,
            MAX_REASONING_CHARS,
            'PROVIDER_STREAM_TOO_LARGE',
            'The provider-exposed reasoning response',
          );
        }
        if (collectContent && reasoningDetails.length) {
          for (const detail of reasoningDetails) {
            const detailSize = JSON.stringify(detail)?.length || 0;
            if (state.reasoningDetails.length >= MAX_REASONING_DETAILS
              || state.reasoningDetailChars + detailSize > MAX_REASONING_CHARS) {
              state.reasoningDetailsTruncated = true;
              break;
            }
            state.reasoningDetails.push(detail);
            state.reasoningDetailChars += detailSize;
          }
        }
        onProgress({
          kind: 'reasoning',
          at: eventAt,
          reasoningDeltaCount: state.reasoningDeltaCount,
          providerGenerationId: state.providerGenerationId,
        });
      }
      onProgress({
        kind: 'event',
        at: eventAt,
        eventCount: state.eventCount,
        usageReceived: Boolean(state.usage),
        providerGenerationId: state.providerGenerationId,
      });
    },
  });

  try {
    while (!state.doneReceived) {
      if (signal?.aborted) throw signal.reason || new DOMException('Operation aborted.', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const activityAt = clock();
      state.chunkCount += 1;
      state.bytesReceived += value.byteLength;
      state.firstActivityAt ??= activityAt;
      state.lastActivityAt = activityAt;
      const text = decoder.decode(value, { stream: true });
      if (captureRaw) appendCaptured(state, text);
      onProgress({
        kind: 'activity',
        at: activityAt,
        chunkCount: state.chunkCount,
        bytesReceived: state.bytesReceived,
      });
      sse.feed(text);
    }
    const tail = decoder.decode();
    if (captureRaw) appendCaptured(state, tail);
    if (tail) sse.feed(tail);
    sse.finish();
    if (!state.doneReceived) {
      throw streamError('PROVIDER_STREAM_INCOMPLETE', 'The provider stream ended before its completion marker.');
    }
    await reader.cancel(OPENROUTER_STREAM_COMPLETE_REASON).catch(() => {});
    return result();
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    const classified = outcomeForError(error);
    error.streamResult = result(classified.outcome, { timeoutKind: classified.timeoutKind });
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* The body may already be detached. */ }
  }
}
