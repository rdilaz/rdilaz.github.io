import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILT_IN_LIVE_IDENTITY,
  EMPTY_NEXT_IDENTITY,
  LIVE_IDENTITY_SCHEMA,
  createLiveIdentityController,
  identityMarker,
} from '../public/visualizer/live-identity.js';
import {
  DREAM_TRACE_FIXTURES,
  DREAM_TRACE_SCHEMA,
  LEGACY_NOT_CAPTURED,
  REASONING_NOT_EXPOSED,
  REDACTED,
  appendDreamAttempt,
  closeDreamAttempt,
  createDreamTrace,
  createDreamTraceFixtures,
  dreamTraceForExport,
  extractProviderReasoning,
  finalizeDreamTrace,
  legacyDiagnosticToTrace,
  patchDreamAttempt,
  recordDreamTraceRollback,
  sanitizeSafeHeaders,
  sanitizeTraceValue,
} from '../public/visualizer/dream-trace.js';
import {
  TRACE_BRIDGE_SCHEMA,
  attachTraceContext,
  beginTraceCapture,
  captureAvailabilityEnd,
  captureAvailabilityStart,
  captureFinalRequest,
  captureProviderResponse,
  captureRequestDispatched,
  captureResponseBodyComplete,
  captureResponseHeaders,
  captureTraceError,
  consumeTraceCapture,
  discardTraceCapture,
  stripTraceContext,
  traceContextFromInit,
  traceDisplayName,
} from '../public/visualizer/trace-bridge.js';
import { buildGenerationMessages, buildRepairMessages } from '../public/visualizer/prompt.js';

const MODEL = Object.freeze({
  id: 'moonshotai/kimi-k3',
  name: 'Kimi K3',
  providerId: 'openrouter',
  upstreamProvider: 'moonshotai',
});

const GENERATED = Object.freeze({
  modelId: MODEL.id,
  modelName: MODEL.name,
  providerId: MODEL.providerId,
  upstreamProvider: MODEL.upstreamProvider,
  generationId: 'a41c20d7-generation-one',
  traceId: 'trace-generation-one',
});

function identityController() {
  let time = 100;
  return createLiveIdentityController({
    idFactory: () => 'fixed-token-source',
    clock: () => ++time,
  });
}

function traceDependencies() {
  let time = 1000;
  let id = 0;
  return {
    clock: () => ++time,
    idFactory: () => `id-${++id}`,
  };
}

function generationTrace() {
  const dependencies = traceDependencies();
  let trace = createDreamTrace({
    id: 'trace-contract',
    diagnosticId: 'diagnostic-contract',
    selectedModel: MODEL,
    startedAt: 10,
  }, dependencies);
  trace = appendDreamAttempt(trace, {
    id: 'attempt-generation',
    kind: 'generation',
    createdAt: 20,
  }, dependencies);
  return { trace, dependencies };
}

function capturedGeneration(trace, dependencies, overrides = {}) {
  const html = '<!doctype html><html><body>one</body></html>';
  return patchDreamAttempt(trace, 'attempt-generation', {
    timing: { requestDispatchedAt: 30, responseBodyCompleteAt: 50 },
    request: {
      captured: true,
      dispatched: true,
      method: 'POST',
      endpoint: 'openrouter.chat.completions',
      model: MODEL.id,
      messages: buildGenerationMessages(),
      parameters: { temperature: 1, max_tokens: 3210, stream: false },
      headers: { Authorization: 'Bearer contract-secret', 'Content-Type': 'application/json' },
      serializedBody: JSON.stringify({ model: MODEL.id, messages: buildGenerationMessages(), max_tokens: 3210 }),
    },
    response: {
      status: 200,
      rawBody: '{"provider":"raw response body"}',
      payload: { id: 'request-1', choices: [{ finish_reason: 'stop', message: { content: 'assistant output' } }] },
      assistantText: 'assistant output',
      rawOutput: 'assistant output',
      extractedHtml: html,
      finishReason: 'stop',
      resolvedModel: `${MODEL.id}:resolved`,
      requestId: 'request-1',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.125 },
      cost: 0.125,
      ...overrides.response,
    },
    artifact: { reliability: { passed: true }, ...overrides.artifact },
  }, dependencies);
}

function bridgeContext(label, options = {}) {
  let time = options.start ?? 2000;
  const context = beginTraceCapture({
    traceId: `trace-${label}`,
    attemptId: `attempt-${label}`,
    displayName: `Display ${label}`,
    correlationId: options.correlationId,
    modelId: MODEL.id,
  }, {
    idFactory: () => `correlation-${label}`,
    clock: () => ++time,
  });
  return context;
}

function finalBridgeRequest(context, { model = MODEL.id, maxTokens = 2500, marker = '' } = {}) {
  const body = {
    model,
    messages: buildGenerationMessages(),
    temperature: 1,
    max_tokens: maxTokens,
    stream: false,
    usage: { include: true },
  };
  if (marker) body.note = marker;
  assert.equal(captureFinalRequest(context, {
    method: 'POST',
    endpoint: 'openrouter.chat.completions',
    url: 'https://openrouter.ai/api/v1/chat/completions?ignored=secret',
    headers: { Authorization: 'Bearer bridge-secret', 'Content-Type': 'application/json' },
    body,
    serializedBody: JSON.stringify(body),
  }), true);
  return body;
}

test('identity schema and built-in constants are versioned', () => {
  assert.equal(LIVE_IDENTITY_SCHEMA, 'live-identity-v1');
  assert.equal(BUILT_IN_LIVE_IDENTITY.modelName, 'Calibration Bloom');
  assert.equal(EMPTY_NEXT_IDENTITY.modelName, 'Choose a model');
});

test('initial LIVE identity is Calibration Bloom', () => {
  assert.equal(identityController().snapshot().live.displayName, 'Calibration Bloom');
});

test('initial NEXT identity asks the user to choose a model', () => {
  assert.equal(identityController().snapshot().next.displayName, 'Choose a model');
});

test('selecting Kimi changes NEXT and not LIVE', () => {
  const controller = identityController();
  const before = controller.snapshot().live;
  const after = controller.setNext(MODEL);
  assert.equal(after.next.modelName, 'Kimi K3');
  assert.deepEqual(after.live, before);
});

test('selecting another NEXT model does not alter generated LIVE', () => {
  const controller = identityController();
  const token = controller.stageCandidate(GENERATED).candidate.token;
  const committed = controller.commitPromotion(token);
  const changed = controller.setNext({ id: 'google/gemini-flash', name: 'Gemini Flash' });
  assert.deepEqual(changed.live, committed.live);
  assert.equal(changed.next.modelName, 'Gemini Flash');
});

test('staging a generation candidate leaves LIVE unchanged', () => {
  const controller = identityController();
  const staged = controller.stageCandidate(GENERATED);
  assert.equal(staged.live.modelName, 'Calibration Bloom');
  assert.equal(staged.candidate.modelName, 'Kimi K3');
});

test('discarding a failed generation leaves LIVE unchanged', () => {
  const controller = identityController();
  const staged = controller.stageCandidate(GENERATED);
  const discarded = controller.discardCandidate(staged.candidate.token);
  assert.equal(discarded.live.modelName, 'Calibration Bloom');
  assert.equal(discarded.candidate, null);
});

test('staging a repair candidate does not announce it as LIVE', () => {
  const controller = identityController();
  controller.setNext(MODEL);
  const staged = controller.stageCandidate({ ...GENERATED, generationId: 'repair0001-result' });
  assert.equal(staged.live.modelName, 'Calibration Bloom');
  assert.match(staged.candidate.displayName, /^Kimi K3 · #/);
});

test('promotion rejects a missing or stale candidate token', () => {
  const controller = identityController();
  controller.stageCandidate(GENERATED);
  assert.throws(() => controller.commitPromotion('candidate:wrong:1'), /token/i);
  assert.equal(controller.snapshot().live.modelName, 'Calibration Bloom');
});

test('LIVE updates only on explicit promotion commit', () => {
  const controller = identityController();
  const staged = controller.stageCandidate(GENERATED);
  assert.equal(controller.snapshot().live.modelName, 'Calibration Bloom');
  const committed = controller.commitPromotion(staged.candidate.token);
  assert.equal(committed.live.modelName, 'Kimi K3');
  assert.equal(committed.candidate, null);
});

test('generated LIVE display contains an eight-character generation marker', () => {
  const controller = identityController();
  const staged = controller.stageCandidate(GENERATED);
  const committed = controller.commitPromotion(staged.candidate.token);
  assert.equal(identityMarker(GENERATED.generationId), 'a41c20d7');
  assert.equal(committed.live.marker.length, 8);
  assert.equal(committed.live.displayName, 'Kimi K3 · #a41c20d7');
});

test('rollback restores the prior LIVE identity', () => {
  const controller = identityController();
  const token = controller.stageCandidate(GENERATED).candidate.token;
  controller.commitPromotion(token);
  const rolledBack = controller.rollback(GENERATED.generationId);
  assert.equal(rolledBack.live.modelName, 'Calibration Bloom');
});

test('failed saved-Dream staging leaves current LIVE unchanged', () => {
  const controller = identityController();
  const liveToken = controller.stageCandidate(GENERATED).candidate.token;
  controller.commitPromotion(liveToken);
  const before = controller.snapshot().live;
  const saved = controller.stageCandidate({ ...GENERATED, kind: 'saved', generationId: 'saved0002-id' });
  controller.discardCandidate(saved.candidate.token);
  assert.deepEqual(controller.snapshot().live, before);
});

test('saved Dream changes LIVE only after its explicit commit', () => {
  const controller = identityController();
  const saved = controller.stageCandidate({ ...GENERATED, kind: 'saved', generationId: 'saved0002-id' });
  assert.equal(saved.live.modelName, 'Calibration Bloom');
  const opened = controller.commitPromotion(saved.candidate.token);
  assert.equal(opened.live.kind, 'saved');
  assert.equal(opened.live.marker, 'saved000');
});

test('identity snapshots are structured clones', () => {
  const controller = identityController();
  const snapshot = controller.setNext(MODEL);
  snapshot.live.modelName = 'Tampered';
  snapshot.next.modelName = 'Tampered';
  const fresh = controller.snapshot();
  assert.equal(fresh.live.modelName, 'Calibration Bloom');
  assert.equal(fresh.next.modelName, 'Kimi K3');
});

test('identity API and snapshots contain no audio state path', () => {
  const controller = identityController();
  assert.equal(Object.keys(controller).some(key => /audio/i.test(key)), false);
  assert.equal(/audio/i.test(JSON.stringify(controller.snapshot())), false);
});

test('restoring built-in after live deletion preserves NEXT selection', () => {
  const controller = identityController();
  controller.setNext(MODEL);
  const token = controller.stageCandidate(GENERATED).candidate.token;
  controller.commitPromotion(token);
  const restored = controller.restoreBuiltIn();
  assert.equal(restored.live.modelName, 'Calibration Bloom');
  assert.equal(restored.next.modelName, 'Kimi K3');
});

test('identity reset returns initial values and advances revision', () => {
  const controller = identityController();
  controller.setNext(MODEL);
  const beforeRevision = controller.snapshot().revision;
  const reset = controller.reset();
  assert.equal(reset.live.modelName, 'Calibration Bloom');
  assert.equal(reset.next.modelName, 'Choose a model');
  assert.equal(reset.revision, beforeRevision + 1);
});

test('candidate tokens stay unique when the injected factory repeats', () => {
  const controller = identityController();
  const first = controller.stageCandidate(GENERATED).candidate.token;
  const second = controller.stageCandidate({ ...GENERATED, generationId: 'bbbbbbbb-second' }).candidate.token;
  assert.notEqual(first, second);
});

test('new trace has the required version and rich empty summary', () => {
  const trace = createDreamTrace({ id: 'trace-schema', selectedModel: MODEL, startedAt: 1 });
  assert.equal(trace.schema, DREAM_TRACE_SCHEMA);
  assert.equal(trace.providerRequestCount, 0);
  assert.equal(trace.repairUsed, false);
  assert.deepEqual(trace.attempts, []);
});

test('generation request retains exact ordered system and user messages', () => {
  const { trace, dependencies } = generationTrace();
  const patched = capturedGeneration(trace, dependencies);
  assert.deepEqual(patched.attempts[0].request.messages, buildGenerationMessages());
  assert.deepEqual(patched.attempts[0].request.messages.map(message => message.role), ['system', 'user']);
});

test('captured request retains spend-guard final max_tokens', () => {
  const { trace, dependencies } = generationTrace();
  const patched = capturedGeneration(trace, dependencies);
  assert.equal(patched.attempts[0].request.parameters.max_tokens, 3210);
});

test('attempt request sanitizes Authorization without its value', () => {
  const { trace, dependencies } = generationTrace();
  const patched = capturedGeneration(trace, dependencies);
  assert.equal(patched.attempts[0].request.headers.authorization, REDACTED);
  assert.doesNotMatch(JSON.stringify(patched), /contract-secret/);
});

test('trace transforms leave prior attempts and inputs immutable', () => {
  const { trace, dependencies } = generationTrace();
  const before = structuredClone(trace);
  const patched = capturedGeneration(trace, dependencies);
  assert.deepEqual(trace, before);
  assert.notStrictEqual(patched, trace);
  assert.equal(Object.isFrozen(patched.attempts[0]), true);
});

test('closed attempts cannot be patched', () => {
  const { trace, dependencies } = generationTrace();
  const captured = capturedGeneration(trace, dependencies);
  const closed = closeDreamAttempt(captured, 'attempt-generation', { outcome: 'succeeded', closedAt: 60 }, dependencies);
  assert.throws(() => patchDreamAttempt(closed, 'attempt-generation', { artifact: { visibleOutput: false } }), /closed/i);
});

test('repair must use the same requested model', () => {
  const { trace, dependencies } = generationTrace();
  const closed = closeDreamAttempt(trace, 'attempt-generation', { outcome: 'failed', closedAt: 30 }, dependencies);
  assert.throws(() => appendDreamAttempt(closed, { kind: 'repair', modelId: 'other/model' }, dependencies), /selected model/i);
});

test('repair preserves exact system/user messages and concrete problem', () => {
  const fixture = DREAM_TRACE_FIXTURES.repaired;
  const expected = buildRepairMessages(
    '<!doctype html><html><body><canvas></canvas></body></html>',
    'VIZ_NOT_CONSUMED\nThe candidate rendered but did not consume window.VIZ frames.',
  );
  assert.deepEqual(fixture.attempts[1].request.messages, expected);
  assert.match(fixture.attempts[1].request.messages[1].content, /VIZ_NOT_CONSUMED/);
});

test('repair append does not mutate attempt one', () => {
  const { trace, dependencies } = generationTrace();
  const firstClosed = closeDreamAttempt(capturedGeneration(trace, dependencies), 'attempt-generation', { outcome: 'repair-required', closedAt: 60 }, dependencies);
  const attemptOne = structuredClone(firstClosed.attempts[0]);
  const withRepair = appendDreamAttempt(firstClosed, { id: 'attempt-repair', kind: 'repair', createdAt: 70 }, dependencies);
  assert.deepEqual(withRepair.attempts[0], attemptOne);
});

test('trace rejects a third attempt', () => {
  const { trace, dependencies } = generationTrace();
  let next = closeDreamAttempt(trace, 'attempt-generation', { outcome: 'repair-required', closedAt: 30 }, dependencies);
  next = appendDreamAttempt(next, { id: 'attempt-repair', kind: 'repair', createdAt: 40 }, dependencies);
  next = closeDreamAttempt(next, 'attempt-repair', { outcome: 'failed', closedAt: 50 }, dependencies);
  assert.throws(() => appendDreamAttempt(next, { kind: 'repair' }, dependencies), /at most two/i);
});

test('raw provider response, assistant output, and extracted HTML stay distinct', () => {
  const { trace, dependencies } = generationTrace();
  const response = capturedGeneration(trace, dependencies).attempts[0].response;
  assert.equal(response.rawBody, '{"provider":"raw response body"}');
  assert.equal(response.assistantText, 'assistant output');
  assert.equal(response.extractedHtml, '<!doctype html><html><body>one</body></html>');
  assert.notEqual(response.rawBody, response.extractedHtml);
});

test('finish reason, resolved model, and request ID are retained', () => {
  const { trace, dependencies } = generationTrace();
  const patched = capturedGeneration(trace, dependencies);
  const response = patched.attempts[0].response;
  assert.equal(response.finishReason, 'stop');
  assert.equal(response.resolvedModel, `${MODEL.id}:resolved`);
  assert.equal(response.requestId, 'request-1');
  assert.equal(patched.finalResolvedModel, `${MODEL.id}:resolved`);
});

test('usage and exact provider-reported cost are recomputed', () => {
  const { trace, dependencies } = generationTrace();
  const patched = capturedGeneration(trace, dependencies);
  assert.deepEqual(patched.totalUsage, { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
  assert.equal(patched.totalReportedCost, 0.125);
  assert.equal(patched.reportedCostComplete, true);
});

test('provider errors close the matching attempt safely', () => {
  const { trace, dependencies } = generationTrace();
  const closed = closeDreamAttempt(trace, 'attempt-generation', {
    outcome: 'failed',
    closedAt: 40,
    error: new Error('Provider refused SENTINEL_SECRET_PROVIDER'),
  }, dependencies);
  assert.equal(closed.attempts[0].state, 'closed');
  assert.equal(closed.attempts[0].response.error.name, 'Error');
  assert.doesNotMatch(closed.attempts[0].response.error.message, /SENTINEL_SECRET_PROVIDER/);
});

test('repair summary uses final resolved model and sets repairUsed', () => {
  const fixture = DREAM_TRACE_FIXTURES.repaired;
  assert.equal(fixture.repairUsed, true);
  assert.equal(fixture.providerRequestCount, 2);
  assert.equal(fixture.finalResolvedModel, 'moonshotai/kimi-k3:exact');
});

test('trace cannot finalize while an attempt remains open', () => {
  const { trace, dependencies } = generationTrace();
  assert.throws(() => finalizeDreamTrace(trace, { outcome: 'failed' }, dependencies), /must be closed/i);
});

test('later runtime rollback appends aftercare without mutating attempts', () => {
  const { trace, dependencies } = generationTrace();
  const captured = capturedGeneration(trace, dependencies);
  const closed = closeDreamAttempt(captured, 'attempt-generation', { outcome: 'succeeded', closedAt: 60 }, dependencies);
  const finalized = finalizeDreamTrace(closed, { outcome: 'succeeded', finishedAt: 70, generationId: 'live-generation' }, dependencies);
  const attempts = structuredClone(finalized.attempts);
  const rolledBack = recordDreamTraceRollback(finalized, {
    rolledBackAt: 90,
    failure: { code: 'RUNTIME_STALLED', message: 'Heartbeat stopped.' },
    finalLiveIdentity: { live: { displayName: 'Calibration Bloom' } },
  }, dependencies);
  assert.equal(rolledBack.status, 'rolled-back');
  assert.equal(rolledBack.originalOutcome, 'succeeded');
  assert.equal(rolledBack.failureCode, 'RUNTIME_STALLED');
  assert.equal(rolledBack.aftercare.at(-1).stage, 'runtime:rolled-back');
  assert.deepEqual(rolledBack.attempts, attempts);
});

test('message.reasoning is preserved as provider-exposed reasoning', () => {
  const reasoning = extractProviderReasoning({ choices: [{ message: { content: 'ordinary answer', reasoning: 'exact visible thought' } }] });
  assert.equal(reasoning.status, 'exposed');
  assert.equal(reasoning.text, 'exact visible thought');
});

test('message.reasoning_details is preserved exactly', () => {
  const details = [{ type: 'summary', text: 'visible summary' }];
  const reasoning = extractProviderReasoning({ choices: [{ message: { reasoning_details: details } }] });
  assert.deepEqual(reasoning.details[0].value, details);
});

test('choice and payload reasoning_details are supported', () => {
  const reasoning = extractProviderReasoning({
    reasoning_details: { text: 'payload detail' },
    choices: [{ reasoning_details: { text: 'choice detail' }, message: { content: 'answer' } }],
  });
  assert.equal(reasoning.status, 'exposed');
  assert.equal(reasoning.details.length, 2);
});

test('reasoning and thinking content parts are exposed but text parts are not', () => {
  const reasoning = extractProviderReasoning({
    choices: [{ message: { content: [
      { type: 'text', text: 'ordinary assistant output' },
      { type: 'reasoning', text: 'reasoning part' },
      { type: 'thinking', thinking: 'thinking part' },
    ] } }],
  });
  assert.match(reasoning.text, /reasoning part/);
  assert.match(reasoning.text, /thinking part/);
  assert.doesNotMatch(reasoning.text, /ordinary assistant output/);
});

test('ordinary assistant content is never mislabeled as reasoning', () => {
  const reasoning = extractProviderReasoning({ choices: [{ message: { content: 'ordinary assistant output' } }] });
  assert.equal(reasoning.status, 'not-exposed');
  assert.equal(reasoning.text, '');
  assert.equal(reasoning.label, REASONING_NOT_EXPOSED);
});

test('reasoning-token accounting without text is labeled token-only', () => {
  const reasoning = extractProviderReasoning({ choices: [{ message: { content: 'answer' } }] }, {
    completion_tokens_details: { reasoning_tokens: 17 },
  });
  assert.equal(reasoning.status, 'token-only');
  assert.equal(reasoning.tokenCount, 17);
  assert.match(reasoning.label, /Reasoning text not exposed/);
});

test('absent reasoning uses the required truthful label', () => {
  assert.equal(extractProviderReasoning({}, {}).label, 'Reasoning not exposed by provider.');
});

test('recursive sanitizer removes credential and local-media fields but preserves token accounting', () => {
  const hostile = {
    authorization: 'Bearer secret-auth',
    apiKey: 'plain-key-value',
    credential: 'plain-credential',
    pkceVerifier: 'plain-verifier',
    access_token: 'plain-access',
    refreshToken: 'plain-refresh',
    cookie: 'session=secret',
    audio: { volume: 1 },
    waveform: [0.1, 0.2],
    spectrum: [1, 2],
    songName: 'Private song',
    mic: true,
    camera: true,
    usage: { prompt_tokens: 5, completion_tokens: 7, reasoning_tokens: 3 },
  };
  const safe = sanitizeTraceValue(hostile);
  assert.deepEqual(safe.usage, { prompt_tokens: 5, completion_tokens: 7, reasoning_tokens: 3 });
  for (const key of ['authorization', 'apiKey', 'credential', 'pkceVerifier', 'access_token', 'refreshToken', 'cookie', 'audio', 'waveform', 'spectrum', 'songName', 'mic', 'camera']) {
    assert.equal(Object.hasOwn(safe, key), false, key);
  }
});

test('recursive sanitizer preserves harmless audio API version metadata', () => {
  const safe = sanitizeTraceValue({ audioApiVersion: 'visualizer-audio-v1', audio: { waveform: [1, 2] } });
  assert.equal(safe.audioApiVersion, 'visualizer-audio-v1');
  assert.equal(Object.hasOwn(safe, 'audio'), false);
});

test('recursive sanitizer redacts Bearer, OpenRouter, and sentinel secrets in strings', () => {
  const safe = sanitizeTraceValue({
    value: 'Bearer abcdefgh sk-or-v1-abcdefghijklmnopqrstuvwxyz SENTINEL_SECRET_DO_NOT_LEAK',
  });
  assert.doesNotMatch(safe.value, /abcdefgh|sk-or-v1|SENTINEL_SECRET_DO_NOT_LEAK/);
  assert.match(safe.value, /\[redacted\]/);
});

test('recursive sanitizer is cycle, depth, and node safe', () => {
  const cycle = { name: 'root' };
  cycle.self = cycle;
  assert.equal(sanitizeTraceValue(cycle).self, '[circular]');
  assert.match(JSON.stringify(sanitizeTraceValue({ a: { b: { c: 1 } } }, { maxDepth: 2 })), /depth limit/);
  assert.match(JSON.stringify(sanitizeTraceValue([1, 2, 3, 4], { maxNodes: 2 })), /node limit/);
});

test('recursive sanitizer is prototype-safe and nonmutating', () => {
  const hostile = JSON.parse('{"__proto__":{"polluted":true},"apiKey":"still-on-source","safe":1}');
  const safe = sanitizeTraceValue(hostile);
  assert.equal(Object.hasOwn(safe, '__proto__'), false);
  assert.equal({}.polluted, undefined);
  assert.equal(hostile.apiKey, 'still-on-source');
  assert.equal(safe.safe, 1);
});

test('safe-header sanitizer keeps an Authorization marker only', () => {
  const safe = sanitizeSafeHeaders({
    Authorization: 'Bearer SENTINEL_SECRET_HEADER',
    'Content-Type': 'application/json',
    'X-Request-Id': 'request-safe',
    Cookie: 'session=secret',
    'X-Api-Key': 'plain-secret',
  });
  assert.deepEqual(safe, {
    authorization: REDACTED,
    'content-type': 'application/json',
    'x-request-id': 'request-safe',
  });
});

test('recursive persistence sanitizer preserves only the redacted Authorization marker', () => {
  const safe = sanitizeTraceValue({ headers: { authorization: REDACTED }, unsafe: { authorization: 'Bearer actual-secret' } });
  assert.deepEqual(safe.headers, { authorization: REDACTED });
  assert.deepEqual(safe.unsafe, {});
});

test('trace export applies defensive redaction recursively', () => {
  const exported = dreamTraceForExport({
    schema: DREAM_TRACE_SCHEMA,
    nested: { harmless: 'SENTINEL_SECRET_EXPORT', authorization: 'Bearer export-secret' },
    usage: { prompt_tokens: 9, completion_tokens: 4 },
  });
  const serialized = JSON.stringify(exported);
  assert.doesNotMatch(serialized, /SENTINEL_SECRET_EXPORT|export-secret/);
  assert.deepEqual(exported.usage, { prompt_tokens: 9, completion_tokens: 4 });
});

test('legacy diagnostic view labels uncaptured request and reasoning data', () => {
  const legacy = legacyDiagnosticToTrace({
    schema: 'dream-diagnostic-v1',
    id: 'legacy-diagnostic',
    createdAt: 50,
    status: 'succeeded',
    modelId: MODEL.id,
    modelName: MODEL.name,
    rawOutput: 'legacy assistant',
    html: '<!doctype html><html></html>',
  });
  assert.equal(legacy.legacyNotice, LEGACY_NOT_CAPTURED);
  assert.equal(legacy.attempts[0].request.messagesNotice, LEGACY_NOT_CAPTURED);
  assert.equal(legacy.attempts[0].response.reasoning.label, LEGACY_NOT_CAPTURED);
  assert.equal(legacy.attempts[0].request.dispatched, null);
  assert.equal(legacy.providerRequestCount, null);
});

test('legacy trace retains Library-compatible fields without inventing prompts', () => {
  const legacy = legacyDiagnosticToTrace({
    id: 'legacy-library',
    createdAt: 60,
    status: 'succeeded',
    modelId: MODEL.id,
    modelName: MODEL.name,
    generationId: 'legacy-generation',
    favorite: true,
    battleWins: 2,
    battleLosses: 1,
    rawOutput: 'legacy output',
    html: '<!doctype html><html><body>legacy</body></html>',
  });
  assert.equal(legacy.modelId, MODEL.id);
  assert.equal(legacy.generationId, 'legacy-generation');
  assert.equal(legacy.favorite, true);
  assert.equal(legacy.battleWins, 2);
  assert.deepEqual(legacy.attempts[0].request.messages, []);
});

test('no-cost repaired fixture is deterministic and complete', () => {
  const first = createDreamTraceFixtures();
  const second = createDreamTraceFixtures();
  assert.deepEqual(first, second);
  assert.equal(first.repaired.attempts.length, 2);
  assert.equal(first.repaired.status, 'succeeded');
  assert.equal(first.repaired.totalReportedCost, 0.021);
  assert.equal(first.repaired.attempts[1].artifact.reliability.passed, true);
});

test('no-cost repaired fixture exposes reasoning and inert extracted HTML', () => {
  const fixture = DREAM_TRACE_FIXTURES.repaired;
  assert.equal(fixture.attempts[1].response.reasoning.status, 'exposed');
  assert.match(fixture.attempts[1].response.extractedHtml, /<script>/);
  assert.equal(globalThis.__dreamTraceFixtureOnly, undefined);
});

test('no-cost rollback fixture has token-only reasoning and distinct LIVE/NEXT snapshots', () => {
  const fixture = DREAM_TRACE_FIXTURES.rolledBack;
  assert.equal(fixture.status, 'rolled-back');
  assert.equal(fixture.attempts[0].response.reasoning.status, 'token-only');
  assert.equal(fixture.attempts[0].response.reasoning.tokenCount, 11);
  assert.notEqual(fixture.liveAtStart.live.modelId, fixture.liveAtStart.next.modelId);
});

test('bridge attaches correlation with a private Symbol and strips it before fetch', () => {
  const context = bridgeContext('symbol');
  const attached = attachTraceContext({ method: 'POST' }, context);
  assert.equal(traceContextFromInit(attached), context);
  assert.equal(Reflect.ownKeys(attached).filter(key => typeof key === 'symbol').length, 1);
  const spread = { ...attached };
  assert.equal(traceContextFromInit(spread), context);
  const stripped = stripTraceContext(spread);
  assert.equal(traceContextFromInit(stripped), null);
  assert.equal(Reflect.ownKeys(stripped).filter(key => typeof key === 'symbol').length, 0);
  assert.equal(discardTraceCapture(context), true);
});

test('bridge exposes display name only while a correlation is active', () => {
  const context = bridgeContext('display');
  assert.equal(traceDisplayName(context), 'Display display');
  assert.equal(discardTraceCapture(context), true);
  assert.equal(traceDisplayName(context), '');
});

test('bridge captures exact final request after spend mutation', () => {
  const context = bridgeContext('final-request');
  const body = finalBridgeRequest(context, { maxTokens: 2345 });
  const capture = consumeTraceCapture(context);
  assert.equal(capture.schema, TRACE_BRIDGE_SCHEMA);
  assert.equal(capture.request.parameters.max_tokens, 2345);
  assert.deepEqual(capture.request.messages, buildGenerationMessages());
  assert.equal(capture.request.serializedBody, JSON.stringify(body));
  assert.equal(capture.request.headers.authorization, REDACTED);
  assert.doesNotMatch(JSON.stringify(capture), /bridge-secret/);
});

test('bridge marks dispatch separately from request preparation', () => {
  const context = bridgeContext('dispatch');
  finalBridgeRequest(context);
  let capture = consumeTraceCapture(context);
  assert.equal(capture.request.dispatched, false);

  const second = bridgeContext('dispatch-two');
  finalBridgeRequest(second);
  assert.equal(captureRequestDispatched(second), true);
  capture = consumeTraceCapture(second);
  assert.equal(capture.request.dispatched, true);
  assert.notEqual(capture.timing.requestDispatchedAt, null);
});

test('bridge captures headers, body completion, provider identity, usage, and exact cost', () => {
  const context = bridgeContext('provider');
  finalBridgeRequest(context);
  captureRequestDispatched(context);
  captureResponseHeaders(context, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'provider-request' },
  });
  captureResponseBodyComplete(context);
  const payload = {
    id: 'provider-request',
    model: `${MODEL.id}:resolved`,
    choices: [{ finish_reason: 'stop', message: { content: 'assistant exact', reasoning: 'provider-visible' } }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20, cost: 0.02 },
  };
  const raw = `  ${JSON.stringify(payload)}\n`;
  assert.equal(captureProviderResponse(context, {
    response: { status: 200, headers: { 'X-Request-Id': 'provider-request' } },
    rawBodyText: raw,
    parsedPayload: payload,
    assistantText: 'assistant exact',
    finishReason: 'stop',
    resolvedModel: payload.model,
    requestId: payload.id,
    usage: payload.usage,
  }), true);
  const capture = consumeTraceCapture(context);
  assert.equal(capture.response.rawBody, raw);
  assert.equal(capture.response.assistantText, 'assistant exact');
  assert.equal(capture.response.finishReason, 'stop');
  assert.equal(capture.response.resolvedModel, payload.model);
  assert.equal(capture.response.requestId, payload.id);
  assert.deepEqual(capture.response.usage, payload.usage);
  assert.equal(capture.response.cost, 0.02);
  assert.equal(capture.response.reasoning.text, 'provider-visible');
  assert.equal(typeof capture.timing.providerDurationMs, 'number');
});

test('bridge keeps raw response, assistant output, and extracted HTML separate', () => {
  const context = bridgeContext('separation');
  finalBridgeRequest(context);
  captureRequestDispatched(context);
  const payload = { choices: [{ message: { content: 'assistant with wrapper' } }] };
  captureProviderResponse(context, {
    response: { status: 200, headers: {} },
    rawBodyText: JSON.stringify(payload),
    parsedPayload: payload,
    assistantText: 'assistant with wrapper',
    extractedHtml: '<!doctype html><html></html>',
  });
  const response = consumeTraceCapture(context).response;
  assert.notEqual(response.rawBody, response.assistantText);
  assert.notEqual(response.assistantText, response.extractedHtml);
});

test('concurrent bridge captures cannot cross', () => {
  const first = bridgeContext('concurrent-a');
  const second = bridgeContext('concurrent-b');
  const firstInit = attachTraceContext({}, first);
  const secondInit = attachTraceContext({}, second);
  assert.equal(traceContextFromInit(firstInit), first);
  assert.equal(traceContextFromInit(secondInit), second);
  finalBridgeRequest(first, { marker: 'request-A' });
  finalBridgeRequest(second, { marker: 'request-B' });
  const firstCapture = consumeTraceCapture(first);
  const secondCapture = consumeTraceCapture(second);
  assert.equal(firstCapture.request.parameters.note, 'request-A');
  assert.equal(secondCapture.request.parameters.note, 'request-B');
  assert.doesNotMatch(firstCapture.request.serializedBody, /request-B/);
  assert.doesNotMatch(secondCapture.request.serializedBody, /request-A/);
});

test('missing and duplicate bridge claims fail safely', () => {
  assert.equal(beginTraceCapture({ traceId: 'missing', attemptId: 'missing' }), null);
  const first = bridgeContext('duplicate', { correlationId: 'duplicate-correlation' });
  assert.notEqual(first, null);
  const duplicate = beginTraceCapture({
    traceId: 'trace-other',
    attemptId: 'attempt-other',
    displayName: 'Other',
    correlationId: 'duplicate-correlation',
  });
  assert.equal(duplicate, null);
  finalBridgeRequest(first);
  assert.equal(captureFinalRequest(first, { body: {} }), false);
  assert.notEqual(consumeTraceCapture(first), null);
  assert.equal(consumeTraceCapture(first), null);
  assert.equal(captureRequestDispatched(first), false);
});

test('availability failure records no fake completion dispatch', () => {
  const context = bridgeContext('availability');
  assert.equal(captureAvailabilityStart(context, { modelId: MODEL.id, endpoint: 'openrouter.models' }), true);
  assert.equal(captureAvailabilityEnd(context, { modelId: MODEL.id, status: 'failed', code: 'NOT_IN_CURRENT_CATALOG' }), true);
  const capture = consumeTraceCapture(context);
  assert.equal(capture.availability.status, 'failed');
  assert.equal(capture.availability.code, 'NOT_IN_CURRENT_CATALOG');
  assert.equal(capture.request, null);
  assert.equal(capture.timing.requestDispatchedAt, null);
});

test('bridge captures provider errors without credential values', () => {
  const context = bridgeContext('error');
  captureTraceError(context, new Error('Rejected Bearer top-secret SENTINEL_SECRET_ERROR'), {
    stage: 'provider-fetch',
    status: 503,
    payload: { authorization: 'Bearer nested-secret', message: 'safe provider detail' },
  });
  const capture = consumeTraceCapture(context);
  const serialized = JSON.stringify(capture);
  assert.equal(capture.errors.length, 1);
  assert.equal(capture.errors[0].stage, 'provider-fetch');
  assert.doesNotMatch(serialized, /top-secret|SENTINEL_SECRET_ERROR|nested-secret/);
  assert.match(serialized, /safe provider detail/);
});

test('bridge redacts sentinel and media fields in final serialized body', () => {
  const context = bridgeContext('request-redaction');
  const body = {
    model: MODEL.id,
    messages: buildGenerationMessages(),
    max_tokens: 2200,
    apiKey: 'plain-unpatterned-secret',
    audio: { waveform: [1, 2, 3] },
    note: 'SENTINEL_SECRET_BODY',
  };
  captureFinalRequest(context, { body, serializedBody: JSON.stringify(body), headers: {} });
  const capture = consumeTraceCapture(context);
  const serialized = JSON.stringify(capture);
  assert.doesNotMatch(serialized, /plain-unpatterned-secret|SENTINEL_SECRET_BODY/);
  assert.equal(Object.hasOwn(capture.request.body, 'audio'), false);
  assert.equal(Object.hasOwn(JSON.parse(capture.request.serializedBody), 'audio'), false);
  assert.equal(capture.request.parameters.max_tokens, 2200);
});
