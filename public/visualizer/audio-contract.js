export const AUDIO_API_V1 = 'visualizer-audio-v1';
export const AUDIO_API_V2 = 'visualizer-audio-v2';
export const AUDIO_API_VERSION = AUDIO_API_V2;
export const EXPRESSIVE_AUDIO_VERSION = 'visualizer-expressive-audio-v1';
export const EXPRESSIVE_LOG_BAND_COUNT = 24;
export const EXPRESSIVE_AGE_CAP_SECONDS = 30;
export const EXPRESSIVE_SILENCE_CAP_SECONDS = 300;

const V1_AUDIO_KEYS = Object.freeze([
  'connected',
  'silence',
  'volume',
  'peak',
  'transient',
  'beat',
  'tempo',
  'tempoConfidence',
  'spectralFlux',
  'spectralCentroid',
  'bands',
  'stereo',
  'waveform',
  'spectrum',
]);

const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function fixedArray(value, length, minimum = 0, maximum = 1) {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? value : [];
  return Array.from({ length }, (_unused, index) => clamp(finite(source[index]), minimum, maximum));
}

function legacyBands(value = {}) {
  return {
    subBass: clamp(finite(value.subBass)),
    bass: clamp(finite(value.bass)),
    lowMid: clamp(finite(value.lowMid)),
    mid: clamp(finite(value.mid)),
    highMid: clamp(finite(value.highMid)),
    treble: clamp(finite(value.treble)),
  };
}

function legacyStereo(value = {}) {
  return {
    balance: clamp(finite(value.balance), -1, 1),
    width: clamp(finite(value.width)),
  };
}

function legacyAudio(value = {}) {
  return {
    connected: Boolean(value.connected),
    silence: value.silence !== false,
    volume: clamp(finite(value.volume)),
    peak: clamp(finite(value.peak)),
    transient: clamp(finite(value.transient)),
    beat: clamp(finite(value.beat)),
    tempo: Math.max(0, finite(value.tempo)),
    tempoConfidence: clamp(finite(value.tempoConfidence)),
    spectralFlux: clamp(finite(value.spectralFlux)),
    spectralCentroid: clamp(finite(value.spectralCentroid)),
    bands: legacyBands(value.bands),
    stereo: legacyStereo(value.stereo),
    waveform: fixedArray(value.waveform, 128, -1, 1),
    spectrum: fixedArray(value.spectrum, 96),
  };
}

function dynamics(value = {}) {
  return {
    fast: clamp(finite(value.fast)),
    slow: clamp(finite(value.slow)),
    attack: clamp(finite(value.attack)),
    release: clamp(finite(value.release)),
    quietness: clamp(finite(value.quietness, 1)),
    silenceSeconds: clamp(finite(value.silenceSeconds), 0, EXPRESSIVE_SILENCE_CAP_SECONDS),
    crest: clamp(finite(value.crest)),
    surge: clamp(finite(value.surge)),
  };
}

function event(value = {}) {
  return {
    pulse: clamp(finite(value.pulse)),
    strength: clamp(finite(value.strength)),
    ageSeconds: clamp(finite(value.ageSeconds, EXPRESSIVE_AGE_CAP_SECONDS), 0, EXPRESSIVE_AGE_CAP_SECONDS),
  };
}

function events(value = {}) {
  return {
    onset: event(value.onset),
    lowImpact: event(value.lowImpact),
    midHit: event(value.midHit),
    highSpark: event(value.highSpark),
  };
}

function rhythm(value = {}) {
  const confidence = clamp(finite(value.confidence));
  return {
    pulse: clamp(finite(value.pulse)),
    phase: confidence >= 0.55 ? clamp(finite(value.phase)) : 0,
    tempo: confidence >= 0.42 ? clamp(finite(value.tempo), 0, 300) : 0,
    confidence,
  };
}

export function createZeroExpressiveAudio() {
  return {
    version: EXPRESSIVE_AUDIO_VERSION,
    dynamics: dynamics(),
    events: events(),
    rhythm: rhythm(),
    frequency: {
      logBands: Array(EXPRESSIVE_LOG_BAND_COUNT).fill(0),
      bandAttack: Array(EXPRESSIVE_LOG_BAND_COUNT).fill(0),
    },
  };
}

export function normalizeExpressiveAudio(value = {}) {
  return {
    version: EXPRESSIVE_AUDIO_VERSION,
    dynamics: dynamics(value.dynamics),
    events: events(value.events),
    rhythm: rhythm(value.rhythm),
    frequency: {
      logBands: fixedArray(value.frequency?.logBands, EXPRESSIVE_LOG_BAND_COUNT),
      bandAttack: fixedArray(value.frequency?.bandAttack, EXPRESSIVE_LOG_BAND_COUNT),
    },
  };
}

export function resolveAudioApiVersion(value) {
  return value === AUDIO_API_V2 ? AUDIO_API_V2 : AUDIO_API_V1;
}

export function isKnownAudioApiVersion(value) {
  return value === AUDIO_API_V1 || value === AUDIO_API_V2;
}

export function projectVisualizerFrame(frame = {}, requestedVersion = AUDIO_API_V1) {
  const version = resolveAudioApiVersion(requestedVersion);
  const audio = legacyAudio(frame.audio);
  if (version === AUDIO_API_V2) audio.expressive = normalizeExpressiveAudio(frame.audio?.expressive);
  return {
    version,
    time: Math.max(0, finite(frame.time)),
    deltaTime: Math.max(0, finite(frame.deltaTime)),
    audio,
    pointer: {
      x: clamp(finite(frame.pointer?.x, 0.5)),
      y: clamp(finite(frame.pointer?.y, 0.5)),
      active: Boolean(frame.pointer?.active),
      down: Boolean(frame.pointer?.down),
    },
    viewport: {
      width: Math.max(1, finite(frame.viewport?.width, 1)),
      height: Math.max(1, finite(frame.viewport?.height, 1)),
      dpr: Math.max(0.1, finite(frame.viewport?.dpr, 1)),
    },
  };
}

export function createInitialVisualizerFrame(requestedVersion = AUDIO_API_V1, viewport = {}) {
  return projectVisualizerFrame({
    time: 0,
    deltaTime: 0,
    audio: {},
    pointer: { x: 0.5, y: 0.5, active: false, down: false },
    viewport,
  }, requestedVersion);
}

export function visualizerFrameShape(frame) {
  const audio = frame?.audio || {};
  const expressive = audio.expressive || null;
  return {
    frame: Object.keys(frame || {}),
    audio: Object.keys(audio),
    bands: Object.keys(audio.bands || {}),
    stereo: Object.keys(audio.stereo || {}),
    waveformLength: Array.isArray(audio.waveform) ? audio.waveform.length : -1,
    spectrumLength: Array.isArray(audio.spectrum) ? audio.spectrum.length : -1,
    pointer: Object.keys(frame?.pointer || {}),
    viewport: Object.keys(frame?.viewport || {}),
    expressive: expressive ? {
      root: Object.keys(expressive),
      dynamics: Object.keys(expressive.dynamics || {}),
      events: Object.keys(expressive.events || {}),
      event: Object.keys(expressive.events?.onset || {}),
      rhythm: Object.keys(expressive.rhythm || {}),
      frequency: Object.keys(expressive.frequency || {}),
      logBandsLength: Array.isArray(expressive.frequency?.logBands) ? expressive.frequency.logBands.length : -1,
      bandAttackLength: Array.isArray(expressive.frequency?.bandAttack) ? expressive.frequency.bandAttack.length : -1,
    } : null,
  };
}

export { V1_AUDIO_KEYS };
