export const REASONING_SELECTION_VERSION = 'visualizer-reasoning-selection-v1';
export const REASONING_SELECTION_SCHEMA = REASONING_SELECTION_VERSION;
export const REASONING_SELECTION_STORAGE_PREFIX = 'ai-visualizer.reasoning-selection.v1.';

// This vocabulary is used only when OpenRouter explicitly reports that every
// gateway effort is accepted. An absent effort list never expands to this list.
export const GATEWAY_REASONING_EFFORTS = Object.freeze([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const EFFORTS = new Set(GATEWAY_REASONING_EFFORTS);
const EFFORT_LABELS = Object.freeze({
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function exactModelId(model) {
  return String(model?.id ?? '').trim();
}

function requiredModelId(model) {
  const modelId = typeof model === 'string' ? model.trim() : exactModelId(model);
  if (!modelId) throw new TypeError('An exact model ID is required.');
  return modelId;
}

function normalizedEffort(value) {
  if (typeof value !== 'string') return null;
  const effort = value.trim().toLowerCase();
  return EFFORTS.has(effort) ? effort : null;
}

function metadataField(reasoning, camelName, rawName = camelName) {
  if (!reasoning) return { present: false, value: undefined, source: null };
  if (Object.hasOwn(reasoning, camelName)) {
    return {
      present: true,
      value: reasoning[camelName],
      source: `model.reasoning.${camelName}`,
    };
  }
  if (rawName !== camelName && Object.hasOwn(reasoning, rawName)) {
    return {
      present: true,
      value: reasoning[rawName],
      source: `model.reasoning.${rawName}`,
    };
  }
  return { present: false, value: undefined, source: null };
}

function normalizedBoolean(field, absentValue) {
  return typeof field.value === 'boolean' ? field.value : absentValue;
}

export function normalizeReasoningMetadata(model) {
  const reasoning = isRecord(model?.reasoning) ? model.reasoning : null;
  const supportedField = metadataField(reasoning, 'supportedEfforts', 'supported_efforts');
  const defaultEffortField = metadataField(reasoning, 'defaultEffort', 'default_effort');
  const defaultEnabledField = metadataField(reasoning, 'defaultEnabled', 'default_enabled');
  const mandatoryField = metadataField(reasoning, 'mandatory');
  const maxTokensField = metadataField(reasoning, 'supportsMaxTokens', 'supports_max_tokens');
  const allGatewayEfforts = supportedField.present && supportedField.value === null;

  let supportedEfforts = [];
  if (allGatewayEfforts) {
    supportedEfforts = [...GATEWAY_REASONING_EFFORTS];
  } else if (Array.isArray(supportedField.value)) {
    const seen = new Set();
    for (const value of supportedField.value) {
      const effort = normalizedEffort(value);
      if (!effort || seen.has(effort)) continue;
      seen.add(effort);
      supportedEfforts.push(effort);
    }
  }

  const mandatory = normalizedBoolean(mandatoryField, false);
  if (mandatory) supportedEfforts = supportedEfforts.filter(effort => effort !== 'none');

  return deepFreeze({
    modelId: exactModelId(model),
    supportedEfforts,
    hasEffortControls: supportedEfforts.length > 0,
    allGatewayEfforts,
    defaultEffort: normalizedEffort(defaultEffortField.value),
    defaultEnabled: normalizedBoolean(defaultEnabledField, null),
    mandatory,
    supportsMaxTokens: normalizedBoolean(maxTokensField, false),
    source: {
      catalog: typeof model?.source === 'string' && model.source.trim() ? model.source.trim() : null,
      reasoning: reasoning ? 'model.reasoning' : null,
      supportedEfforts: supportedField.source,
      defaultEffort: defaultEffortField.source,
      defaultEnabled: defaultEnabledField.source,
      mandatory: mandatoryField.source,
      supportsMaxTokens: maxTokensField.source,
    },
  });
}

export function listReasoningOptions(model) {
  const metadata = normalizeReasoningMetadata(model);
  const options = [{ value: 'default', label: 'Default', mode: 'default', effort: null }];
  for (const effort of metadata.supportedEfforts) {
    options.push({ value: effort, label: EFFORT_LABELS[effort], mode: 'explicit', effort });
  }
  return deepFreeze(options);
}

function selectionSnapshot({ modelId, mode, effort, selectedAt, staleFallback }) {
  return deepFreeze({
    schema: REASONING_SELECTION_SCHEMA,
    modelId,
    mode,
    effort,
    selectedAt,
    staleFallback,
  });
}

function defaultSelection(modelId, selectedAt = null, staleFallback = false) {
  return selectionSnapshot({
    modelId,
    mode: 'default',
    effort: null,
    selectedAt,
    staleFallback,
  });
}

function normalizedSelectedAt(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeReasoningSelection(model, selection = null) {
  const metadata = normalizeReasoningMetadata(model);
  const modelId = metadata.modelId;
  if (!isRecord(selection)) return defaultSelection(modelId);

  const selectedAt = normalizedSelectedAt(selection.selectedAt);
  const inheritedFallback = selection.staleFallback === true;
  if (!modelId) return defaultSelection(modelId, selectedAt, true);

  if (Object.hasOwn(selection, 'modelId') && String(selection.modelId ?? '').trim() !== modelId) {
    return defaultSelection(modelId, selectedAt, true);
  }

  if (selection.mode === 'default') {
    const hasUnexpectedEffort = selection.effort !== null && selection.effort !== undefined;
    return defaultSelection(modelId, selectedAt, inheritedFallback || hasUnexpectedEffort);
  }

  if (selection.mode === 'explicit') {
    const effort = normalizedEffort(selection.effort);
    if (effort && metadata.supportedEfforts.includes(effort)) {
      return selectionSnapshot({
        modelId,
        mode: 'explicit',
        effort,
        selectedAt,
        staleFallback: inheritedFallback,
      });
    }
    return defaultSelection(modelId, selectedAt, true);
  }

  return defaultSelection(modelId, selectedAt, true);
}

// The caller should add this as request.reasoning only when a value is returned.
// Undefined is intentional: Default must omit reasoning rather than send an
// empty, enabled, low, medium, or high configuration.
export function createReasoningRequestConfiguration(model, selection = null) {
  const normalized = normalizeReasoningSelection(model, selection);
  if (normalized.mode !== 'explicit') return undefined;
  return deepFreeze({ effort: normalized.effort });
}

export function reasoningSelectionStorageKey(modelId) {
  return `${REASONING_SELECTION_STORAGE_PREFIX}${encodeURIComponent(requiredModelId(modelId))}`;
}

export function createReasoningSelectionStore({ storage = null, clock = () => Date.now() } = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function.');
  if (storage !== null && (typeof storage?.getItem !== 'function' || typeof storage?.setItem !== 'function')) {
    throw new TypeError('storage must implement the localStorage getItem/setItem contract.');
  }

  const memory = new Map();

  function read(key) {
    if (storage) {
      try {
        const value = storage.getItem(key);
        if (value !== null && value !== undefined) return String(value);
      } catch {
        // The in-memory copy keeps the current session usable when storage is blocked.
      }
    }
    return memory.get(key) ?? null;
  }

  function write(key, value) {
    memory.set(key, value);
    if (!storage) return;
    try {
      storage.setItem(key, value);
    } catch {
      // Selection remains available from memory for this store instance.
    }
  }

  function now() {
    const selectedAt = clock();
    if (typeof selectedAt !== 'number' || !Number.isFinite(selectedAt)) {
      throw new TypeError('clock must return a finite number.');
    }
    return selectedAt;
  }

  function load(model) {
    const modelId = requiredModelId(model);
    const serialized = read(reasoningSelectionStorageKey(modelId));
    if (serialized === null) return defaultSelection(modelId);
    try {
      return normalizeReasoningSelection(model, JSON.parse(serialized));
    } catch {
      return defaultSelection(modelId, null, true);
    }
  }

  function save(model, selection = null) {
    const modelId = requiredModelId(model);
    const normalized = normalizeReasoningSelection(model, selection);
    const selectedAt = now();
    const snapshot = selectionSnapshot({
      modelId,
      mode: normalized.mode,
      effort: normalized.effort,
      selectedAt,
      staleFallback: normalized.staleFallback,
    });
    const persisted = {
      modelId: snapshot.modelId,
      mode: snapshot.mode,
      effort: snapshot.effort,
      selectedAt: snapshot.selectedAt,
    };
    write(reasoningSelectionStorageKey(modelId), JSON.stringify(persisted));
    return snapshot;
  }

  function clear(model) {
    const modelId = requiredModelId(model);
    const key = reasoningSelectionStorageKey(modelId);
    memory.delete(key);
    if (storage?.removeItem) {
      try {
        storage.removeItem(key);
      } catch {
        // Clearing the in-memory value is still safe when persistence is blocked.
      }
    }
    return defaultSelection(modelId);
  }

  return Object.freeze({
    version: REASONING_SELECTION_VERSION,
    load,
    save,
    snapshot: load,
    clear,
  });
}
