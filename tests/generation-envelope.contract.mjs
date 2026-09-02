import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_GENERATION_ENVELOPE_SAFETY_FACTOR,
  GENERATION_ENVELOPE_REASONS,
  GENERATION_ENVELOPE_VERSION,
  calculateGenerationEnvelope,
  estimateConservativePromptTokens,
  minimumPracticalCompletionTokens,
  minimumPracticalTokensForReasoning,
} from '../public/visualizer/generation-envelope.js';
import {
  GENERATION_FAILURE_CATEGORIES,
  classifyGenerationFailure,
  generationFailureCopy,
} from '../public/visualizer/generation-failure.js';

const BASE_MODEL = Object.freeze({
  id: 'quality/cheap-long-context',
  context_length: 160000,
  top_provider: { max_completion_tokens: 100000 },
  pricing: {
    prompt: 0,
    completion: 0.00001,
    request: 0,
  },
});

function envelope(overrides = {}) {
  const modelOverride = overrides.model || {};
  const model = {
    ...BASE_MODEL,
    ...modelOverride,
    top_provider: {
      ...BASE_MODEL.top_provider,
      ...modelOverride.top_provider,
    },
    pricing: {
      ...BASE_MODEL.pricing,
      ...modelOverride.pricing,
    },
  };
  return calculateGenerationEnvelope({
    model,
    conservativePromptTokens: 1000,
    remainingBudgets: { perDream: 10, session: 10, daily: 10, provider: 10 },
    ...overrides,
    model,
    remainingBudgets: {
      perDream: 10,
      session: 10,
      daily: 10,
      provider: 10,
      ...overrides.remainingBudgets,
    },
  });
}

function assertAtMost(actual, ceiling, label) {
  assert.ok(actual <= ceiling, `${label}: ${actual} must not exceed ${ceiling}`);
}

test('generation envelope is versioned and uses the documented practical allowance', () => {
  const result = envelope();
  assert.equal(result.schema, GENERATION_ENVELOPE_VERSION);
  assert.equal(result.policy, 'quality-first');
  assert.equal(DEFAULT_GENERATION_ENVELOPE_SAFETY_FACTOR, 0.9);
  assert.equal(minimumPracticalCompletionTokens, 4500);
  assert.equal(result.minimumPracticalCompletionTokens, 4500);
});

test('prompt reservation uses a UTF-8 byte upper bound with chat framing headroom', () => {
  const ascii = [{ role: 'user', content: 'abcd' }];
  const unicode = [{ role: 'user', content: '音楽🎵' }];
  assert.equal(estimateConservativePromptTokens(ascii), 300);
  assert.ok(estimateConservativePromptTokens(unicode) >= 300);
  const longUnicode = [{ role: 'user', content: '音'.repeat(400) }];
  assert.ok(estimateConservativePromptTokens(longUnicode) >= 1200);
});

test('reasoning effort reserves a separate 4,500-token artifact allowance', () => {
  assert.equal(minimumPracticalTokensForReasoning({ reasoningSelection: { mode: 'explicit', effort: 'none' } }), 4500);
  assert.equal(minimumPracticalTokensForReasoning({ reasoningSelection: { mode: 'explicit', effort: 'low' } }), 5625);
  assert.equal(minimumPracticalTokensForReasoning({ reasoningSelection: { mode: 'explicit', effort: 'medium' } }), 9000);
  assert.equal(minimumPracticalTokensForReasoning({ reasoningSelection: { mode: 'explicit', effort: 'high' } }), 22500);
  assert.equal(minimumPracticalTokensForReasoning({ reasoningSelection: { mode: 'explicit', effort: 'xhigh' } }), 90000);
  assert.equal(minimumPracticalTokensForReasoning({
    reasoningSelection: { mode: 'default', effort: null },
    model: { reasoning: { default_enabled: true, default_effort: 'high' } },
  }), 22500);
  const unknownNative = calculateGenerationEnvelope({
    model: {
      context_length: 100000,
      top_provider: { max_completion_tokens: 50000 },
      pricing: { prompt: 0, completion: 0, request: 0 },
      reasoning: { mandatory: true },
    },
    conservativePromptTokens: 1000,
    remainingBudgets: { perDream: 1, session: 1, daily: 1, provider: 1 },
    reasoningSelection: { mode: 'default', effort: null },
  });
  assert.equal(unknownNative.practicalReasoningEffort, 'unknown-native');
  assert.equal(unknownNative.qualityFloorBasis, 'conservative-native-unknown');
  assert.equal(unknownNative.minimumPracticalCompletionTokensForRequest, 22500);
});

test('18-19: no universal ceiling; an affordable cheap model receives more than 14k', () => {
  const result = envelope();
  assert.equal(result.rootMaxTokensCeiling, null, 'omitting root max_tokens must not create a fallback');
  assert.ok(result.finalMaxTokens > 14000);
  assert.equal(result.finalMaxTokens, 100000);
  assert.equal(result.canDispatch, true);

  const explicitlyBounded = envelope({ max_tokens: 18000 });
  assert.equal(explicitlyBounded.finalMaxTokens, 18000, 'root max_tokens is only an explicit ceiling');
  assert.ok(explicitlyBounded.reasons.includes(GENERATION_ENVELOPE_REASONS.ROOT_MAX_TOKENS_CEILING));
});

test('20-21: live model and context-safe completion limits are never exceeded', () => {
  const modelBound = envelope({
    model: { top_provider: { max_completion_tokens: 12345 } },
  });
  assert.equal(modelBound.modelCompletionCeiling, 12345);
  assert.equal(modelBound.finalMaxTokens, 12345);

  const contextBound = envelope({
    model: { context_length: 12000, top_provider: { max_completion_tokens: 50000 } },
    conservativePromptTokens: 1250,
  });
  assert.equal(contextBound.contextCompletionCeiling, 10750);
  assert.equal(contextBound.finalMaxTokens, 10750);
  assertAtMost(contextBound.finalMaxTokens + contextBound.conservativePromptTokens, 12000, 'context capacity');
});

test('22-24, 27: affordability uses the strict minimum Dream/session/day/provider remainder', () => {
  const pricedModel = {
    pricing: { prompt: 0, completion: 0.01, request: 0 },
    context_length: 100000,
    top_provider: { max_completion_tokens: 90000 },
  };
  const cases = [
    ['perDream', { perDream: 100, session: 200, daily: 200, provider: 200 }],
    ['session', { perDream: 200, session: 80, daily: 200, provider: 200 }],
    ['daily', { perDream: 200, session: 200, daily: 70, provider: 200 }],
    ['provider', { perDream: 200, session: 200, daily: 200, provider: 60 }],
  ];

  for (const [name, remainingBudgets] of cases) {
    const result = envelope({ model: pricedModel, remainingBudgets });
    const strict = Math.min(...Object.values(remainingBudgets));
    const expectedAffordable = Math.floor(strict * 0.9 / 0.01);
    assert.equal(result.strictRemainingBudget, strict, `${name} must be the strict budget`);
    assert.deepEqual(result.limitingBudgets, [name]);
    assert.equal(result.affordableCompletionTokens, expectedAffordable);
    assert.equal(result.finalMaxTokens, expectedAffordable);
    assertAtMost(result.finalRequestCostCeiling, strict, `${name} request cost`);
  }
});

test('25-27: request, prompt, completion, and optional reasoning prices are reserved', () => {
  const result = envelope({
    model: {
      pricing: {
        prompt: 0.01,
        completion: 0.01,
        request: 10,
        internal_reasoning: 0.02,
      },
      context_length: 100000,
      top_provider: { max_completion_tokens: 90000 },
    },
    conservativePromptTokens: 1000,
    remainingBudgets: { perDream: 100, session: 100, daily: 100, provider: 100 },
  });
  assert.equal(result.requestFeeReserve, 10);
  assert.equal(result.promptCostReserve, 10);
  assert.equal(result.fixedCostReserve, 20);
  assert.equal(result.completionPriceCeiling, 0.03);
  assert.equal(result.affordableCompletionTokens, Math.floor((90 - 20) / 0.03));
  const independentlySummedCeiling = result.requestFeeReserve
    + result.promptCostReserve
    + result.completionCostReserve
    + result.internalReasoningCostReserve;
  assert.ok(Math.abs(result.finalRequestCostCeiling - independentlySummedCeiling) < 1e-12);
  assertAtMost(result.finalRequestCostCeiling, result.effectiveSpendCeiling, 'safety-adjusted spend');
});

test('required pricing must be explicit; only explicit zero required prices are free', () => {
  const free = calculateGenerationEnvelope({
    model: {
      context_length: 32000,
      top_provider: { max_completion_tokens: 16000 },
      pricing: { prompt: '0', completion: 0, request: '0.000' },
    },
    conservativePromptTokens: 500,
    remainingBudgets: { perDream: 0, session: 0, daily: 0, provider: 0 },
  });
  assert.equal(free.pricingStatus, 'known');
  assert.equal(free.free, true);
  assert.equal(free.affordableCompletionTokens, Number.POSITIVE_INFINITY);
  assert.equal(free.finalRequestCostCeiling, 0);
  assert.equal(free.canDispatch, true);

  const missingRequestPrice = calculateGenerationEnvelope({
    model: {
      context_length: 32000,
      top_provider: { max_completion_tokens: 16000 },
      pricing: { prompt: 0, completion: 0 },
    },
    conservativePromptTokens: 500,
    remainingBudgets: { perDream: 1, session: 1, daily: 1, provider: 1 },
  });
  assert.equal(missingRequestPrice.pricingStatus, 'unknown');
  assert.equal(missingRequestPrice.free, null);
  assert.deepEqual(missingRequestPrice.missingPricing, ['request']);
  assert.equal(missingRequestPrice.finalMaxTokens, null);
  assert.equal(missingRequestPrice.canDispatch, false);
  assert.ok(missingRequestPrice.reasons.includes(GENERATION_ENVELOPE_REASONS.PRICING_UNKNOWN));
});

test('28-30: low spend blocks quality instead of mutating reasoning; raising spend permits it', () => {
  const reasoningSelection = Object.freeze({ mode: 'explicit', effort: 'xhigh' });
  const model = {
    pricing: { prompt: 0, completion: 0.01, request: 0 },
    context_length: 100000,
    top_provider: { max_completion_tokens: 90000 },
  };
  const low = envelope({
    model,
    reasoningSelection,
    remainingBudgets: { perDream: 40, session: 40, daily: 40, provider: 40 },
  });
  assert.strictEqual(low.reasoningSelection, reasoningSelection);
  assert.equal(low.reasoningSelection.effort, 'xhigh');
  assert.equal(low.qualityDowngradeApplied, false);
  assert.equal(low.finalMaxTokens, 3600);
  assert.equal(low.insufficientPracticalEnvelope, true);
  assert.equal(low.practicalEnvelopeConstraint, GENERATION_ENVELOPE_REASONS.PRACTICAL_AFFORDABILITY_LIMIT);
  assert.equal(low.canDispatch, false);

  const raised = envelope({
    model,
    reasoningSelection,
    remainingBudgets: { perDream: 1100, session: 1100, daily: 1100, provider: 1100 },
  });
  assert.strictEqual(raised.reasoningSelection, reasoningSelection);
  assert.equal(raised.reasoningSelection.effort, 'xhigh');
  assert.equal(raised.qualityDowngradeApplied, false);
  assert.equal(raised.minimumPracticalCompletionTokensForRequest, 90000);
  assert.ok(raised.finalMaxTokens >= minimumPracticalCompletionTokens);
  assert.equal(raised.insufficientPracticalEnvelope, false);
  assert.equal(raised.canDispatch, true);
});

test('physical model ceiling is distinguished from an affordability shortfall', () => {
  const result = envelope({
    model: {
      pricing: { prompt: 0, completion: 0, request: 0 },
      context_length: 32000,
      top_provider: { max_completion_tokens: 12000 },
    },
    reasoningSelection: { mode: 'explicit', effort: 'high' },
  });
  assert.equal(result.canDispatch, false);
  assert.equal(result.practicalEnvelopeConstraint, GENERATION_ENVELOPE_REASONS.PRACTICAL_MODEL_LIMIT);
});

test('40-42: enforced cost is exact while theoretical catalog cost is developer-only, not expected', () => {
  const result = envelope({
    model: {
      pricing: { prompt: 0.001, completion: 0.002, request: 0.5 },
      context_length: 20000,
      top_provider: { max_completion_tokens: 50000 },
    },
    conservativePromptTokens: 1000,
    max_tokens: 6000,
    remainingBudgets: { perDream: 100, session: 100, daily: 100, provider: 100 },
  });
  assert.equal(result.finalMaxTokens, 6000);
  assert.equal(result.finalRequestCostCeiling, 0.5 + 1000 * 0.001 + 6000 * 0.002);
  assert.equal(result.theoreticalModelCeiling, 0.5 + 1000 * 0.001 + 50000 * 0.002);
  assert.deepEqual(result.theoreticalModelCeilingDetails, {
    label: 'theoreticalModelCeiling',
    audience: 'developer',
    consumerVisible: false,
    isPrediction: false,
    completionTokens: 50000,
  });
  assert.equal(Object.hasOwn(result, 'expectedCost'), false);
  assert.equal(Object.hasOwn(result, 'typicalCost'), false);
});

const DEEPSEEK_HTTP_200_EMPTY_LENGTH_FIXTURE = Object.freeze(JSON.parse(await readFile(
  new URL('./fixtures/deepseek-v4-flash-0731-length.json', import.meta.url),
  'utf8',
)));

test('44-54: exact DeepSeek HTTP-200 empty length fixture is output-budget exhaustion', () => {
  const fixture = DEEPSEEK_HTTP_200_EMPTY_LENGTH_FIXTURE;
  const choice = fixture.response.payload.choices[0];
  const usage = fixture.response.payload.usage;
  assert.equal(fixture.response.status, 200);
  assert.equal(fixture.request.temperature, 1);
  assert.equal(fixture.request.max_tokens, 14000);
  assert.equal(fixture.request.stream, false);
  assert.equal(fixture.request.model, 'deepseek/deepseek-v4-flash-0731');
  assert.equal(fixture.requestedModel, fixture.request.model);
  assert.equal(fixture.response.payload.model, fixture.request.model);
  assert.equal(fixture.response.resolvedModel, fixture.request.model);
  assert.equal(choice.finish_reason, 'length');
  assert.equal(choice.native_finish_reason, 'length');
  assert.equal(choice.message.content, null);
  assert.equal(usage.completion_tokens, 14000);
  assert.equal(usage.completion_tokens_details.reasoning_tokens, 12392);
  assert.equal(usage.prompt_tokens, 600);
  assert.equal(usage.total_tokens, 14600);
  assert.equal(fixture.response.assistantText, '');
  assert.equal(fixture.response.extractedHtml, '');
  assert.equal(usage.cost, 0.004004);
  assert.equal(fixture.providerDurationMs, 190227);
  assert.equal(fixture.liveIdentity.modelName, 'Calibration Bloom');

  const category = classifyGenerationFailure(fixture);
  assert.equal(category, GENERATION_FAILURE_CATEGORIES.OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT);
  assert.notEqual(category, GENERATION_FAILURE_CATEGORIES.PROVIDER_EXPLICIT_ERROR);
  assert.equal(generationFailureCopy(category),
    'This model ran out of generation room before it finished the visual. Your current Dream is still here.');
});

test('failure classification is evidence-based rather than model-specific', () => {
  const evidence = structuredClone(DEEPSEEK_HTTP_200_EMPTY_LENGTH_FIXTURE);
  evidence.request.model = 'another/provider-model';
  evidence.response.resolvedModel = 'another/provider-model';
  evidence.response.payload.model = 'another/provider-model';
  assert.equal(classifyGenerationFailure(evidence),
    GENERATION_FAILURE_CATEGORIES.OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT);
});

test('61-67: exact failure evidence remains in seven distinct result categories', () => {
  const cases = [
    [GENERATION_FAILURE_CATEGORIES.PARTIAL_OUTPUT_TRUNCATED, {
      response: {
        status: 200,
        payload: { choices: [{ finish_reason: 'length', message: { content: '<!doctype html><html>' } }] },
        assistantText: '<!doctype html><html>',
      },
    }],
    [GENERATION_FAILURE_CATEGORIES.EMPTY_PROVIDER_CONTENT, {
      response: {
        status: 200,
        payload: { choices: [{ finish_reason: 'stop', message: { content: null } }] },
        assistantText: '',
      },
    }],
    [GENERATION_FAILURE_CATEGORIES.PROVIDER_EXPLICIT_ERROR, {
      response: { status: 503, payload: { error: { message: 'route unavailable' } } },
    }],
    [GENERATION_FAILURE_CATEGORIES.PROVIDER_TIMEOUT, {
      error: { name: 'TimeoutError', message: 'request timed out' },
    }],
    [GENERATION_FAILURE_CATEGORIES.INVALID_HTML, {
      response: {
        status: 200,
        payload: { choices: [{ finish_reason: 'stop', message: { content: 'not html' } }] },
        assistantText: 'not html',
      },
      staticValidation: { passed: false, problems: ['Missing HTML document'] },
    }],
    [GENERATION_FAILURE_CATEGORIES.RENDERER_RUNTIME_FAILURE, {
      response: {
        status: 200,
        payload: { choices: [{ finish_reason: 'stop', message: { content: '<!doctype html><html></html>' } }] },
        assistantText: '<!doctype html><html></html>',
        extractedHtml: '<!doctype html><html></html>',
      },
      reliability: { passed: false, failure: 'watchdog' },
    }],
    [GENERATION_FAILURE_CATEGORIES.CANCELLED, {
      cancelled: true,
      error: { name: 'AbortError' },
    }],
  ];

  const observed = cases.map(([expected, evidence]) => {
    const actual = classifyGenerationFailure(evidence);
    assert.equal(actual, expected);
    assert.ok(generationFailureCopy(actual).length > 0);
    return actual;
  });
  assert.equal(new Set(observed).size, cases.length, 'specific evidence must not collapse categories');
});

test('choice-level provider errors and timeout metadata cannot become artifacts or repairs', () => {
  assert.equal(classifyGenerationFailure({
    response: {
      status: 200,
      payload: {
        choices: [{ finish_reason: 'error', error: { message: 'upstream failed' }, message: { content: '<html>' } }],
      },
    },
  }), GENERATION_FAILURE_CATEGORIES.PROVIDER_EXPLICIT_ERROR);
  assert.equal(classifyGenerationFailure({
    response: {
      status: 200,
      payload: {
        choices: [{ error: { metadata: { error_type: 'timeout' } }, message: { content: null } }],
      },
    },
  }), GENERATION_FAILURE_CATEGORIES.PROVIDER_TIMEOUT);
  assert.equal(classifyGenerationFailure({ response: { status: 524 } }), GENERATION_FAILURE_CATEGORIES.PROVIDER_TIMEOUT);
});
