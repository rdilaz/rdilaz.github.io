export const GENERATION_FAILURE_VERSION = 'visualizer-generation-failure-v1';

export const GENERATION_FAILURE_CATEGORIES = Object.freeze({
  OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT: 'OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT',
  PARTIAL_OUTPUT_TRUNCATED: 'PARTIAL_OUTPUT_TRUNCATED',
  EMPTY_PROVIDER_CONTENT: 'EMPTY_PROVIDER_CONTENT',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_EXPLICIT_ERROR: 'PROVIDER_EXPLICIT_ERROR',
  INVALID_HTML: 'INVALID_HTML',
  RENDERER_RUNTIME_FAILURE: 'RENDERER_RUNTIME_FAILURE',
  CANCELLED: 'CANCELLED',
});

export const GENERATION_FAILURE_COPY = Object.freeze({
  [GENERATION_FAILURE_CATEGORIES.OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT]: 'This model ran out of generation room before it finished the visual. Your current Dream is still here.',
  [GENERATION_FAILURE_CATEGORIES.PARTIAL_OUTPUT_TRUNCATED]: 'This model\'s visual was cut off before it finished. Your current Dream is still here.',
  [GENERATION_FAILURE_CATEGORIES.EMPTY_PROVIDER_CONTENT]: 'This model returned no visualizer code. Your current Dream is still here.',
  [GENERATION_FAILURE_CATEGORIES.PROVIDER_TIMEOUT]: 'This model timed out before it finished the visual. Your current Dream is still here.',
  [GENERATION_FAILURE_CATEGORIES.PROVIDER_EXPLICIT_ERROR]: 'AI service unavailable. Your current Dream is still here.',
  [GENERATION_FAILURE_CATEGORIES.INVALID_HTML]: 'This model returned a visual that could not be safely opened. Your current Dream is still here.',
  [GENERATION_FAILURE_CATEGORIES.RENDERER_RUNTIME_FAILURE]: 'The new visual could not run reliably. Your current Dream is still here.',
  [GENERATION_FAILURE_CATEGORIES.CANCELLED]: 'Dream cancelled. Your current Dream is still here.',
});

const hasOwn = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);

function firstPresent(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
}

function isLengthFinish(value) {
  const normalized = String(value || '').trim().toLowerCase().replaceAll('-', '_');
  return ['length', 'max_tokens', 'max_output_tokens', 'token_limit'].includes(normalized);
}

function stageMatches(value, pattern) {
  return pattern.test(String(value || ''));
}

/** Classifies only evidence-backed failures; a successful/unknown record returns null. */
export function classifyGenerationFailure(evidence = {}) {
  const response = evidence.response || {};
  const payload = evidence.payload || evidence.parsedPayload || response.payload || response.parsedPayload || {};
  const choice = payload?.choices?.[0] || evidence.choice || response.choice || {};
  const message = choice?.message || payload?.message || evidence.message || response.message || {};
  const error = evidence.error || response.error || null;
  const providerError = payload?.error || choice?.error || message?.error || null;
  const providerErrorType = String(
    providerError?.metadata?.error_type
      || providerError?.error_type
      || providerError?.type
      || providerError?.code
      || '',
  );
  const status = finiteNumber(evidence.httpStatus, evidence.status, response.status);
  const httpSuccess = evidence.httpSuccess === true
    || evidence.providerCompleted === true
    || response.ok === true
    || (status !== null && status >= 200 && status < 300);
  const timeout = evidence.timeout === true
    || evidence.timedOut === true
    || [408, 504, 524].includes(status)
    || /^(408|504|524)$/.test(providerErrorType)
    || /timeout|timed_out/i.test(providerErrorType)
    || /^(TimeoutError|ETIMEDOUT)$/i.test(String(error?.name || error?.code || ''))
    || /^(DREAM_IDLE_TIMEOUT|DREAM_HARD_TIMEOUT)$/i.test(String(error?.code || ''))
    || /timed?\s*out/i.test(String(error?.message || ''));
  const cancelled = evidence.cancelled === true
    || evidence.canceled === true
    || evidence.userCancelled === true
    || evidence.userCanceled === true
    || (!timeout && /^(AbortError|ERR_CANCELED|ERR_CANCELLED)$/i.test(String(error?.name || error?.code || '')));

  if (cancelled) return GENERATION_FAILURE_CATEGORIES.CANCELLED;
  if (timeout) return GENERATION_FAILURE_CATEGORIES.PROVIDER_TIMEOUT;

  const providerExplicitError = evidence.providerExplicitError === true
    || (status !== null && (status < 200 || status >= 300))
    || providerError != null
    || ['error', 'content_filter'].includes(String(choice?.finish_reason || '').toLowerCase())
    || (error != null && stageMatches(evidence.stage || error.stage, /provider|transport|request/i));
  if (providerExplicitError) return GENERATION_FAILURE_CATEGORIES.PROVIDER_EXPLICIT_ERROR;

  const finishReason = firstPresent(
    evidence.finishReason,
    evidence.finish_reason,
    response.finishReason,
    response.finish_reason,
    choice?.finish_reason,
  );
  const nativeFinishReason = firstPresent(
    evidence.nativeFinishReason,
    evidence.native_finish_reason,
    response.nativeFinishReason,
    response.native_finish_reason,
    choice?.native_finish_reason,
    payload?.native_finish_reason,
  );
  const lengthExhausted = isLengthFinish(finishReason) || isLengthFinish(nativeFinishReason);
  const assistantText = firstPresent(
    evidence.assistantText,
    evidence.rawOutput,
    response.assistantText,
    response.rawOutput,
    textFromContent(message?.content),
  );
  const extractedHtml = firstPresent(
    evidence.extractedHtml,
    evidence.html,
    response.extractedHtml,
    response.html,
    evidence.artifact?.html,
  );
  const hasAssistantOutput = String(assistantText || '').trim().length > 0;
  const hasHtml = String(extractedHtml || '').trim().length > 0;

  if (httpSuccess && lengthExhausted) {
    return hasAssistantOutput || hasHtml
      ? GENERATION_FAILURE_CATEGORIES.PARTIAL_OUTPUT_TRUNCATED
      : GENERATION_FAILURE_CATEGORIES.OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT;
  }

  const contentWasReported = hasOwn(evidence, 'assistantText')
    || hasOwn(evidence, 'rawOutput')
    || hasOwn(response, 'assistantText')
    || hasOwn(response, 'rawOutput')
    || hasOwn(message, 'content');
  if (httpSuccess && contentWasReported && !hasAssistantOutput && !hasHtml) {
    return GENERATION_FAILURE_CATEGORIES.EMPTY_PROVIDER_CONTENT;
  }

  const staticValidation = evidence.staticValidation
    || evidence.validation
    || evidence.artifact?.staticValidation
    || response.staticValidation;
  const invalidHtml = evidence.invalidHtml === true
    || evidence.staticValidationFailed === true
    || staticValidation?.passed === false
    || stageMatches(evidence.stage, /static[-_ ]?validation|invalid[-_ ]?html/i);
  if (invalidHtml) return GENERATION_FAILURE_CATEGORIES.INVALID_HTML;

  const reliability = evidence.reliability || evidence.artifact?.reliability || response.reliability;
  const runtimeFailure = evidence.rendererRuntimeFailure === true
    || evidence.runtimeFailure === true
    || reliability?.passed === false
    || stageMatches(evidence.stage, /renderer|runtime|reliability|watchdog/i);
  if (runtimeFailure) return GENERATION_FAILURE_CATEGORIES.RENDERER_RUNTIME_FAILURE;

  return null;
}

export function generationFailureCopy(category) {
  return GENERATION_FAILURE_COPY[category] || '';
}
