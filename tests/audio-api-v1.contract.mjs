import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIO_API_V1,
  AUDIO_API_V2,
  createInitialVisualizerFrame,
  projectVisualizerFrame,
  visualizerFrameShape,
} from '../public/visualizer/audio-contract.js';
import { createSyntheticFrame } from '../public/visualizer/reliability.js';

const V1_SHAPE = {
  frame: ['version', 'time', 'deltaTime', 'audio', 'pointer', 'viewport'],
  audio: [
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
  ],
  bands: ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'treble'],
  stereo: ['balance', 'width'],
  waveformLength: 128,
  spectrumLength: 96,
  pointer: ['x', 'y', 'active', 'down'],
  viewport: ['width', 'height', 'dpr'],
  expressive: null,
};

test('V1 initial and synthetic frames retain the exact pre-milestone recursive shape', () => {
  const initial = createInitialVisualizerFrame(AUDIO_API_V1, { width: 640, height: 360, dpr: 1 });
  const synthetic = createSyntheticFrame(7, 350, { width: 640, height: 360, dpr: 1 });
  assert.deepEqual(visualizerFrameShape(initial), V1_SHAPE);
  assert.deepEqual(visualizerFrameShape(synthetic), V1_SHAPE);
  assert.equal(initial.version, AUDIO_API_V1);
  assert.equal(Object.hasOwn(initial.audio, 'expressive'), false);
  assert.equal(Object.hasOwn(synthetic.audio, 'expressive'), false);
});

test('V1 projection strips every V2-only or unknown enumerable field', () => {
  const v2 = createSyntheticFrame(11, 500, { width: 800, height: 450, dpr: 1.5 }, 60, AUDIO_API_V2);
  v2.unknownFrameField = 'must-not-cross';
  v2.audio.unknownAudioField = 'must-not-cross';
  v2.audio.bands.unknownBand = 1;
  v2.pointer.unknownPointer = true;
  v2.viewport.unknownViewport = true;
  const projected = projectVisualizerFrame(v2, AUDIO_API_V1);

  assert.deepEqual(visualizerFrameShape(projected), V1_SHAPE);
  assert.equal(projected.version, AUDIO_API_V1);
  assert.equal(Object.hasOwn(projected.audio, 'expressive'), false);
  assert.equal(JSON.stringify(projected).includes('must-not-cross'), false);
});

test('absent and unknown contract declarations fail safely to exact V1', () => {
  const source = createSyntheticFrame(3, 250, { width: 320, height: 180, dpr: 1 }, 30, AUDIO_API_V2);
  for (const value of [undefined, null, '', 'visualizer-audio-v3', 'VISUALIZER-AUDIO-V2', {}]) {
    const projected = projectVisualizerFrame(source, value);
    assert.equal(projected.version, AUDIO_API_V1);
    assert.deepEqual(visualizerFrameShape(projected), V1_SHAPE);
  }
});

test('V2 remains fixed and nested without changing V1 fields', () => {
  const source = createSyntheticFrame(9, 430, { width: 640, height: 360, dpr: 1 }, 60, AUDIO_API_V2);
  const v1 = projectVisualizerFrame(source, AUDIO_API_V1);
  const v2 = projectVisualizerFrame(source, AUDIO_API_V2);
  const { expressive, ...v2LegacyAudio } = v2.audio;
  assert.deepEqual(v2LegacyAudio, v1.audio);
  assert.equal(v2.version, AUDIO_API_V2);
  assert.equal(expressive.version, 'visualizer-expressive-audio-v1');
  assert.deepEqual(Object.keys(expressive), ['version', 'dynamics', 'events', 'rhythm', 'frequency']);
  assert.deepEqual(Object.keys(expressive.dynamics), [
    'fast', 'slow', 'attack', 'release', 'quietness', 'silenceSeconds', 'crest', 'surge',
  ]);
  assert.deepEqual(Object.keys(expressive.events), ['onset', 'lowImpact', 'midHit', 'highSpark']);
  assert.deepEqual(Object.keys(expressive.events.onset), ['pulse', 'strength', 'ageSeconds']);
  assert.deepEqual(Object.keys(expressive.rhythm), ['pulse', 'phase', 'tempo', 'confidence']);
  assert.deepEqual(Object.keys(expressive.frequency), ['logBands', 'bandAttack']);
  assert.equal(expressive.frequency.logBands.length, 24);
  assert.equal(expressive.frequency.bandAttack.length, 24);
});

test('V2 reliability stimulation keeps quiet, event-age, attack, and rhythm semantics truthful', () => {
  const viewport = { width: 640, height: 360, dpr: 1 };
  const quiet = createSyntheticFrame(2, 100, viewport, 60, AUDIO_API_V2);
  assert.equal(quiet.audio.silence, true);
  assert.equal(quiet.audio.volume, 0);
  assert.ok(quiet.audio.expressive.dynamics.silenceSeconds > 0.09);
  assert.equal(quiet.audio.expressive.events.onset.pulse, 0);
  assert.equal(quiet.audio.expressive.events.lowImpact.ageSeconds, 30);
  assert.equal(Math.max(...quiet.audio.expressive.frequency.logBands), 0);
  assert.equal(Math.max(...quiet.audio.expressive.frequency.bandAttack), 0);
  assert.equal(quiet.audio.expressive.dynamics.release, 0);
  assert.equal(quiet.audio.expressive.dynamics.crest, 0);
  assert.equal(quiet.audio.expressive.dynamics.surge, 0);

  const lowEntrance = createSyntheticFrame(12, 210, viewport, 60, AUDIO_API_V2);
  const lowSettled = createSyntheticFrame(20, 400, viewport, 60, AUDIO_API_V2);
  assert.ok(lowEntrance.audio.expressive.events.lowImpact.pulse > 0.5);
  assert.ok(lowEntrance.audio.expressive.events.lowImpact.ageSeconds > 0);
  assert.ok(Math.max(...lowEntrance.audio.expressive.frequency.bandAttack)
    > Math.max(...lowSettled.audio.expressive.frequency.bandAttack));

  const secondQuiet = createSyntheticFrame(75, 1250, viewport, 60, AUDIO_API_V2);
  assert.equal(secondQuiet.audio.silence, true);
  assert.ok(secondQuiet.audio.expressive.dynamics.silenceSeconds < 0.1);
  assert.equal(secondQuiet.audio.expressive.rhythm.tempo, 200);
  assert.ok(secondQuiet.audio.expressive.rhythm.confidence >= 0.55);
  assert.ok(secondQuiet.audio.expressive.rhythm.phase >= 0 && secondQuiet.audio.expressive.rhythm.phase <= 1);
});
