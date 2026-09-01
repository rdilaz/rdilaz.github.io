import {
  REDACTED,
  extractProviderReasoning,
  redactSecretStrings,
  sanitizeSafeHeaders,
  sanitizeTraceValue,
} from './dream-trace.js';

export const TRACE_BRIDGE_SCHEMA = 'dream-trace-bridge-v1';

const TRACE_CONTEXT = Symbol('dream-trace-context');
const captures = new Map();

function defaultId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  try {
    Object.freeze(value);
  } catch {
    return value;
  }
  return value;
}

function validText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function lookup(context) {
  if (!context) return null;
  if (typeof context === 'string') return captures.get(context) || null;
  if (typeof context !== 'object') return null;
  const correlationId = validText(context.correlationId);
  const record = correlationId ? captures.get(correlationId) : null;
  return record?.context === context ? record : null;
}

function timestamp(record, detail = {}, keys = []) {
  for (const key of ['at', ...keys]) {
    if (detail?.[key] !== undefined && detail[key] !== null) return detail[key];
  }
  return record.clock();
}

function timeline(record, stage, at, detail = {}) {
  record.timeline.push({ stage, at, ...sanitizeTraceValue(detail) });
  record.updatedAt = at;
}

function safeError(error) {
  if (error == null) return null;
  if (error instanceof Error) return sanitizeTraceValue(error);
  if (typeof error === 'string') return { name: 'Error', message: redactSecretStrings(error) };
  return sanitizeTraceValue(error);
}

function sanitizedJsonText(value, parsedValue) {
  const original = String(value ?? '');
  let parsed = parsedValue;
  if (parsed === undefined) {
    try { parsed = JSON.parse(original); } catch { return redactSecretStrings(original); }
  }
  const safe = sanitizeTraceValue(parsed);
  const redacted = redactSecretStrings(original);
  try {
    if (redacted === original && JSON.stringify(parsed) === JSON.stringify(safe)) return original;
    return JSON.stringify(safe);
  } catch {
    return redacted;
  }
}

function safeUrl(value) {
  const input = validText(value);
  if (!input) return '';
  try {
    const url = new URL(input, 'https://local.invalid');
    const relative = url.origin === 'https://local.invalid';
    const safe = `${relative ? '' : url.origin}${url.pathname}`;
    return redactSecretStrings(safe);
  } catch {
    return redactSecretStrings(input.split(/[?#]/, 1)[0]);
  }
}

function parametersFromBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const parameters = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'model' || key === 'messages') continue;
    parameters[key] = value;
  }
  return sanitizeTraceValue(parameters);
}

function responseCost(detail, usage) {
  for (const value of [detail?.reportedCost, detail?.cost, usage?.cost, usage?.total_cost]) {
    if (value === '' || value == null) continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

export function beginTraceCapture({
  traceId,
  attemptId,
  displayName,
  correlationId,
  ...metadata
} = {}, {
  idFactory = defaultId,
  clock = () => Date.now(),
} = {}) {
  if (typeof idFactory !== 'function' || typeof clock !== 'function') return null;
  const safeTraceId = validText(traceId);
  const safeAttemptId = validText(attemptId);
  const safeDisplayName = redactSecretStrings(validText(displayName));
  if (!safeTraceId || !safeAttemptId || !safeDisplayName) return null;

  let id = validText(correlationId);
  if (id && captures.has(id)) return null;
  for (let claim = 0; !id || captures.has(id); claim += 1) {
    if (claim >= 8) return null;
    id = `capture:${String(idFactory())}:${claim + 1}`;
  }

  const createdAt = clock();
  const context = Object.freeze({ correlationId: id });
  captures.set(id, {
    context,
    clock,
    schema: TRACE_BRIDGE_SCHEMA,
    correlationId: id,
    traceId: safeTraceId,
    attemptId: safeAttemptId,
    displayName: safeDisplayName,
    metadata: sanitizeTraceValue(metadata),
    createdAt,
    updatedAt: createdAt,
    timing: {
      availabilityStartedAt: null,
      availabilityEndedAt: null,
      requestPreparedAt: null,
      requestDispatchedAt: null,
      responseHeadersAt: null,
      responseBodyCompleteAt: null,
      providerDurationMs: null,
    },
    availability: null,
    request: null,
    response: null,
    errors: [],
    timeline: [{ stage: 'capture:began', at: createdAt }],
    claims: new Set(),
  });
  return context;
}

export function attachTraceContext(init = {}, context) {
  const output = { ...(init || {}) };
  const existing = traceContextFromInit(output);
  if (existing) return output;
  if (!lookup(context)) return output;
  Object.defineProperty(output, TRACE_CONTEXT, {
    value: context,
    enumerable: true,
    configurable: true,
    writable: false,
  });
  return output;
}

export function traceContextFromInit(init) {
  if (!init || typeof init !== 'object') return null;
  let context;
  try { context = init[TRACE_CONTEXT]; } catch { return null; }
  return lookup(context)?.context || null;
}

export function stripTraceContext(init = {}) {
  const output = { ...(init || {}) };
  delete output[TRACE_CONTEXT];
  return output;
}

export function traceDisplayName(context) {
  return lookup(context)?.displayName || '';
}

export function captureAvailabilityStart(context, detail = {}) {
  const record = lookup(context);
  if (!record || record.claims.has('availability-start')) return false;
  const at = timestamp(record, detail, ['startedAt']);
  record.claims.add('availability-start');
  record.timing.availabilityStartedAt = at;
  record.availability = {
    modelId: validText(detail.modelId),
    endpoint: validText(detail.endpoint),
    status: 'checking',
    startedAt: at,
    endedAt: null,
  };
  timeline(record, 'availability:started', at, {
    modelId: record.availability.modelId,
    endpoint: record.availability.endpoint,
  });
  return true;
}

export function captureAvailabilityEnd(context, detail = {}) {
  const record = lookup(context);
  if (!record || !record.claims.has('availability-start') || record.claims.has('availability-end')) return false;
  const at = timestamp(record, detail, ['endedAt']);
  record.claims.add('availability-end');
  record.timing.availabilityEndedAt = at;
  record.availability = {
    ...record.availability,
    modelId: validText(detail.modelId) || record.availability.modelId,
    status: validText(detail.status) || 'unknown',
    code: validText(detail.code),
    resolvedModel: validText(detail.resolvedModel),
    error: safeError(detail.error),
    endedAt: at,
  };
  timeline(record, 'availability:ended', at, {
    status: record.availability.status,
    code: record.availability.code,
    resolvedModel: record.availability.resolvedModel,
    error: record.availability.error,
  });
  return true;
}

export function captureFinalRequest(context, detail = {}) {
  const record = lookup(context);
  if (!record || record.claims.has('final-request')) return false;
  const at = timestamp(record, detail, ['preparedAt']);
  const safeBody = sanitizeTraceValue(detail.body ?? null);
  const serializedBody = sanitizedJsonText(detail.serializedBody ?? '', detail.body);
  const messages = Array.isArray(safeBody?.messages) ? safeBody.messages : [];
  record.claims.add('final-request');
  record.timing.requestPreparedAt = at;
  record.request = {
    captured: true,
    dispatched: false,
    method: validText(detail.method).toUpperCase() || 'POST',
    endpoint: validText(detail.endpoint),
    url: safeUrl(detail.url),
    model: validText(safeBody?.model),
    messages,
    parameters: parametersFromBody(safeBody),
    headers: sanitizeSafeHeaders(detail.headers),
    body: safeBody,
    serializedBody,
  };
  timeline(record, 'request:prepared-final', at, {
    method: record.request.method,
    endpoint: record.request.endpoint,
    model: record.request.model,
    maxTokens: record.request.parameters?.max_tokens ?? null,
  });
  return true;
}

export function captureRequestDispatched(context, detail = {}) {
  const record = lookup(context);
  if (!record || !record.request || record.claims.has('request-dispatched')) return false;
  const at = timestamp(record, detail, ['dispatchedAt']);
  record.claims.add('request-dispatched');
  record.request.dispatched = true;
  record.timing.requestDispatchedAt = at;
  timeline(record, 'request:dispatched', at, { endpoint: record.request.endpoint });
  return true;
}

export function captureResponseHeaders(context, response, detail = {}) {
  const record = lookup(context);
  if (!record || !record.claims.has('request-dispatched') || record.claims.has('response-headers')) return false;
  const at = timestamp(record, detail, ['headersAt']);
  record.claims.add('response-headers');
  record.timing.responseHeadersAt = at;
  const status = Number(response?.status);
  const headers = sanitizeSafeHeaders(response?.headers ?? detail.headers);
  record.response = {
    status: Number.isFinite(status) ? status : null,
    headers,
    rawBody: '',
    payload: null,
    assistantText: '',
    rawOutput: '',
    extractedHtml: '',
    finishReason: '',
    resolvedModel: '',
    requestId: validText(headers['x-request-id'] || headers['request-id']),
    usage: null,
    cost: null,
    costDetails: null,
    reasoning: extractProviderReasoning(null, null),
    error: null,
  };
  timeline(record, 'response:headers', at, { status: record.response.status });
  return true;
}

export function captureResponseBodyComplete(context, detail = {}) {
  const record = lookup(context);
  if (!record || !record.claims.has('request-dispatched') || record.claims.has('response-body-complete')) return false;
  const at = timestamp(record, detail, ['completedAt']);
  record.claims.add('response-body-complete');
  record.timing.responseBodyCompleteAt = at;
  const startedAt = Number(record.timing.requestDispatchedAt);
  const endedAt = Number(at);
  if (Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt) {
    record.timing.providerDurationMs = endedAt - startedAt;
  }
  timeline(record, 'response:body-complete', at);
  return true;
}

export function captureProviderResponse(context, detail = {}) {
  const record = lookup(context);
  if (!record || !record.claims.has('request-dispatched') || record.claims.has('provider-response')) return false;
  const at = timestamp(record, detail, ['completedAt']);
  record.claims.add('provider-response');
  if (!record.claims.has('response-body-complete')) {
    record.claims.add('response-body-complete');
    record.timing.responseBodyCompleteAt = at;
  }
  const parsedPayload = sanitizeTraceValue(detail.parsedPayload ?? detail.payload ?? null);
  const usage = sanitizeTraceValue(detail.usage ?? parsedPayload?.usage ?? null);
  const rawBodyText = sanitizedJsonText(
    detail.rawBodyText ?? detail.rawBody ?? '',
    detail.parseError ? undefined : detail.parsedPayload ?? detail.payload,
  );
  const existing = record.response || {};
  const responseStatus = Number(detail.response?.status ?? detail.status ?? existing.status);
  const headers = Object.keys(existing.headers || {}).length
    ? existing.headers
    : sanitizeSafeHeaders(detail.response?.headers ?? detail.headers);
  const cost = responseCost(detail, usage);
  const assistantText = redactSecretStrings(detail.assistantText ?? '');
  record.response = {
    status: Number.isFinite(responseStatus) ? responseStatus : null,
    headers,
    rawBody: rawBodyText,
    payload: parsedPayload,
    assistantText,
    rawOutput: redactSecretStrings(detail.rawOutput ?? assistantText),
    extractedHtml: redactSecretStrings(detail.extractedHtml ?? ''),
    finishReason: validText(detail.finishReason),
    resolvedModel: validText(detail.resolvedModel),
    requestId: validText(detail.requestId) || validText(headers['x-request-id'] || headers['request-id']),
    usage,
    cost,
    costDetails: sanitizeTraceValue(detail.costDetails ?? usage?.cost_details ?? usage?.costDetails ?? null),
    reasoning: extractProviderReasoning(parsedPayload, usage),
    parseError: safeError(detail.parseError),
    error: existing.error || null,
  };
  const startedAt = Number(record.timing.requestDispatchedAt);
  const endedAt = Number(record.timing.responseBodyCompleteAt);
  if (Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt) {
    record.timing.providerDurationMs = endedAt - startedAt;
  }
  timeline(record, 'provider:response-captured', at, {
    status: record.response.status,
    finishReason: record.response.finishReason,
    resolvedModel: record.response.resolvedModel,
    requestId: record.response.requestId,
  });
  return true;
}

export function captureTraceError(context, error, detail = {}) {
  const record = lookup(context);
  if (!record) return false;
  const at = timestamp(record, detail);
  const safe = safeError(error) || { name: 'Error', message: 'Unknown trace error.' };
  const stage = validText(detail.stage) || 'unknown';
  const duplicate = record.errors.some(entry => (
    entry.stage === stage
    && entry.error?.name === safe.name
    && entry.error?.message === safe.message
  ));
  if (duplicate) return false;
  const errorDetail = sanitizeTraceValue(detail);
  delete errorDetail.at;
  delete errorDetail.stage;
  const entry = { stage, at, error: safe, ...errorDetail };
  record.errors.push(entry);
  if (!record.response) {
    record.response = {
      status: Number.isFinite(Number(detail.status)) ? Number(detail.status) : null,
      headers: {},
      rawBody: '',
      payload: sanitizeTraceValue(detail.payload ?? null),
      assistantText: '',
      rawOutput: '',
      extractedHtml: '',
      finishReason: '',
      resolvedModel: '',
      requestId: '',
      usage: null,
      cost: null,
      costDetails: null,
      reasoning: extractProviderReasoning(null, null),
      error: safe,
    };
  } else if (!record.response.error) {
    record.response.error = safe;
  }
  timeline(record, `error:${stage}`, at, { error: safe, ...errorDetail });
  return true;
}

export function consumeTraceCapture(context) {
  const record = lookup(context);
  if (!record) return null;
  captures.delete(record.correlationId);
  const consumedAt = record.clock();
  const output = {
    schema: record.schema,
    correlationId: record.correlationId,
    traceId: record.traceId,
    attemptId: record.attemptId,
    displayName: record.displayName,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: consumedAt,
    consumedAt,
    timing: record.timing,
    availability: record.availability,
    request: record.request,
    response: record.response,
    errors: record.errors,
    timeline: record.timeline,
  };
  const safe = sanitizeTraceValue(output);
  if (record.request?.headers?.authorization === REDACTED) {
    safe.request.headers.authorization = REDACTED;
  }
  if (record.response?.headers?.authorization === REDACTED) {
    safe.response.headers.authorization = REDACTED;
  }
  return deepFreeze(safe);
}

export function discardTraceCapture(context) {
  const record = lookup(context);
  if (!record) return false;
  captures.delete(record.correlationId);
  return true;
}
