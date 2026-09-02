import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPENROUTER_MODEL_NORMALIZATION_VERSION,
  buildOpenRouterCompletionRequest,
  categorizedTransportError,
  normalizeOpenRouterModel,
  shouldBlockStaleReasoningRepair,
} from '../public/visualizer/provider-runtime.js';
import {
  calculateCostGuardEnvelope,
  calculateFallbackUsageCost,
  maximumDreamCostCeiling,
  maximumMoney,
  normalizeCostGuardModel,
} from '../public/visualizer/cost-guard.js';
import {
  beginTraceCapture,
  captureFinalRequest,
  captureProviderResponse,
  captureRequestDispatched,
  captureRequestPolicy,
  consumeTraceCapture,
} from '../public/visualizer/trace-bridge.js';

const RAW_MODEL = Object.freeze({
  id: 'quality/exact-reasoner',
  name: 'Exact Reasoner',
  context_length: 64000,
  top_provider: Object.freeze({
    max_completion_tokens: 32000,
    context_length: 60000,
    is_moderated: false,
  }),
  pricing: Object.freeze({
    prompt: '0.000001',
    completion: '0.00001',
    request: '0',
    internal_reasoning: '0.000002',
  }),
  reasoning: Object.freeze({
    mandatory: false,
    default_enabled: true,
    supported_efforts: Object.freeze(['high', 'max']),
    default_effort: 'high',
    supports_max_tokens: true,
  }),
  architecture: Object.freeze({ output_modalities: Object.freeze(['text']) }),
  supported_parameters: Object.freeze(['reasoning', 'response_format', 'temperature', 'max_tokens']),
});

const MESSAGES = Object.freeze([
  Object.freeze({ role: 'system', content: 'Return complete HTML.' }),
  Object.freeze({ role: 'user', content: 'Draw sound.' }),
]);

test('catalog normalization preserves exact reasoning, provider limits, pricing, and source facts', () => {
  const model = normalizeOpenRouterModel(RAW_MODEL);
  assert.equal(OPENROUTER_MODEL_NORMALIZATION_VERSION, 'openrouter-model-normalization-v3');
  assert.deepEqual(model.reasoning, RAW_MODEL.reasoning);
  assert.deepEqual(model.pricing, RAW_MODEL.pricing);
  assert.deepEqual(model.top_provider, RAW_MODEL.top_provider);
  assert.equal(model.maxCompletionTokens, 32000);
  assert.equal(model.rootContextLength, 64000);
  assert.equal(model.topProviderContextLength, 60000);
  assert.equal(model.metadataSource.reasoning, 'model.reasoning');
  assert.deepEqual(model.reasoningMetadata.supportedEfforts, ['high', 'max']);
  assert.equal(model.reasoningMetadata.source.supportedEfforts, 'model.reasoning.supported_efforts');
});

test('an established local timeout outranks a later user abort while ordinary abort remains cancellation', () => {
  const controller = new AbortController();
  controller.abort();
  const timeout = Object.assign(new Error('idle first'), {
    name: 'DreamTimeoutError',
    code: 'DREAM_IDLE_TIMEOUT',
    timeoutKind: 'idle',
  });
  const classifiedTimeout = categorizedTransportError(timeout, { signal: controller.signal });
  assert.equal(classifiedTimeout.code, 'PROVIDER_TIMEOUT');
  assert.equal(classifiedTimeout.timeoutKind, 'idle');

  const classifiedCancel = categorizedTransportError(new TypeError('body stream aborted'), { signal: controller.signal });
  assert.equal(classifiedCancel.name, 'AbortError');
});

test('Default omits reasoning while explicit effort uses the exact enforceable OpenRouter shape', () => {
  const model = normalizeOpenRouterModel(RAW_MODEL);
  const nativeDefault = buildOpenRouterCompletionRequest({ model, messages: MESSAGES });
  assert.equal(nativeDefault.body.max_tokens, 32000);
  assert.equal(Object.hasOwn(nativeDefault.body, 'reasoning'), false);
  assert.deepEqual(nativeDefault.body.provider, { require_parameters: true });
  assert.equal(nativeDefault.policy.nativeDefaultUsed, true);
  assert.equal(nativeDefault.policy.dispatchedReasoning, null);

  const explicit = buildOpenRouterCompletionRequest({
    model,
    messages: MESSAGES,
    reasoningSelection: { modelId: model.id, mode: 'explicit', effort: 'max', selectedAt: 10 },
  });
  assert.deepEqual(explicit.body.reasoning, { effort: 'max' });
  assert.deepEqual(explicit.body.provider, { require_parameters: true });
  assert.equal(explicit.body.stream, true);
  assert.equal(explicit.policy.nativeDefaultUsed, false);
  assert.deepEqual(explicit.policy.dispatchedReasoning, { effort: 'max' });

  const stale = buildOpenRouterCompletionRequest({
    model,
    messages: MESSAGES,
    reasoningSelection: { modelId: model.id, mode: 'explicit', effort: 'low', selectedAt: 5 },
  });
  assert.equal(stale.reasoningSelectionStale, true);
  assert.equal(stale.reasoningSelection.mode, 'default');
  assert.equal(Object.hasOwn(stale.body, 'reasoning'), false);
  assert.deepEqual(stale.body.provider, { require_parameters: true });
  assert.equal(shouldBlockStaleReasoningRepair('generation', { mode: 'explicit' }, stale), false);
  assert.equal(shouldBlockStaleReasoningRepair('repair', { mode: 'explicit' }, stale), true);
});

test('repair preserves the immutable Dream-start reasoning selection or blocks stale effort', () => {
  const model = normalizeOpenRouterModel(RAW_MODEL);
  const dreamStart = Object.freeze({ modelId: model.id, mode: 'explicit', effort: 'high', selectedAt: 10 });
  const generation = buildOpenRouterCompletionRequest({
    model,
    messages: MESSAGES,
    reasoningSelection: dreamStart,
    attemptKind: 'generation',
  });
  const repair = buildOpenRouterCompletionRequest({
    model,
    messages: MESSAGES,
    reasoningSelection: dreamStart,
    attemptKind: 'repair',
  });
  assert.deepEqual(generation.body.reasoning, { effort: 'high' });
  assert.deepEqual(repair.body.reasoning, { effort: 'high' });
  assert.equal(repair.policy.attemptKind, 'repair');
  assert.equal(shouldBlockStaleReasoningRepair('repair', dreamStart, repair), false);

  const changedCatalog = normalizeOpenRouterModel({
    ...RAW_MODEL,
    reasoning: { ...RAW_MODEL.reasoning, supported_efforts: ['max'] },
  });
  const staleRepair = buildOpenRouterCompletionRequest({
    model: changedCatalog,
    messages: MESSAGES,
    reasoningSelection: dreamStart,
    attemptKind: 'repair',
  });
  assert.equal(staleRepair.body.reasoning, undefined);
  assert.equal(shouldBlockStaleReasoningRepair('repair', dreamStart, staleRepair), true);
});

test('request construction omits unsupported temperature and uses max_completion_tokens when advertised', () => {
  const model = normalizeOpenRouterModel({
    ...RAW_MODEL,
    supported_parameters: ['reasoning', 'max_completion_tokens'],
  });
  const prepared = buildOpenRouterCompletionRequest({ model, messages: MESSAGES });
  assert.equal(Object.hasOwn(prepared.body, 'temperature'), false);
  assert.equal(Object.hasOwn(prepared.body, 'max_tokens'), false);
  assert.equal(prepared.body.max_completion_tokens, 32000);
  assert.equal(prepared.policy.maxTokenParameter, 'max_completion_tokens');
});

test('pricing overrides use their highest prompt/completion rates and bound one possible repair', () => {
  const model = normalizeCostGuardModel({
    ...RAW_MODEL,
    pricing: {
      ...RAW_MODEL.pricing,
      overrides: [
        { min_prompt_tokens: 32000, prompt: '0.000003', completion: '0.00002' },
        { utc_start: 100, utc_end: 200, completion: '0.00004' },
      ],
    },
  });
  assert.equal(model.pricing.prompt.value, 0.000003);
  assert.equal(model.pricing.completion.value, 0.00004);
  const envelope = calculateCostGuardEnvelope({
    model,
    messages: MESSAGES,
    remainingBudgets: { perDream: 10, session: 10, daily: 10, provider: 10 },
  });
  const dreamMaximum = maximumDreamCostCeiling(envelope);
  assert.ok(dreamMaximum >= envelope.finalRequestCostCeiling);
  assert.ok(dreamMaximum <= envelope.strictRemainingBudget);
  assert.equal(maximumMoney(0.014), '$0.02');
  assert.equal(maximumMoney(0.01001), '$0.02');
});

test('cost adapter treats absent optional fees as zero but requires prompt and completion prices', () => {
  const base = {
    id: 'quality/optional-fees',
    context_length: 40000,
    top_provider: { max_completion_tokens: 30000 },
  };
  const compatible = calculateCostGuardEnvelope({
    model: { ...base, pricing: { prompt: 0, completion: 0.00001 } },
    messages: MESSAGES,
    remainingBudgets: { perDream: 1, session: 1, daily: 1, provider: 1 },
  });
  assert.equal(compatible.pricingStatus, 'known');
  assert.equal(compatible.pricing.request, 0);
  assert.equal(compatible.pricing.internalReasoning, 0);
  assert.equal(compatible.canDispatch, true);

  const missingRequired = calculateCostGuardEnvelope({
    model: { ...base, pricing: { prompt: 0 } },
    messages: MESSAGES,
    remainingBudgets: { perDream: 1, session: 1, daily: 1, provider: 1 },
  });
  assert.equal(missingRequired.pricingStatus, 'unknown');
  assert.equal(missingRequired.canDispatch, false);
});

test('fallback reconciliation bills reasoning as output and adds separately published reasoning price', () => {
  const cost = calculateFallbackUsageCost({
    id: 'quality/reasoning-cost',
    context_length: 20000,
    top_provider: { max_completion_tokens: 10000 },
    pricing: { prompt: 0.001, completion: 0.002, internal_reasoning: 0.003 },
  }, {
    prompt_tokens: 100,
    completion_tokens: 200,
    completion_tokens_details: { reasoning_tokens: 50 },
  });
  assert.equal(cost, 0.1 + 0.4 + 0.15);
});

test('final trace captures policy, exact post-envelope body, sanitization, and native finish reason', () => {
  const model = normalizeOpenRouterModel(RAW_MODEL);
  const prepared = buildOpenRouterCompletionRequest({
    model,
    messages: MESSAGES,
    reasoningSelection: { modelId: model.id, mode: 'explicit', effort: 'high' },
  });
  const envelope = calculateCostGuardEnvelope({
    model: prepared.policy.catalogModel,
    messages: MESSAGES,
    maxTokens: prepared.body.max_tokens,
    remainingBudgets: { perDream: 0.4, session: 1, daily: 1, provider: 1 },
    reasoningSelection: prepared.reasoningSelection,
  });
  assert.equal(envelope.canDispatch, true);
  assert.ok(envelope.finalMaxTokens < prepared.body.max_tokens);

  let now = 100;
  const context = beginTraceCapture({
    traceId: 'trace-quality',
    attemptId: 'attempt-quality',
    displayName: model.name,
  }, { idFactory: () => 'quality', clock: () => ++now });
  captureRequestPolicy(context, prepared.policy);
  captureRequestPolicy(context, {
    generationEnvelopeVersion: envelope.schema,
    finalMaxTokens: envelope.finalMaxTokens,
    finalRequestCostCeiling: envelope.finalRequestCostCeiling,
  });
  const body = {
    ...prepared.body,
    max_tokens: envelope.finalMaxTokens,
    usage: { include: true },
  };
  const serializedBody = JSON.stringify(body);
  captureFinalRequest(context, {
    method: 'POST',
    endpoint: 'openrouter.chat.completions',
    url: 'https://openrouter.ai/api/v1/chat/completions?secret=ignored',
    headers: { Authorization: 'Bearer contract-secret', 'Content-Type': 'application/json' },
    body,
    serializedBody,
  });
  captureRequestDispatched(context);
  const payload = {
    model: model.id,
    choices: [{
      finish_reason: 'stop',
      native_finish_reason: 'stop',
      message: { content: '<!doctype html><html></html>' },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.001 },
  };
  captureProviderResponse(context, {
    response: { status: 200, headers: { 'X-Request-Id': 'request-quality' } },
    rawBodyText: JSON.stringify(payload),
    parsedPayload: payload,
    assistantText: payload.choices[0].message.content,
    resolvedModel: model.id,
    requestId: 'request-quality',
  });

  const trace = consumeTraceCapture(context);
  assert.equal(trace.request.policy.finalMaxTokens, envelope.finalMaxTokens);
  assert.equal(trace.request.policy.finalRequestCostCeiling, envelope.finalRequestCostCeiling);
  assert.equal(trace.request.policy.nativeDefaultUsed, false);
  assert.deepEqual(trace.request.policy.dispatchedReasoning, { effort: 'high' });
  assert.equal(trace.request.parameters.max_tokens, envelope.finalMaxTokens);
  assert.equal(trace.request.serializedBody, serializedBody);
  assert.equal(trace.request.headers.authorization, '[redacted]');
  assert.equal(trace.response.nativeFinishReason, 'stop');
  assert.equal(trace.response.native_finish_reason, 'stop');
  assert.doesNotMatch(JSON.stringify(trace), /contract-secret/);
});
