import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_MODEL_FIT_CONFIGURATIONS,
  MAX_MODEL_FIT_METRIC_SAMPLES,
  MAX_RECENT_EVIDENCE_PER_CONFIGURATION,
  MAX_RECENT_MODEL_FIT_EVIDENCE,
  MODEL_FIT_EVIDENCE_SCHEMA,
  MODEL_FIT_MATRIX_SCHEMA,
  MODEL_FIT_RESULT_CATEGORIES,
  MODEL_FIT_STATUSES,
  copyModelFitMatrix,
  createModelFitConfigurationIdentity,
  createModelFitEvidenceStore,
  createModelFitMatrixExport,
  empiricalModelFitCostPreview,
  modelFitConfigurationKey,
  modelFitMatrixText,
  modelFitObservationFromDreamTrace,
  modelFitStatus,
} from '../public/visualizer/model-fit-evidence.js';
import {
  MODEL_PRODUCT_CATALOG,
  MODEL_PRODUCT_CATALOG_ENTRIES,
  MODEL_PRODUCT_CATALOG_SCHEMA,
  OPERATOR_APPROVED_MODEL_ENTRIES,
  modelProductCatalogSnapshot,
} from '../public/visualizer/model-product-catalog.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    serialized: key => values.get(key) || '',
  };
}

function configuration(overrides = {}) {
  return {
    modelId: 'fixture/model-alpha',
    reasoningChoice: 'default',
    promptProfileId: 'neutral-v1',
    promptVersion: 'visualizer-prompt-v2',
    promptHash: 'prompt-hash-a1',
    generationEnvelopeMajorVersion: 1,
    audioApiVersion: 'visualizer-audio-v1',
    reliabilityVersion: 'dream-reliability-v1',
    runtimeVersion: 'visualizer-runtime-v1',
    ...overrides,
  };
}

function failedObservation(id, config = configuration(), overrides = {}) {
  return {
    observationId: id,
    configuration: config,
    attemptedAt: 1000,
    providerAttemptCount: 1,
    resultCategory: MODEL_FIT_RESULT_CATEGORIES.OTHER_FAILURE,
    ...overrides,
  };
}

test('schema and configuration identity preserve every compatibility dimension', () => {
  assert.equal(MODEL_FIT_EVIDENCE_SCHEMA, 'visualizer-model-fit-v1');
  const identity = createModelFitConfigurationIdentity({
    ...configuration(),
    reasoningChoice: { mode: 'explicit', effort: 'high' },
    generationEnvelopeVersion: 'visualizer-generation-envelope-v1.7',
    generationEnvelopeMajorVersion: undefined,
  });
  assert.deepEqual(identity, {
    modelId: 'fixture/model-alpha',
    reasoningChoice: 'high',
    promptProfileId: 'neutral-v1',
    promptVersion: 'visualizer-prompt-v2',
    promptHash: 'prompt-hash-a1',
    generationEnvelopeMajorVersion: 1,
    audioApiVersion: 'visualizer-audio-v1',
    reliabilityVersion: 'dream-reliability-v1',
    runtimeVersion: 'visualizer-runtime-v1',
  });
  assert.equal(Object.isFrozen(identity), true);
  assert.notEqual(
    modelFitConfigurationKey(configuration()),
    modelFitConfigurationKey(configuration({ modelId: 'fixture/model-beta' })),
  );
});

test('static operator catalog is truthful, versioned, frozen, and empty', () => {
  assert.equal(MODEL_PRODUCT_CATALOG_SCHEMA, 'visualizer-model-product-catalog-v1');
  assert.strictEqual(MODEL_PRODUCT_CATALOG_ENTRIES, MODEL_PRODUCT_CATALOG);
  assert.strictEqual(OPERATOR_APPROVED_MODEL_ENTRIES, MODEL_PRODUCT_CATALOG);
  assert.equal(Object.isFrozen(MODEL_PRODUCT_CATALOG), true);
  assert.deepEqual(MODEL_PRODUCT_CATALOG, []);
  assert.deepEqual(modelProductCatalogSnapshot(), {
    schema: MODEL_PRODUCT_CATALOG_SCHEMA,
    entries: [],
  });
});

test('35: zero exact compatible billed observations yields no estimate', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  store.recordObservation({
    observationId: 'ready-without-billing',
    configuration: configuration(),
    attemptedAt: 100,
    resultCategory: MODEL_FIT_RESULT_CATEGORIES.READY,
    readySuccess: true,
    providerAttemptCount: 1,
  });
  const preview = store.costPreview(configuration());
  assert.equal(preview.label, 'No estimate yet');
  assert.equal(preview.estimateUsd, null);
  assert.deepEqual(preview.dev, {
    count: 0,
    min: null,
    median: null,
    max: null,
    minUsd: null,
    medianUsd: null,
    maxUsd: null,
    lastUsd: null,
    lifetimeCount: 0,
  });
});

test('36: one exact compatible observation yields a truthful Last estimate', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  store.recordObservation({
    observationId: 'one-cost',
    configuration: configuration(),
    attemptedAt: 100,
    resultCategory: MODEL_FIT_RESULT_CATEGORIES.READY,
    readySuccess: true,
    exactBilledCostUsd: 0.12,
  });
  const preview = empiricalModelFitCostPreview(store, configuration());
  assert.equal(preview.kind, 'last');
  assert.equal(preview.label, 'Last ~$0.12');
  assert.equal(preview.estimateUsd, 0.12);
  assert.equal(preview.dev.count, 1);
  assert.equal(preview.dev.minUsd, 0.12);
  assert.equal(preview.dev.medianUsd, 0.12);
  assert.equal(preview.dev.maxUsd, 0.12);
});

test('37: multiple exact observations use a deterministic median with dev min/median/max/count', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  for (const [id, attemptedAt, exactBilledCostUsd] of [
    ['cost-three', 300, 0.3],
    ['cost-one', 100, 0.1],
    ['cost-four', 400, 0.4],
    ['cost-two', 200, 0.2],
  ]) {
    store.recordObservation({
      observationId: id,
      configuration: configuration(),
      attemptedAt,
      resultCategory: MODEL_FIT_RESULT_CATEGORIES.READY,
      readySuccess: true,
      exactBilledCostUsd,
    });
  }
  const preview = store.costPreview(configuration());
  assert.equal(preview.kind, 'usually');
  assert.equal(preview.label, 'Usually ~$0.25');
  assert.equal(preview.estimateUsd, 0.25);
  assert.deepEqual(
    { count: preview.dev.count, min: preview.dev.min, median: preview.dev.median, max: preview.dev.max },
    { count: 4, min: 0.1, median: 0.25, max: 0.4 },
  );
});

test('38: reasoning choices never share empirical cost buckets', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  const high = configuration({ reasoningChoice: 'high' });
  store.recordObservation({
    observationId: 'default-cost',
    configuration: configuration(),
    attemptedAt: 100,
    resultCategory: MODEL_FIT_RESULT_CATEGORIES.READY,
    exactBilledCostUsd: 0.11,
  });
  assert.equal(store.costPreview(configuration()).label, 'Last ~$0.11');
  assert.equal(store.costPreview(high).label, 'No estimate yet');
});

test('39: prompt profile/version/hash and envelope-major buckets never mix', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  store.recordObservation({
    observationId: 'baseline-compatible-cost',
    configuration: configuration(),
    attemptedAt: 100,
    resultCategory: MODEL_FIT_RESULT_CATEGORIES.READY,
    exactBilledCostUsd: 0.2,
  });
  for (const incompatible of [
    configuration({ promptProfileId: 'baseline-v1' }),
    configuration({ promptVersion: 'visualizer-prompt-v3' }),
    configuration({ promptHash: 'prompt-hash-b2' }),
    configuration({ generationEnvelopeMajorVersion: 2 }),
  ]) assert.equal(store.costPreview(incompatible).label, 'No estimate yet');

  const sameEnvelopeMajor = configuration({
    generationEnvelopeMajorVersion: undefined,
    generationEnvelopeVersion: 'visualizer-generation-envelope-v1.9',
  });
  assert.equal(store.costPreview(sameEnvelopeMajor).label, 'Last ~$0.20');
});

test('43 and 79: matrix export/text/copy retain evidence but recursively remove secrets and media', async () => {
  const storage = memoryStorage();
  const store = createModelFitEvidenceStore(storage);
  store.recordObservation({
    observationId: 'sanitized-cost',
    configuration: {
      ...configuration(),
      authorization: 'Bearer SENTINEL_AUTHORIZATION',
      apiKey: 'sk-or-v1-SENTINEL_API_KEY',
    },
    attemptedAt: 200,
    resultCategory: MODEL_FIT_RESULT_CATEGORIES.READY,
    readySuccess: true,
    providerAttemptCount: 1,
    providerDurationMs: 1234,
    usage: { promptTokens: 20, completionTokens: 40, reasoningTokens: 12, totalTokens: 60 },
    artifactBytes: 4096,
    exactBilledCostUsd: 0.0321,
    headers: { authorization: 'Bearer SENTINEL_HEADER' },
    cookie: 'SENTINEL_COOKIE',
    waveform: [0.1, -0.1],
    spectrum: [0.2],
    rawAudio: 'SENTINEL_AUDIO',
    song: { title: 'SENTINEL_SONG' },
  });
  const bundle = createModelFitMatrixExport(store, {
    capturedAt: 500,
    currentVersions: configuration(),
    catalogUpdatedAt: 450,
  });
  assert.equal(bundle.schema, MODEL_FIT_MATRIX_SCHEMA);
  assert.equal(bundle.evidenceSchema, MODEL_FIT_EVIDENCE_SCHEMA);
  assert.equal(bundle.configurations[0].counts.providerAttempts, 1);
  assert.equal(bundle.configurations[0].tokens.reasoning.total, 12);
  assert.equal(bundle.configurations[0].artifactBytes.total, 4096);
  assert.equal(bundle.configurations[0].exactBilledCostUsd.total, 0.0321);

  const poisoned = {
    ...bundle,
    authorization: 'Bearer SENTINEL_BUNDLE',
    nested: {
      apiKey: 'sk-or-v1-SENTINEL_NESTED',
      cookie: 'SENTINEL_COOKIE_NESTED',
      waveform: [1],
      spectrum: [2],
      rawAudio: 'SENTINEL_RAW_AUDIO',
      song: 'SENTINEL_SONG_NESTED',
    },
  };
  const text = modelFitMatrixText(poisoned);
  assert.match(text, /^=== AI VISUALIZER MODEL TEST MATRIX v1 ===/);
  assert.match(text, /visualizer-model-fit-matrix-v1/);
  assert.match(text, /exactBilledCostUsd/);
  assert.match(text, /reasoning/);
  assert.doesNotMatch(text, /SENTINEL|authorization|apiKey|cookie|waveform|spectrum|rawAudio|"song"/i);
  assert.match(text, /=== END AI VISUALIZER MODEL TEST MATRIX ===$/);

  let copied = '';
  const result = await copyModelFitMatrix(store, {
    capturedAt: 500,
    clipboard: { writeText: async value => { copied = value; } },
  });
  assert.equal(copied, result.text);
  assert.equal(result.characters, copied.length);
});

test('59, 69, and 72: output-budget exhaustion is TESTED and never inferred incompatible', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  store.recordObservation({
    observationId: 'deepseek-regression',
    configuration: configuration({
      modelId: 'deepseek/deepseek-v4-flash-0731',
      reasoningChoice: 'default',
    }),
    attemptedAt: 190227,
    resultCategory: MODEL_FIT_RESULT_CATEGORIES.OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT,
    providerAttemptCount: 1,
    providerDurationMs: 190227,
    usage: {
      promptTokens: 600,
      completionTokens: 14000,
      reasoningTokens: 12392,
      totalTokens: 14600,
    },
    artifactBytes: 0,
    exactBilledCostUsd: 0.004004,
    knownIncompatible: true,
  });
  const config = store.configuration(configuration({ modelId: 'deepseek/deepseek-v4-flash-0731' }));
  assert.equal(config.status, MODEL_FIT_STATUSES.TESTED);
  assert.equal(config.knownIncompatible, null);
  assert.equal(config.aggregate.failureCategories.OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT, 1);
  assert.equal(config.aggregate.usage.reasoningTokens.total, 12392);
  assert.equal(store.modelStatus('deepseek/deepseek-v4-flash-0731'), MODEL_FIT_STATUSES.TESTED);
  assert.equal(modelFitStatus({ providerAttemptCount: 1, knownIncompatible: true }), MODEL_FIT_STATUSES.TESTED);
});

test('68: a configuration and model with no attempts are UNTESTED', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  assert.equal(store.configurationStatus(configuration()), MODEL_FIT_STATUSES.UNTESTED);
  assert.equal(store.modelStatus(configuration().modelId), MODEL_FIT_STATUSES.UNTESTED);
});

test('69: one ordinary failed provider attempt becomes TESTED', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  store.recordObservation(failedObservation('one-failure'));
  assert.equal(store.configurationStatus(configuration()), MODEL_FIT_STATUSES.TESTED);
  assert.equal(store.configuration(configuration()).aggregate.failureCount, 1);
});

test('70: one qualifying Ready result becomes PROVEN', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  store.recordObservation({
    observationId: 'ready-success',
    configuration: configuration(),
    attemptedAt: 100,
    resultCategory: MODEL_FIT_RESULT_CATEGORIES.READY,
    readySuccess: true,
    providerAttemptCount: 1,
  });
  const evidence = store.configuration(configuration());
  assert.equal(evidence.status, MODEL_FIT_STATUSES.PROVEN);
  assert.equal(evidence.aggregate.readySuccessCount, 1);
  assert.equal(evidence.aggregate.lastSuccessAt, 100);
});

test('71: a successful Open/LIVE increments LIVE/Open evidence without inventing a provider call', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  store.recordObservation({
    observationId: 'ready-before-open',
    configuration: configuration(),
    attemptedAt: 100,
    resultCategory: MODEL_FIT_RESULT_CATEGORIES.READY,
    readySuccess: true,
    providerAttemptCount: 1,
  });
  store.recordObservation({
    observationId: 'open-success',
    configuration: configuration(),
    attemptedAt: 200,
    resultCategory: MODEL_FIT_RESULT_CATEGORIES.LIVE_OPEN,
    liveSuccess: true,
    openSuccess: true,
    providerAttemptCount: 0,
  });
  const aggregate = store.configuration(configuration()).aggregate;
  assert.equal(aggregate.providerAttemptCount, 1);
  assert.equal(aggregate.liveSuccessCount, 1);
  assert.equal(aggregate.openSuccessCount, 1);
  assert.equal(aggregate.liveOpenSuccessCount, 1);
  assert.equal(aggregate.lastSuccessAt, 200);
});

test('73: one timeout remains TESTED rather than Known Incompatible', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  store.recordObservation(failedObservation('one-timeout', configuration(), {
    resultCategory: MODEL_FIT_RESULT_CATEGORIES.PROVIDER_TIMEOUT,
  }));
  const evidence = store.configuration(configuration());
  assert.equal(evidence.status, MODEL_FIT_STATUSES.TESTED);
  assert.equal(evidence.knownIncompatible, null);
  assert.equal(evidence.aggregate.failureCategories.PROVIDER_TIMEOUT, 1);
});

test('74: only explicit deterministic configuration/model marks produce KNOWN_INCOMPATIBLE', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  const markedConfiguration = store.markConfigurationKnownIncompatible(configuration(), {
    code: 'NO_TEXT_OUTPUT',
    source: 'deterministic catalog capability',
    markedAt: 50,
  });
  assert.equal(markedConfiguration.status, MODEL_FIT_STATUSES.KNOWN_INCOMPATIBLE);
  assert.equal(markedConfiguration.knownIncompatible.deterministic, true);
  assert.equal(store.modelStatus(configuration().modelId), MODEL_FIT_STATUSES.UNTESTED);

  const markedModel = store.markModelKnownIncompatible(configuration().modelId, {
    code: 'NO_TEXT_OUTPUT',
    source: 'deterministic catalog capability',
    markedAt: 60,
  });
  assert.equal(markedModel.status, MODEL_FIT_STATUSES.KNOWN_INCOMPATIBLE);
  assert.throws(
    () => store.markConfigurationKnownIncompatible(configuration({ reasoningChoice: 'high' }), {
      code: MODEL_FIT_RESULT_CATEGORIES.PROVIDER_TIMEOUT,
    }),
    /observational evidence/,
  );
});

test('75 and 76: reasoning configurations remain separate while model status aggregates proof', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  const native = configuration({ reasoningChoice: 'default' });
  const high = configuration({ reasoningChoice: 'high' });
  const max = configuration({ reasoningChoice: 'max' });
  store.recordObservation(failedObservation('default-failed', native));
  store.recordObservation({
    observationId: 'high-ready',
    configuration: high,
    attemptedAt: 200,
    resultCategory: MODEL_FIT_RESULT_CATEGORIES.READY,
    readySuccess: true,
    providerAttemptCount: 1,
  });
  assert.equal(store.configurationStatus(native), MODEL_FIT_STATUSES.TESTED);
  assert.equal(store.configurationStatus(high), MODEL_FIT_STATUSES.PROVEN);
  assert.equal(store.configurationStatus(max), MODEL_FIT_STATUSES.UNTESTED);
  assert.equal(store.modelStatus(native.modelId), MODEL_FIT_STATUSES.PROVEN);
  assert.equal(store.model(native.modelId).configurationCount, 2);
});

test('77: global, per-configuration, metric, and configuration evidence remain bounded', () => {
  const store = createModelFitEvidenceStore(memoryStorage(), {
    maxRecentEvidence: 2,
    maxRecentPerConfiguration: 2,
    maxMetricSamples: 2,
    maxConfigurations: 2,
  });
  for (let index = 0; index < 4; index += 1) {
    store.recordObservation({
      observationId: `bounded-${index}`,
      configuration: configuration(),
      attemptedAt: 100 + index,
      resultCategory: MODEL_FIT_RESULT_CATEGORIES.OTHER_FAILURE,
      providerAttemptCount: 1,
      providerDurationMs: 1000 + index,
      exactBilledCostUsd: 0.01 + index / 100,
    });
  }
  let snapshot = store.snapshot();
  assert.equal(snapshot.recentEvidence.length, 2);
  assert.equal(snapshot.configurations[0].recentEvidence.length, 2);
  assert.equal(snapshot.configurations[0].aggregate.observationCount, 4);
  assert.equal(snapshot.configurations[0].aggregate.providerDurationMs.sampleCount, 2);
  assert.equal(snapshot.configurations[0].aggregate.exactBilledCostUsd.sampleCount, 2);

  store.recordObservation(failedObservation('bounded-high', configuration({ reasoningChoice: 'high' }), { attemptedAt: 200 }));
  store.recordObservation(failedObservation('bounded-max', configuration({ reasoningChoice: 'max' }), { attemptedAt: 300 }));
  snapshot = store.snapshot();
  assert.equal(snapshot.configurations.length, 2);
  assert.ok(snapshot.configurations.length <= MAX_MODEL_FIT_CONFIGURATIONS);
  assert.ok(snapshot.recentEvidence.length <= MAX_RECENT_MODEL_FIT_EVIDENCE);
  assert.ok(snapshot.configurations.every(entry => entry.recentEvidence.length <= MAX_RECENT_EVIDENCE_PER_CONFIGURATION));
  assert.ok(snapshot.configurations.every(entry => entry.aggregate.exactBilledCostUsd.sampleCount <= MAX_MODEL_FIT_METRIC_SAMPLES));
});

test('78: audio, reliability, runtime, and exact prompt versions are separately scoped', () => {
  const baselineKey = modelFitConfigurationKey(configuration());
  for (const changed of [
    configuration({ audioApiVersion: 'visualizer-audio-v2' }),
    configuration({ reliabilityVersion: 'dream-reliability-v2' }),
    configuration({ runtimeVersion: 'visualizer-runtime-v2' }),
    configuration({ promptVersion: 'visualizer-prompt-v2.1' }),
  ]) assert.notEqual(modelFitConfigurationKey(changed), baselineKey);
});

test('80: injected storage survives reload and observation IDs remain idempotent', () => {
  const storage = memoryStorage();
  const first = createModelFitEvidenceStore(storage);
  const input = failedObservation('reload-idempotent', configuration(), {
    providerAttemptCount: 2,
    repairCount: 1,
    exactBilledCostUsd: 0.08,
  });
  assert.equal(first.recordObservation(input).recorded, true);
  assert.match(storage.serialized(first.storageKey), /reload-idempotent/);

  const reloaded = createModelFitEvidenceStore(storage);
  assert.equal(reloaded.configuration(configuration()).aggregate.providerAttemptCount, 2);
  assert.equal(reloaded.recordObservation(input).duplicate, true);
  const aggregate = reloaded.configuration(configuration()).aggregate;
  assert.equal(aggregate.observationCount, 1);
  assert.equal(aggregate.providerAttemptCount, 2);
  assert.equal(aggregate.repairCount, 1);
  assert.equal(aggregate.exactBilledCostUsd.count, 1);
});

test('bounded observations aggregate attempts, categories, latency, usage, artifacts, costs, repairs, and dates', () => {
  const store = createModelFitEvidenceStore(memoryStorage());
  store.recordObservation({
    observationId: 'complete-observation',
    configuration: configuration(),
    attemptedAt: 500,
    resultCategory: MODEL_FIT_RESULT_CATEGORIES.READY,
    readySuccess: true,
    providerAttemptCount: 2,
    providerDurationsMs: [120, 180],
    usage: { promptTokens: 30, completionTokens: 70, reasoningTokens: 20, totalTokens: 100 },
    artifactBytes: 8192,
    exactBilledCostUsd: 0,
    repairCount: 1,
  });
  const aggregate = store.configuration(configuration()).aggregate;
  assert.equal(aggregate.providerAttemptCount, 2);
  assert.equal(aggregate.readySuccessCount, 1);
  assert.deepEqual(aggregate.resultCategories, { READY: 1 });
  assert.equal(aggregate.providerDurationMs.count, 2);
  assert.equal(aggregate.providerDurationMs.median, 150);
  assert.equal(aggregate.usage.promptTokens.total, 30);
  assert.equal(aggregate.usage.completionTokens.total, 70);
  assert.equal(aggregate.usage.reasoningTokens.total, 20);
  assert.equal(aggregate.usage.totalTokens.total, 100);
  assert.equal(aggregate.artifactBytes.total, 8192);
  assert.equal(aggregate.exactBilledCostUsd.count, 1);
  assert.equal(aggregate.exactBilledCostUsd.total, 0);
  assert.equal(aggregate.repairCount, 1);
  assert.equal(aggregate.lastAttemptAt, 500);
  assert.equal(aggregate.lastSuccessAt, 500);
});

test('pure finalized Dream Trace conversion retains only compact evidence facts', () => {
  const trace = {
    schema: 'dream-trace-v1',
    id: 'trace-ready-result',
    state: 'closed',
    status: 'ready',
    outcome: 'ready',
    modelId: configuration().modelId,
    finishedAt: 500,
    providerRequestCount: 2,
    reportedCostComplete: true,
    exactReportedCost: 0.09,
    attempts: [
      {
        kind: 'generation',
        state: 'closed',
        request: { dispatched: true, headers: { authorization: 'Bearer SENTINEL_TRACE' } },
        timing: { requestDispatchedAt: 100, responseBodyCompleteAt: 200 },
        response: {
          status: 200,
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.04 },
          rawBody: 'SENTINEL_RAW_BODY',
          extractedHtml: '',
        },
      },
      {
        kind: 'repair',
        state: 'closed',
        request: { dispatched: true },
        timing: { providerDurationMs: 250 },
        response: {
          status: 200,
          usage: {
            prompt_tokens: 15,
            completion_tokens: 35,
            total_tokens: 50,
            completion_tokens_details: { reasoning_tokens: 11 },
            cost: 0.05,
          },
          extractedHtml: '<!doctype html><p>ready</p>',
        },
      },
    ],
  };
  const observation = modelFitObservationFromDreamTrace(trace, configuration());
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(observation.observationId, trace.id);
  assert.equal(observation.resultCategory, MODEL_FIT_RESULT_CATEGORIES.READY);
  assert.equal(observation.providerAttemptCount, 2);
  assert.deepEqual(observation.providerDurationsMs, [100, 250]);
  assert.deepEqual(observation.usage, {
    promptTokens: 25,
    completionTokens: 55,
    reasoningTokens: 11,
    totalTokens: 80,
  });
  assert.equal(observation.repairCount, 1);
  assert.equal(observation.artifactBytes, 27);
  assert.equal(observation.exactBilledCostUsd, 0.09);
  const serialized = JSON.stringify(observation);
  assert.doesNotMatch(serialized, /SENTINEL|authorization|rawBody|extractedHtml/i);
});
