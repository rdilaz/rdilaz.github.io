export const AUDIO_SENSITIVITY_SCHEMA = 'visualizer-audio-sensitivity-v1';
export const AUDIO_SENSITIVITY_VERSION = AUDIO_SENSITIVITY_SCHEMA;
export const AUDIO_SENSITIVITY_STORAGE_KEY = 'ai-visualizer.audio-sensitivity.v1';
export const DEFAULT_AUDIO_SENSITIVITY_PERCENT = 100;
export const MIN_AUDIO_SENSITIVITY_PERCENT = 50;
export const MAX_AUDIO_SENSITIVITY_PERCENT = 200;
export const AUDIO_SENSITIVITY_STEP_PERCENT = 10;

const INTENSITY_FIELDS = Object.freeze(['volume', 'peak', 'transient', 'beat', 'spectralFlux']);
const BAND_FIELDS = Object.freeze(['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'treble']);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function browserLocalStorage() {
  try {
    const storage = globalThis.localStorage;
    return storage?.getItem && storage?.setItem ? storage : null;
  } catch {
    return null;
  }
}

function finiteNumber(value, label) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw new TypeError(`${label} must be a finite number.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number.`);
  return number;
}

export function normalizeAudioSensitivityPercent(value) {
  const number = finiteNumber(value, 'Audio sensitivity');
  const bounded = clamp(number, MIN_AUDIO_SENSITIVITY_PERCENT, MAX_AUDIO_SENSITIVITY_PERCENT);
  const steps = Math.round((bounded - MIN_AUDIO_SENSITIVITY_PERCENT) / AUDIO_SENSITIVITY_STEP_PERCENT);
  return MIN_AUDIO_SENSITIVITY_PERCENT + steps * AUDIO_SENSITIVITY_STEP_PERCENT;
}

export function createAudioSensitivityController({
  storage = browserLocalStorage(),
  clock = () => Date.now(),
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function.');
  if (storage !== null && (typeof storage?.getItem !== 'function' || typeof storage?.setItem !== 'function')) {
    throw new TypeError('storage must implement the localStorage getItem/setItem contract.');
  }

  function restore() {
    if (!storage) return null;
    try {
      const serialized = storage.getItem(AUDIO_SENSITIVITY_STORAGE_KEY);
      if (serialized === null || serialized === undefined) return null;
      const persisted = JSON.parse(String(serialized));
      if (!persisted || persisted.schema !== AUDIO_SENSITIVITY_SCHEMA) return null;
      const changedAt = persisted.changedAt === null
        ? null
        : finiteNumber(persisted.changedAt, 'Persisted sensitivity timestamp');
      return {
        schema: AUDIO_SENSITIVITY_SCHEMA,
        sensitivityPercent: normalizeAudioSensitivityPercent(persisted.sensitivityPercent),
        changedAt,
      };
    } catch {
      return null;
    }
  }

  let state = restore() || {
    schema: AUDIO_SENSITIVITY_SCHEMA,
    sensitivityPercent: DEFAULT_AUDIO_SENSITIVITY_PERCENT,
    changedAt: null,
  };
  const listeners = new Set();

  function snapshot() {
    return Object.freeze({ ...state });
  }

  function now() {
    return finiteNumber(clock(), 'clock return value');
  }

  function persist() {
    if (!storage) return;
    try {
      storage.setItem(AUDIO_SENSITIVITY_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // The synchronous controller remains usable when browser storage is blocked.
    }
  }

  function setSensitivity(value) {
    const sensitivityPercent = normalizeAudioSensitivityPercent(value);
    if (sensitivityPercent === state.sensitivityPercent) return snapshot();
    state = {
      schema: AUDIO_SENSITIVITY_SCHEMA,
      sensitivityPercent,
      changedAt: now(),
    };
    persist();
    const current = snapshot();
    listeners.forEach(listener => listener(current));
    return current;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Audio sensitivity listener must be a function.');
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    version: AUDIO_SENSITIVITY_VERSION,
    snapshot,
    subscribe,
    setSensitivity,
    increase: () => setSensitivity(state.sensitivityPercent + AUDIO_SENSITIVITY_STEP_PERCENT),
    decrease: () => setSensitivity(state.sensitivityPercent - AUDIO_SENSITIVITY_STEP_PERCENT),
    reset: () => setSensitivity(DEFAULT_AUDIO_SENSITIVITY_PERCENT),
  });
}

function scaleIntensity(value, scale) {
  return clamp(finiteNumber(value, 'Audio intensity') * scale, 0, 1);
}

function scaleWaveform(value, scale) {
  return clamp(finiteNumber(value, 'Waveform amplitude') * scale, -1, 1);
}

function mapValues(values, transform, label) {
  if (!values || typeof values.map !== 'function') throw new TypeError(`${label} must support map().`);
  return values.map(transform);
}

export function applyAudioSensitivity(sample, sensitivityPercent = DEFAULT_AUDIO_SENSITIVITY_PERCENT) {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    throw new TypeError('Audio sample must be an object.');
  }

  const scale = normalizeAudioSensitivityPercent(sensitivityPercent) / DEFAULT_AUDIO_SENSITIVITY_PERCENT;
  const transformed = { ...sample };

  for (const field of INTENSITY_FIELDS) {
    if (hasOwn(sample, field)) transformed[field] = scaleIntensity(sample[field], scale);
  }

  if (sample.bands && typeof sample.bands === 'object' && !Array.isArray(sample.bands)) {
    const bands = { ...sample.bands };
    for (const field of BAND_FIELDS) {
      if (hasOwn(sample.bands, field)) bands[field] = scaleIntensity(sample.bands[field], scale);
    }
    transformed.bands = bands;
  }

  if (hasOwn(sample, 'spectrum')) {
    transformed.spectrum = mapValues(sample.spectrum, value => scaleIntensity(value, scale), 'Spectrum');
  }
  if (hasOwn(sample, 'waveform')) {
    transformed.waveform = mapValues(sample.waveform, value => scaleWaveform(value, scale), 'Waveform');
  }

  return transformed;
}
