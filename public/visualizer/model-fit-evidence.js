export const MODEL_FIT_EVIDENCE_SCHEMA = 'visualizer-model-fit-v1';
export const MODEL_FIT_MATRIX_SCHEMA = 'visualizer-model-fit-matrix-v1';
export const MODEL_FIT_STORAGE_KEY = 'ai-visualizer.model-fit.v1';

export const MAX_MODEL_FIT_CONFIGURATIONS = 96;
export const MAX_RECENT_MODEL_FIT_EVIDENCE = 80;
export const MAX_RECENT_EVIDENCE_PER_CONFIGURATION = 12;
export const MAX_MODEL_FIT_METRIC_SAMPLES = 31;
export const MAX_SEEN_MODEL_FIT_OBSERVATIONS = 512;

export const MODEL_FIT_STATUSES = Object.freeze({
  UNTESTED: 'UNTESTED',
  TESTED: 'TESTED',
  PROVEN: 'PROVEN',
  KNOWN_INCOMPATIBLE: 'KNOWN_INCOMPATIBLE',
});

export const MODEL_FIT_RESULT_CATEGORIES = Object.freeze({
  READY: 'READY',
  LIVE_OPEN: 'LIVE_OPEN',
  OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT: 'OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT',
  PARTIAL_ARTIFACT_TRUNCATED: 'PARTIAL_ARTIFACT_TRUNCATED',
  EMPTY_PROVIDER_CONTENT: 'EMPTY_PROVIDER_CONTENT',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  INVALID_HTML: 'INVALID_HTML',
  RUNTIME_RELIABILITY_FAILURE: 'RUNTIME_RELIABILITY_FAILURE',
  USER_CANCELLED: 'USER_CANCELLED',
  BUDGET_BLOCKED_BEFORE_DISPATCH: 'BUDGET_BLOCKED_BEFORE_DISPATCH',
  OTHER_FAILURE: 'OTHER_FAILURE',
});

export const MODEL_FIT_EVIDENCE_LIMITS = Object.freeze({
  configurations: MAX_MODEL_FIT_CONFIGURATIONS,
  recentEvidence: MAX_RECENT_MODEL_FIT_EVIDENCE,
  recentPerConfiguration: MAX_RECENT_EVIDENCE_PER_CONFIGURATION,
  metricSamples: MAX_MODEL_FIT_METRIC_SAMPLES,
  seenObservationIds: MAX_SEEN_MODEL_FIT_OBSERVATIONS,
});

const SUCCESS_CATEGORIES = new Set([
  MODEL_FIT_RESULT_CATEGORIES.READY,
  MODEL_FIT_RESULT_CATEGORIES.LIVE_OPEN,
]);

const NON_FAILURE_CATEGORIES = new Set([
  ...SUCCESS_CATEGORIES,
  MODEL_FIT_RESULT_CATEGORIES.USER_CANCELLED,
  MODEL_FIT_RESULT_CATEGORIES.BUDGET_BLOCKED_BEFORE_DISPATCH,
]);

const RELIABILITY_FAILURE_CODES = new Set([
  'BOOT_TIMEOUT',
  'RUNTIME_ERROR',
  'VIZ_CALLBACK_ERROR',
  'RENDER_CONTEXT_FAILED',
  'SHADER_COMPILE_FAILED',
  'PROGRAM_LINK_FAILED',
  'NO_VISIBLE_OUTPUT',
  'VIZ_NOT_CONSUMED',
  'RUNTIME_STALLED',
  'WEBGL_CONTEXT_LOST',
  'PERFORMANCE_COLLAPSE',
  'PROBE_FAILED',
  'ROLLED_BACK',
  'RUNTIME_FAILURE',
]);

const CATEGORY_ALIASES = Object.freeze({
  READY_SUCCESS: MODEL_FIT_RESULT_CATEGORIES.READY,
  READY_TO_OPEN: MODEL_FIT_RESULT_CATEGORIES.READY,
  LIVE: MODEL_FIT_RESULT_CATEGORIES.LIVE_OPEN,
  OPEN: MODEL_FIT_RESULT_CATEGORIES.LIVE_OPEN,
  OPENED: MODEL_FIT_RESULT_CATEGORIES.LIVE_OPEN,
  SUCCEEDED: MODEL_FIT_RESULT_CATEGORIES.LIVE_OPEN,
  VERIFIED_LIVE: MODEL_FIT_RESULT_CATEGORIES.LIVE_OPEN,
  OUTPUT_BUDGET_EXHAUSTED: MODEL_FIT_RESULT_CATEGORIES.OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT,
  PARTIAL_OUTPUT_TRUNCATED: MODEL_FIT_RESULT_CATEGORIES.PARTIAL_ARTIFACT_TRUNCATED,
  PARTIAL_HTML_TRUNCATED: MODEL_FIT_RESULT_CATEGORIES.PARTIAL_ARTIFACT_TRUNCATED,
  EMPTY_CONTENT: MODEL_FIT_RESULT_CATEGORIES.EMPTY_PROVIDER_CONTENT,
  EMPTY_OUTPUT: MODEL_FIT_RESULT_CATEGORIES.EMPTY_PROVIDER_CONTENT,
  REQUEST_TIMEOUT: MODEL_FIT_RESULT_CATEGORIES.PROVIDER_TIMEOUT,
  TRANSPORT_TIMEOUT: MODEL_FIT_RESULT_CATEGORIES.PROVIDER_TIMEOUT,
  TIMEOUT: MODEL_FIT_RESULT_CATEGORIES.PROVIDER_TIMEOUT,
  PROVIDER_EXPLICIT_ERROR: MODEL_FIT_RESULT_CATEGORIES.PROVIDER_ERROR,
  STATIC_INVALID_HTML: MODEL_FIT_RESULT_CATEGORIES.INVALID_HTML,
  INVALID_VISUALIZER_HTML: MODEL_FIT_RESULT_CATEGORIES.INVALID_HTML,
  RELIABILITY_FAILURE: MODEL_FIT_RESULT_CATEGORIES.RUNTIME_RELIABILITY_FAILURE,
  RENDERER_RUNTIME_FAILURE: MODEL_FIT_RESULT_CATEGORIES.RUNTIME_RELIABILITY_FAILURE,
  RUNTIME_FAILURE: MODEL_FIT_RESULT_CATEGORIES.RUNTIME_RELIABILITY_FAILURE,
  CANCELLED: MODEL_FIT_RESULT_CATEGORIES.USER_CANCELLED,
  CANCELED: MODEL_FIT_RESULT_CATEGORIES.USER_CANCELLED,
  BUDGET_BLOCKED: MODEL_FIT_RESULT_CATEGORIES.BUDGET_BLOCKED_BEFORE_DISPATCH,
  INSUFFICIENT_BUDGET: MODEL_FIT_RESULT_CATEGORIES.BUDGET_BLOCKED_BEFORE_DISPATCH,
  INSUFFICIENT_PRACTICAL_ENVELOPE: MODEL_FIT_RESULT_CATEGORIES.BUDGET_BLOCKED_BEFORE_DISPATCH,
  GENERATION_ENVELOPE_UNAVAILABLE: MODEL_FIT_RESULT_CATEGORIES.BUDGET_BLOCKED_BEFORE_DISPATCH,
  PRICING_UNKNOWN: MODEL_FIT_RESULT_CATEGORIES.BUDGET_BLOCKED_BEFORE_DISPATCH,
  FAILED: MODEL_FIT_RESULT_CATEGORIES.OTHER_FAILURE,
});

const MATRIX_PREFIX = '=== AI VISUALIZER MODEL TEST MATRIX v1 ===\nPaste this entire block into ChatGPT.\n';
const MATRIX_SUFFIX = '=== END AI VISUALIZER MODEL TEST MATRIX ===';

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function redactSecretText(value) {
  let text = String(value ?? '');
  text = text.replace(/\bBearer\s+[^\s"'<>;,]+/gi, 'Bearer [redacted]');
  text = text.replace(/\bsk-or-v1-[A-Za-z0-9._~-]+\b/gi, '[redacted]');
  text = text.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted]');
  text = text.replace(
    /\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|credential|client[_-]?secret|cookie|password)\s*[:=]\s*[^\s,;&]+/gi,
    '$1=[redacted]',
  );
  return text;
}

function boundedText(value, label, { required = false, max = 180 } = {}) {
  const text = redactSecretText(value).trim();
  if (required && !text) throw new TypeError(`${label} is required.`);
  return text.slice(0, max);
}

function finiteNumber(value, { integer = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const bounded = Math.min(number, max);
  return integer ? Math.floor(bounded) : bounded;
}

function timestamp(value, fallback = null) {
  const numeric = finiteNumber(value);
  if (numeric != null) return numeric;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeReasoningChoice(value) {
  if (value && typeof value === 'object') {
    const mode = String(value.mode ?? '').trim().toLowerCase();
    if (mode === 'default' || mode === 'native') return 'default';
    value = firstDefined(value.effort, value.choice, value.value, mode || undefined);
  }
  const choice = boundedText(value, 'Reasoning choice', { required: true, max: 80 }).toLowerCase();
  return choice === 'native' ? 'default' : choice;
}

function envelopeMajorVersion(value) {
  const direct = finiteNumber(value, { integer: true, max: 1000000 });
  if (direct != null && direct > 0 && /^\s*v?\d+\s*$/i.test(String(value))) return direct;
  const text = String(value ?? '').trim();
  const match = text.match(/(?:^|[-_.])v?(\d+)(?:\.\d+)*(?:$|[-_.])/i);
  const major = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(major) || major < 1) {
    throw new TypeError('Generation-envelope major version is required.');
  }
  return major;
}

export function createModelFitConfigurationIdentity(input = {}) {
  const promptProfile = input.promptProfile && typeof input.promptProfile === 'object' ? input.promptProfile : {};
  const versions = input.versions && typeof input.versions === 'object' ? input.versions : {};
  const reliabilityRuntimeVersion = firstDefined(
    input.reliabilityRuntimeVersion,
    input.runtimeCompatibilityVersion,
    versions.reliabilityRuntimeVersion,
  );
  const identity = {
    modelId: boundedText(firstDefined(input.modelId, input.model?.id), 'Exact model ID', { required: true, max: 240 }),
    reasoningChoice: normalizeReasoningChoice(firstDefined(
      input.reasoningChoice,
      input.reasoningSelection,
      input.reasoning,
    )),
    promptProfileId: boundedText(firstDefined(
      input.promptProfileId,
      promptProfile.id,
      input.prompt?.profileId,
    ), 'Prompt profile ID', { required: true, max: 160 }),
    promptVersion: boundedText(firstDefined(
      input.promptVersion,
      versions.promptVersion,
      input.prompt?.version,
    ), 'Prompt version', { required: true, max: 160 }),
    promptHash: boundedText(firstDefined(
      input.promptHash,
      input.promptProfileHash,
      promptProfile.briefHash,
      promptProfile.hash,
      input.prompt?.hash,
    ), 'Prompt hash', { required: true, max: 160 }),
    generationEnvelopeMajorVersion: envelopeMajorVersion(firstDefined(
      input.generationEnvelopeMajorVersion,
      input.generationEnvelopeVersion,
      versions.generationEnvelopeMajorVersion,
      versions.generationEnvelopeVersion,
    )),
    audioApiVersion: boundedText(firstDefined(
      input.audioApiVersion,
      versions.audioApiVersion,
    ), 'Audio API version', { required: true, max: 160 }),
    reliabilityVersion: boundedText(firstDefined(
      input.reliabilityVersion,
      versions.reliabilityVersion,
      reliabilityRuntimeVersion,
    ), 'Reliability version', { required: true, max: 160 }),
    runtimeVersion: boundedText(firstDefined(
      input.runtimeVersion,
      versions.runtimeVersion,
      reliabilityRuntimeVersion,
      input.reliabilityVersion,
      versions.reliabilityVersion,
    ), 'Runtime version', { required: true, max: 160 }),
  };
  return deepFreeze(identity);
}

export function modelFitConfigurationKey(input) {
  const identity = createModelFitConfigurationIdentity(input);
  return JSON.stringify([
    MODEL_FIT_EVIDENCE_SCHEMA,
    identity.modelId,
    identity.reasoningChoice,
    identity.promptProfileId,
    identity.promptVersion,
    identity.promptHash,
    identity.generationEnvelopeMajorVersion,
    identity.audioApiVersion,
    identity.reliabilityVersion,
    identity.runtimeVersion,
  ]);
}

export const normalizeModelFitConfigurationIdentity = createModelFitConfigurationIdentity;
export const configurationKeyForModelFit = modelFitConfigurationKey;

function categoryCode(value) {
  return String(value ?? '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 120);
}

export function normalizeModelFitResultCategory(value) {
  const code = categoryCode(value);
  if (!code) return MODEL_FIT_RESULT_CATEGORIES.OTHER_FAILURE;
  if (Object.values(MODEL_FIT_RESULT_CATEGORIES).includes(code)) return code;
  if (CATEGORY_ALIASES[code]) return CATEGORY_ALIASES[code];
  if (RELIABILITY_FAILURE_CODES.has(code)) return MODEL_FIT_RESULT_CATEGORIES.RUNTIME_RELIABILITY_FAILURE;
  if (/^(HTTP_)?(REQUEST_|PROVIDER_|TRANSPORT_)?TIMEOUT$/.test(code)) return MODEL_FIT_RESULT_CATEGORIES.PROVIDER_TIMEOUT;
  if (/CANCEL/.test(code)) return MODEL_FIT_RESULT_CATEGORIES.USER_CANCELLED;
  if (/INVALID.*HTML|HTML.*INVALID/.test(code)) return MODEL_FIT_RESULT_CATEGORIES.INVALID_HTML;
  return MODEL_FIT_RESULT_CATEGORIES.OTHER_FAILURE;
}

export function modelFitStatus(evidence = {}) {
  const known = evidence.knownIncompatible?.deterministic === true
    || evidence.deterministicIncompatibility === true;
  if (known) return MODEL_FIT_STATUSES.KNOWN_INCOMPATIBLE;
  const ready = finiteNumber(firstDefined(evidence.readySuccessCount, evidence.readySuccesses), { integer: true }) || 0;
  const live = finiteNumber(firstDefined(evidence.liveOpenSuccessCount, evidence.liveOpenSuccesses), { integer: true }) || 0;
  if (ready > 0 || live > 0) return MODEL_FIT_STATUSES.PROVEN;
  const attempts = finiteNumber(firstDefined(evidence.providerAttemptCount, evidence.attempts), { integer: true }) || 0;
  return attempts > 0 ? MODEL_FIT_STATUSES.TESTED : MODEL_FIT_STATUSES.UNTESTED;
}

export const statusForModelFitEvidence = modelFitStatus;

function emptyMetric() {
  return {
    count: 0,
    total: 0,
    min: null,
    max: null,
    last: null,
    lastAt: null,
    samples: [],
  };
}

function normalizedMetric(metric, sampleLimit) {
  const output = emptyMetric();
  if (!metric || typeof metric !== 'object') return output;
  output.count = finiteNumber(metric.count, { integer: true }) || 0;
  output.total = finiteNumber(metric.total) || 0;
  output.min = finiteNumber(metric.min);
  output.max = finiteNumber(metric.max);
  output.last = finiteNumber(metric.last);
  output.lastAt = timestamp(metric.lastAt);
  output.samples = (Array.isArray(metric.samples) ? metric.samples : [])
    .map((sample, index) => ({
      value: finiteNumber(sample?.value),
      at: timestamp(sample?.at, 0),
      observationId: boundedText(sample?.observationId, 'Observation ID', { max: 180 }),
      order: finiteNumber(sample?.order, { integer: true, max: 1000 }) ?? index,
    }))
    .filter(sample => sample.value != null)
    .sort((a, b) => b.at - a.at || b.order - a.order || b.observationId.localeCompare(a.observationId))
    .slice(0, sampleLimit);
  return output;
}

function addMetric(metric, value, at, observationId, sampleLimit, order = 0) {
  const number = finiteNumber(value);
  if (number == null) return;
  metric.count += 1;
  metric.total += number;
  metric.min = metric.min == null ? number : Math.min(metric.min, number);
  metric.max = metric.max == null ? number : Math.max(metric.max, number);
  if (metric.lastAt == null || at >= metric.lastAt) {
    metric.last = number;
    metric.lastAt = at;
  }
  metric.samples.push({ value: number, at, observationId, order });
  metric.samples.sort((a, b) => b.at - a.at || b.order - a.order || b.observationId.localeCompare(a.observationId));
  metric.samples = metric.samples.slice(0, sampleLimit);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function metricView(metric) {
  const samples = metric.samples.map(sample => ({ ...sample }));
  return {
    count: metric.count,
    total: metric.total,
    min: metric.min,
    median: median(samples.map(sample => sample.value)),
    max: metric.max,
    last: metric.last,
    lastAt: metric.lastAt,
    sampleCount: samples.length,
    samples,
  };
}

function emptyAggregate() {
  return {
    observationCount: 0,
    providerAttemptCount: 0,
    readySuccessCount: 0,
    liveSuccessCount: 0,
    openSuccessCount: 0,
    liveOpenSuccessCount: 0,
    failureCount: 0,
    failureCategories: {},
    resultCategories: {},
    repairCount: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    providerDurationMs: emptyMetric(),
    usage: {
      promptTokens: emptyMetric(),
      completionTokens: emptyMetric(),
      reasoningTokens: emptyMetric(),
      totalTokens: emptyMetric(),
    },
    artifactBytes: emptyMetric(),
    exactBilledCostUsd: emptyMetric(),
  };
}

function normalizedAggregate(aggregate, sampleLimit) {
  const output = emptyAggregate();
  if (!aggregate || typeof aggregate !== 'object') return output;
  for (const key of [
    'observationCount',
    'providerAttemptCount',
    'readySuccessCount',
    'liveSuccessCount',
    'openSuccessCount',
    'liveOpenSuccessCount',
    'failureCount',
    'repairCount',
  ]) output[key] = finiteNumber(aggregate[key], { integer: true }) || 0;
  output.lastAttemptAt = timestamp(aggregate.lastAttemptAt);
  output.lastSuccessAt = timestamp(aggregate.lastSuccessAt);
  for (const [key, count] of Object.entries(aggregate.failureCategories || {})) {
    const category = normalizeModelFitResultCategory(key);
    output.failureCategories[category] = finiteNumber(count, { integer: true }) || 0;
  }
  for (const [key, count] of Object.entries(aggregate.resultCategories || {})) {
    const category = normalizeModelFitResultCategory(key);
    output.resultCategories[category] = finiteNumber(count, { integer: true }) || 0;
  }
  output.providerDurationMs = normalizedMetric(aggregate.providerDurationMs, sampleLimit);
  output.usage.promptTokens = normalizedMetric(aggregate.usage?.promptTokens, sampleLimit);
  output.usage.completionTokens = normalizedMetric(aggregate.usage?.completionTokens, sampleLimit);
  output.usage.reasoningTokens = normalizedMetric(aggregate.usage?.reasoningTokens, sampleLimit);
  output.usage.totalTokens = normalizedMetric(aggregate.usage?.totalTokens, sampleLimit);
  output.artifactBytes = normalizedMetric(aggregate.artifactBytes, sampleLimit);
  output.exactBilledCostUsd = normalizedMetric(aggregate.exactBilledCostUsd, sampleLimit);
  return output;
}

function sumUsage(attempts) {
  const fields = {
    promptTokens: ['prompt_tokens', 'promptTokens', 'input_tokens', 'inputTokens'],
    completionTokens: ['completion_tokens', 'completionTokens', 'output_tokens', 'outputTokens'],
    totalTokens: ['total_tokens', 'totalTokens'],
  };
  const output = { promptTokens: null, completionTokens: null, reasoningTokens: null, totalTokens: null };
  for (const attempt of attempts) {
    const usage = attempt?.usage || attempt?.response?.usage;
    if (!usage || typeof usage !== 'object') continue;
    for (const [target, aliases] of Object.entries(fields)) {
      const value = finiteNumber(firstDefined(...aliases.map(key => usage[key])));
      if (value != null) output[target] = (output[target] || 0) + value;
    }
    const reasoning = finiteNumber(firstDefined(
      usage.reasoning_tokens,
      usage.reasoningTokens,
      usage.completion_tokens_details?.reasoning_tokens,
      usage.completionTokensDetails?.reasoningTokens,
      usage.output_tokens_details?.reasoning_tokens,
      usage.outputTokensDetails?.reasoningTokens,
    ));
    if (reasoning != null) output.reasoningTokens = (output.reasoningTokens || 0) + reasoning;
  }
  if (output.totalTokens == null && (output.promptTokens != null || output.completionTokens != null)) {
    output.totalTokens = (output.promptTokens || 0) + (output.completionTokens || 0);
  }
  return output;
}

function usageFromObservation(input, attempts) {
  const usage = input.usage && typeof input.usage === 'object' ? input.usage : null;
  if (!usage) return sumUsage(attempts);
  const promptTokens = finiteNumber(firstDefined(usage.promptTokens, usage.prompt_tokens, usage.inputTokens, usage.input_tokens));
  const completionTokens = finiteNumber(firstDefined(usage.completionTokens, usage.completion_tokens, usage.outputTokens, usage.output_tokens));
  const reasoningTokens = finiteNumber(firstDefined(
    usage.reasoningTokens,
    usage.reasoning_tokens,
    usage.completion_tokens_details?.reasoning_tokens,
    usage.completionTokensDetails?.reasoningTokens,
    usage.output_tokens_details?.reasoning_tokens,
    usage.outputTokensDetails?.reasoningTokens,
  ));
  let totalTokens = finiteNumber(firstDefined(usage.totalTokens, usage.total_tokens));
  if (totalTokens == null && (promptTokens != null || completionTokens != null)) {
    totalTokens = (promptTokens || 0) + (completionTokens || 0);
  }
  return { promptTokens, completionTokens, reasoningTokens, totalTokens };
}

function durationsFromObservation(input, attempts) {
  const explicit = firstDefined(input.providerDurationsMs, input.providerDurationMs);
  if (explicit !== undefined) {
    return (Array.isArray(explicit) ? explicit : [explicit])
      .map(value => finiteNumber(value, { max: 24 * 60 * 60 * 1000 }))
      .filter(value => value != null)
      .slice(0, 8);
  }
  return attempts.map(attempt => {
    const timing = attempt?.timing || {};
    const direct = finiteNumber(firstDefined(attempt?.providerDurationMs, timing.providerDurationMs));
    if (direct != null) return direct;
    const start = timestamp(firstDefined(timing.requestDispatchedAt, attempt?.startedAt));
    const end = timestamp(firstDefined(timing.responseBodyCompleteAt, attempt?.finishedAt));
    return start != null && end != null && end >= start ? end - start : null;
  }).filter(value => value != null).slice(0, 8);
}

function exactCostFromObservation(input, attempts, providerAttemptCount) {
  for (const key of [
    'exactBilledCostUsd',
    'exactBilledCost',
    'exactCostUsd',
    'exactCost',
    'exactReportedCost',
    'billedCostUsd',
    'billedCost',
  ]) {
    if (Object.hasOwn(input, key)) return finiteNumber(input[key], { max: 1000000 });
  }
  if (input.reportedCostComplete === true && Object.hasOwn(input, 'totalReportedCost')) {
    return finiteNumber(input.totalReportedCost, { max: 1000000 });
  }
  if (input.usage && Object.hasOwn(input.usage, 'cost')) {
    return finiteNumber(input.usage.cost, { max: 1000000 });
  }
  if (input.costIsExact === true && Object.hasOwn(input, 'cost')) {
    return finiteNumber(input.cost, { max: 1000000 });
  }
  if (!attempts.length || providerAttemptCount < 1) return null;
  const costs = attempts
    .filter(attempt => attempt?.request?.dispatched !== false && attempt?.dispatched !== false)
    .map(attempt => firstDefined(
      attempt?.exactBilledCostUsd,
      attempt?.exactBilledCost,
      attempt?.response?.cost,
      attempt?.response?.usage?.cost,
      attempt?.usage?.cost,
    ));
  if (costs.length !== providerAttemptCount || costs.some(value => finiteNumber(value) == null)) return null;
  return costs.reduce((total, value) => total + finiteNumber(value), 0);
}

function inferredProviderAttemptCount(input, attempts, resultCategory) {
  const explicit = firstDefined(input.providerAttemptCount, input.attemptCount);
  if (explicit !== undefined) return finiteNumber(explicit, { integer: true, max: 8 }) || 0;
  if (attempts.length) {
    return attempts.filter(attempt => attempt?.request?.dispatched !== false && attempt?.dispatched !== false).length;
  }
  if (
    resultCategory === MODEL_FIT_RESULT_CATEGORIES.USER_CANCELLED
    || resultCategory === MODEL_FIT_RESULT_CATEGORIES.BUDGET_BLOCKED_BEFORE_DISPATCH
  ) return 0;
  return 1;
}

function normalizeObservation(input, clock) {
  if (!input || typeof input !== 'object') throw new TypeError('A model-fit observation is required.');
  const identity = createModelFitConfigurationIdentity(
    input.configurationIdentity || input.configuration || input.config || input.identity || input,
  );
  const observationId = boundedText(firstDefined(
    input.observationId,
    input.id,
    input.traceId,
    input.resultId,
    input.dreamId,
    input.generationId,
  ), 'Observation ID', { required: true, max: 180 });
  const rawCategory = firstDefined(input.resultCategory, input.failureCategory, input.category, input.failureCode, input.status, input.outcome);
  let resultCategory = normalizeModelFitResultCategory(rawCategory);
  const readySuccess = input.readySuccess === true || input.ready === true || resultCategory === MODEL_FIT_RESULT_CATEGORIES.READY;
  const liveSuccess = input.liveSuccess === true || input.live === true || resultCategory === MODEL_FIT_RESULT_CATEGORIES.LIVE_OPEN;
  const openSuccess = input.openSuccess === true || input.opened === true || resultCategory === MODEL_FIT_RESULT_CATEGORIES.LIVE_OPEN;
  if (liveSuccess || openSuccess) resultCategory = MODEL_FIT_RESULT_CATEGORIES.LIVE_OPEN;
  else if (readySuccess) resultCategory = MODEL_FIT_RESULT_CATEGORIES.READY;
  const attempts = Array.isArray(input.providerAttempts)
    ? input.providerAttempts.slice(0, 8)
    : Array.isArray(input.attempts) ? input.attempts.slice(0, 8) : [];
  const providerAttemptCount = inferredProviderAttemptCount(input, attempts, resultCategory);
  const attemptedAt = timestamp(firstDefined(input.attemptedAt, input.finishedAt, input.createdAt), clock());
  const qualifyingSuccess = readySuccess || liveSuccess || openSuccess;
  const succeededAt = qualifyingSuccess
    ? timestamp(firstDefined(input.succeededAt, input.successAt, input.finishedAt), attemptedAt)
    : null;
  const usage = usageFromObservation(input, attempts);
  const repairCount = finiteNumber(firstDefined(input.repairCount, input.repairs), { integer: true, max: 4 })
    ?? (input.repairUsed === true ? 1 : attempts.filter(attempt => attempt?.kind === 'repair').length);
  const artifactBytes = finiteNumber(firstDefined(input.artifactBytes, input.outputBytes), { integer: true, max: Number.MAX_SAFE_INTEGER });
  const exactBilledCostUsd = exactCostFromObservation(input, attempts, providerAttemptCount);
  const failureCategory = NON_FAILURE_CATEGORIES.has(resultCategory) ? null : resultCategory;
  return deepFreeze({
    schema: MODEL_FIT_EVIDENCE_SCHEMA,
    observationId,
    configurationKey: modelFitConfigurationKey(identity),
    identity,
    attemptedAt,
    succeededAt,
    resultCategory,
    failureCategory,
    providerAttemptCount,
    readySuccess,
    liveSuccess,
    openSuccess,
    liveOpenSuccess: liveSuccess || openSuccess,
    repairCount,
    providerDurationsMs: durationsFromObservation(input, attempts),
    usage,
    artifactBytes,
    exactBilledCostUsd,
  });
}

export function createModelFitObservation(input, { clock = () => Date.now() } = {}) {
  return normalizeObservation(input, clock);
}

function freshDocument() {
  return {
    schema: MODEL_FIT_EVIDENCE_SCHEMA,
    revision: 0,
    updatedAt: null,
    configurations: [],
    modelIncompatibilities: [],
    recentEvidence: [],
    seenObservationIds: [],
  };
}

function safeMark(mark, scope, clock, required = false) {
  if (!mark || typeof mark !== 'object') {
    if (required) throw new TypeError('A deterministic incompatibility code is required.');
    return null;
  }
  const code = categoryCode(firstDefined(mark.code, mark.reasonCode, mark.category));
  if (!code) {
    if (required) throw new TypeError('A deterministic incompatibility code is required.');
    return null;
  }
  const nondeterministic = new Set([
    MODEL_FIT_RESULT_CATEGORIES.OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT,
    MODEL_FIT_RESULT_CATEGORIES.PARTIAL_ARTIFACT_TRUNCATED,
    MODEL_FIT_RESULT_CATEGORIES.PROVIDER_TIMEOUT,
    MODEL_FIT_RESULT_CATEGORIES.PROVIDER_ERROR,
    MODEL_FIT_RESULT_CATEGORIES.USER_CANCELLED,
    MODEL_FIT_RESULT_CATEGORIES.BUDGET_BLOCKED_BEFORE_DISPATCH,
  ]);
  const observationalCode = /TIMEOUT|BUDGET|RATE_LIMIT|CANCEL|TRANSIENT|TEMPORARY/.test(code);
  if (required && (nondeterministic.has(normalizeModelFitResultCategory(code)) || observationalCode)) {
    throw new TypeError(`${code} is observational evidence, not a deterministic incompatibility.`);
  }
  return {
    deterministic: true,
    scope,
    code,
    category: 'DETERMINISTIC_INCOMPATIBILITY',
    source: boundedText(mark.source, 'Incompatibility source', { max: 120 }),
    markedAt: timestamp(mark.markedAt, clock()),
  };
}

function normalizeStoredObservation(observation) {
  if (!observation || typeof observation !== 'object') return null;
  try {
    const identity = createModelFitConfigurationIdentity(observation.identity || observation.configuration || {});
    const observationId = boundedText(observation.observationId, 'Observation ID', { required: true, max: 180 });
    const resultCategory = normalizeModelFitResultCategory(observation.resultCategory);
    return {
      schema: MODEL_FIT_EVIDENCE_SCHEMA,
      observationId,
      configurationKey: modelFitConfigurationKey(identity),
      identity,
      attemptedAt: timestamp(observation.attemptedAt, 0),
      succeededAt: timestamp(observation.succeededAt),
      resultCategory,
      failureCategory: observation.failureCategory ? normalizeModelFitResultCategory(observation.failureCategory) : null,
      providerAttemptCount: finiteNumber(observation.providerAttemptCount, { integer: true, max: 8 }) || 0,
      readySuccess: observation.readySuccess === true,
      liveSuccess: observation.liveSuccess === true,
      openSuccess: observation.openSuccess === true,
      liveOpenSuccess: observation.liveOpenSuccess === true,
      repairCount: finiteNumber(observation.repairCount, { integer: true, max: 4 }) || 0,
      providerDurationsMs: (Array.isArray(observation.providerDurationsMs) ? observation.providerDurationsMs : [])
        .map(value => finiteNumber(value, { max: 24 * 60 * 60 * 1000 }))
        .filter(value => value != null)
        .slice(0, 8),
      usage: {
        promptTokens: finiteNumber(observation.usage?.promptTokens),
        completionTokens: finiteNumber(observation.usage?.completionTokens),
        reasoningTokens: finiteNumber(observation.usage?.reasoningTokens),
        totalTokens: finiteNumber(observation.usage?.totalTokens),
      },
      artifactBytes: finiteNumber(observation.artifactBytes, { integer: true }),
      exactBilledCostUsd: finiteNumber(observation.exactBilledCostUsd, { max: 1000000 }),
    };
  } catch {
    return null;
  }
}

function emptyConfiguration(identity, now) {
  return {
    key: modelFitConfigurationKey(identity),
    identity,
    createdAt: now,
    updatedAt: now,
    knownIncompatible: null,
    aggregate: emptyAggregate(),
    recentEvidence: [],
  };
}

function normalizeStoredDocument(parsed, limits, clock) {
  if (!parsed || parsed.schema !== MODEL_FIT_EVIDENCE_SCHEMA) return freshDocument();
  const document = freshDocument();
  document.revision = finiteNumber(parsed.revision, { integer: true }) || 0;
  document.updatedAt = timestamp(parsed.updatedAt);
  for (const candidate of Array.isArray(parsed.configurations) ? parsed.configurations.slice(0, limits.configurations) : []) {
    try {
      const identity = createModelFitConfigurationIdentity(candidate.identity || {});
      const entry = emptyConfiguration(identity, timestamp(candidate.createdAt, 0));
      entry.updatedAt = timestamp(candidate.updatedAt, entry.createdAt);
      entry.knownIncompatible = safeMark(candidate.knownIncompatible, 'configuration', clock);
      entry.aggregate = normalizedAggregate(candidate.aggregate, limits.metricSamples);
      entry.recentEvidence = (Array.isArray(candidate.recentEvidence) ? candidate.recentEvidence : [])
        .map(normalizeStoredObservation)
        .filter(Boolean)
        .filter(observation => observation.configurationKey === entry.key)
        .sort((a, b) => b.attemptedAt - a.attemptedAt || b.observationId.localeCompare(a.observationId))
        .slice(0, limits.recentPerConfiguration);
      document.configurations.push(entry);
    } catch {
      // Invalid local entries are ignored without affecting valid evidence.
    }
  }
  document.modelIncompatibilities = (Array.isArray(parsed.modelIncompatibilities) ? parsed.modelIncompatibilities : [])
    .map(candidate => {
      const modelId = boundedText(candidate?.modelId, 'Exact model ID', { max: 240 });
      const mark = safeMark(candidate?.mark, 'model', clock);
      return modelId && mark ? { modelId, mark } : null;
    })
    .filter(Boolean)
    .slice(0, limits.configurations);
  document.recentEvidence = (Array.isArray(parsed.recentEvidence) ? parsed.recentEvidence : [])
    .map(normalizeStoredObservation)
    .filter(Boolean)
    .sort((a, b) => b.attemptedAt - a.attemptedAt || b.observationId.localeCompare(a.observationId))
    .slice(0, limits.recentEvidence);
  document.seenObservationIds = (Array.isArray(parsed.seenObservationIds) ? parsed.seenObservationIds : [])
    .map(value => boundedText(value, 'Observation ID', { max: 180 }))
    .filter(Boolean)
    .slice(0, limits.seenObservationIds);
  return document;
}

function incrementCategory(target, category, amount = 1) {
  target[category] = (target[category] || 0) + amount;
}

function applyObservation(entry, observation, limits) {
  const aggregate = entry.aggregate;
  aggregate.observationCount += 1;
  aggregate.providerAttemptCount += observation.providerAttemptCount;
  aggregate.readySuccessCount += observation.readySuccess ? 1 : 0;
  aggregate.liveSuccessCount += observation.liveSuccess ? 1 : 0;
  aggregate.openSuccessCount += observation.openSuccess ? 1 : 0;
  aggregate.liveOpenSuccessCount += observation.liveOpenSuccess ? 1 : 0;
  aggregate.repairCount += observation.repairCount;
  incrementCategory(aggregate.resultCategories, observation.resultCategory);
  if (observation.failureCategory) {
    aggregate.failureCount += 1;
    incrementCategory(aggregate.failureCategories, observation.failureCategory);
  }
  if (observation.providerAttemptCount > 0) {
    aggregate.lastAttemptAt = Math.max(aggregate.lastAttemptAt || 0, observation.attemptedAt);
  }
  if (observation.succeededAt != null) {
    aggregate.lastSuccessAt = Math.max(aggregate.lastSuccessAt || 0, observation.succeededAt);
  }
  observation.providerDurationsMs.forEach((value, index) => {
    addMetric(aggregate.providerDurationMs, value, observation.attemptedAt, observation.observationId, limits.metricSamples, index);
  });
  for (const key of ['promptTokens', 'completionTokens', 'reasoningTokens', 'totalTokens']) {
    addMetric(aggregate.usage[key], observation.usage[key], observation.attemptedAt, observation.observationId, limits.metricSamples);
  }
  addMetric(aggregate.artifactBytes, observation.artifactBytes, observation.attemptedAt, observation.observationId, limits.metricSamples);
  addMetric(aggregate.exactBilledCostUsd, observation.exactBilledCostUsd, observation.attemptedAt, observation.observationId, limits.metricSamples);
  entry.updatedAt = Math.max(entry.updatedAt || 0, observation.attemptedAt);
  entry.recentEvidence.unshift(clone(observation));
  entry.recentEvidence.sort((a, b) => b.attemptedAt - a.attemptedAt || b.observationId.localeCompare(a.observationId));
  entry.recentEvidence = entry.recentEvidence.slice(0, limits.recentPerConfiguration);
}

function aggregateView(aggregate) {
  return {
    observationCount: aggregate.observationCount,
    providerAttemptCount: aggregate.providerAttemptCount,
    attempts: aggregate.providerAttemptCount,
    readySuccessCount: aggregate.readySuccessCount,
    readySuccesses: aggregate.readySuccessCount,
    liveSuccessCount: aggregate.liveSuccessCount,
    openSuccessCount: aggregate.openSuccessCount,
    liveOpenSuccessCount: aggregate.liveOpenSuccessCount,
    liveOpenSuccesses: aggregate.liveOpenSuccessCount,
    failureCount: aggregate.failureCount,
    failureCategories: { ...aggregate.failureCategories },
    failuresByCategory: { ...aggregate.failureCategories },
    resultCategories: { ...aggregate.resultCategories },
    repairCount: aggregate.repairCount,
    repairs: aggregate.repairCount,
    lastAttemptAt: aggregate.lastAttemptAt,
    lastSuccessAt: aggregate.lastSuccessAt,
    providerDurationMs: metricView(aggregate.providerDurationMs),
    usage: {
      promptTokens: metricView(aggregate.usage.promptTokens),
      completionTokens: metricView(aggregate.usage.completionTokens),
      reasoningTokens: metricView(aggregate.usage.reasoningTokens),
      totalTokens: metricView(aggregate.usage.totalTokens),
    },
    artifactBytes: metricView(aggregate.artifactBytes),
    exactBilledCostUsd: metricView(aggregate.exactBilledCostUsd),
  };
}

function configurationView(entry) {
  const aggregate = aggregateView(entry.aggregate);
  return {
    key: entry.key,
    configurationKey: entry.key,
    identity: clone(entry.identity),
    status: modelFitStatus({ ...aggregate, knownIncompatible: entry.knownIncompatible }),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    knownIncompatible: clone(entry.knownIncompatible),
    aggregate,
    recentEvidence: clone(entry.recentEvidence),
  };
}

function modelView(document, modelId) {
  const configurations = document.configurations.filter(entry => entry.identity.modelId === modelId);
  const modelMark = document.modelIncompatibilities.find(entry => entry.modelId === modelId)?.mark || null;
  const counts = {
    configurationCount: configurations.length,
    providerAttemptCount: 0,
    readySuccessCount: 0,
    liveOpenSuccessCount: 0,
    failureCount: 0,
    repairCount: 0,
    failureCategories: {},
    resultCategories: {},
    lastAttemptAt: null,
    lastSuccessAt: null,
  };
  for (const entry of configurations) {
    const aggregate = entry.aggregate;
    counts.providerAttemptCount += aggregate.providerAttemptCount;
    counts.readySuccessCount += aggregate.readySuccessCount;
    counts.liveOpenSuccessCount += aggregate.liveOpenSuccessCount;
    counts.failureCount += aggregate.failureCount;
    counts.repairCount += aggregate.repairCount;
    if (aggregate.lastAttemptAt != null) counts.lastAttemptAt = Math.max(counts.lastAttemptAt || 0, aggregate.lastAttemptAt);
    if (aggregate.lastSuccessAt != null) counts.lastSuccessAt = Math.max(counts.lastSuccessAt || 0, aggregate.lastSuccessAt);
    for (const [category, count] of Object.entries(aggregate.failureCategories)) incrementCategory(counts.failureCategories, category, count);
    for (const [category, count] of Object.entries(aggregate.resultCategories)) incrementCategory(counts.resultCategories, category, count);
  }
  return {
    modelId,
    status: modelFitStatus({
      ...counts,
      knownIncompatible: modelMark,
    }),
    knownIncompatible: clone(modelMark),
    ...counts,
    configurationStatuses: configurations
      .map(entry => ({
        configurationKey: entry.key,
        reasoningChoice: entry.identity.reasoningChoice,
        status: modelFitStatus({ ...entry.aggregate, knownIncompatible: entry.knownIncompatible }),
      }))
      .sort((a, b) => a.configurationKey.localeCompare(b.configurationKey)),
  };
}

function storageAndOptions(storageOrOptions, options) {
  if (storageOrOptions?.getItem && storageOrOptions?.setItem) {
    return { ...options, storage: storageOrOptions };
  }
  return storageOrOptions && typeof storageOrOptions === 'object' ? storageOrOptions : {};
}

function boundedLimit(value, fallback) {
  const requested = finiteNumber(value, { integer: true, max: fallback });
  return requested != null && requested > 0 ? requested : fallback;
}

export class ModelFitEvidenceStore {
  constructor(storageOrOptions = {}, options = {}) {
    const resolved = storageAndOptions(storageOrOptions, options);
    this.storage = resolved.storage || null;
    this.storageKey = boundedText(resolved.storageKey || MODEL_FIT_STORAGE_KEY, 'Storage key', { required: true, max: 200 });
    this.clock = typeof resolved.clock === 'function' ? resolved.clock : () => Date.now();
    this.limits = Object.freeze({
      configurations: boundedLimit(resolved.maxConfigurations, MAX_MODEL_FIT_CONFIGURATIONS),
      recentEvidence: boundedLimit(resolved.maxRecentEvidence, MAX_RECENT_MODEL_FIT_EVIDENCE),
      recentPerConfiguration: boundedLimit(resolved.maxRecentPerConfiguration, MAX_RECENT_EVIDENCE_PER_CONFIGURATION),
      metricSamples: boundedLimit(resolved.maxMetricSamples, MAX_MODEL_FIT_METRIC_SAMPLES),
      seenObservationIds: boundedLimit(resolved.maxSeenObservationIds, MAX_SEEN_MODEL_FIT_OBSERVATIONS),
    });
    this.persistent = Boolean(this.storage?.getItem && this.storage?.setItem);
    this.memoryDocument = freshDocument();
    this._load();
  }

  _load() {
    if (!this.persistent) return this.memoryDocument;
    try {
      const serialized = this.storage.getItem(this.storageKey);
      this.memoryDocument = normalizeStoredDocument(serialized ? JSON.parse(serialized) : null, this.limits, this.clock);
    } catch {
      this.persistent = false;
    }
    return this.memoryDocument;
  }

  _save(document) {
    document.revision += 1;
    document.updatedAt = timestamp(this.clock(), document.updatedAt || 0);
    this.memoryDocument = document;
    if (!this.persistent) return;
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(document));
    } catch {
      this.persistent = false;
    }
  }

  recordObservation(input) {
    const document = this._load();
    const observation = normalizeObservation(input, this.clock);
    if (document.seenObservationIds.includes(observation.observationId)) {
      const existing = document.configurations.find(entry => entry.key === observation.configurationKey) || null;
      return deepFreeze({
        recorded: false,
        duplicate: true,
        observation: clone(observation),
        configuration: existing ? configurationView(existing) : null,
      });
    }
    let entry = document.configurations.find(candidate => candidate.key === observation.configurationKey);
    if (!entry) {
      entry = emptyConfiguration(observation.identity, observation.attemptedAt);
      document.configurations.push(entry);
    }
    applyObservation(entry, observation, this.limits);
    document.recentEvidence.unshift(clone(observation));
    document.recentEvidence.sort((a, b) => b.attemptedAt - a.attemptedAt || b.observationId.localeCompare(a.observationId));
    document.recentEvidence = document.recentEvidence.slice(0, this.limits.recentEvidence);
    document.seenObservationIds.unshift(observation.observationId);
    document.seenObservationIds = [...new Set(document.seenObservationIds)].slice(0, this.limits.seenObservationIds);
    document.configurations.sort((a, b) => b.updatedAt - a.updatedAt || b.key.localeCompare(a.key));
    document.configurations = document.configurations.slice(0, this.limits.configurations);
    const retainedKeys = new Set(document.configurations.map(candidate => candidate.key));
    document.recentEvidence = document.recentEvidence.filter(candidate => retainedKeys.has(candidate.configurationKey));
    this._save(document);
    return deepFreeze({
      recorded: true,
      duplicate: false,
      observation: clone(observation),
      configuration: configurationView(entry),
    });
  }

  record(input) {
    return this.recordObservation(input);
  }

  markConfigurationKnownIncompatible(configuration, mark = {}) {
    const identity = createModelFitConfigurationIdentity(configuration);
    const key = modelFitConfigurationKey(identity);
    const document = this._load();
    let entry = document.configurations.find(candidate => candidate.key === key);
    if (!entry) {
      entry = emptyConfiguration(identity, timestamp(mark.markedAt, this.clock()));
      document.configurations.push(entry);
    }
    entry.knownIncompatible = safeMark(mark, 'configuration', this.clock, true);
    entry.updatedAt = entry.knownIncompatible.markedAt;
    document.configurations.sort((a, b) => b.updatedAt - a.updatedAt || b.key.localeCompare(a.key));
    document.configurations = document.configurations.slice(0, this.limits.configurations);
    this._save(document);
    return deepFreeze(configurationView(entry));
  }

  markModelKnownIncompatible(modelId, mark = {}) {
    const exactModelId = boundedText(modelId, 'Exact model ID', { required: true, max: 240 });
    const document = this._load();
    const value = { modelId: exactModelId, mark: safeMark(mark, 'model', this.clock, true) };
    const index = document.modelIncompatibilities.findIndex(candidate => candidate.modelId === exactModelId);
    if (index >= 0) document.modelIncompatibilities[index] = value;
    else document.modelIncompatibilities.unshift(value);
    document.modelIncompatibilities = document.modelIncompatibilities.slice(0, this.limits.configurations);
    this._save(document);
    return deepFreeze(modelView(document, exactModelId));
  }

  markKnownIncompatible(subject, mark = {}) {
    return typeof subject === 'string'
      ? this.markModelKnownIncompatible(subject, mark)
      : this.markConfigurationKnownIncompatible(subject, mark);
  }

  configuration(configuration) {
    const key = modelFitConfigurationKey(configuration);
    const entry = this._load().configurations.find(candidate => candidate.key === key);
    if (entry) return deepFreeze(configurationView(entry));
    const identity = createModelFitConfigurationIdentity(configuration);
    const empty = emptyConfiguration(identity, 0);
    return deepFreeze(configurationView(empty));
  }

  getConfiguration(configuration) {
    return this.configuration(configuration);
  }

  configurationStatus(configuration) {
    return this.configuration(configuration).status;
  }

  model(modelId) {
    const exactModelId = boundedText(modelId, 'Exact model ID', { required: true, max: 240 });
    return deepFreeze(modelView(this._load(), exactModelId));
  }

  getModel(modelId) {
    return this.model(modelId);
  }

  modelStatus(modelId) {
    return this.model(modelId).status;
  }

  listConfigurations({ modelId = '' } = {}) {
    return this.snapshot().configurations.filter(entry => !modelId || entry.identity.modelId === modelId);
  }

  listModels() {
    return this.snapshot().models;
  }

  costPreview(configuration) {
    return empiricalModelFitCostPreview(this, configuration);
  }

  matrix(options = {}) {
    return createModelFitMatrixExport(this, options);
  }

  matrixText(options = {}) {
    return modelFitMatrixText(this, options);
  }

  snapshot() {
    const document = this._load();
    const modelIds = new Set(document.configurations.map(entry => entry.identity.modelId));
    document.modelIncompatibilities.forEach(entry => modelIds.add(entry.modelId));
    return deepFreeze({
      schema: MODEL_FIT_EVIDENCE_SCHEMA,
      revision: document.revision,
      updatedAt: document.updatedAt,
      limits: { ...this.limits },
      configurations: document.configurations.map(configurationView),
      models: [...modelIds].sort().map(modelId => modelView(document, modelId)),
      modelIncompatibilities: clone(document.modelIncompatibilities),
      recentEvidence: clone(document.recentEvidence),
    });
  }
}

export function createModelFitEvidenceStore(storageOrOptions = {}, options = {}) {
  return new ModelFitEvidenceStore(storageOrOptions, options);
}

function evidenceSnapshot(source) {
  if (source?.snapshot && typeof source.snapshot === 'function') return source.snapshot();
  if (source?.schema === MODEL_FIT_EVIDENCE_SCHEMA && Array.isArray(source.configurations)) return source;
  return {
    schema: MODEL_FIT_EVIDENCE_SCHEMA,
    revision: 0,
    updatedAt: null,
    configurations: [],
    models: [],
    recentEvidence: [],
  };
}

function formatUsd(value) {
  const amount = finiteNumber(value);
  if (amount == null) return '';
  if (amount >= 0.01 || amount === 0) return amount.toFixed(2);
  if (amount >= 0.001) return amount.toFixed(4);
  return amount.toFixed(6);
}

export function empiricalModelFitCostPreview(source, configuration) {
  const snapshot = evidenceSnapshot(source);
  const key = modelFitConfigurationKey(configuration);
  const entry = snapshot.configurations.find(candidate => candidate.configurationKey === key || candidate.key === key);
  const metric = entry?.aggregate?.exactBilledCostUsd;
  const samples = (Array.isArray(metric?.samples) ? metric.samples : [])
    .map(sample => ({
      value: finiteNumber(sample?.value),
      at: timestamp(sample?.at, 0),
      observationId: String(sample?.observationId || ''),
    }))
    .filter(sample => sample.value != null);
  const values = samples.map(sample => sample.value);
  const middle = median(values);
  const latest = [...samples].sort((a, b) => b.at - a.at || b.observationId.localeCompare(a.observationId))[0]?.value ?? null;
  const dev = {
    count: values.length,
    min: values.length ? Math.min(...values) : null,
    median: middle,
    max: values.length ? Math.max(...values) : null,
    minUsd: values.length ? Math.min(...values) : null,
    medianUsd: middle,
    maxUsd: values.length ? Math.max(...values) : null,
    lastUsd: latest,
    lifetimeCount: finiteNumber(metric?.count, { integer: true }) || values.length,
  };
  if (!values.length) {
    return deepFreeze({ kind: 'none', label: 'No estimate yet', text: 'No estimate yet', estimateUsd: null, dev });
  }
  if (values.length === 1) {
    const label = `Last ~$${formatUsd(latest)}`;
    return deepFreeze({ kind: 'last', label, text: label, estimateUsd: latest, dev });
  }
  const label = `Usually ~$${formatUsd(middle)}`;
  return deepFreeze({ kind: 'usually', label, text: label, estimateUsd: middle, dev });
}

export const empiricalCostPreview = empiricalModelFitCostPreview;
export const createEmpiricalCostPreview = empiricalModelFitCostPreview;

function isSensitiveMatrixKey(key) {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === 'authorization' || normalized === 'authentication' || normalized === 'auth' || normalized === 'key') return true;
  if (normalized !== 'configurationkey' && normalized.endsWith('key')) return true;
  if (/credential|apikey|privatekey|secret|password|passwd|pkce|cookie/.test(normalized)) return true;
  if (/oauth|authcode|authtoken/.test(normalized)) return true;
  if (/accesstoken|refreshtoken|bearertoken|sessiontoken|idtoken/.test(normalized)) return true;
  if (/waveform|spectrum|rawaudio|audiosamples|audioframe|audiodata/.test(normalized)) return true;
  if (/song|nowplaying|trackname|tracktitle|artistname|albumname/.test(normalized)) return true;
  if (/rawoutput|rawresponse|rawbody|assistanttext|generatedhtml|^html$/.test(normalized)) return true;
  return false;
}

export function sanitizeModelFitMatrixValue(value, { maxDepth = 20, maxNodes = 20000 } = {}) {
  const ancestors = new WeakSet();
  let nodes = 0;
  function visit(current, depth) {
    nodes += 1;
    if (nodes > maxNodes) return '[truncated]';
    if (typeof current === 'string') return redactSecretText(current).slice(0, 500);
    if (typeof current === 'number') return Number.isFinite(current) ? current : null;
    if (typeof current === 'boolean' || current === null) return current;
    if (current === undefined || typeof current === 'function' || typeof current === 'symbol') return undefined;
    if (depth >= maxDepth) return '[truncated]';
    if (ancestors.has(current)) return '[circular]';
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        return current.slice(0, 1000).map(item => visit(item, depth + 1)).map(item => item === undefined ? null : item);
      }
      const output = {};
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
        if (
          !descriptor.enumerable
          || !Object.hasOwn(descriptor, 'value')
          || ['__proto__', 'prototype', 'constructor'].includes(key)
          || isSensitiveMatrixKey(key)
        ) continue;
        const nested = visit(descriptor.value, depth + 1);
        if (nested !== undefined) output[key] = nested;
      }
      return output;
    } finally {
      ancestors.delete(current);
    }
  }
  return visit(value, 0);
}

function summaryMetric(metric) {
  if (!metric) return metricView(emptyMetric());
  return {
    count: finiteNumber(metric.count, { integer: true }) || 0,
    total: finiteNumber(metric.total) || 0,
    min: finiteNumber(metric.min),
    median: finiteNumber(metric.median),
    max: finiteNumber(metric.max),
    last: finiteNumber(metric.last),
    lastAt: timestamp(metric.lastAt),
    sampleCount: finiteNumber(metric.sampleCount, { integer: true }) || 0,
  };
}

function exportedObservation(observation) {
  return {
    observationId: observation.observationId,
    attemptedAt: observation.attemptedAt,
    succeededAt: observation.succeededAt,
    resultCategory: observation.resultCategory,
    failureCategory: observation.failureCategory,
    providerAttemptCount: observation.providerAttemptCount,
    readySuccess: observation.readySuccess,
    liveOpenSuccess: observation.liveOpenSuccess,
    repairCount: observation.repairCount,
    providerDurationsMs: observation.providerDurationsMs,
    usage: observation.usage,
    artifactBytes: observation.artifactBytes,
    exactBilledCostUsd: observation.exactBilledCostUsd,
  };
}

function exportedConfiguration(entry) {
  const aggregate = entry.aggregate;
  return {
    configurationKey: entry.configurationKey || entry.key,
    identity: entry.identity,
    configurationStatus: entry.status,
    knownIncompatible: entry.knownIncompatible,
    counts: {
      observations: aggregate.observationCount,
      providerAttempts: aggregate.providerAttemptCount,
      readySuccesses: aggregate.readySuccessCount,
      liveOpenSuccesses: aggregate.liveOpenSuccessCount,
      failures: aggregate.failureCount,
      repairs: aggregate.repairCount,
    },
    resultCategories: aggregate.resultCategories,
    failureCategories: aggregate.failureCategories,
    lastAttemptAt: aggregate.lastAttemptAt,
    lastSuccessAt: aggregate.lastSuccessAt,
    latencyMs: summaryMetric(aggregate.providerDurationMs),
    tokens: {
      prompt: summaryMetric(aggregate.usage.promptTokens),
      completion: summaryMetric(aggregate.usage.completionTokens),
      reasoning: summaryMetric(aggregate.usage.reasoningTokens),
      total: summaryMetric(aggregate.usage.totalTokens),
    },
    reasoning: {
      choice: entry.identity.reasoningChoice,
      tokenUsage: summaryMetric(aggregate.usage.reasoningTokens),
    },
    artifactBytes: summaryMetric(aggregate.artifactBytes),
    exactBilledCostUsd: summaryMetric(aggregate.exactBilledCostUsd),
    recentEvidence: (entry.recentEvidence || []).map(exportedObservation),
  };
}

function versionSummary(configurations, current = {}) {
  const identities = configurations.map(entry => entry.identity);
  const unique = selector => [...new Set(identities.map(selector).filter(value => value !== '' && value != null))].sort();
  const promptProfiles = new Map();
  identities.forEach(identity => promptProfiles.set(
    `${identity.promptProfileId}\u0000${identity.promptHash}`,
    { id: identity.promptProfileId, hash: identity.promptHash },
  ));
  const currentVersions = current && typeof current === 'object' ? {
    promptProfileId: boundedText(current.promptProfileId, 'Prompt profile ID', { max: 160 }) || null,
    promptVersion: boundedText(current.promptVersion, 'Prompt version', { max: 160 }) || null,
    promptHash: boundedText(current.promptHash, 'Prompt hash', { max: 160 }) || null,
    generationEnvelopeMajorVersion: current.generationEnvelopeMajorVersion == null
      ? null
      : envelopeMajorVersion(current.generationEnvelopeMajorVersion),
    audioApiVersion: boundedText(current.audioApiVersion, 'Audio API version', { max: 160 }) || null,
    reliabilityVersion: boundedText(current.reliabilityVersion, 'Reliability version', { max: 160 }) || null,
    runtimeVersion: boundedText(current.runtimeVersion, 'Runtime version', { max: 160 }) || null,
  } : null;
  return {
    evidenceSchema: MODEL_FIT_EVIDENCE_SCHEMA,
    matrixSchema: MODEL_FIT_MATRIX_SCHEMA,
    promptProfiles: [...promptProfiles.values()].sort((a, b) => a.id.localeCompare(b.id) || a.hash.localeCompare(b.hash)),
    promptVersions: unique(identity => identity.promptVersion),
    generationEnvelopeMajorVersions: unique(identity => identity.generationEnvelopeMajorVersion),
    audioApiVersions: unique(identity => identity.audioApiVersion),
    reliabilityVersions: unique(identity => identity.reliabilityVersion),
    runtimeVersions: unique(identity => identity.runtimeVersion),
    current: currentVersions,
  };
}

export function createModelFitMatrixExport(source, {
  capturedAt = Date.now(),
  currentVersions = null,
  catalogUpdatedAt = null,
} = {}) {
  const snapshot = evidenceSnapshot(source);
  const configurations = [...snapshot.configurations]
    .sort((a, b) => (a.configurationKey || a.key).localeCompare(b.configurationKey || b.key));
  const models = [...(snapshot.models || [])]
    .sort((a, b) => a.modelId.localeCompare(b.modelId))
    .map(model => ({
      modelId: model.modelId,
      modelStatus: model.status,
      knownIncompatible: model.knownIncompatible,
      configurationCount: model.configurationCount,
      providerAttemptCount: model.providerAttemptCount,
      readySuccessCount: model.readySuccessCount,
      liveOpenSuccessCount: model.liveOpenSuccessCount,
      failureCount: model.failureCount,
      failureCategories: model.failureCategories,
      repairCount: model.repairCount,
      lastAttemptAt: model.lastAttemptAt,
      lastSuccessAt: model.lastSuccessAt,
      configurationStatuses: model.configurationStatuses,
    }));
  const totals = models.reduce((result, model) => ({
    models: result.models + 1,
    configurations: result.configurations + model.configurationCount,
    providerAttempts: result.providerAttempts + model.providerAttemptCount,
    readySuccesses: result.readySuccesses + model.readySuccessCount,
    liveOpenSuccesses: result.liveOpenSuccesses + model.liveOpenSuccessCount,
    failures: result.failures + model.failureCount,
    repairs: result.repairs + model.repairCount,
  }), { models: 0, configurations: 0, providerAttempts: 0, readySuccesses: 0, liveOpenSuccesses: 0, failures: 0, repairs: 0 });
  const at = timestamp(capturedAt, Date.now());
  const bundle = {
    schema: MODEL_FIT_MATRIX_SCHEMA,
    evidenceSchema: MODEL_FIT_EVIDENCE_SCHEMA,
    purpose: 'Sanitized local model-configuration evidence for operator analysis.',
    capturedAt: at,
    capturedAtIso: new Date(at).toISOString(),
    catalogUpdatedAt: timestamp(catalogUpdatedAt),
    versions: versionSummary(configurations, currentVersions || {}),
    statusSemantics: {
      UNTESTED: 'No compatible provider attempts.',
      TESTED: 'Compatible provider attempts exist without a qualifying Ready or LIVE/Open success.',
      PROVEN: 'At least one compatible Ready or LIVE/Open success.',
      KNOWN_INCOMPATIBLE: 'An explicit deterministic incompatibility mark; never inferred from an ordinary failure.',
    },
    totals,
    models,
    configurations: configurations.map(exportedConfiguration),
  };
  return deepFreeze(sanitizeModelFitMatrixValue(bundle));
}

export const createModelTestMatrixExport = createModelFitMatrixExport;

export function modelFitMatrixText(sourceOrBundle, options = {}) {
  const bundle = sourceOrBundle?.schema === MODEL_FIT_MATRIX_SCHEMA
    ? sanitizeModelFitMatrixValue(sourceOrBundle)
    : createModelFitMatrixExport(sourceOrBundle, options);
  return `${MATRIX_PREFIX}${JSON.stringify(bundle, null, 2)}\n${MATRIX_SUFFIX}`;
}

export const modelTestMatrixText = modelFitMatrixText;

export async function copyModelFitMatrix(source, options = {}) {
  const bundle = createModelFitMatrixExport(source, options);
  const text = modelFitMatrixText(bundle);
  const clipboard = options.clipboard || globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
  await clipboard.writeText(text);
  return deepFreeze({ bundle, text, characters: text.length });
}

export const copyModelTestMatrix = copyModelFitMatrix;

function utf8Bytes(value) {
  const text = String(value ?? '');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
  return encodeURIComponent(text).replace(/%[0-9A-F]{2}|./gi, 'x').length;
}

function traceFailureCategory(trace, finalAttempt, html) {
  const code = firstDefined(trace.resultCategory, trace.failureCategory, trace.failureCode, finalAttempt?.response?.error?.code);
  if (code) {
    const normalized = normalizeModelFitResultCategory(code);
    if (normalized !== MODEL_FIT_RESULT_CATEGORIES.OTHER_FAILURE || categoryCode(code) === 'OTHER_FAILURE') return normalized;
  }
  const finishReason = categoryCode(firstDefined(
    finalAttempt?.response?.finishReason,
    finalAttempt?.response?.payload?.choices?.[0]?.finish_reason,
    finalAttempt?.response?.payload?.choices?.[0]?.native_finish_reason,
  ));
  if (finishReason === 'LENGTH' || finishReason === 'MAX_TOKENS') {
    return html
      ? MODEL_FIT_RESULT_CATEGORIES.PARTIAL_ARTIFACT_TRUNCATED
      : MODEL_FIT_RESULT_CATEGORIES.OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT;
  }
  if (trace.status === 'cancelled' || trace.outcome === 'cancelled') return MODEL_FIT_RESULT_CATEGORIES.USER_CANCELLED;
  if (finalAttempt?.response?.status >= 400) return MODEL_FIT_RESULT_CATEGORIES.PROVIDER_ERROR;
  if (!html && finalAttempt?.response?.status >= 200 && finalAttempt?.response?.status < 300) {
    return MODEL_FIT_RESULT_CATEGORIES.EMPTY_PROVIDER_CONTENT;
  }
  return MODEL_FIT_RESULT_CATEGORIES.OTHER_FAILURE;
}

export function modelFitObservationFromDreamTrace(trace, configuration, result = {}) {
  if (!trace || typeof trace !== 'object' || !Array.isArray(trace.attempts)) {
    throw new TypeError('A finalized Dream Trace is required.');
  }
  if (trace.state === 'open' || trace.attempts.some(attempt => attempt?.state === 'open')) {
    throw new TypeError('Only a finalized Dream Trace can become model-fit evidence.');
  }
  const identity = createModelFitConfigurationIdentity(configuration);
  const traceModelId = boundedText(firstDefined(trace.modelId, trace.selectedModel?.id), 'Dream Trace model ID', { required: true, max: 240 });
  if (traceModelId !== identity.modelId) throw new TypeError('Dream Trace model ID does not match the configuration identity.');
  const dispatchedAttempts = trace.attempts.filter(attempt => attempt?.request?.dispatched === true);
  const providerAttemptCount = finiteNumber(trace.providerRequestCount, { integer: true, max: 8 }) ?? dispatchedAttempts.length;
  const finalAttempt = [...trace.attempts].reverse().find(attempt => (
    attempt?.response?.usage
    || attempt?.response?.status != null
    || attempt?.response?.extractedHtml
    || attempt?.response?.error
  )) || trace.attempts.at(-1) || null;
  const html = String(firstDefined(finalAttempt?.response?.extractedHtml, trace.html, '') || '');
  const traceStatus = String(firstDefined(trace.outcome, trace.status, '')).toLowerCase();
  const readySuccess = result.readySuccess === true || result.ready === true || traceStatus === 'ready';
  const finalLive = trace.finalLiveIdentity?.live || trace.finalLiveIdentity;
  const liveIdentityMatches = finalLive?.modelId === identity.modelId
    && (!trace.finalGenerationId || !finalLive?.generationId || finalLive.generationId === trace.finalGenerationId);
  const liveSuccess = result.liveSuccess === true || result.live === true || (traceStatus === 'succeeded' && liveIdentityMatches);
  const openSuccess = result.openSuccess === true || result.opened === true || liveSuccess && providerAttemptCount === 0;
  const resultCategory = readySuccess
    ? MODEL_FIT_RESULT_CATEGORIES.READY
    : liveSuccess || openSuccess
      ? MODEL_FIT_RESULT_CATEGORIES.LIVE_OPEN
      : traceFailureCategory(trace, finalAttempt, html);
  const reportedCostComplete = trace.reportedCostComplete === true;
  const exactBilledCostUsd = reportedCostComplete
    ? finiteNumber(firstDefined(trace.exactReportedCost, trace.totalReportedCost))
    : null;
  const observation = createModelFitObservation({
    observationId: firstDefined(result.observationId, result.id, trace.id, trace.traceId),
    configuration: identity,
    attemptedAt: firstDefined(result.attemptedAt, trace.finishedAt, trace.updatedAt, trace.createdAt),
    succeededAt: readySuccess || liveSuccess || openSuccess
      ? firstDefined(result.succeededAt, trace.finishedAt, trace.updatedAt)
      : null,
    resultCategory,
    providerAttemptCount,
    readySuccess,
    liveSuccess,
    openSuccess,
    repairCount: trace.attempts.filter(attempt => attempt?.kind === 'repair' && attempt?.request?.dispatched === true).length,
    providerDurationsMs: dispatchedAttempts.map(attempt => {
      const direct = finiteNumber(attempt?.timing?.providerDurationMs);
      if (direct != null) return direct;
      const start = timestamp(attempt?.timing?.requestDispatchedAt);
      const end = timestamp(attempt?.timing?.responseBodyCompleteAt);
      return start != null && end != null && end >= start ? end - start : null;
    }).filter(value => value != null),
    usage: sumUsage(dispatchedAttempts),
    artifactBytes: html ? utf8Bytes(html) : 0,
    exactBilledCostUsd,
  });
  return deepFreeze(observation);
}

export const observationFromFinalizedDreamTrace = modelFitObservationFromDreamTrace;
export const observationFromDreamTrace = modelFitObservationFromDreamTrace;
