import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIO_SENSITIVITY_SCHEMA,
  AUDIO_SENSITIVITY_STEP_PERCENT,
  AUDIO_SENSITIVITY_STORAGE_KEY,
  AUDIO_SENSITIVITY_VERSION,
  DEFAULT_AUDIO_SENSITIVITY_PERCENT,
  MAX_AUDIO_SENSITIVITY_PERCENT,
  MIN_AUDIO_SENSITIVITY_PERCENT,
  applyAudioSensitivity,
  createAudioSensitivityController,
} from '../public/visualizer/audio-sensitivity.js';

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

function sampleFixture() {
  return {
    schema: 'visualizer-audio-v1',
    connected: true,
    silence: false,
    volume: 0.4,
    peak: 0.8,
    transient: 0.6,
    beat: 0.75,
    tempo: 123.4,
    tempoConfidence: 0.67,
    spectralFlux: 0.7,
    spectralCentroid: 0.43,
    bands: {
      subBass: 0.2,
      bass: 0.4,
      lowMid: 0.6,
      mid: 0.8,
      highMid: 0.9,
      treble: 1,
      unrelatedBand: 7,
    },
    stereo: { balance: -0.24, width: 0.86 },
    waveform: [-0.75, -0.5, 0, 0.5, 0.75],
    spectrum: [0.2, 0.4, 0.6, 1],
    time: 42.5,
    deltaTime: 0.016,
    unrelated: { retained: true },
  };
}

test('schema and sensitivity range are explicitly versioned host policy', () => {
  assert.equal(AUDIO_SENSITIVITY_SCHEMA, 'visualizer-audio-sensitivity-v1');
  assert.equal(AUDIO_SENSITIVITY_VERSION, AUDIO_SENSITIVITY_SCHEMA);
  assert.equal(DEFAULT_AUDIO_SENSITIVITY_PERCENT, 100);
  assert.equal(MIN_AUDIO_SENSITIVITY_PERCENT, 50);
  assert.equal(MAX_AUDIO_SENSITIVITY_PERCENT, 200);
  assert.equal(AUDIO_SENSITIVITY_STEP_PERCENT, 10);
});

test('milestones 107-111, 113: controls change synchronously, quantize, clamp, and reset', () => {
  let timestamp = 1000;
  const controller = createAudioSensitivityController({
    storage: createMemoryStorage(),
    clock: () => ++timestamp,
  });
  const observed = [];
  const unsubscribe = controller.subscribe(snapshot => observed.push(snapshot));

  assert.equal(controller.version, AUDIO_SENSITIVITY_SCHEMA);
  assert.equal(controller.snapshot().sensitivityPercent, 100, '107: default is 100%');
  assert.equal(observed.length, 1, 'subscription immediately exposes the current value');

  assert.equal(controller.increase().sensitivityPercent, 110, '108: Up increases one step');
  controller.reset();
  assert.equal(controller.decrease().sensitivityPercent, 90, '109: Down decreases one step');
  assert.equal(controller.setSensitivity(-100).sensitivityPercent, 50, '110: lower bound');
  assert.equal(controller.decrease().sensitivityPercent, 50, 'lower bound remains stable');
  assert.equal(controller.setSensitivity(999).sensitivityPercent, 200, '111: upper bound');
  assert.equal(controller.increase().sensitivityPercent, 200, 'upper bound remains stable');
  assert.equal(controller.setSensitivity('137').sensitivityPercent, 140, '113: range-control strings use 10% steps');
  assert.equal(controller.reset().sensitivityPercent, 100, 'reset immediately restores the default');
  assert.equal(controller.snapshot().changedAt, 1007);
  assert.equal(Object.isFrozen(controller.snapshot()), true);
  assert.equal(observed.at(-1).sensitivityPercent, 100, 'subscribers see reset synchronously');

  const observedBeforeUnsubscribe = observed.length;
  unsubscribe();
  controller.increase();
  assert.equal(observed.length, observedBeforeUnsubscribe);
});

test('milestone 112: injected local storage persists a versioned value across reload and reset', () => {
  const storage = createMemoryStorage();
  const first = createAudioSensitivityController({ storage, clock: () => 1234 });
  first.setSensitivity(170);

  assert.deepEqual(JSON.parse(storage.getItem(AUDIO_SENSITIVITY_STORAGE_KEY)), {
    schema: AUDIO_SENSITIVITY_SCHEMA,
    sensitivityPercent: 170,
    changedAt: 1234,
  });

  const reloaded = createAudioSensitivityController({ storage, clock: () => 2000 });
  assert.deepEqual(reloaded.snapshot(), {
    schema: AUDIO_SENSITIVITY_SCHEMA,
    sensitivityPercent: 170,
    changedAt: 1234,
  });
  reloaded.reset();
  assert.equal(createAudioSensitivityController({ storage }).snapshot().sensitivityPercent, 100);

  const staleStorage = createMemoryStorage({
    [AUDIO_SENSITIVITY_STORAGE_KEY]: JSON.stringify({
      schema: 'visualizer-audio-sensitivity-v0',
      sensitivityPercent: 200,
      changedAt: 1,
    }),
  });
  assert.equal(createAudioSensitivityController({ storage: staleStorage }).snapshot().sensitivityPercent, 100);
});

test('milestones 114-120: post-engine transform scales and clamps all reactive fields', () => {
  const source = sampleFixture();
  const before = structuredClone(source);
  const transformed = applyAudioSensitivity(source, 200);

  assert.equal(transformed.volume, 0.8, '114: volume');
  assert.equal(transformed.peak, 1, '115: peak');
  assert.equal(transformed.transient, 1, '116: transient');
  assert.equal(transformed.beat, 1, '117: beat clamps');
  assert.equal(transformed.spectralFlux, 1, 'spectral flux is intensity-like');
  assert.deepEqual(transformed.bands, {
    subBass: 0.4,
    bass: 0.8,
    lowMid: 1,
    mid: 1,
    highMid: 1,
    treble: 1,
    unrelatedBand: 7,
  }, '118: every named band scales and clamps');
  assert.deepEqual(transformed.spectrum, [0.4, 0.8, 1, 1], '119: every spectrum value scales and clamps');
  assert.deepEqual(transformed.waveform, [-1, -1, 0, 1, 1], '120: waveform clamps symmetrically around zero');

  assert.notStrictEqual(transformed, source);
  assert.notStrictEqual(transformed.bands, source.bands);
  assert.notStrictEqual(transformed.spectrum, source.spectrum);
  assert.notStrictEqual(transformed.waveform, source.waveform);
  assert.deepEqual(source, before, 'the pure transform must not mutate the AudioEngine sample');
});

test('milestones 120-127: attenuation stays symmetric and non-reactive audio truth is unchanged', () => {
  const source = sampleFixture();
  const transformed = applyAudioSensitivity(source, 50);

  assert.deepEqual(transformed.waveform, [-0.375, -0.25, 0, 0.25, 0.375], '120: negative and positive amplitudes use the same factor');
  assert.equal(transformed.tempo, source.tempo, '121: tempo');
  assert.equal(transformed.tempoConfidence, source.tempoConfidence, '122: tempo confidence');
  assert.equal(transformed.spectralCentroid, source.spectralCentroid, '123: spectral centroid');
  assert.equal(transformed.stereo.balance, source.stereo.balance, '124: stereo balance');
  assert.equal(transformed.stereo.width, source.stereo.width, '125: stereo width');
  assert.equal(transformed.connected, source.connected, '126: connection state');
  assert.equal(transformed.silence, source.silence, '127: silence state');
  assert.equal(transformed.time, source.time);
  assert.equal(transformed.deltaTime, source.deltaTime);
  assert.strictEqual(transformed.stereo, source.stereo);
  assert.strictEqual(transformed.unrelated, source.unrelated);
  assert.deepEqual(Object.keys(transformed), Object.keys(source), 'the VIZ audio schema is unchanged');
  assert.deepEqual(Object.keys(transformed.bands), Object.keys(source.bands));
});

test('100% remains value-neutral while still returning independent transformed containers', () => {
  const source = sampleFixture();
  const transformed = applyAudioSensitivity(source);

  assert.deepEqual(transformed, source);
  assert.notStrictEqual(transformed, source);
  assert.notStrictEqual(transformed.bands, source.bands);
  assert.notStrictEqual(transformed.spectrum, source.spectrum);
  assert.notStrictEqual(transformed.waveform, source.waveform);
});
