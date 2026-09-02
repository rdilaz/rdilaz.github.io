export const MODEL_ELIGIBILITY_VERSION = 'visualizer-model-eligibility-v1';
export const MIN_LIVE_DREAM_OUTPUT_TOKENS = 2200;

function expirationTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const parsed = Date.parse(dateOnly ? `${text}T23:59:59.999Z` : text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function liveDreamEligibility(model, now = Date.now()) {
  const id = String(model?.id || '').trim();
  if (!id) return { eligible: false, reason: 'MISSING_ID' };

  // OpenRouter's general catalog intentionally includes asynchronous Batch API
  // variants. Those cannot serve the Visualizer's interactive /chat/completions
  // request path and must never enter any live Dream picker.
  if (/:batch$/i.test(id) || /\(batch\)\s*$/i.test(String(model?.name || ''))) {
    return { eligible: false, reason: 'BATCH_ONLY' };
  }

  const expiresAt = expirationTimestamp(model?.expiration_date);
  if (expiresAt !== null && expiresAt < Number(now || Date.now())) {
    return { eligible: false, reason: 'EXPIRED', expiresAt };
  }

  const outputModalities = Array.isArray(model?.architecture?.output_modalities)
    ? model.architecture.output_modalities.map(value => String(value).toLowerCase())
    : [];
  if (outputModalities.length && !outputModalities.includes('text')) {
    return { eligible: false, reason: 'NO_TEXT_OUTPUT' };
  }

  const maxOutput = Number(model?.top_provider?.max_completion_tokens || 0);
  if (Number.isFinite(maxOutput) && maxOutput > 0 && maxOutput < MIN_LIVE_DREAM_OUTPUT_TOKENS) {
    return { eligible: false, reason: 'OUTPUT_TOO_SMALL', maxOutput };
  }

  const supportedParameters = Array.isArray(model?.supported_parameters)
    ? model.supported_parameters.map(value => String(value).toLowerCase())
    : [];
  if (
    supportedParameters.length
    && !supportedParameters.includes('max_tokens')
    && !supportedParameters.includes('max_completion_tokens')
  ) {
    return { eligible: false, reason: 'OUTPUT_LIMIT_UNENFORCEABLE' };
  }

  return { eligible: true, reason: 'LIVE_DREAM_COMPATIBLE', expiresAt };
}

export function isLiveDreamModel(model, now = Date.now()) {
  return liveDreamEligibility(model, now).eligible;
}

export function filterLiveDreamModels(models, now = Date.now()) {
  return (Array.isArray(models) ? models : []).filter(model => isLiveDreamModel(model, now));
}
