import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GATEWAY_REASONING_EFFORTS,
  REASONING_SELECTION_SCHEMA,
  REASONING_SELECTION_VERSION,
  createReasoningRequestConfiguration,
  createReasoningSelectionStore,
  listReasoningOptions,
  normalizeReasoningMetadata,
  normalizeReasoningSelection,
  reasoningSelectionStorageKey,
} from '../public/visualizer/reasoning-settings.js';

const DEEPSEEK = Object.freeze({
  id: 'deepseek/deepseek-v4-flash-0731',
  source: 'openrouter',
  reasoning: Object.freeze({
    mandatory: false,
    default_enabled: true,
    supported_efforts: Object.freeze(['max', 'high', 'low']),
    default_effort: 'high',
  }),
});

const EXACT_LEVELS = Object.freeze({
  id: 'provider/exact-levels',
  reasoning: Object.freeze({
    supportedEfforts: Object.freeze(['low', 'high', 'xhigh', 'max']),
    defaultEffort: 'xhigh',
    defaultEnabled: false,
    mandatory: false,
    supportsMaxTokens: true,
  }),
});

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
  };
}

function explicit(effort, modelId = undefined) {
  return { ...(modelId === undefined ? {} : { modelId }), mode: 'explicit', effort };
}

test('contract is explicitly versioned', () => {
  assert.equal(REASONING_SELECTION_VERSION, 'visualizer-reasoning-selection-v1');
  assert.equal(REASONING_SELECTION_SCHEMA, REASONING_SELECTION_VERSION);
});

test('milestone 1-3: Default is native omission, never an implicit Low or High', () => {
  const selection = normalizeReasoningSelection(DEEPSEEK);
  assert.deepEqual(selection, {
    schema: REASONING_SELECTION_SCHEMA,
    modelId: DEEPSEEK.id,
    mode: 'default',
    effort: null,
    selectedAt: null,
    staleFallback: false,
  });
  assert.equal(createReasoningRequestConfiguration(DEEPSEEK, selection), undefined);
  assert.equal(createReasoningRequestConfiguration({
    id: 'provider/default-low',
    reasoning: { supported_efforts: ['low'], default_effort: 'low', default_enabled: true },
  }), undefined);
  assert.equal(createReasoningRequestConfiguration({
    id: 'provider/default-high',
    reasoning: { supported_efforts: ['high'], default_effort: 'high', default_enabled: true },
  }), undefined);

  const request = { model: DEEPSEEK.id };
  const reasoning = createReasoningRequestConfiguration(DEEPSEEK, selection);
  if (reasoning !== undefined) request.reasoning = reasoning;
  assert.equal(Object.hasOwn(request, 'reasoning'), false);
});

test('milestone 4: absent supported efforts means Default only and no invented request', () => {
  const noReasoningMetadata = { id: 'provider/no-reasoning' };
  const budgetOnlyMetadata = {
    id: 'provider/budget-only',
    reasoning: { default_enabled: true, supports_max_tokens: true },
  };

  assert.deepEqual(listReasoningOptions(noReasoningMetadata).map(option => option.value), ['default']);
  assert.deepEqual(listReasoningOptions(budgetOnlyMetadata).map(option => option.value), ['default']);
  assert.equal(normalizeReasoningMetadata(budgetOnlyMetadata).hasEffortControls, false);
  assert.equal(normalizeReasoningMetadata(budgetOnlyMetadata).supportsMaxTokens, true);
  const normalized = normalizeReasoningSelection(budgetOnlyMetadata, explicit('high'));
  assert.equal(normalized.mode, 'default');
  assert.equal(normalized.staleFallback, true);
  assert.equal(createReasoningRequestConfiguration(budgetOnlyMetadata, explicit('high')), undefined);
});

test('milestone 5-6: options use only metadata values and preserve provider order', () => {
  const metadata = normalizeReasoningMetadata(DEEPSEEK);
  assert.deepEqual(metadata.supportedEfforts, ['max', 'high', 'low']);
  assert.deepEqual(listReasoningOptions(DEEPSEEK).map(option => option.value), [
    'default',
    'max',
    'high',
    'low',
  ]);
  for (const unsupported of ['none', 'minimal', 'medium', 'xhigh']) {
    assert.equal(listReasoningOptions(DEEPSEEK).some(option => option.effort === unsupported), false);
  }
  assert.equal(metadata.defaultEffort, 'high');
  assert.equal(metadata.defaultEnabled, true);
  assert.equal(metadata.mandatory, false);
  assert.equal(metadata.supportsMaxTokens, false);
  assert.deepEqual(metadata.source, {
    catalog: 'openrouter',
    reasoning: 'model.reasoning',
    supportedEfforts: 'model.reasoning.supported_efforts',
    defaultEffort: 'model.reasoning.default_effort',
    defaultEnabled: 'model.reasoning.default_enabled',
    mandatory: 'model.reasoning.mandatory',
    supportsMaxTokens: null,
  });
});

test('metadata normalization accepts camelCase without broadening its exact list', () => {
  const metadata = normalizeReasoningMetadata(EXACT_LEVELS);
  assert.deepEqual(metadata.supportedEfforts, ['low', 'high', 'xhigh', 'max']);
  assert.equal(metadata.defaultEffort, 'xhigh');
  assert.equal(metadata.defaultEnabled, false);
  assert.equal(metadata.mandatory, false);
  assert.equal(metadata.supportsMaxTokens, true);
  assert.equal(metadata.source.supportedEfforts, 'model.reasoning.supportedEfforts');
  assert.equal(Object.isFrozen(metadata), true);
  assert.equal(Object.isFrozen(metadata.supportedEfforts), true);
  assert.equal(Object.isFrozen(metadata.source), true);
});

test('supported_efforts null alone expands the documented gateway vocabulary', () => {
  const allEfforts = { id: 'provider/all-efforts', reasoning: { supported_efforts: null } };
  const absentEfforts = { id: 'provider/absent-efforts', reasoning: {} };
  assert.deepEqual(normalizeReasoningMetadata(allEfforts).supportedEfforts, GATEWAY_REASONING_EFFORTS);
  assert.equal(normalizeReasoningMetadata(allEfforts).allGatewayEfforts, true);
  assert.deepEqual(normalizeReasoningMetadata(absentEfforts).supportedEfforts, []);
  assert.equal(normalizeReasoningMetadata(absentEfforts).allGatewayEfforts, false);
});

test('milestone 7: unsupported efforts always fall back and are never dispatched', () => {
  for (const effort of ['none', 'minimal', 'medium', 'xhigh', 'invented']) {
    const selection = normalizeReasoningSelection(DEEPSEEK, explicit(effort));
    assert.equal(selection.mode, 'default', effort);
    assert.equal(selection.effort, null, effort);
    assert.equal(selection.staleFallback, true, effort);
    assert.equal(createReasoningRequestConfiguration(DEEPSEEK, explicit(effort)), undefined, effort);
  }
});

test('milestone 8: mandatory reasoning filters None and cannot dispatch it', () => {
  const mandatory = {
    id: 'provider/mandatory',
    reasoning: { mandatory: true, supported_efforts: ['none', 'high', 'low'] },
  };
  assert.deepEqual(listReasoningOptions(mandatory).map(option => option.value), ['default', 'high', 'low']);
  const none = normalizeReasoningSelection(mandatory, explicit('none'));
  assert.equal(none.mode, 'default');
  assert.equal(none.staleFallback, true);
  assert.equal(createReasoningRequestConfiguration(mandatory, explicit('none')), undefined);
  assert.deepEqual(createReasoningRequestConfiguration(mandatory, explicit('high')), { effort: 'high' });
});

test('milestone 9-12: Low, High, XHigh, and Max use only the exact supported shape', () => {
  for (const effort of ['low', 'high', 'xhigh', 'max']) {
    const configuration = createReasoningRequestConfiguration(EXACT_LEVELS, explicit(effort));
    assert.deepEqual(configuration, { effort }, effort);
    assert.deepEqual(Object.keys(configuration), ['effort'], effort);
    assert.equal(Object.isFrozen(configuration), true, effort);
  }

  assert.equal(createReasoningRequestConfiguration(DEEPSEEK, explicit('xhigh')), undefined);
  assert.equal(createReasoningRequestConfiguration({
    id: 'provider/no-max',
    reasoning: { supported_efforts: ['low', 'high'] },
  }, explicit('max')), undefined);
});

test('milestone 13: stale persisted effort falls back to Default with a signal', () => {
  const storage = createMemoryStorage({
    [reasoningSelectionStorageKey(DEEPSEEK.id)]: JSON.stringify({
      modelId: DEEPSEEK.id,
      mode: 'explicit',
      effort: 'medium',
      selectedAt: 123,
    }),
  });
  const store = createReasoningSelectionStore({ storage, clock: () => 999 });
  const restored = store.load(DEEPSEEK);
  assert.equal(restored.mode, 'default');
  assert.equal(restored.effort, null);
  assert.equal(restored.selectedAt, 123);
  assert.equal(restored.staleFallback, true);
  assert.equal(createReasoningRequestConfiguration(DEEPSEEK, restored), undefined);
});

test('store persists exact selections independently for each exact model', () => {
  const storage = createMemoryStorage();
  let timestamp = 1000;
  const firstStore = createReasoningSelectionStore({ storage, clock: () => ++timestamp });
  firstStore.save(DEEPSEEK, explicit('high'));
  firstStore.save(EXACT_LEVELS, explicit('low'));

  assert.deepEqual(JSON.parse(storage.getItem(reasoningSelectionStorageKey(DEEPSEEK.id))), {
    modelId: DEEPSEEK.id,
    mode: 'explicit',
    effort: 'high',
    selectedAt: 1001,
  });
  assert.deepEqual(JSON.parse(storage.getItem(reasoningSelectionStorageKey(EXACT_LEVELS.id))), {
    modelId: EXACT_LEVELS.id,
    mode: 'explicit',
    effort: 'low',
    selectedAt: 1002,
  });

  const reloadedStore = createReasoningSelectionStore({ storage, clock: () => 2000 });
  assert.equal(reloadedStore.load(DEEPSEEK).effort, 'high');
  assert.equal(reloadedStore.load(EXACT_LEVELS).effort, 'low');
  assert.notEqual(reasoningSelectionStorageKey(DEEPSEEK.id), reasoningSelectionStorageKey(EXACT_LEVELS.id));
});

test('milestone 14: Dream-start snapshots are cloned, deeply immutable, and stable', () => {
  const storage = createMemoryStorage();
  let timestamp = 10;
  const store = createReasoningSelectionStore({ storage, clock: () => ++timestamp });
  const mutableUiSelection = explicit('low');
  store.save(EXACT_LEVELS, mutableUiSelection);
  const dreamStartSnapshot = store.snapshot(EXACT_LEVELS);
  const inFlightConfiguration = createReasoningRequestConfiguration(EXACT_LEVELS, dreamStartSnapshot);

  mutableUiSelection.effort = 'max';
  store.save(EXACT_LEVELS, mutableUiSelection);
  const currentSelection = store.snapshot(EXACT_LEVELS);

  assert.equal(Object.isFrozen(dreamStartSnapshot), true);
  assert.equal(Object.isFrozen(inFlightConfiguration), true);
  assert.notStrictEqual(dreamStartSnapshot, currentSelection);
  assert.equal(dreamStartSnapshot.effort, 'low');
  assert.deepEqual(inFlightConfiguration, { effort: 'low' });
  assert.equal(currentSelection.effort, 'max');
  assert.throws(() => {
    dreamStartSnapshot.effort = 'high';
  }, TypeError);
});
