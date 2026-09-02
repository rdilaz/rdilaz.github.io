import { DEFAULT_VISUALIZER_HTML } from './default-visualizer.js';
import { FEATURED_DREAM_MANIFEST, FEATURED_MANIFEST_SCHEMA } from './featured/manifest.js';

export { FEATURED_DREAM_MANIFEST, FEATURED_MANIFEST_SCHEMA };

const clone = value => structuredClone(value);

export function validateFeaturedEntry(entry) {
  for (const field of ['id', 'title', 'modelId', 'modelName', 'promptProfileId', 'promptProfileName', 'audioApiVersion', 'htmlPath', 'contentDigest']) {
    if (!String(entry?.[field] || '').trim()) throw new TypeError(`Featured Dream ${field} is required.`);
  }
  if (entry.schema !== FEATURED_MANIFEST_SCHEMA) throw new TypeError(`Featured Dream ${entry.id} has an unsupported schema.`);
  if (!Number.isInteger(entry.order) || entry.order < 1) throw new TypeError(`Featured Dream ${entry.id} requires a positive integer order.`);
  if (!/^\.\/featured\/[a-z0-9-]+\.html$/i.test(entry.htmlPath)) throw new TypeError(`Featured Dream ${entry.id} must use a repository-local HTML path.`);
  if (!/^[a-f0-9]{64}$/i.test(entry.contentDigest)) throw new TypeError(`Featured Dream ${entry.id} requires a SHA-256 content digest.`);
  if (entry.reliability?.status !== 'verified-in-ci' || entry.reliability?.contract !== 'dream-reliability-v1') {
    throw new TypeError(`Featured Dream ${entry.id} requires verified reliability evidence.`);
  }
  if (!entry.provenance?.operatorApprovalRecord || !['existing-shipped-built-in', 'operator-approved'].includes(entry.provenance?.curationStatus)) {
    throw new TypeError(`Featured Dream ${entry.id} requires an accepted curation record.`);
  }
  if (entry.provenance?.generatedByModel && !entry.resolvedModel) {
    throw new TypeError(`Model-generated Featured Dream ${entry.id} requires its resolved model.`);
  }
  if (entry.provenance?.generatedByModel && (
    entry.provenance.curationStatus !== 'operator-approved'
    || !entry.provenance.generationTraceId
    || (!entry.requestId && !entry.providerGenerationId)
    || !entry.promptVersion
    || entry.promptProfileId === 'not-captured'
  )) throw new TypeError(`Model-generated Featured Dream ${entry.id} requires approved model, request, prompt, and trace provenance.`);
  if (/tests[\\/]fixtures/i.test(entry.htmlPath)) throw new TypeError('Regression fixtures cannot be Featured Dreams.');
}

async function htmlDigest(html) {
  const normalized = new TextEncoder().encode(String(html).replace(/\r\n/g, '\n'));
  const digest = await crypto.subtle.digest('SHA-256', normalized);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadFeaturedDreams({ fetchImpl = globalThis.fetch } = {}) {
  const entries = FEATURED_DREAM_MANIFEST.map(clone).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const seen = new Set();
  const loaded = [];
  for (const entry of entries) {
    validateFeaturedEntry(entry);
    if (seen.has(entry.id)) throw new TypeError(`Duplicate Featured Dream id: ${entry.id}`);
    seen.add(entry.id);
    let html = '';
    let loadedFromManifestPath = false;
    if (typeof fetchImpl === 'function') {
      try {
        const response = await fetchImpl(new URL(entry.htmlPath, import.meta.url));
        if (response?.ok) {
          html = await response.text();
          loadedFromManifestPath = true;
        }
      } catch {
        // The shipped built-in remains a no-network fallback for first paint.
      }
    }
    if (!html && entry.id === 'calibration-bloom') html = DEFAULT_VISUALIZER_HTML;
    if (!/<html[\s>]/i.test(html) || !/<\/html\s*>/i.test(html)) {
      throw new Error(`Featured Dream ${entry.id} did not load as a complete HTML document.`);
    }
    if (loadedFromManifestPath && await htmlDigest(html) !== entry.contentDigest) {
      throw new Error(`Featured Dream ${entry.id} did not match its approved content digest.`);
    }
    loaded.push(Object.freeze({
      ...entry,
      key: `featured:${entry.id}`,
      source: 'featured',
      artifactId: entry.id,
      generationId: `featured:${entry.id}`,
      html,
      healthStatus: 'verified',
      openStatus: entry.startup ? 'verified-live' : 'ready-to-open',
      contentDigestVerified: loadedFromManifestPath,
      favorite: false,
    }));
  }
  return loaded;
}

function slug(value) {
  return String(value || 'dream').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'dream';
}

export async function createFeaturedExportPackage(generation, { title = '' } = {}) {
  const required = ['id', 'html', 'modelId', 'resolvedModel', 'promptProfileId', 'promptVersion', 'audioApiVersion', 'traceId'];
  const hasProviderIdentity = Boolean(String(generation?.providerGenerationId || generation?.requestId || '').trim());
  if (required.some(field => !String(generation?.[field] || '').trim()) || !hasProviderIdentity || !generation?.preflightEvidence?.passed || !['ready', 'verified'].includes(generation?.healthStatus)) {
    throw new TypeError('A ready local Dream with exact model, request, prompt, trace, and preflight evidence is required for Featured export.');
  }
  const id = `${slug(title || generation.modelName)}-${String(generation.id).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
  const contentDigest = await htmlDigest(generation.html);
  return {
    schema: 'visualizer-featured-export-v1',
    reviewStatus: 'pending-operator-review',
    manifestEntry: {
      schema: FEATURED_MANIFEST_SCHEMA,
      id,
      title: title || `${generation.modelName} Dream`,
      modelId: generation.modelId,
      modelName: generation.modelName || generation.modelId,
      resolvedModel: generation.resolvedModel || '',
      promptProfileId: generation.promptProfileId || 'not-captured',
      promptProfileName: generation.promptProfileName || generation.promptProfile?.name || generation.promptProfileId,
      promptVersion: generation.promptVersion || null,
      audioApiVersion: generation.audioApiVersion || null,
      htmlPath: `./featured/${id}.html`,
      contentDigest,
      order: null,
      startup: false,
      requestId: generation.requestId,
      providerGenerationId: generation.providerGenerationId || '',
      reliability: {
        status: 'pending-ci-verification',
        contract: 'dream-reliability-v1',
      },
      provenance: {
        kind: 'model-generated-local-export',
        generatedByModel: true,
        generationTraceId: generation.traceId || null,
        curationStatus: 'pending-operator-review',
        operatorApprovalRecord: null,
      },
    },
    html: generation.html,
  };
}
