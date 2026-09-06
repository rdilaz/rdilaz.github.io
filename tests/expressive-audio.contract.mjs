import assert from 'node:assert/strict';
import test from 'node:test';
import { ExpressiveAudioProcessor } from '../public/visualizer/expressive-audio.js';

const SAMPLE_RATE = 48000;
const FFT_SIZE = 4096;
const BIN_COUNT = FFT_SIZE / 2;
const STEP = 1 / 60;

function silentSpectrum() {
  return new Float32Array(BIN_COUNT).fill(-120);
}

function toneSpectrum(frequency, decibels = -18) {
  const values = silentSpectrum();
  const bin = Math.round(frequency / (SAMPLE_RATE / FFT_SIZE));
  for (let offset = -1; offset <= 1; offset += 1) {
    if (bin + offset >= 0 && bin + offset < values.length) values[bin + offset] = decibels - Math.abs(offset) * 5;
  }
  return values;
}

function regionSpectrum(minimumHz, maximumHz, decibels = -27) {
  const values = silentSpectrum();
  const binHz = SAMPLE_RATE / FFT_SIZE;
  const start = Math.max(0, Math.floor(minimumHz / binHz));
  const end = Math.min(values.length, Math.ceil(maximumHz / binHz));
  for (let index = start; index < end; index += 1) {
    values[index] = decibels - ((index - start) % 5) * 0.35;
  }
  return values;
}

function sample(processor, time, {
  volume = 0,
  peak = volume * 1.5,
  spectrum = null,
  connected = true,
} = {}) {
  return processor.process({
    timestampSeconds: time,
    connected,
    rawVolume: volume,
    rawPeak: peak,
    frequencyData: spectrum || silentSpectrum(),
    frequencyKind: 'decibels',
    sampleRate: SAMPLE_RATE,
    fftSize: FFT_SIZE,
  });
}

function settleSilence(processor, start = 0, duration = 0.25) {
  let output;
  for (let time = start; time <= start + duration + 1e-9; time += STEP) output = sample(processor, time);
  return { output, time: start + duration + STEP };
}

function entrance({ frequency = 70, volume = 0.2, peak = volume * 1.7, spectrum = null } = {}) {
  const processor = new ExpressiveAudioProcessor();
  const settled = settleSilence(processor);
  const output = sample(processor, settled.time, {
    volume,
    peak,
    spectrum: spectrum || toneSpectrum(frequency),
  });
  return { processor, output, time: settled.time };
}

function maximumIndex(values) {
  let bestIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[bestIndex]) bestIndex = index;
  }
  return bestIndex;
}

function assertFiniteBounded(value, path = 'expressive') {
  if (Array.isArray(value)) {
    assert.equal(value.length, 24, `${path} has the fixed band count`);
    value.forEach((entry, index) => assertFiniteBounded(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    if (path === 'expressive') assert.equal(value.version, 'visualizer-expressive-audio-v1');
    Object.entries(value).forEach(([key, entry]) => {
      if (key !== 'version') assertFiniteBounded(entry, `${path}.${key}`);
    });
    return;
  }
  if (typeof value === 'number') {
    assert.equal(Number.isFinite(value), true, `${path} is finite`);
    assert.ok(value >= 0, `${path} is nonnegative`);
    if (path.endsWith('.tempo')) assert.ok(value <= 300, `${path} is capped`);
    else if (path.endsWith('.silenceSeconds')) assert.ok(value <= 300, `${path} is capped`);
    else if (path.endsWith('.ageSeconds')) assert.ok(value <= 30, `${path} is capped`);
    else assert.ok(value <= 1, `${path} is at most one`);
    return;
  }
  assert.fail(`${path} must be numeric`);
}

test('silence advances quiet state without false events or invalid output', () => {
  const processor = new ExpressiveAudioProcessor();
  let output;
  for (let frame = 0; frame <= 240; frame += 1) output = sample(processor, frame * STEP);
  assert.ok(output.dynamics.quietness > 0.97);
  assert.ok(output.dynamics.silenceSeconds > 3.9);
  for (const event of Object.values(output.events)) {
    assert.equal(event.pulse, 0);
    assert.equal(event.strength, 0);
  }
  assert.equal(output.rhythm.tempo, 0);
  assert.equal(output.rhythm.confidence, 0);
  assertFiniteBounded(output);
});

test('low-level noise cannot train itself into false maximum activity', () => {
  const processor = new ExpressiveAudioProcessor();
  const noise = regionSpectrum(30, 15000, -76);
  let output;
  for (let frame = 0; frame <= 600; frame += 1) {
    output = sample(processor, frame * STEP, { volume: 0.0012, peak: 0.003, spectrum: noise });
  }
  assert.ok(output.dynamics.quietness > 0.9);
  assert.ok(output.dynamics.fast < 0.08);
  assert.ok(Math.max(...output.frequency.logBands) < 0.08);
  assert.ok(Math.max(...Object.values(output.events).map(event => event.strength)) < 0.08);
});

test('broad and regional events distinguish low, mid, and high attacks', () => {
  const low = entrance({ frequency: 70, volume: 0.24 }).output;
  const mid = entrance({ volume: 0.2, spectrum: regionSpectrum(650, 1800, -22) }).output;
  const high = entrance({ volume: 0.16, peak: 0.55, spectrum: regionSpectrum(6000, 11000, -20) }).output;

  assert.ok(low.events.onset.strength > 0.2);
  assert.ok(mid.events.onset.strength > 0.2);
  assert.ok(high.events.onset.strength > 0.2);
  assert.ok(low.events.lowImpact.strength > low.events.midHit.strength + 0.2);
  assert.ok(low.events.lowImpact.strength > low.events.highSpark.strength + 0.2);
  assert.ok(mid.events.midHit.strength > mid.events.lowImpact.strength + 0.15);
  assert.ok(mid.events.midHit.strength > mid.events.highSpark.strength + 0.15);
  assert.ok(high.events.highSpark.strength > high.events.lowImpact.strength + 0.15);
  assert.ok(high.events.highSpark.strength > high.events.midHit.strength + 0.15);
});

test('hard low impacts preserve greater strength than soft impacts', () => {
  const soft = entrance({ frequency: 68, volume: 0.055, peak: 0.12, spectrum: toneSpectrum(68, -29) }).output;
  const hard = entrance({ frequency: 68, volume: 0.27, peak: 0.62, spectrum: toneSpectrum(68, -16) }).output;
  assert.ok(soft.events.lowImpact.strength > 0.1);
  assert.ok(hard.events.lowImpact.strength > soft.events.lowImpact.strength + 0.2);
  assert.ok(hard.events.onset.strength > soft.events.onset.strength + 0.2);
});

test('log bands localize sustained tones and band attack settles after entrance', () => {
  const cases = [
    { frequency: 55, expected: [1, 6] },
    { frequency: 900, expected: [11, 15] },
    { frequency: 8000, expected: [20, 23] },
  ];
  for (const fixture of cases) {
    const processor = new ExpressiveAudioProcessor();
    let time = settleSilence(processor).time;
    const spectrum = toneSpectrum(fixture.frequency);
    const entranceOutput = sample(processor, time, { volume: 0.22, spectrum });
    const attackMaximum = Math.max(...entranceOutput.frequency.bandAttack);
    let sustained = entranceOutput;
    for (let frame = 1; frame <= 90; frame += 1) {
      time += STEP;
      sustained = sample(processor, time, { volume: 0.22, spectrum });
    }
    const index = maximumIndex(sustained.frequency.logBands);
    assert.ok(index >= fixture.expected[0] && index <= fixture.expected[1], `${fixture.frequency} Hz localized to band ${index}`);
    assert.ok(attackMaximum > 0.25);
    assert.ok(Math.max(...sustained.frequency.bandAttack) < 0.04);
    assert.ok(sustained.events.onset.ageSeconds > 1);
    assert.ok(sustained.events.onset.pulse < 0.02);
  }
});

test('every tested sampling and 30 FPS delivery phase retains a short event', () => {
  const phaseOffsets = [0, 1 / 240, 1 / 120, 1 / 80, 1 / 60, 1 / 48, 1 / 40, 7 / 240];
  for (const phaseOffset of phaseOffsets) {
    const processor = new ExpressiveAudioProcessor();
    const eventAt = 0.5 + phaseOffset;
    const analysisWindow = FFT_SIZE / SAMPLE_RATE;
    let maximumDeliveredPulse = 0;
    let nextDelivery = 0;
    for (let frame = 0; frame <= 75; frame += 1) {
      const time = frame * STEP;
      const eventVisibleToAnalyser = time >= eventAt && time <= eventAt + analysisWindow;
      const output = sample(processor, time, eventVisibleToAnalyser
        ? { volume: 0.2, peak: 0.58, spectrum: regionSpectrum(45, 160, -18) }
        : {});
      if (time + 1e-9 >= nextDelivery) {
        maximumDeliveredPulse = Math.max(maximumDeliveredPulse, output.events.lowImpact.pulse);
        nextDelivery += 1 / 30;
      }
    }
    assert.ok(maximumDeliveredPulse > 0.2, `phase ${phaseOffset.toFixed(5)} retained ${maximumDeliveredPulse}`);
  }
});

function runImpactTrain(times) {
  const processor = new ExpressiveAudioProcessor();
  const duration = Math.max(...times) + 0.75;
  const spectrum = toneSpectrum(65, -17);
  let output;
  let phaseAfterEvidence = 0;
  for (let frame = 0; frame <= Math.ceil(duration / STEP); frame += 1) {
    const time = frame * STEP;
    const active = times.some(eventAt => time >= eventAt && time < eventAt + 0.055);
    output = sample(processor, time, active ? { volume: 0.24, peak: 0.58, spectrum } : {});
    if (output.rhythm.confidence >= 0.55 && !active) phaseAfterEvidence = Math.max(phaseAfterEvidence, output.rhythm.phase);
  }
  return { output, phaseAfterEvidence, onsetHistoryLength: processor.rhythmOnsets.length };
}

test('regular approximately 125 BPM impacts develop tempo and phase confidence', () => {
  const regular = runImpactTrain(Array.from({ length: 10 }, (_unused, index) => 0.4 + index * 0.48));
  assert.ok(regular.output.rhythm.tempo >= 122 && regular.output.rhythm.tempo <= 128, String(regular.output.rhythm.tempo));
  assert.ok(regular.output.rhythm.confidence >= 0.55, String(regular.output.rhythm.confidence));
  assert.ok(regular.phaseAfterEvidence > 0.1);
});

test('one missed onset preserves the dominant period while repeated half-time ambiguity does not', () => {
  const oneMiss = runImpactTrain([0.4, 0.88, 1.36, 2.32, 2.8, 3.28, 3.76, 4.24, 4.72]);
  assert.ok(oneMiss.output.rhythm.tempo >= 122 && oneMiss.output.rhythm.tempo <= 128, String(oneMiss.output.rhythm.tempo));
  assert.ok(oneMiss.output.rhythm.confidence >= 0.5, String(oneMiss.output.rhythm.confidence));

  const alternating = runImpactTrain([0.4, 0.88, 1.84, 2.32, 3.28, 3.76, 4.72, 5.2, 6.16]);
  assert.ok(alternating.output.rhythm.confidence < 0.42, String(alternating.output.rhythm.confidence));
  assert.equal(alternating.output.rhythm.tempo, 0);
});

test('a quiet break clears stale rhythm and a new regular train reacquires promptly', () => {
  const first = Array.from({ length: 8 }, (_unused, index) => 0.4 + index * 0.48);
  const secondStart = first.at(-1) + 2.6;
  const second = Array.from({ length: 8 }, (_unused, index) => secondStart + index * 0.48);
  const processor = new ExpressiveAudioProcessor();
  const spectrum = toneSpectrum(65, -17);
  let output;
  let confidenceDuringBreak = 1;
  for (let frame = 0; frame <= Math.ceil((second.at(-1) + 0.4) / STEP); frame += 1) {
    const time = frame * STEP;
    const active = [...first, ...second].some(eventAt => time >= eventAt && time < eventAt + 0.055);
    output = sample(processor, time, active ? { volume: 0.24, peak: 0.58, spectrum } : {});
    if (time > first.at(-1) + 1.8 && time < secondStart) confidenceDuringBreak = output.rhythm.confidence;
  }
  assert.ok(confidenceDuringBreak < 0.1, String(confidenceDuringBreak));
  assert.ok(output.rhythm.tempo >= 122 && output.rhythm.tempo <= 128, String(output.rhythm.tempo));
  assert.ok(output.rhythm.confidence >= 0.5, String(output.rhythm.confidence));
});

test('rhythm onset history remains bounded under a long regular train', () => {
  const times = Array.from({ length: 40 }, (_unused, index) => 0.4 + index * 0.48);
  const result = runImpactTrain(times);
  assert.ok(result.output.rhythm.confidence >= 0.5);
  assert.ok(result.output.rhythm.tempo >= 122 && result.output.rhythm.tempo <= 128);
  assert.ok(result.onsetHistoryLength <= 16);
});

test('time-based attack semantics stay stable across 30, 60, and 120 Hz analysis cadence', () => {
  const maxima = [];
  for (const fps of [30, 60, 120]) {
    const processor = new ExpressiveAudioProcessor();
    const step = 1 / fps;
    let maximumOnset = 0;
    for (let frame = 0; frame <= Math.ceil(0.9 / step); frame += 1) {
      const time = frame * step;
      const progress = Math.max(0, Math.min(1, (time - 0.2) / 0.24));
      const decibels = progress ? -72 + progress * 54 : -120;
      const output = sample(processor, time, {
        volume: progress * 0.22,
        peak: progress * 0.42,
        spectrum: toneSpectrum(72, decibels),
      });
      maximumOnset = Math.max(maximumOnset, output.events.onset.strength);
    }
    maxima.push(maximumOnset);
  }
  assert.ok(Math.min(...maxima) > 0.09, JSON.stringify(maxima));
  assert.ok(Math.max(...maxima) - Math.min(...maxima) < 0.1, JSON.stringify(maxima));
});

test('soft abrupt regional events remain classified across 30, 60, and 120 Hz cadence', () => {
  const events = [];
  for (const fps of [30, 60, 120]) {
    const processor = new ExpressiveAudioProcessor();
    const step = 1 / fps;
    let onset = 0;
    let lowImpact = 0;
    for (let frame = 0; frame <= Math.ceil(0.7 / step); frame += 1) {
      const time = frame * step;
      const active = time >= 0.25 && time < 0.35;
      const output = sample(processor, time, active
        ? { volume: 0.015, peak: 0.032, spectrum: toneSpectrum(72, -38) }
        : {});
      onset = Math.max(onset, output.events.onset.strength);
      lowImpact = Math.max(lowImpact, output.events.lowImpact.strength);
    }
    events.push({ fps, onset, lowImpact });
  }
  assert.ok(events.every(event => event.onset > 0.05), JSON.stringify(events));
  assert.ok(events.every(event => event.lowImpact > 0.05), JSON.stringify(events));
});

test('byte analyser fallback matches equivalent decibel energy', () => {
  const decibels = toneSpectrum(900, -44);
  const bytes = Uint8Array.from(decibels, value => Math.round((Math.max(-100, Math.min(-12, value)) + 100) / 88 * 255));
  const decibelProcessor = new ExpressiveAudioProcessor();
  const byteProcessor = new ExpressiveAudioProcessor();
  settleSilence(decibelProcessor);
  settleSilence(byteProcessor);
  const decibelOutput = decibelProcessor.process({
    timestampSeconds: 0.3,
    connected: true,
    rawVolume: 0.18,
    rawPeak: 0.3,
    frequencyData: decibels,
    frequencyKind: 'decibels',
    sampleRate: SAMPLE_RATE,
    fftSize: FFT_SIZE,
  });
  const byteOutput = byteProcessor.process({
    timestampSeconds: 0.3,
    connected: true,
    rawVolume: 0.18,
    rawPeak: 0.3,
    frequencyData: bytes,
    frequencyKind: 'bytes',
    frequencyMinDecibels: -100,
    frequencyMaxDecibels: -12,
    sampleRate: SAMPLE_RATE,
    fftSize: FFT_SIZE,
  });
  const peakBand = maximumIndex(decibelOutput.frequency.logBands);
  assert.equal(maximumIndex(byteOutput.frequency.logBands), peakBand);
  assert.ok(Math.abs(byteOutput.frequency.logBands[peakBand] - decibelOutput.frequency.logBands[peakBand]) < 0.02);
});

test('irregular impacts remain low-confidence and do not claim tempo', () => {
  const irregular = runImpactTrain([0.4, 0.73, 1.56, 2.01, 3.04, 3.42, 4.15, 4.72, 5.81]);
  assert.ok(irregular.output.rhythm.confidence < 0.42, String(irregular.output.rhythm.confidence));
  assert.equal(irregular.output.rhythm.tempo, 0);
  assert.equal(irregular.output.rhythm.phase, 0);
});

test('silence-to-full entrance produces surge without stale state across boundaries', () => {
  const processor = new ExpressiveAudioProcessor();
  let time = settleSilence(processor, 0, 3.4).time;
  const entranceOutput = sample(processor, time, {
    volume: 0.28,
    peak: 0.72,
    spectrum: regionSpectrum(35, 14000, -24),
  });
  assert.ok(entranceOutput.dynamics.surge > 0.35);
  assert.ok(entranceOutput.events.onset.strength > 0.3);

  for (const reason of ['pause', 'seek', 'source-replacement', 'resume']) {
    processor.reset(time);
    time += STEP;
    const resetOutput = sample(processor, time);
    assert.equal(resetOutput.rhythm.tempo, 0, reason);
    assert.equal(resetOutput.rhythm.confidence, 0, reason);
    assert.equal(resetOutput.events.onset.pulse, 0, reason);
    assert.equal(resetOutput.events.lowImpact.pulse, 0, reason);
    assertFiniteBounded(resetOutput, reason);
  }
});

test('resume and suspension prime sustained audio without manufacturing an impact', () => {
  const processor = new ExpressiveAudioProcessor();
  let time = settleSilence(processor).time;
  const spectrum = toneSpectrum(70);
  for (let frame = 0; frame < 40; frame += 1) {
    time += STEP;
    sample(processor, time, { volume: 0.22, peak: 0.34, spectrum });
  }
  processor.reset(time);
  time += STEP;
  const resumed = sample(processor, time, { volume: 0.22, peak: 0.34, spectrum });
  assert.equal(resumed.events.onset.pulse, 0);
  assert.equal(resumed.events.lowImpact.pulse, 0);
  assert.equal(resumed.dynamics.attack, 0);
  assert.equal(resumed.dynamics.surge, 0);

  const suspended = sample(processor, time + 0.4, { volume: 0.22, peak: 0.34, spectrum });
  assert.equal(suspended.events.onset.pulse, 0);
  assert.equal(suspended.events.lowImpact.pulse, 0);
  assert.equal(suspended.rhythm.tempo, 0);
});

test('quiet duration and event age account for a sub-reset 200 ms gap', () => {
  const processor = new ExpressiveAudioProcessor();
  sample(processor, 0);
  const output = sample(processor, 0.2);
  assert.ok(output.dynamics.silenceSeconds >= 0.199 && output.dynamics.silenceSeconds <= 0.201);
  assert.ok(output.events.onset.ageSeconds >= 0.199);
});
