import { sanitizeTraceValue } from './dream-trace.js';

export const DEBUG_BUNDLE_SCHEMA = 'visualizer-debug-bundle-v1';

const BUNDLE_PREFIX = '=== AI VISUALIZER DEBUG BUNDLE v1 ===\nPaste this entire block into ChatGPT.\n';

function recordTimestamp(record) {
  return Number(record?.createdAt || record?.updatedAt || 0);
}

function recordSummary(record) {
  if (!record) return null;
  return {
    id: record.id || '',
    kind: record.kind || '',
    status: record.status || '',
    failureCode: record.failureCode || '',
    failureMessage: record.failureMessage || '',
    modelId: record.modelId || '',
    modelName: record.modelName || '',
    resolvedModel: record.resolvedModel || '',
    requestId: record.requestId || '',
    generationId: record.generationId || '',
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    finishedAt: record.finishedAt || null,
    repairUsed: Boolean(record.repairUsed),
    outputBytes: Number(record.outputBytes || 0),
  };
}

function latestGeneration(records) {
  return records.find(record => record?.kind === 'generation') || records[0] || null;
}

function relatedAfterPrimary(records, primary) {
  if (!primary) return [];
  const start = recordTimestamp(primary);
  const end = start + 10 * 60 * 1000;
  return records.filter(record => {
    if (!record || record.id === primary.id) return false;
    const timestamp = recordTimestamp(record);
    if (timestamp < start || timestamp > end) return false;
    return ['automatic-recovery', 'library-reopen', 'manual-retest'].includes(record.kind)
      || (primary.generationId && record.generationId === primary.generationId)
      || (primary.trace?.id && record.trace?.id === primary.trace.id);
  }).slice(0, 4);
}

export function createDebugBundle({
  identity = null,
  runtime = null,
  diagnosticExport = null,
  page = null,
  capturedAt = Date.now(),
} = {}) {
  const records = Array.isArray(diagnosticExport?.records) ? diagnosticExport.records : [];
  const primaryDream = latestGeneration(records);
  const latestRecord = records[0] || null;
  const related = relatedAfterPrimary(records, primaryDream);

  const bundle = {
    schema: DEBUG_BUNDLE_SCHEMA,
    purpose: 'One-click evidence bundle for remote Visualizer debugging.',
    capturedAt,
    capturedAtIso: new Date(capturedAt).toISOString(),
    page: page || null,
    identity,
    runtime,
    primaryDream,
    latestRecordWhenDifferent: latestRecord && latestRecord.id !== primaryDream?.id ? latestRecord : null,
    relatedRecords: related,
    recentRecordSummaries: records.slice(0, 8).map(recordSummary),
    interpretationHint: primaryDream
      ? `Primary Dream: ${primaryDream.modelName || primaryDream.modelId || 'unknown model'} · ${primaryDream.status || 'unknown status'}${primaryDream.failureCode ? ` · ${primaryDream.failureCode}` : ''}`
      : 'No generation diagnostic was found in local history.',
  };

  return sanitizeTraceValue(bundle);
}

export function debugBundleText(bundle) {
  return `${BUNDLE_PREFIX}${JSON.stringify(sanitizeTraceValue(bundle), null, 2)}\n=== END AI VISUALIZER DEBUG BUNDLE ===`;
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function toast(message) {
  const element = document.getElementById('toast');
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.hidden = true; }, 5200);
}

async function waitForDevApi(timeoutMs = 5000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const api = window.VIZ_DEV;
    if (api?.identity && api?.state && api?.list) return api;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Visualizer developer API is not ready yet.');
}

export async function collectCurrentDebugBundle() {
  const api = await waitForDevApi();
  const [identity, runtime, diagnosticExport] = await Promise.all([
    Promise.resolve(api.identity()),
    Promise.resolve(api.state()),
    api.list(),
  ]);
  return createDebugBundle({
    identity,
    runtime,
    diagnosticExport,
    page: {
      origin: location.origin,
      pathname: location.pathname,
      developerMode: document.body.classList.contains('dev-mode'),
    },
  });
}

export async function copyCurrentDebugBundle() {
  const bundle = await collectCurrentDebugBundle();
  const text = debugBundleText(bundle);
  await copyText(text);
  return { bundle, text, characters: text.length };
}

function installGlobalApi() {
  if (typeof window === 'undefined' || window.VIZ_DEBUG_BUNDLE) return;
  Object.defineProperty(window, 'VIZ_DEBUG_BUNDLE', {
    value: Object.freeze({
      schema: DEBUG_BUNDLE_SCHEMA,
      collect: collectCurrentDebugBundle,
      copy: copyCurrentDebugBundle,
    }),
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

function ensureCopyButton() {
  if (!document.body.classList.contains('dev-mode')) return;
  const toolbar = document.querySelector('.diagnostics-toolbar');
  if (!toolbar || document.getElementById('copyDebugBundle')) return;

  const button = document.createElement('button');
  button.id = 'copyDebugBundle';
  button.type = 'button';
  button.textContent = 'Copy debug bundle';
  button.title = 'Copy the latest Dream, full trace, LIVE/NEXT state, runtime state, and related recovery evidence for ChatGPT.';
  button.addEventListener('click', async () => {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Collecting…';
    try {
      const { characters } = await copyCurrentDebugBundle();
      button.textContent = 'Copied ✓';
      toast(`Copied the complete debug bundle (${Math.round(characters / 1024)} KB). Paste it directly into ChatGPT.`);
      setTimeout(() => {
        if (button.isConnected) button.textContent = original;
      }, 2200);
    } catch (error) {
      button.textContent = 'Copy failed';
      toast(error?.message || 'Could not copy the debug bundle.');
      setTimeout(() => {
        if (button.isConnected) button.textContent = original;
      }, 2800);
    } finally {
      button.disabled = false;
    }
  });
  toolbar.prepend(button);

  const summary = document.getElementById('diagnosticsSummary');
  if (summary && !document.getElementById('debugBundleHint')) {
    const hint = document.createElement('p');
    hint.id = 'debugBundleHint';
    hint.className = 'diagnostics-boundary';
    hint.textContent = 'After a test Dream, use Copy debug bundle and paste the entire result into ChatGPT. You do not need to inspect the trace yourself.';
    summary.before(hint);
  }
}

function installUi() {
  installGlobalApi();
  ensureCopyButton();
  const observer = new MutationObserver(() => ensureCopyButton());
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installUi, { once: true });
  else queueMicrotask(installUi);
}
