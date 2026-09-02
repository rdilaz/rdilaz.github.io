import './debug-bundle.js';
import { createDreamTrace, sanitizeTraceValue } from './dream-trace.js';

export const DIAGNOSTIC_SCHEMA = 'dream-diagnostic-v1';

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

export function createDiagnosticRecord({
  model,
  providerId = 'openrouter',
  kind = 'generation',
  liveSnapshot = null,
  nextSnapshot = null,
} = {}) {
  const timestamp = Date.now();
  const id = crypto.randomUUID();
  const trace = createDreamTrace({
    id,
    diagnosticId: id,
    selectedModel: {
      id: model?.id || 'unknown/model',
      name: model?.name || model?.id || 'Unknown model',
      providerId,
      upstreamProvider: model?.provider || '',
    },
    liveAtStart: liveSnapshot,
    nextAtStart: nextSnapshot,
    startedAt: timestamp,
  });
  return {
    schema: DIAGNOSTIC_SCHEMA,
    id,
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
    truncations: [],
    trace,
    timeline: [],
    environment: environment(),
  };
}

export function addDiagnosticTimeline(record, stage, detail = {}) {
  const at = Date.now();
  record.timeline.push({ stage, at, elapsedMs: at - record.createdAt, ...sanitizeTraceValue(detail) });
  record.updatedAt = at;
  return record;
}

export function applyProviderResult(record, result, { repaired = false } = {}) {
  record.resolvedModel = result?.resolvedModel || record.resolvedModel || record.modelId;
  record.requestId = result?.requestId || record.requestId || '';
  record.usage = result?.usage || record.usage || null;
  record.outputBytes = new TextEncoder().encode(String(result?.html || '')).byteLength;
  const retain = (field, value) => {
    const text = String(sanitizeTraceValue(String(value || '')) || '');
    const retained = text.slice(0, 350000);
    record[field] = retained;
    record.truncations = (record.truncations || []).filter(item => item.field !== field);
    if (retained.length !== text.length) {
      record.truncations.push({
        field,
        originalCharacters: text.length,
        retainedCharacters: retained.length,
      });
    }
  };
  retain('rawOutput', result?.raw);
  retain('html', result?.html);
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
  record.failureMessage = String(sanitizeTraceValue(failureMessage || '') || '');
  record.generationId = generationId || record.generationId || '';
  record.finishedAt = Date.now();
  record.updatedAt = record.finishedAt;
  addDiagnosticTimeline(record, `finished:${record.status}`, {
    failureCode: record.failureCode,
  });
  return record;
}

export function diagnosticForExport(record, { includeHtml = true } = {}) {
  const copy = structuredClone(record);
  if (!includeHtml) {
    delete copy.html;
    delete copy.rawOutput;
  }
  return sanitizeTraceValue(copy);
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
  if (record.status === 'ready') return 'Ready to open';
  if (record.status === 'succeeded') return 'Healthy';
  if (record.status === 'rolled-back') return 'Rolled back';
  if (record.status === 'failed') return 'Failed safely';
  if (record.status === 'cancelled') return 'Cancelled';
  return record.status || 'Unknown';
}
