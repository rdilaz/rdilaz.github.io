export const GENERATION_ENVELOPE_VERSION = 'visualizer-generation-envelope-v1';
export const GENERATION_ENVELOPE_SCHEMA = GENERATION_ENVELOPE_VERSION;
export const DEFAULT_GENERATION_ENVELOPE_SAFETY_FACTOR = 0.9;

// This is a practical product floor, not a guarantee of success. It reuses the
// existing accepted 4,500-token typical successful-output allowance.
export const minimumPracticalCompletionTokens = 4500;

// OpenRouter documents these percentages for translating effort to a reasoning
// budget when a provider needs one. We use them only to reserve room for the
// artifact, never to alter the user's effort or predict actual consumption.
const REASONING_HEADROOM_PERCENT = Object.freeze({
  none: 0,
  minimal: 10,
  low: 20,
  medium: 50,
  high: 80,
  xhigh: 95,
  max: 95,
});

export const GENERATION_ENVELOPE_REASONS = Object.freeze({
  PRICING_UNKNOWN: 'PRICING_UNKNOWN',
  PROMPT_TOKENS_UNKNOWN: 'PROMPT_TOKENS_UNKNOWN',
  MODEL_COMPLETION_LIMIT_UNKNOWN: 'MODEL_COMPLETION_LIMIT_UNKNOWN',
  CONTEXT_CAPACITY_UNKNOWN: 'CONTEXT_CAPACITY_UNKNOWN',
  SPEND_LIMIT_UNKNOWN: 'SPEND_LIMIT_UNKNOWN',
  INVALID_SAFETY_FACTOR: 'INVALID_SAFETY_FACTOR',
  INVALID_ROOT_MAX_TOKENS: 'INVALID_ROOT_MAX_TOKENS',
  MODEL_COMPLETION_CEILING: 'MODEL_COMPLETION_CEILING',
  CONTEXT_CAPACITY_CEILING: 'CONTEXT_CAPACITY_CEILING',
  ROOT_MAX_TOKENS_CEILING: 'ROOT_MAX_TOKENS_CEILING',
  AFFORDABILITY_CEILING: 'AFFORDABILITY_CEILING',
  INSUFFICIENT_PRACTICAL_ENVELOPE: 'INSUFFICIENT_PRACTICAL_ENVELOPE',
  PRACTICAL_MODEL_LIMIT: 'PRACTICAL_MODEL_LIMIT',
  PRACTICAL_CONTEXT_LIMIT: 'PRACTICAL_CONTEXT_LIMIT',
  PRACTICAL_REQUEST_LIMIT: 'PRACTICAL_REQUEST_LIMIT',
  PRACTICAL_AFFORDABILITY_LIMIT: 'PRACTICAL_AFFORDABILITY_LIMIT',
});

const hasOwn = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);

function firstOwn(sources, keys) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      if (hasOwn(source, key)) return { present: true, value: source[key] };
    }
  }
  return { present: false, value: undefined };
}

function priceEntry(options, nestedKeys, rootKeys) {
  const nested = firstOwn([options.pricing, options.model?.pricing], nestedKeys);
  return nested.present ? nested : firstOwn([options, options.model], rootKeys);
}

function parsePrice(entry) {
  if (!entry.present || (typeof entry.value !== 'number' && typeof entry.value !== 'string')) return null;
  if (typeof entry.value === 'string' && entry.value.trim() === '') return null;
  const value = Number(entry.value);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizePricing(options) {
  const entries = {
    prompt: priceEntry(options,
      ['prompt', 'input', 'promptPrice', 'inputPrice', 'prompt_price', 'input_price'],
      ['promptPrice', 'inputPrice']),
    completion: priceEntry(options,
      ['completion', 'output', 'completionPrice', 'outputPrice', 'completion_price', 'output_price'],
      ['completionPrice', 'outputPrice']),
    request: priceEntry(options,
      ['request', 'requestFee', 'requestPrice', 'request_fee', 'request_price'],
      ['requestFee', 'requestPrice']),
    internalReasoning: priceEntry(options,
      ['internal_reasoning', 'internalReasoning', 'internalReasoningPrice', 'reasoning'],
      ['internalReasoningPrice']),
  };
  const missing = [];
  const prompt = parsePrice(entries.prompt);
  const completion = parsePrice(entries.completion);
  const request = parsePrice(entries.request);
  if (prompt === null) missing.push('prompt');
  if (completion === null) missing.push('completion');
  if (request === null) missing.push('request');

  let internalReasoning = 0;
  if (entries.internalReasoning.present) {
    internalReasoning = parsePrice(entries.internalReasoning);
    if (internalReasoning === null) missing.push('internal_reasoning');
  }

  const known = missing.length === 0;
  return {
    known,
    missing,
    prompt,
    completion,
    request,
    internalReasoning,
    // A route is free only when every required price was explicitly published
    // as zero. Missing metadata never becomes an implicit free price.
    free: known && prompt === 0 && completion === 0 && request === 0 && internalReasoning === 0,
  };
}

function positiveIntegerCeiling(values) {
  const ceilings = values
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 0)
    .map(Math.floor);
  return ceilings.length ? Math.min(...ceilings) : null;
}

function modelCompletionCeiling(options) {
  const model = options.model || {};
  return positiveIntegerCeiling([
    options.modelMaximumCompletionTokens,
    options.maxCompletionTokens,
    model.maxCompletionTokens,
    model.max_completion_tokens,
    model.capabilities?.maxOutputTokens,
    model.top_provider?.max_completion_tokens,
    model.topProvider?.maxCompletionTokens,
  ]);
}

function modelContextCapacity(options) {
  const model = options.model || {};
  return positiveIntegerCeiling([
    options.contextCapacityTokens,
    model.contextLength,
    model.context_length,
    model.contextWindow,
    model.context_window,
  ]);
}

function contentLength(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  try { return JSON.stringify(content); } catch { return String(content); }
}

function utf8Bytes(value) {
  const text = String(value ?? '');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
  return encodeURIComponent(text).replace(/%[0-9A-F]{2}|./gi, 'x').length;
}

export function estimateConservativePromptTokens(messages) {
  if (!Array.isArray(messages)) return null;
  const contentBytes = messages.reduce((total, message) => total + utf8Bytes(contentLength(message?.content)), 0);
  // Byte-level tokenizers cannot produce more content tokens than UTF-8 bytes;
  // fixed per-message and request reserves cover chat framing and role markers.
  return Math.max(300, contentBytes + messages.length * 32 + 128);
}

function reasoningField(reasoning, camelCase, snakeCase = camelCase) {
  if (!reasoning || typeof reasoning !== 'object') return undefined;
  if (Object.hasOwn(reasoning, camelCase)) return reasoning[camelCase];
  return reasoning[snakeCase];
}

function practicalReasoningPolicy(options) {
  const selection = options.reasoningSelection;
  if (selection?.mode === 'explicit') {
    const effort = String(selection.effort || '').toLowerCase();
    return { effort, headroomEffort: effort, basis: 'explicit-user-selection' };
  }
  const reasoning = options.reasoningMetadata || options.model?.reasoning || null;
  if (!reasoning || typeof reasoning !== 'object') {
    return { effort: 'none', headroomEffort: 'none', basis: 'no-reasoning-metadata' };
  }
  const mandatory = reasoningField(reasoning, 'mandatory') === true;
  const defaultEnabled = reasoningField(reasoning, 'defaultEnabled', 'default_enabled');
  if (!mandatory && defaultEnabled === false) {
    return { effort: 'none', headroomEffort: 'none', basis: 'catalog-default-disabled' };
  }
  const defaultEffort = String(reasoningField(reasoning, 'defaultEffort', 'default_effort') || '').toLowerCase();
  if ((mandatory || defaultEnabled === true) && Object.hasOwn(REASONING_HEADROOM_PERCENT, defaultEffort)) {
    return { effort: defaultEffort, headroomEffort: defaultEffort, basis: 'catalog-native-default' };
  }
  return { effort: 'unknown-native', headroomEffort: 'high', basis: 'conservative-native-unknown' };
}

export function minimumPracticalTokensForReasoning(options = {}) {
  const policy = practicalReasoningPolicy(options);
  const percent = REASONING_HEADROOM_PERCENT[policy.headroomEffort] ?? 0;
  if (percent <= 0) return minimumPracticalCompletionTokens;
  return Math.ceil(minimumPracticalCompletionTokens * 100 / (100 - percent));
}

function promptTokenEstimate(options) {
  const entry = firstOwn([options], ['conservativePromptTokens', 'promptTokens']);
  if (entry.present) {
    const value = Number(entry.value);
    return Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null;
  }
  return estimateConservativePromptTokens(options.messages);
}

function rootMaxTokensCeiling(options) {
  const entry = firstOwn([options], ['max_tokens', 'maxTokens']);
  if (!entry.present) return { present: false, valid: true, value: null };
  const number = Number(entry.value);
  if (!Number.isFinite(number) || number < 0) return { present: true, valid: false, value: null };
  return { present: true, valid: true, value: Math.floor(number) };
}

function budgetNumber(raw) {
  if (raw && typeof raw === 'object') {
    if (hasOwn(raw, 'remaining')) return budgetNumber(raw.remaining);
    if (hasOwn(raw, 'limit_remaining')) return budgetNumber(raw.limit_remaining);
    if (hasOwn(raw, 'limit')) {
      const limit = Number(raw.limit);
      const spent = Number(raw.spent || 0);
      return Number.isFinite(limit) && Number.isFinite(spent) ? Math.max(0, limit - spent) : null;
    }
    return null;
  }
  if (raw === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function normalizeRemainingBudgets(options) {
  const source = options.remainingBudgets || options.budgets || {};
  const read = (sourceKeys, rootKeys) => {
    const entry = firstOwn([source], sourceKeys);
    return entry.present ? budgetNumber(entry.value) : budgetNumber(firstOwn([options], rootKeys).value);
  };
  const perDream = read(['perDream', 'per_dream', 'perDreamRemaining'], ['perDreamRemaining']);
  const session = read(['session', 'sessionRemaining'], ['sessionRemaining']);
  const daily = read(['daily', 'day', 'dailyRemaining'], ['dailyRemaining']);
  const providerEntry = firstOwn([source], ['provider', 'providerRemaining']);
  const rootProviderEntry = firstOwn([options], ['providerRemaining']);
  const providerRaw = providerEntry.present ? providerEntry.value : rootProviderEntry.value;
  // null/omitted means the provider reports no finite account-side ceiling.
  const provider = providerRaw == null ? Number.POSITIVE_INFINITY : budgetNumber(providerRaw);
  const known = perDream !== null && session !== null && daily !== null && provider !== null;
  return { known, perDream, session, daily, provider };
}

function addReason(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function maximumAffordableTokens(effectiveSpendCeiling, fixedCostReserve, completionPriceCeiling) {
  if (fixedCostReserve > effectiveSpendCeiling) return 0;
  if (completionPriceCeiling === 0 || effectiveSpendCeiling === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  const raw = Math.floor((effectiveSpendCeiling - fixedCostReserve) / completionPriceCeiling);
  return Number.isSafeInteger(raw) ? Math.max(0, raw) : Number.POSITIVE_INFINITY;
}

/**
 * Calculates a browser-neutral, quality-first completion envelope. Monetary
 * values are provider billing units (currently dollars) and catalog prices are
 * per token. `max_tokens`, when supplied, is only an additional root ceiling;
 * omitting it does not introduce a fallback ceiling.
 */
export function calculateGenerationEnvelope(options = {}) {
  const reasons = [];
  const pricing = normalizePricing(options);
  const promptTokens = promptTokenEstimate(options);
  const modelCeiling = modelCompletionCeiling(options);
  const contextCapacityTokens = modelContextCapacity(options);
  const contextCeiling = contextCapacityTokens === null || promptTokens === null
    ? null
    : Math.max(0, contextCapacityTokens - promptTokens);
  const rootCeiling = rootMaxTokensCeiling(options);
  const budgets = normalizeRemainingBudgets(options);
  const practicalReasoningPolicyValue = practicalReasoningPolicy(options);
  const minimumPracticalCompletionTokensForRequest = minimumPracticalTokensForReasoning(options);
  const suppliedSafetyFactor = options.safetyFactor ?? DEFAULT_GENERATION_ENVELOPE_SAFETY_FACTOR;
  const safetyFactor = Number(suppliedSafetyFactor);
  const validSafetyFactor = Number.isFinite(safetyFactor) && safetyFactor > 0 && safetyFactor <= 1;

  if (!pricing.known) addReason(reasons, GENERATION_ENVELOPE_REASONS.PRICING_UNKNOWN);
  if (promptTokens === null) addReason(reasons, GENERATION_ENVELOPE_REASONS.PROMPT_TOKENS_UNKNOWN);
  if (modelCeiling === null) addReason(reasons, GENERATION_ENVELOPE_REASONS.MODEL_COMPLETION_LIMIT_UNKNOWN);
  if (contextCapacityTokens === null) addReason(reasons, GENERATION_ENVELOPE_REASONS.CONTEXT_CAPACITY_UNKNOWN);
  if (!budgets.known) addReason(reasons, GENERATION_ENVELOPE_REASONS.SPEND_LIMIT_UNKNOWN);
  if (!validSafetyFactor) addReason(reasons, GENERATION_ENVELOPE_REASONS.INVALID_SAFETY_FACTOR);
  if (!rootCeiling.valid) addReason(reasons, GENERATION_ENVELOPE_REASONS.INVALID_ROOT_MAX_TOKENS);

  const pricingReady = pricing.known && promptTokens !== null;
  const requestFeeReserve = pricingReady ? pricing.request : null;
  const promptCostReserve = pricingReady ? promptTokens * pricing.prompt : null;
  const fixedCostReserve = pricingReady ? requestFeeReserve + promptCostReserve : null;
  // Reserving both prices for every completion token is deliberately
  // conservative when a catalog publishes a separate reasoning-token price.
  const completionPriceCeiling = pricing.known
    ? pricing.completion + pricing.internalReasoning
    : null;
  const strictRemainingBudget = budgets.known
    ? Math.min(budgets.perDream, budgets.session, budgets.daily, budgets.provider)
    : null;
  const effectiveSpendCeiling = budgets.known && validSafetyFactor
    ? strictRemainingBudget * safetyFactor
    : null;
  const affordableCompletionTokens = pricingReady && effectiveSpendCeiling !== null
    ? maximumAffordableTokens(effectiveSpendCeiling, fixedCostReserve, completionPriceCeiling)
    : null;

  const calculationReady = modelCeiling !== null
    && contextCeiling !== null
    && rootCeiling.valid
    && affordableCompletionTokens !== null;
  const physicalCeilings = calculationReady
    ? [modelCeiling, contextCeiling, affordableCompletionTokens]
    : [];
  if (calculationReady && rootCeiling.present) physicalCeilings.push(rootCeiling.value);
  let finalMaxTokens = calculationReady ? Math.min(...physicalCeilings) : null;
  let finalRequestCostCeiling = finalMaxTokens === null
    ? null
    : fixedCostReserve + finalMaxTokens * completionPriceCeiling;

  // Floating-point division can land one token above a decimal-priced budget.
  // Correct downward so the returned ceiling never crosses the safety boundary.
  if (
    finalMaxTokens !== null
    && Number.isFinite(effectiveSpendCeiling)
    && finalRequestCostCeiling > effectiveSpendCeiling
  ) {
    finalMaxTokens = Math.max(0, finalMaxTokens - 1);
    finalRequestCostCeiling = fixedCostReserve + finalMaxTokens * completionPriceCeiling;
  }

  if (finalMaxTokens !== null) {
    if (finalMaxTokens === modelCeiling) addReason(reasons, GENERATION_ENVELOPE_REASONS.MODEL_COMPLETION_CEILING);
    if (finalMaxTokens === contextCeiling) addReason(reasons, GENERATION_ENVELOPE_REASONS.CONTEXT_CAPACITY_CEILING);
    if (rootCeiling.present && finalMaxTokens === rootCeiling.value) {
      addReason(reasons, GENERATION_ENVELOPE_REASONS.ROOT_MAX_TOKENS_CEILING);
    }
    if (finalMaxTokens === affordableCompletionTokens) {
      addReason(reasons, GENERATION_ENVELOPE_REASONS.AFFORDABILITY_CEILING);
    }
  }

  const insufficientPracticalEnvelope = finalMaxTokens !== null
    && finalMaxTokens < minimumPracticalCompletionTokensForRequest;
  let practicalEnvelopeConstraint = null;
  if (insufficientPracticalEnvelope) {
    addReason(reasons, GENERATION_ENVELOPE_REASONS.INSUFFICIENT_PRACTICAL_ENVELOPE);
    const physicalCandidates = [
      [GENERATION_ENVELOPE_REASONS.PRACTICAL_MODEL_LIMIT, modelCeiling],
      [GENERATION_ENVELOPE_REASONS.PRACTICAL_CONTEXT_LIMIT, contextCeiling],
      ...(rootCeiling.present ? [[GENERATION_ENVELOPE_REASONS.PRACTICAL_REQUEST_LIMIT, rootCeiling.value]] : []),
    ];
    const physical = physicalCandidates.sort((a, b) => a[1] - b[1])[0];
    practicalEnvelopeConstraint = physical?.[1] < minimumPracticalCompletionTokensForRequest
      ? physical[0]
      : GENERATION_ENVELOPE_REASONS.PRACTICAL_AFFORDABILITY_LIMIT;
    addReason(reasons, practicalEnvelopeConstraint);
  }

  const theoreticalModelCeiling = pricingReady && modelCeiling !== null
    ? fixedCostReserve + modelCeiling * completionPriceCeiling
    : null;
  const limitingBudgets = strictRemainingBudget === null ? [] : ['perDream', 'session', 'daily', 'provider']
    .filter(name => budgets[name] === strictRemainingBudget);
  const configurationBlocked = reasons.some(reason => [
    GENERATION_ENVELOPE_REASONS.PRICING_UNKNOWN,
    GENERATION_ENVELOPE_REASONS.PROMPT_TOKENS_UNKNOWN,
    GENERATION_ENVELOPE_REASONS.MODEL_COMPLETION_LIMIT_UNKNOWN,
    GENERATION_ENVELOPE_REASONS.CONTEXT_CAPACITY_UNKNOWN,
    GENERATION_ENVELOPE_REASONS.SPEND_LIMIT_UNKNOWN,
    GENERATION_ENVELOPE_REASONS.INVALID_SAFETY_FACTOR,
    GENERATION_ENVELOPE_REASONS.INVALID_ROOT_MAX_TOKENS,
  ].includes(reason));

  return {
    schema: GENERATION_ENVELOPE_SCHEMA,
    policy: 'quality-first',
    minimumPracticalCompletionTokens,
    minimumPracticalCompletionTokensForRequest,
    practicalReasoningEffort: practicalReasoningPolicyValue.effort,
    qualityFloorBasis: practicalReasoningPolicyValue.basis,
    safetyFactor: validSafetyFactor ? safetyFactor : null,
    reasoningSelection: options.reasoningSelection,
    qualityDowngradeApplied: false,
    pricingStatus: pricing.known ? 'known' : 'unknown',
    missingPricing: [...pricing.missing],
    free: pricing.known ? pricing.free : null,
    pricing: pricing.known ? {
      prompt: pricing.prompt,
      completion: pricing.completion,
      request: pricing.request,
      internalReasoning: pricing.internalReasoning,
    } : null,
    conservativePromptTokens: promptTokens,
    contextCapacityTokens,
    modelCompletionCeiling: modelCeiling,
    contextCompletionCeiling: contextCeiling,
    rootMaxTokensCeiling: rootCeiling.value,
    remainingBudgets: budgets.known ? {
      perDream: budgets.perDream,
      session: budgets.session,
      daily: budgets.daily,
      provider: budgets.provider,
    } : null,
    strictRemainingBudget,
    limitingBudgets,
    effectiveSpendCeiling,
    requestFeeReserve,
    promptCostReserve,
    fixedCostReserve,
    completionPriceCeiling,
    affordableCompletionTokens,
    finalMaxTokens,
    completionCostReserve: finalMaxTokens === null ? null : finalMaxTokens * pricing.completion,
    internalReasoningCostReserve: finalMaxTokens === null ? null : finalMaxTokens * pricing.internalReasoning,
    finalRequestCostCeiling,
    theoreticalModelCeiling,
    theoreticalModelCeilingDetails: {
      label: 'theoreticalModelCeiling',
      audience: 'developer',
      consumerVisible: false,
      isPrediction: false,
      completionTokens: modelCeiling,
    },
    reasons,
    insufficientPracticalEnvelope,
    practicalEnvelopeConstraint,
    blocked: configurationBlocked || insufficientPracticalEnvelope,
    canDispatch: !configurationBlocked && !insufficientPracticalEnvelope,
  };
}
