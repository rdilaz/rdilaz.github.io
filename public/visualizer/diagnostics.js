export const DIAGNOSTIC_SCHEMA = 'dream-diagnostic-v1';

const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'authorization',
  'credential',
  'credentials',
  'token',
  'access_token',
  'refresh_token',
  'waveform',
  'spectrum',
  'audio',
]);

function environment() {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.userAgentData?.platform || navigator.platform || '',
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemory: navigator.deviceMemory || null,
    webgpu: Boolean(navigator.gpu),
    crossOriginIsolated: Boolean(crossOriginIsolated),
    viewport: {
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio || 1,
    },
  };
}

export function createDiagnosticRecord({ model, providerId = 'openrouter', kind = 'generation' } = {}) {
  const timestamp = Date.now();
  return {
    schema: DIAGNOSTIC_SCHEMA,
    id: crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    kind,
    status: 'started',
    failureCode: '',
    failureMessage: '',
    modelId: model?.id || '',
    modelName: model?.name || model?.id || 'Unknown model',
    providerId,
    upstreamProvider: model?.provider || '',
    resolvedModel: '',
    requestId: '',
    promptVersion: '',
    audioApiVersion: '',
    usage: null,
    outputBytes: 0,
    rawOutput: '',
    html: '',
    repairUsed: false,
    repairProblem: '',
    staticValidation: [],
    reliability: null,
    repairReliability: null,
    promotionWatchdog: null,
    attempts: [],
    rollback: null,
    generationId: '',
    timeline: [],
    environment: environment(),
  };
}

export function addDiagnosticTimeline(record, stage, detail = {}) {
  const at = Date.now();
  record.timeline.push({ stage, at, elapsedMs: at - record.createdAt, ...structuredClone(detail) });
  record.updatedAt = at;
  return record;
}

export function applyProviderResult(record, result, { repaired = false } = {}) {
  record.resolvedModel = result?.resolvedModel || record.resolvedModel || record.modelId;
  record.requestId = result?.requestId || record.requestId || '';
  record.usage = result?.usage || record.usage || null;
  record.outputBytes = new TextEncoder().encode(String(result?.html || '')).byteLength;
  record.rawOutput = String(result?.raw || '').slice(0, 350000);
  record.html = String(result?.html || '').slice(0, 350000);
  if (repaired) record.repairUsed = true;
  record.updatedAt = Date.now();
  return record;
}

export function finishDiagnostic(record, {
  status,
  failureCode = '',
  failureMessage = '',
  generationId = '',
} = {}) {
  record.status = status || record.status;
  record.failureCode = failureCode || '';
  record.failureMessage = failureMessage || '';
  record.generationId = generationId || record.generationId || '';
  record.finishedAt = Date.now();
  record.updatedAt = record.finishedAt;
  addDiagnosticTimeline(record, `finished:${record.status}`, {
    failureCode: record.failureCode,
  });
  return record;
}

function sanitizeValue(value, seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, seen));
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      if (key === 'audioApiVersion') output[key] = nested;
      else output[key] = '[redacted]';
      continue;
    }
    output[key] = sanitizeValue(nested, seen);
  }
  return output;
}

export function diagnosticForExport(record, { includeHtml = true } = {}) {
  const copy = structuredClone(record);
  if (!includeHtml) {
    delete copy.html;
    delete copy.rawOutput;
  }
  return sanitizeValue(copy);
}

export function diagnosticsForExport(records, options = {}) {
  return {
    schema: 'dream-diagnostic-export-v1',
    exportedAt: new Date().toISOString(),
    records: records.map(record => diagnosticForExport(record, options)),
  };
}

export async function copyText(text) {
  const value = String(text || '');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

export function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function shortDiagnosticId(id) {
  return String(id || '').split('-')[0] || 'unknown';
}

export function diagnosticStatusLabel(record) {
  if (record.status === 'succeeded') return 'Healthy';
  if (record.status === 'rolled-back') return 'Rolled back';
  if (record.status === 'failed') return 'Failed safely';
  if (record.status === 'cancelled') return 'Cancelled';
  return record.status || 'Unknown';
}
