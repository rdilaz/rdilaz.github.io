export const FEATURED_MANIFEST_SCHEMA = 'visualizer-featured-v1';

export const FEATURED_DREAM_MANIFEST = Object.freeze([
  Object.freeze({
    schema: FEATURED_MANIFEST_SCHEMA,
    id: 'calibration-bloom',
    title: 'Calibration Bloom',
    modelId: 'built-in/calibration-bloom',
    modelName: 'Calibration Bloom',
    resolvedModel: '',
    promptProfileId: 'not-applicable-host-authored',
    promptProfileName: 'Host-authored',
    promptVersion: null,
    audioApiVersion: 'visualizer-audio-v1',
    htmlPath: './featured/calibration-bloom.html',
    contentDigest: '6dadff79c9cc52e8a2c96a641dbd1a1e303728efbb11fee4b6f294333227198d',
    order: 1,
    startup: true,
    reliability: Object.freeze({
      status: 'verified-in-ci',
      contract: 'dream-reliability-v1',
    }),
    provenance: Object.freeze({
      kind: 'host-created',
      generatedByModel: false,
      generationTraceId: null,
      curationStatus: 'existing-shipped-built-in',
      operatorApprovalRecord: Object.freeze({
        kind: 'existing-shipped-artifact',
        note: 'Calibration Bloom predates the Featured manifest and is retained as the accepted built-in.',
      }),
    }),
  }),
]);
