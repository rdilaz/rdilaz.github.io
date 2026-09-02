import { buildGenerationMessages, buildRepairMessages } from './prompt.js';

export const DREAM_TRACE_SCHEMA = 'dream-trace-v1';
export const DREAM_TRACE_EXPORT_SCHEMA = 'dream-trace-export-v1';
export const LEGACY_NOT_CAPTURED = 'Not captured by this app version.';
export const REASONING_NOT_EXPOSED = 'Reasoning not exposed by provider.';
export const REDACTED = '[redacted]';

const ACCOUNTING_KEYS = new Set([
  'tokens',
  'prompttokens',
  'completiontokens',
  'reasoningtokens',
  'totaltokens',
  'inputtokens',
  'outputtokens',
  'cachedtokens',
  'cachecreationinputtokens',
  'cachereadinputtokens',
  'maxtokens',
  'maxcompletiontokens',
]);

const SAFE_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'cache-control',
  'content-length',
  'content-type',
  'date',
  'etag',
  'http-referer',
  'referer',
  'retry-after',
  'server',
  'vary',
  'x-openrouter-title',
  'x-generation-id',
  'x-request-id',
  'request-id',
  'cf-ray',
]);

const clone = value => structuredClone(value);

function normalizedKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key) {
  const raw = String(key).toLowerCase();
  const name = normalizedKey(key);
  if (raw === '__proto__' || name === 'prototype' || name === 'constructor') return true;
  if (ACCOUNTING_KEYS.has(name) || name.endsWith('tokencount')) return false;
  if (name === 'key' || name === 'token' || name === 'secret' || name === 'password' || name === 'passwd') return true;
  if (name.endsWith('key') && !name.endsWith('monkey')) return true;
  if (/authorization|credential|apikey|secretkey|privatekey|clientsecret/.test(name)) return true;
  if (/pkce|codeverifier|codechallenge|verifier/.test(name)) return true;
  if (/accesstoken|refreshtoken|bearertoken|authtoken|sessiontoken|idtoken/.test(name)) return true;
  if (name === 'access' || name === 'refresh' || /cookie/.test(name)) return true;
  if (name === 'audioapiversion') return false;
  if (/audio|waveform|spectrum/.test(name)) return true;
  if (/song|nowplaying|trackname|tracktitle|artistname|albumname/.test(name)) return true;
  if (/microphone|camera|mediastream/.test(name) || name === 'mic' || name.startsWith('micinput')) return true;
  return false;
}

export function redactSecretStrings(value) {
  let text = String(value ?? '');
  text = text.replace(/\bBearer\s+[^\s"'<>;,]+/gi, `Bearer ${REDACTED}`);
  text = text.replace(/\bsk-or-v1-[A-Za-z0-9._~-]+\b/gi, REDACTED);
  text = text.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, REDACTED);
  text = text.replace(/\bSENTINEL(?:[_-][A-Za-z0-9]+)+\b/gi, REDACTED);
  text = text.replace(
    /\b(authorization|api[_-]?key|openrouter[_-]?key|access[_-]?token|refresh[_-]?token|code[_-]?verifier|pkce[_-]?verifier|credential|client[_-]?secret|cookie|password|token|key)["']?\s*[:=]\s*["']?[^\s"',;&<>}\]]+["']?/gi,
    (_match, label) => `${label}=${REDACTED}`,
  );
  return text;
}

function sanitizeNumber(value) {
  return Number.isFinite(value) ? value : null;
}

export function sanitizeTraceValue(value, { maxDepth = 32, maxNodes = 50000 } = {}) {
  const depthLimit = Math.max(1, Number(maxDepth) || 32);
  const nodeLimit = Math.max(1, Number(maxNodes) || 50000);
  const ancestors = new WeakSet();
  let nodes = 0;

  function visit(current, depth) {
    nodes += 1;
    if (nodes > nodeLimit) return '[truncated: node limit]';
    if (typeof current === 'string') return redactSecretStrings(current);
    if (typeof current === 'number') return sanitizeNumber(current);
    if (typeof current === 'bigint') return current.toString();
    if (typeof current === 'boolean' || current === null) return current;
    if (current === undefined || typeof current === 'function' || typeof current === 'symbol') return undefined;
    if (depth >= depthLimit) return '[truncated: depth limit]';
    if (ancestors.has(current)) return '[circular]';

    if (current instanceof Date) {
      return Number.isNaN(current.getTime()) ? null : current.toISOString();
    }
    if (current instanceof RegExp) return current.toString();
    if (current instanceof ArrayBuffer) return `[binary omitted: ${current.byteLength} bytes]`;
    if (ArrayBuffer.isView(current)) {
      if (current instanceof DataView) return `[binary omitted: ${current.byteLength} bytes]`;
      ancestors.add(current);
      const output = [];
      for (let index = 0; index < current.length; index += 1) {
        const nested = visit(current[index], depth + 1);
        output.push(nested === undefined ? null : nested);
        if (nodes > nodeLimit) break;
      }
      ancestors.delete(current);
      return output;
    }
    if (current instanceof Error) {
      const output = {
        name: redactSecretStrings(current.name || 'Error'),
        message: redactSecretStrings(current.message || ''),
      };
      if (current.code != null) output.code = redactSecretStrings(current.code);
      if (current.status != null) output.status = sanitizeNumber(Number(current.status));
      if (current.cause != null) output.cause = visit(current.cause, depth + 1);
      return output;
    }

    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const output = [];
        for (const item of current) {
          if (nodes >= nodeLimit) {
            output.push('[truncated: node limit]');
            break;
          }
          const nested = visit(item, depth + 1);
          output.push(nested === undefined ? null : nested);
        }
        return output;
      }
      if (current instanceof Map) {
        const output = [];
        for (const [key, nestedValue] of current) {
          output.push([visit(key, depth + 1), visit(nestedValue, depth + 1)]);
          if (nodes > nodeLimit) break;
        }
        return output;
      }
      if (current instanceof Set) {
        const output = [];
        for (const nestedValue of current) {
          output.push(visit(nestedValue, depth + 1));
          if (nodes > nodeLimit) break;
        }
        return output;
      }

      let descriptors;
      try {
        descriptors = Object.getOwnPropertyDescriptors(current);
      } catch {
        return '[unavailable]';
      }
      const output = {};
      for (const key of Object.keys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) continue;
        if (isSensitiveKey(key)) {
          if (normalizedKey(key) === 'authorization' && descriptor.value === REDACTED) {
            Object.defineProperty(output, 'authorization', {
              value: REDACTED,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          }
          continue;
        }
        const nested = visit(descriptor.value, depth + 1);
        if (nested === undefined) continue;
        Object.defineProperty(output, key, {
          value: nested,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        if (nodes > nodeLimit) break;
      }
      return output;
    } finally {
      ancestors.delete(current);
    }
  }

  return visit(value, 0);
}

function headerEntries(headers) {
  if (!headers) return [];
  if (Array.isArray(headers)) return headers;
  if (headers instanceof Map) return [...headers.entries()];
  if (typeof headers.forEach === 'function' && typeof headers.entries === 'function') {
    try {
      return [...headers.entries()];
    } catch {
      return [];
    }
  }
  try {
    return Object.entries(headers);
  } catch {
    return [];
  }
}

function isSafeHeaderName(name) {
  return SAFE_HEADERS.has(name)
    || name.startsWith('x-ratelimit-')
    || name.startsWith('ratelimit-')
    || name.startsWith('x-openrouter-') && name !== 'x-openrouter-key';
}

export function sanitizeSafeHeaders(headers) {
  const output = {};
  for (const entry of headerEntries(headers)) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const name = String(entry[0] ?? '').trim().toLowerCase();
    if (!name) continue;
    if (name === 'authorization') {
      output.authorization = REDACTED;
      continue;
    }
    if (isSensitiveKey(name) || !isSafeHeaderName(name)) continue;
    const value = Array.isArray(entry[1]) ? entry[1].join(', ') : String(entry[1] ?? '');
    output[name] = redactSecretStrings(value);
  }
  return output;
}

function numeric(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function firstNumeric(...values) {
  for (const value of values) {
    const number = numeric(value);
    if (number != null) return number;
  }
  return null;
}

export function reasoningTokenCount(usage) {
  return firstNumeric(
    usage?.reasoning_tokens,
    usage?.reasoningTokens,
    usage?.completion_tokens_details?.reasoning_tokens,
    usage?.completionTokensDetails?.reasoningTokens,
    usage?.output_tokens_details?.reasoning_tokens,
    usage?.outputTokensDetails?.reasoningTokens,
  );
}

function reasoningText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) return value.map(reasoningText).filter(Boolean).join('\n');
  for (const key of ['text', 'reasoning', 'thinking', 'content', 'summary']) {
    if (typeof value[key] === 'string' && value[key]) return value[key];
  }
  return '';
}

export function extractProviderReasoning(payload, usage = payload?.usage) {
  const details = [];
  const texts = [];

  function expose(source, value) {
    if (value == null || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return;
    const safeValue = sanitizeTraceValue(value);
    details.push({ source, value: safeValue });
    const text = reasoningText(safeValue);
    if (text) texts.push(text);
  }

  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  const primaryChoice = choices[0] || null;
  const message = primaryChoice?.message || payload?.message || null;
  expose('message.reasoning', message?.reasoning);
  expose('message.reasoning_details', message?.reasoning_details);
  expose('choice.reasoning_details', primaryChoice?.reasoning_details);
  expose('payload.reasoning_details', payload?.reasoning_details);

  const partCollections = [
    ['message.content', message?.content],
    ['choice.content', primaryChoice?.content],
    ['payload.content', payload?.content],
  ];
  if (Array.isArray(payload?.output)) {
    payload.output.forEach((item, index) => partCollections.push([`payload.output[${index}].content`, item?.content]));
  }
  for (const [source, parts] of partCollections) {
    if (!Array.isArray(parts)) continue;
    parts.forEach((part, index) => {
      const type = String(part?.type ?? '').toLowerCase();
      if (!type.includes('reasoning') && !type.includes('thinking')) return;
      expose(`${source}[${index}]`, part);
    });
  }

  const tokenCount = reasoningTokenCount(usage);
  if (details.length) {
    return {
      status: 'exposed',
      exposed: true,
      hasText: texts.length > 0,
      label: 'Provider-exposed reasoning.',
      text: texts.join('\n'),
      details,
      tokenCount,
    };
  }
  if (tokenCount != null && tokenCount > 0) {
    return {
      status: 'token-only',
      exposed: false,
      hasText: false,
      label: `Reasoning text not exposed by provider.\nReasoning tokens: ${tokenCount}`,
      text: '',
      details: [],
      tokenCount,
    };
  }
  return {
    status: 'not-exposed',
    exposed: false,
    hasText: false,
    label: REASONING_NOT_EXPOSED,
    text: '',
    details: [],
    tokenCount,
  };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return value;
  }
  for (const descriptor of Object.values(descriptors)) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  try {
    Object.freeze(value);
  } catch {
    return value;
  }
  return value;
}

function immutable(value) {
  return deepFreeze(value);
}

function defaultId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function text(value, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function required(value, label) {
  const result = text(value);
  if (!result) throw new TypeError(`${label} is required.`);
  return result;
}

function at(value, clock) {
  return value ?? clock();
}

function timelineEntry(stage, timestamp, detail = {}) {
  return {
    stage: required(stage, 'Timeline stage'),
    at: timestamp,
    ...sanitizeTraceValue(detail),
  };
}

function emptyAttempt({ trace, input, id, timestamp }) {
  const selected = trace.selectedModel;
  const requestedModelId = required(input.requestedModelId ?? input.modelId ?? selected.id, 'Requested model ID');
  const displayName = text(input.displayName ?? input.modelName, selected.name || requestedModelId);
  return {
    id,
    attemptId: id,
    number: trace.attempts.length + 1,
    kind: input.kind,
    state: 'open',
    status: 'open',
    outcome: 'open',
    identity: {
      traceId: trace.id,
      attemptId: id,
      requestedModelId,
      selectedDisplayName: displayName,
      providerId: text(input.providerId, selected.providerId),
      upstreamProvider: text(input.upstreamProvider, selected.upstreamProvider),
      resolvedModel: '',
      requestId: '',
      providerGenerationId: '',
      diagnosticId: text(input.diagnosticId, trace.diagnosticId),
      generationId: '',
    },
    timing: {
      createdAt: timestamp,
      availabilityStartedAt: null,
      availabilityEndedAt: null,
      requestPreparedAt: null,
      requestDispatchedAt: null,
      responseHeadersAt: null,
      firstStreamActivityAt: null,
      firstStreamEventAt: null,
      firstReasoningDeltaAt: null,
      firstContentDeltaAt: null,
      lastStreamActivityAt: null,
      streamCompletedAt: null,
      streamTerminatedAt: null,
      responseBodyCompleteAt: null,
      providerDurationMs: null,
      artifactValidationStartedAt: null,
      artifactValidationEndedAt: null,
      promotionStartedAt: null,
      promotionEndedAt: null,
      watchdogStartedAt: null,
      watchdogEndedAt: null,
      rollbackAt: null,
      closedAt: null,
    },
    request: {
      captured: false,
      dispatched: false,
      method: '',
      endpoint: '',
      model: requestedModelId,
      messages: [],
      parameters: {},
      policy: null,
      headers: {},
      serializedBody: '',
    },
    response: {
      status: null,
      headers: {},
      rawBody: '',
      payload: null,
      streamAggregate: null,
      assistantText: '',
      rawOutput: '',
      extractedHtml: '',
      finishReason: '',
      nativeFinishReason: '',
      native_finish_reason: '',
      resolvedModel: '',
      requestId: '',
      providerGenerationId: '',
      usage: null,
      cost: null,
      costDetails: null,
      reasoning: extractProviderReasoning(null, null),
      error: null,
      transport: null,
    },
    artifact: {
      staticValidation: null,
      reliability: null,
      rendererEvidence: null,
      consoleErrors: [],
      consoleWarnings: [],
      shaderFailures: [],
      vizConsumption: null,
      visibleOutput: null,
      viewportCanary: null,
      performanceWarnings: [],
      promotionWatchdog: null,
      rollbackReason: null,
      repairProblem: '',
    },
    timeline: [timelineEntry(`attempt:${trace.attempts.length + 1}:created`, timestamp)],
  };
}

function usageProjection(attempts) {
  let found = false;
  let prompt = 0;
  let completion = 0;
  let reasoning = 0;
  let total = 0;
  let hasPrompt = false;
  let hasCompletion = false;
  let hasReasoning = false;
  let hasTotal = false;

  for (const attempt of attempts) {
    const usage = attempt.response?.usage;
    if (!usage || typeof usage !== 'object') continue;
    found = true;
    const promptValue = firstNumeric(usage.prompt_tokens, usage.promptTokens, usage.input_tokens, usage.inputTokens);
    const completionValue = firstNumeric(usage.completion_tokens, usage.completionTokens, usage.output_tokens, usage.outputTokens);
    const reasoningValue = reasoningTokenCount(usage);
    const totalValue = firstNumeric(usage.total_tokens, usage.totalTokens);
    if (promptValue != null) { prompt += promptValue; hasPrompt = true; }
    if (completionValue != null) { completion += completionValue; hasCompletion = true; }
    if (reasoningValue != null) { reasoning += reasoningValue; hasReasoning = true; }
    if (totalValue != null) { total += totalValue; hasTotal = true; }
  }
  if (!found) return null;
  const output = {};
  if (hasPrompt) output.prompt_tokens = prompt;
  if (hasCompletion) output.completion_tokens = completion;
  if (hasReasoning) output.reasoning_tokens = reasoning;
  output.total_tokens = hasTotal ? total : prompt + completion;
  return output;
}

function reportedCost(attempt) {
  return firstNumeric(
    attempt.response?.cost,
    attempt.response?.usage?.cost,
    attempt.response?.usage?.total_cost,
    attempt.response?.costDetails?.cost,
    attempt.response?.costDetails?.total_cost,
  );
}

function applyProjection(trace) {
  const dispatched = trace.attempts.filter(attempt => attempt.request?.dispatched === true);
  const requestCountKnown = !trace.legacy;
  const costs = trace.attempts.map(reportedCost).filter(value => value != null);
  const finalAttempt = [...trace.attempts].reverse().find(attempt => (
    attempt.response?.rawBody
    || attempt.response?.payload
    || attempt.response?.assistantText
    || attempt.response?.resolvedModel
    || attempt.response?.requestId
    || attempt.response?.providerGenerationId
    || attempt.response?.usage
    || attempt.response?.transport
    || attempt.response?.error
  )) || trace.attempts.at(-1) || null;
  const finalResolvedModel = finalAttempt?.response?.resolvedModel
    || finalAttempt?.identity?.resolvedModel
    || '';
  const usage = usageProjection(trace.attempts);
  const knownReportedCostSubtotal = costs.length ? costs.reduce((sum, value) => sum + value, 0) : null;
  const reportedCostComplete = requestCountKnown && dispatched.length > 0 && costs.length === dispatched.length;
  const exactReportedCost = reportedCostComplete ? knownReportedCostSubtotal : null;

  trace.providerRequestCount = requestCountKnown ? dispatched.length : null;
  trace.requestCount = requestCountKnown ? dispatched.length : null;
  trace.repairUsed = trace.attempts.some(attempt => attempt.kind === 'repair');
  trace.totalUsage = usage;
  trace.usage = usage;
  trace.exactReportedCost = exactReportedCost;
  trace.totalReportedCost = exactReportedCost;
  trace.knownReportedCostSubtotal = knownReportedCostSubtotal;
  trace.reportedCostComplete = reportedCostComplete;
  trace.finalResolvedModel = finalResolvedModel;
  trace.resolvedModel = finalResolvedModel;
  trace.requestId = finalAttempt?.response?.requestId || finalAttempt?.identity?.requestId || '';
  trace.providerGenerationId = finalAttempt?.response?.providerGenerationId || '';
  trace.streamTransport = finalAttempt?.response?.transport || null;
  trace.rawOutput = finalAttempt?.response?.rawOutput || finalAttempt?.response?.assistantText || '';
  trace.html = finalAttempt?.response?.extractedHtml || '';
  trace.requestPolicy = finalAttempt?.request?.policy || null;
  trace.finalFinishReason = finalAttempt?.response?.finishReason || '';
  trace.finalNativeFinishReason = finalAttempt?.response?.nativeFinishReason
    || finalAttempt?.response?.native_finish_reason
    || '';
  trace.summary = {
    providerRequestCount: trace.providerRequestCount,
    usage,
    exactReportedCost,
    knownReportedCostSubtotal,
    reportedCostComplete: trace.reportedCostComplete,
    finalResolvedModel,
    finalFinishReason: trace.finalFinishReason,
    finalNativeFinishReason: trace.finalNativeFinishReason,
    requestPolicy: trace.requestPolicy,
    repairUsed: trace.repairUsed,
    providerGenerationId: trace.providerGenerationId,
    streamTransport: trace.streamTransport,
  };
  return trace;
}

function assertTrace(trace) {
  if (!trace || trace.schema !== DREAM_TRACE_SCHEMA || !Array.isArray(trace.attempts)) {
    throw new TypeError(`Expected a ${DREAM_TRACE_SCHEMA} trace.`);
  }
}

function assertTraceOpen(trace) {
  assertTrace(trace);
  if (trace.state !== 'open') throw new Error('Finalized traces cannot be changed.');
}

export function createDreamTrace(options = {}, {
  idFactory = () => defaultId('trace'),
  clock = () => Date.now(),
} = {}) {
  const selectedInput = options.selectedModel || {};
  const modelId = required(selectedInput.id ?? options.modelId, 'Selected model ID');
  const modelName = text(selectedInput.name ?? options.modelName, modelId);
  const timestamp = at(options.startedAt ?? options.createdAt, clock);
  const id = required(options.id ?? options.traceId ?? idFactory(), 'Trace ID');
  const selectedModel = {
    id: modelId,
    name: modelName,
    providerId: text(selectedInput.providerId ?? options.providerId, 'openrouter'),
    upstreamProvider: text(selectedInput.upstreamProvider ?? selectedInput.provider ?? options.upstreamProvider),
  };
  const trace = {
    schema: DREAM_TRACE_SCHEMA,
    id,
    traceId: id,
    diagnosticId: text(options.diagnosticId, id),
    state: 'open',
    status: 'open',
    outcome: 'open',
    createdAt: timestamp,
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    selectedModel,
    modelId,
    modelName,
    providerId: selectedModel.providerId,
    upstreamProvider: selectedModel.upstreamProvider,
    liveAtStart: sanitizeTraceValue(options.liveAtStart ?? options.liveSnapshot ?? null),
    nextAtStart: sanitizeTraceValue(options.nextAtStart ?? options.nextSnapshot ?? null),
    finalLiveIdentity: null,
    finalGenerationId: '',
    generationId: '',
    failureCode: '',
    failureMessage: '',
    attempts: [],
    timeline: [timelineEntry('trace:created', timestamp)],
  };
  return immutable(applyProjection(trace));
}

export function recomputeDreamTrace(trace) {
  assertTrace(trace);
  return immutable(applyProjection(clone(trace)));
}

export function appendDreamAttempt(trace, input = {}, {
  idFactory = () => defaultId('attempt'),
  clock = () => Date.now(),
} = {}) {
  assertTraceOpen(trace);
  if (trace.attempts.length >= 2) throw new Error('A Dream trace can contain at most two attempts.');
  const expectedKind = trace.attempts.length === 0 ? 'generation' : 'repair';
  const kind = text(input.kind, expectedKind);
  if (kind !== expectedKind) throw new Error(`Attempt ${trace.attempts.length + 1} must be ${expectedKind}.`);
  if (trace.attempts.length && trace.attempts.at(-1).state !== 'closed') {
    throw new Error('Close the generation attempt before appending repair.');
  }
  const requestedModelId = text(input.requestedModelId ?? input.modelId, trace.selectedModel.id);
  if (requestedModelId !== trace.selectedModel.id) {
    throw new Error('Repair and generation must use the trace selected model.');
  }
  const timestamp = at(input.createdAt, clock);
  const id = required(input.id ?? input.attemptId ?? idFactory(), 'Attempt ID');
  if (trace.attempts.some(attempt => attempt.id === id)) throw new Error('Attempt IDs must be unique within a trace.');
  const next = clone(trace);
  next.attempts.push(emptyAttempt({ trace: next, input: { ...input, kind }, id, timestamp }));
  next.updatedAt = timestamp;
  next.timeline.push(timelineEntry(`attempt:${next.attempts.length}:appended`, timestamp, { attemptId: id, kind }));
  return immutable(applyProjection(next));
}

function mergeObjects(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return sanitizeTraceValue(patch);
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      output[key] = mergeObjects(base[key], value);
    } else {
      output[key] = sanitizeTraceValue(value);
    }
  }
  return output;
}

function sanitizeError(error) {
  if (error == null) return null;
  if (error instanceof Error) return sanitizeTraceValue(error);
  if (typeof error === 'string') return { name: 'Error', message: redactSecretStrings(error) };
  return sanitizeTraceValue(error);
}

export function patchDreamAttempt(trace, attemptId, patch = {}, {
  clock = () => Date.now(),
} = {}) {
  assertTraceOpen(trace);
  const next = clone(trace);
  const index = next.attempts.findIndex(attempt => attempt.id === attemptId || attempt.attemptId === attemptId);
  if (index < 0) throw new Error(`Unknown Dream attempt: ${attemptId}`);
  const attempt = next.attempts[index];
  if (attempt.state !== 'open') throw new Error('Closed Dream attempts are immutable.');
  const allowed = new Set(['identity', 'timing', 'request', 'response', 'artifact', 'timeline']);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new Error(`Attempt field ${key} cannot be patched.`);
  }

  const lockedIdentity = {
    traceId: attempt.identity.traceId,
    attemptId: attempt.identity.attemptId,
    requestedModelId: attempt.identity.requestedModelId,
    selectedDisplayName: attempt.identity.selectedDisplayName,
    providerId: attempt.identity.providerId,
    upstreamProvider: attempt.identity.upstreamProvider,
    diagnosticId: attempt.identity.diagnosticId,
  };
  if (patch.identity) attempt.identity = { ...mergeObjects(attempt.identity, patch.identity), ...lockedIdentity };
  if (patch.timing) attempt.timing = mergeObjects(attempt.timing, patch.timing);
  if (patch.request) {
    attempt.request = mergeObjects(attempt.request, patch.request);
    if (patch.request.headers !== undefined) attempt.request.headers = sanitizeSafeHeaders(patch.request.headers);
    if (patch.request.serializedBody !== undefined) attempt.request.serializedBody = redactSecretStrings(patch.request.serializedBody);
    if (attempt.request.model && attempt.request.model !== attempt.identity.requestedModelId) {
      throw new Error('Captured request model does not match the selected model.');
    }
  }
  if (patch.response) {
    attempt.response = mergeObjects(attempt.response, patch.response);
    if (patch.response.nativeFinishReason !== undefined && patch.response.native_finish_reason === undefined) {
      attempt.response.native_finish_reason = text(patch.response.nativeFinishReason);
    }
    if (patch.response.native_finish_reason !== undefined && patch.response.nativeFinishReason === undefined) {
      attempt.response.nativeFinishReason = text(patch.response.native_finish_reason);
    }
    if (patch.response.headers !== undefined) attempt.response.headers = sanitizeSafeHeaders(patch.response.headers);
    if (patch.response.rawBody !== undefined) attempt.response.rawBody = redactSecretStrings(patch.response.rawBody);
    if (patch.response.error !== undefined) attempt.response.error = sanitizeError(patch.response.error);
    if (patch.response.reasoning === undefined && (patch.response.payload !== undefined || patch.response.usage !== undefined)) {
      attempt.response.reasoning = extractProviderReasoning(attempt.response.payload, attempt.response.usage);
    }
  }
  if (patch.artifact) attempt.artifact = mergeObjects(attempt.artifact, patch.artifact);
  if (patch.timeline !== undefined) {
    if (!Array.isArray(patch.timeline)) throw new TypeError('Attempt timeline patches must be arrays.');
    attempt.timeline.push(...sanitizeTraceValue(patch.timeline));
  }

  attempt.identity.resolvedModel = text(attempt.response.resolvedModel, attempt.identity.resolvedModel);
  attempt.identity.requestId = text(attempt.response.requestId, attempt.identity.requestId);
  attempt.identity.providerGenerationId = text(attempt.response.providerGenerationId, attempt.identity.providerGenerationId);
  if (attempt.timing.providerDurationMs == null) {
    const start = numeric(attempt.timing.requestDispatchedAt);
    const end = numeric(attempt.timing.responseBodyCompleteAt);
    if (start != null && end != null && end >= start) attempt.timing.providerDurationMs = end - start;
  }
  const timestamp = clock();
  next.updatedAt = timestamp;
  next.attempts[index] = attempt;
  return immutable(applyProjection(next));
}

export function appendAttemptTimeline(trace, attemptId, stage, detail = {}, {
  clock = () => Date.now(),
} = {}) {
  const timestamp = detail.at ?? clock();
  const safeDetail = { ...detail };
  delete safeDetail.at;
  return patchDreamAttempt(trace, attemptId, {
    timeline: [timelineEntry(stage, timestamp, safeDetail)],
  }, { clock: () => timestamp });
}

export function appendTraceTimeline(trace, stage, detail = {}, {
  clock = () => Date.now(),
} = {}) {
  assertTraceOpen(trace);
  const next = clone(trace);
  const timestamp = detail.at ?? clock();
  const safeDetail = { ...detail };
  delete safeDetail.at;
  next.timeline.push(timelineEntry(stage, timestamp, safeDetail));
  next.updatedAt = timestamp;
  return immutable(applyProjection(next));
}

export function closeDreamAttempt(trace, attemptId, options = {}, {
  clock = () => Date.now(),
} = {}) {
  const patch = {};
  for (const key of ['identity', 'timing', 'request', 'response', 'artifact', 'timeline']) {
    if (options[key] !== undefined) patch[key] = options[key];
  }
  let next = Object.keys(patch).length ? patchDreamAttempt(trace, attemptId, patch, { clock }) : trace;
  assertTraceOpen(next);
  next = clone(next);
  const attempt = next.attempts.find(item => item.id === attemptId || item.attemptId === attemptId);
  if (!attempt) throw new Error(`Unknown Dream attempt: ${attemptId}`);
  if (attempt.state !== 'open') throw new Error('Closed Dream attempts are immutable.');
  const outcome = required(options.outcome ?? options.status, 'Attempt outcome');
  if (outcome === 'open') throw new Error('A closed attempt requires a final outcome.');
  const timestamp = at(options.closedAt, clock);
  attempt.state = 'closed';
  attempt.status = outcome;
  attempt.outcome = outcome;
  attempt.timing.closedAt = timestamp;
  if (options.error !== undefined) attempt.response.error = sanitizeError(options.error);
  attempt.timeline.push(timelineEntry(`attempt:${attempt.number}:closed`, timestamp, { outcome }));
  next.updatedAt = timestamp;
  return immutable(applyProjection(next));
}

export function finalizeDreamTrace(trace, options = {}, {
  clock = () => Date.now(),
} = {}) {
  assertTraceOpen(trace);
  if (trace.attempts.some(attempt => attempt.state !== 'closed')) {
    throw new Error('All Dream attempts must be closed before the trace is finalized.');
  }
  const next = clone(trace);
  const outcome = required(options.outcome ?? options.status, 'Trace outcome');
  if (outcome === 'open') throw new Error('A finalized trace requires a final outcome.');
  const timestamp = at(options.finishedAt, clock);
  next.state = 'closed';
  next.status = outcome;
  next.outcome = outcome;
  next.finishedAt = timestamp;
  next.updatedAt = timestamp;
  next.finalGenerationId = text(options.generationId ?? options.finalGenerationId);
  next.generationId = next.finalGenerationId;
  next.finalLiveIdentity = sanitizeTraceValue(options.finalLiveIdentity ?? options.liveIdentity ?? null);
  const failure = options.failure || {};
  next.failureCode = text(options.failureCode ?? failure.code);
  next.failureMessage = redactSecretStrings(options.failureMessage ?? failure.message ?? '');
  next.timeline.push(timelineEntry(`trace:finished:${outcome}`, timestamp, { failureCode: next.failureCode }));
  return immutable(applyProjection(next));
}

export function recordDreamTraceRollback(trace, options = {}, {
  clock = () => Date.now(),
} = {}) {
  assertTrace(trace);
  if (trace.state !== 'closed') throw new Error('Only a finalized Dream trace can record a later runtime rollback.');
  const next = clone(trace);
  const timestamp = at(options.rolledBackAt, clock);
  const failure = options.failure || options.rollback || {};
  if (next.status !== 'rolled-back') next.originalOutcome = next.outcome;
  if (next.initialFinishedAt == null) next.initialFinishedAt = next.finishedAt;
  next.status = 'rolled-back';
  next.outcome = 'rolled-back';
  next.finishedAt = timestamp;
  next.updatedAt = timestamp;
  next.rolledBackAt = timestamp;
  next.failureCode = text(options.failureCode ?? failure.code, next.failureCode || 'RUNTIME_FAILURE');
  next.failureMessage = redactSecretStrings(options.failureMessage ?? failure.message ?? next.failureMessage ?? '');
  next.finalLiveIdentity = sanitizeTraceValue(options.finalLiveIdentity ?? options.liveIdentity ?? next.finalLiveIdentity);
  next.rollback = sanitizeTraceValue(failure);
  next.aftercare = [...(Array.isArray(next.aftercare) ? next.aftercare : []), {
    stage: 'runtime:rolled-back',
    at: timestamp,
    failureCode: next.failureCode,
    failureMessage: next.failureMessage,
    finalLiveIdentity: next.finalLiveIdentity,
  }];
  next.timeline.push(timelineEntry('runtime:rolled-back', timestamp, { failureCode: next.failureCode }));
  return immutable(applyProjection(next));
}

export function legacyDiagnosticToTrace(diagnostic = {}) {
  const safe = sanitizeTraceValue(diagnostic) || {};
  const timestamp = safe.createdAt ?? 0;
  const id = text(safe.id, `legacy-${timestamp}`);
  const legacyRawOutput = typeof safe.rawOutput === 'string' ? safe.rawOutput : '';
  const legacyHtml = typeof safe.html === 'string' ? safe.html : '';
  const legacyAttempts = Array.isArray(safe.attempts) && safe.attempts.length ? safe.attempts.slice(0, 2) : [{}];
  const attempts = legacyAttempts.map((legacyAttempt, index) => {
    const kind = index === 0 ? 'generation' : 'repair';
    const attemptId = text(legacyAttempt.id, `${id}-attempt-${index + 1}`);
    const responseBelongsHere = index === legacyAttempts.length - 1;
    return {
      id: attemptId,
      attemptId,
      number: index + 1,
      kind,
      state: 'closed',
      status: responseBelongsHere ? text(safe.status, 'unknown') : 'legacy-unknown',
      outcome: responseBelongsHere ? text(safe.status, 'unknown') : 'legacy-unknown',
      identity: {
        traceId: id,
        attemptId,
        requestedModelId: text(safe.modelId),
        selectedDisplayName: text(safe.modelName, text(safe.modelId, 'Unknown model')),
        providerId: text(safe.providerId),
        upstreamProvider: text(safe.upstreamProvider),
        resolvedModel: responseBelongsHere ? text(safe.resolvedModel) : '',
        requestId: responseBelongsHere ? text(safe.requestId) : '',
        providerGenerationId: '',
        diagnosticId: id,
        generationId: text(safe.generationId),
      },
      timing: {
        createdAt: legacyAttempt.startedAt ?? timestamp,
        closedAt: legacyAttempt.finishedAt ?? safe.finishedAt ?? safe.updatedAt ?? timestamp,
      },
      request: {
        captured: false,
        dispatched: null,
        notCaptured: LEGACY_NOT_CAPTURED,
        method: '',
        endpoint: '',
        model: text(safe.modelId),
        messages: [],
        messagesNotice: LEGACY_NOT_CAPTURED,
        parameters: {},
        policy: null,
        headers: {},
        serializedBody: '',
      },
      response: {
        status: null,
        headers: {},
        rawBody: '',
        payload: null,
        streamAggregate: null,
        assistantText: responseBelongsHere ? legacyRawOutput : '',
        rawOutput: responseBelongsHere ? legacyRawOutput : '',
        extractedHtml: responseBelongsHere ? legacyHtml : '',
        finishReason: '',
        nativeFinishReason: '',
        native_finish_reason: '',
        resolvedModel: responseBelongsHere ? text(safe.resolvedModel) : '',
        requestId: responseBelongsHere ? text(safe.requestId) : '',
        providerGenerationId: '',
        usage: responseBelongsHere ? safe.usage ?? null : null,
        cost: responseBelongsHere ? firstNumeric(safe.cost, safe.usage?.cost) : null,
        costDetails: null,
        reasoning: { status: 'not-captured', exposed: false, hasText: false, label: LEGACY_NOT_CAPTURED, text: '', details: [], tokenCount: null },
        error: responseBelongsHere && safe.failureMessage ? { name: 'LegacyDiagnosticError', message: safe.failureMessage, code: safe.failureCode || '' } : null,
        transport: null,
      },
      artifact: {
        staticValidation: legacyAttempt.staticValidation ?? safe.staticValidation ?? null,
        reliability: legacyAttempt.reliability ?? safe.reliability ?? null,
        rendererEvidence: null,
        consoleErrors: [],
        consoleWarnings: [],
        shaderFailures: [],
        vizConsumption: null,
        visibleOutput: null,
        viewportCanary: null,
        performanceWarnings: [],
        promotionWatchdog: legacyAttempt.promotionWatchdog ?? safe.promotionWatchdog ?? null,
        rollbackReason: safe.rollback ?? null,
        repairProblem: index === 1 ? text(safe.repairProblem) : '',
      },
      timeline: Array.isArray(legacyAttempt.timeline) ? legacyAttempt.timeline : [],
    };
  });
  const trace = {
    schema: DREAM_TRACE_SCHEMA,
    sourceSchema: text(safe.schema, 'legacy-diagnostic'),
    legacy: true,
    legacyNotice: LEGACY_NOT_CAPTURED,
    id,
    traceId: id,
    diagnosticId: id,
    state: 'closed',
    status: text(safe.status, 'unknown'),
    outcome: text(safe.status, 'unknown'),
    createdAt: timestamp,
    startedAt: timestamp,
    updatedAt: safe.updatedAt ?? timestamp,
    finishedAt: safe.finishedAt ?? safe.updatedAt ?? timestamp,
    selectedModel: {
      id: text(safe.modelId),
      name: text(safe.modelName, text(safe.modelId, 'Unknown model')),
      providerId: text(safe.providerId),
      upstreamProvider: text(safe.upstreamProvider),
    },
    modelId: text(safe.modelId),
    modelName: text(safe.modelName, text(safe.modelId, 'Unknown model')),
    providerId: text(safe.providerId),
    upstreamProvider: text(safe.upstreamProvider),
    liveAtStart: null,
    nextAtStart: null,
    finalLiveIdentity: null,
    finalGenerationId: text(safe.generationId),
    generationId: text(safe.generationId),
    failureCode: text(safe.failureCode),
    failureMessage: text(safe.failureMessage),
    promptVersion: text(safe.promptVersion),
    healthStatus: text(safe.healthStatus),
    healthSummary: safe.healthSummary ?? null,
    attempt: numeric(safe.attempt),
    favorite: Boolean(safe.favorite),
    battleWins: numeric(safe.battleWins) ?? 0,
    battleLosses: numeric(safe.battleLosses) ?? 0,
    attempts,
    timeline: Array.isArray(safe.timeline) ? safe.timeline : [],
  };
  return immutable(applyProjection(trace));
}

export function dreamTraceForExport(trace, { includeHtml = true, maxDepth, maxNodes } = {}) {
  const safe = sanitizeTraceValue(trace, { maxDepth, maxNodes });
  if (!includeHtml && safe && Array.isArray(safe.attempts)) {
    for (const attempt of safe.attempts) {
      if (!attempt?.response) continue;
      delete attempt.response.rawBody;
      delete attempt.response.payload;
      delete attempt.response.assistantText;
      delete attempt.response.rawOutput;
      delete attempt.response.extractedHtml;
    }
    delete safe.rawOutput;
    delete safe.html;
  }
  return safe;
}

export function dreamTracesForExport(traces, { clock = () => Date.now(), ...options } = {}) {
  return {
    schema: DREAM_TRACE_EXPORT_SCHEMA,
    exportedAt: new Date(clock()).toISOString(),
    traces: Array.from(traces || [], trace => dreamTraceForExport(trace, options)),
  };
}

function buildFixtureTraces() {
  const generationMessages = buildGenerationMessages();
  const brokenOutput = '<!doctype html><html><body><canvas></canvas></body></html>';
  const repairProblem = 'VIZ_NOT_CONSUMED\nThe candidate rendered but did not consume window.VIZ frames.';
  const repairMessages = buildRepairMessages(brokenOutput, repairProblem);
  const repairedOutput = '<!doctype html><html><body><canvas id="art"></canvas><script>window.__dreamTraceFixtureOnly = true;</script></body></html>';
  const liveBefore = {
    schema: 'live-identity-v1',
    revision: 2,
    live: { modelId: 'built-in/calibration-bloom', modelName: 'Calibration Bloom', displayName: 'Calibration Bloom' },
    next: { modelId: 'moonshotai/kimi-k3', modelName: 'Kimi K3', displayName: 'Kimi K3' },
    candidate: null,
  };
  const liveAfter = {
    schema: 'live-identity-v1',
    revision: 5,
    live: { modelId: 'moonshotai/kimi-k3', modelName: 'Kimi K3', generationId: 'a41c20d7-fixture-generation', marker: 'a41c20d7', displayName: 'Kimi K3 · #a41c20d7' },
    next: { modelId: 'moonshotai/kimi-k3', modelName: 'Kimi K3', displayName: 'Kimi K3' },
    candidate: null,
  };
  const dependencies = { idFactory: () => 'unused', clock: () => 0 };
  let repaired = createDreamTrace({
    id: 'trace-fixture-repaired',
    diagnosticId: 'diagnostic-fixture-repaired',
    selectedModel: { id: 'moonshotai/kimi-k3', name: 'Kimi K3', providerId: 'openrouter', upstreamProvider: 'moonshotai' },
    liveAtStart: liveBefore,
    nextAtStart: liveBefore,
    startedAt: 1000,
  }, dependencies);
  repaired = appendDreamAttempt(repaired, { id: 'attempt-fixture-generation', kind: 'generation', createdAt: 1010 }, dependencies);
  const generationPayload = {
    id: 'or-request-generation',
    model: 'moonshotai/kimi-k3:exact',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: brokenOutput } }],
    usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200, cost: 0.0125 },
  };
  repaired = closeDreamAttempt(repaired, 'attempt-fixture-generation', {
    outcome: 'repair-required',
    closedAt: 1400,
    timing: { availabilityStartedAt: 1012, availabilityEndedAt: 1020, requestPreparedAt: 1022, requestDispatchedAt: 1030, responseHeadersAt: 1300, responseBodyCompleteAt: 1320, artifactValidationStartedAt: 1330, artifactValidationEndedAt: 1390 },
    request: {
      captured: true,
      dispatched: true,
      method: 'POST',
      endpoint: 'openrouter:chat-completions',
      model: 'moonshotai/kimi-k3',
      messages: generationMessages,
      parameters: { temperature: 1, max_tokens: 4200, stream: false, usage: { include: true } },
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-secret-never-retained' },
      serializedBody: JSON.stringify({ model: 'moonshotai/kimi-k3', messages: generationMessages, temperature: 1, max_tokens: 4200, stream: false, usage: { include: true } }),
    },
    response: {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': 'or-request-generation' },
      rawBody: JSON.stringify(generationPayload),
      payload: generationPayload,
      assistantText: brokenOutput,
      rawOutput: brokenOutput,
      extractedHtml: brokenOutput,
      finishReason: 'stop',
      resolvedModel: generationPayload.model,
      requestId: generationPayload.id,
      usage: generationPayload.usage,
      cost: generationPayload.usage.cost,
    },
    artifact: { reliability: { passed: false, failure: { code: 'VIZ_NOT_CONSUMED', message: 'No VIZ frame consumption observed.' } }, vizConsumption: false, repairProblem },
  }, dependencies);
  repaired = appendDreamAttempt(repaired, { id: 'attempt-fixture-repair', kind: 'repair', createdAt: 1410 }, dependencies);
  const repairPayload = {
    id: 'or-request-repair',
    model: 'moonshotai/kimi-k3:exact',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: repairedOutput, reasoning: 'I connected the animation loop to VIZ.onFrame while preserving the canvas composition.' } }],
    usage: { prompt_tokens: 240, completion_tokens: 110, total_tokens: 350, completion_tokens_details: { reasoning_tokens: 18 }, cost: 0.0085 },
  };
  repaired = closeDreamAttempt(repaired, 'attempt-fixture-repair', {
    outcome: 'succeeded',
    closedAt: 1900,
    timing: { availabilityStartedAt: 1412, availabilityEndedAt: 1420, requestPreparedAt: 1422, requestDispatchedAt: 1430, responseHeadersAt: 1700, responseBodyCompleteAt: 1730, artifactValidationStartedAt: 1740, artifactValidationEndedAt: 1800, promotionStartedAt: 1810, watchdogStartedAt: 1820, watchdogEndedAt: 1880, promotionEndedAt: 1890 },
    request: {
      captured: true,
      dispatched: true,
      method: 'POST',
      endpoint: 'openrouter:chat-completions',
      model: 'moonshotai/kimi-k3',
      messages: repairMessages,
      parameters: { temperature: 1, max_tokens: 2800, stream: false, usage: { include: true } },
      headers: { 'content-type': 'application/json', authorization: 'Bearer another-fixture-secret' },
      serializedBody: JSON.stringify({ model: 'moonshotai/kimi-k3', messages: repairMessages, temperature: 1, max_tokens: 2800, stream: false, usage: { include: true } }),
    },
    response: {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': 'or-request-repair' },
      rawBody: JSON.stringify(repairPayload),
      payload: repairPayload,
      assistantText: repairedOutput,
      rawOutput: repairedOutput,
      extractedHtml: repairedOutput,
      finishReason: 'stop',
      resolvedModel: repairPayload.model,
      requestId: repairPayload.id,
      usage: repairPayload.usage,
      cost: repairPayload.usage.cost,
    },
    artifact: { staticValidation: [], reliability: { passed: true, summary: { visible: true, vizConsumed: true, rendererTypes: ['2d'] } }, vizConsumption: true, visibleOutput: true, viewportCanary: { passed: true }, promotionWatchdog: { passed: true, durationMs: 60 } },
  }, dependencies);
  repaired = finalizeDreamTrace(repaired, { outcome: 'succeeded', finishedAt: 1910, generationId: 'a41c20d7-fixture-generation', finalLiveIdentity: liveAfter }, dependencies);

  const rolledBackStart = {
    schema: 'live-identity-v1',
    revision: 8,
    live: { modelId: 'anthropic/claude-sonnet', modelName: 'Claude Sonnet', generationId: 'bb22cc33-live', marker: 'bb22cc33', displayName: 'Claude Sonnet · #bb22cc33' },
    next: { modelId: 'google/gemini-flash', modelName: 'Gemini Flash', displayName: 'Gemini Flash' },
    candidate: null,
  };
  let rolledBack = createDreamTrace({
    id: 'trace-fixture-rolled-back',
    diagnosticId: 'diagnostic-fixture-rolled-back',
    selectedModel: { id: 'google/gemini-flash', name: 'Gemini Flash', providerId: 'openrouter', upstreamProvider: 'google' },
    liveAtStart: rolledBackStart,
    nextAtStart: rolledBackStart,
    startedAt: 3000,
  }, dependencies);
  rolledBack = appendDreamAttempt(rolledBack, { id: 'attempt-fixture-rolled-back', kind: 'generation', createdAt: 3010 }, dependencies);
  const rollbackOutput = '<!doctype html><html><body><div>Fixture candidate</div></body></html>';
  const rollbackPayload = {
    id: 'or-request-rolled-back',
    model: 'google/gemini-flash:resolved',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: rollbackOutput } }],
    usage: { prompt_tokens: 90, completion_tokens: 70, total_tokens: 160, completion_tokens_details: { reasoning_tokens: 11 }, cost: 0 },
  };
  rolledBack = closeDreamAttempt(rolledBack, 'attempt-fixture-rolled-back', {
    outcome: 'rolled-back',
    closedAt: 3600,
    timing: { availabilityStartedAt: 3012, availabilityEndedAt: 3020, requestDispatchedAt: 3030, responseHeadersAt: 3300, responseBodyCompleteAt: 3320, promotionStartedAt: 3400, watchdogStartedAt: 3410, watchdogEndedAt: 3550, rollbackAt: 3560, promotionEndedAt: 3580 },
    request: { captured: true, dispatched: true, method: 'POST', endpoint: 'openrouter:chat-completions', model: 'google/gemini-flash', messages: generationMessages, parameters: { max_tokens: 3600, temperature: 1, stream: false }, headers: { authorization: 'Bearer fixture' }, serializedBody: JSON.stringify({ model: 'google/gemini-flash', messages: generationMessages, max_tokens: 3600, temperature: 1, stream: false }) },
    response: { status: 200, rawBody: JSON.stringify(rollbackPayload), payload: rollbackPayload, assistantText: rollbackOutput, rawOutput: rollbackOutput, extractedHtml: rollbackOutput, finishReason: 'stop', resolvedModel: rollbackPayload.model, requestId: rollbackPayload.id, usage: rollbackPayload.usage, cost: 0 },
    artifact: { reliability: { passed: true }, promotionWatchdog: { passed: false, failure: { code: 'RUNTIME_ERROR', message: 'Fixture candidate crashed during the rollback window.' } }, rollbackReason: { code: 'RUNTIME_ERROR', message: 'Fixture candidate crashed during the rollback window.' } },
  }, dependencies);
  rolledBack = finalizeDreamTrace(rolledBack, { outcome: 'rolled-back', finishedAt: 3610, failureCode: 'RUNTIME_ERROR', failureMessage: 'Fixture candidate crashed during the rollback window.', finalLiveIdentity: rolledBackStart }, dependencies);

  return immutable({ repaired, rolledBack });
}

export const DREAM_TRACE_FIXTURES = buildFixtureTraces();

export function createDreamTraceFixtures() {
  return clone(DREAM_TRACE_FIXTURES);
}
