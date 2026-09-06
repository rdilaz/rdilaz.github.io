import {
  EXPRESSIVE_AGE_CAP_SECONDS,
  EXPRESSIVE_AUDIO_VERSION,
  EXPRESSIVE_LOG_BAND_COUNT,
  EXPRESSIVE_SILENCE_CAP_SECONDS,
} from './audio-contract.js';

const LOG_MIN_HZ = 30;
const LOG_MAX_HZ = 16000;
const MAX_RHYTHM_ONSETS = 16;
const SILENCE_THRESHOLD = 0.0025;
const EVENT_NAMES = Object.freeze(['onset', 'lowImpact', 'midHit', 'highSpark']);
const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function coefficient(deltaTime, timeConstant) {
  return 1 - Math.exp(-Math.max(0, deltaTime) / Math.max(0.001, timeConstant));
}

function follow(current, target, deltaTime, attackSeconds, releaseSeconds) {
  const timeConstant = target >= current ? attackSeconds : releaseSeconds;
  return current + (target - current) * coefficient(deltaTime, timeConstant);
}

function decay(value, deltaTime, timeConstant) {
  return value * Math.exp(-Math.max(0, deltaTime) / Math.max(0.001, timeConstant));
}

function smoothstep(minimum, maximum, value) {
  const amount = clamp((value - minimum) / Math.max(0.000001, maximum - minimum));
  return amount * amount * (3 - 2 * amount);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function emptyEvent() {
  return {
    pulse: 0,
    strength: 0,
    ageSeconds: EXPRESSIVE_AGE_CAP_SECONDS,
    lastTriggeredAt: -Infinity,
    armed: true,
  };
}

function eventOutput(value) {
  return {
    pulse: clamp(value.pulse),
    strength: clamp(value.strength),
    ageSeconds: clamp(value.ageSeconds, 0, EXPRESSIVE_AGE_CAP_SECONDS),
  };
}

export class ExpressiveAudioProcessor {
  constructor() {
    this.bandCenters = new Float32Array(EXPRESSIVE_LOG_BAND_COUNT);
    const ratio = LOG_MAX_HZ / LOG_MIN_HZ;
    for (let index = 0; index < EXPRESSIVE_LOG_BAND_COUNT; index += 1) {
      const low = LOG_MIN_HZ * Math.pow(ratio, index / EXPRESSIVE_LOG_BAND_COUNT);
      const high = LOG_MIN_HZ * Math.pow(ratio, (index + 1) / EXPRESSIVE_LOG_BAND_COUNT);
      this.bandCenters[index] = Math.sqrt(low * high);
    }
    this.rawBands = new Float32Array(EXPRESSIVE_LOG_BAND_COUNT);
    this.bandBaselines = new Float32Array(EXPRESSIVE_LOG_BAND_COUNT);
    this.bandLevels = new Float32Array(EXPRESSIVE_LOG_BAND_COUNT);
    this.bandAttacks = new Float32Array(EXPRESSIVE_LOG_BAND_COUNT);
    this.reset();
  }

  reset(timestampSeconds = null) {
    this.lastTimestamp = Number.isFinite(Number(timestampSeconds)) ? Number(timestampSeconds) : null;
    this.fast = 0;
    this.slow = 0;
    this.attack = 0;
    this.release = 0;
    this.quietness = 1;
    this.silenceSeconds = 0;
    this.surge = 0;
    this.referenceLevel = 0.12;
    this.noiseFloor = 0.0015;
    this.levelBaseline = 0;
    this.rawBands.fill(0);
    this.bandBaselines.fill(0);
    this.bandLevels.fill(0);
    this.bandAttacks.fill(0);
    this.events = Object.fromEntries(EVENT_NAMES.map(name => [name, emptyEvent()]));
    this.rhythmOnsets = [];
    this.rhythmConfidence = 0;
    this.rhythmTempo = 0;
    this.rhythmPulse = 0;
    this.lastRhythmOnsetAt = -Infinity;
    this.needsBaseline = true;
    return this.snapshot(0);
  }

  frequencyAmplitude(value, frequencyKind, minimumDecibels, maximumDecibels) {
    if (!Number.isFinite(value)) return 0;
    if (frequencyKind === 'normalized') return clamp(value);
    if (frequencyKind === 'bytes') {
      const decibels = minimumDecibels + clamp(value / 255) * (maximumDecibels - minimumDecibels);
      return clamp(Math.pow(10, decibels / 20));
    }
    return clamp(Math.pow(10, clamp(value, -120, 0) / 20));
  }

  analyzeBands(
    frequencyData,
    sampleRate,
    fftSize,
    frequencyKind,
    minimumDecibels,
    maximumDecibels,
    audibility,
    deltaTime,
    prime,
  ) {
    const source = frequencyData && typeof frequencyData.length === 'number' ? frequencyData : [];
    const binHz = Math.max(1, finite(sampleRate, 48000) / Math.max(2, finite(fftSize, 4096)));
    const nyquist = finite(sampleRate, 48000) / 2;
    const ratio = Math.min(LOG_MAX_HZ, nyquist) / LOG_MIN_HZ;
    for (let bandIndex = 0; bandIndex < EXPRESSIVE_LOG_BAND_COUNT; bandIndex += 1) {
      const lowHz = LOG_MIN_HZ * Math.pow(ratio, bandIndex / EXPRESSIVE_LOG_BAND_COUNT);
      const highHz = LOG_MIN_HZ * Math.pow(ratio, (bandIndex + 1) / EXPRESSIVE_LOG_BAND_COUNT);
      const start = Math.max(0, Math.floor(lowHz / binHz));
      const end = Math.min(source.length, Math.max(start + 1, Math.ceil(highHz / binHz)));
      let peak = 0;
      let squares = 0;
      let count = 0;
      for (let index = start; index < end; index += 1) {
        const amplitude = this.frequencyAmplitude(
          Number(source[index]),
          frequencyKind,
          minimumDecibels,
          maximumDecibels,
        );
        peak = Math.max(peak, amplitude);
        squares += amplitude * amplitude;
        count += 1;
      }
      const rms = count ? Math.sqrt(squares / count) : 0;
      const target = clamp(((peak * 0.72 + rms * 0.28) - 0.0003) / 0.125) * audibility;
      this.rawBands[bandIndex] = target;
      const level = prime
        ? target
        : follow(this.bandLevels[bandIndex], target, deltaTime, 0.018, 0.16);
      const positiveChange = Math.max(0, level - this.bandBaselines[bandIndex] - 0.008);
      const cadenceScale = clamp((1 / 60) / Math.max(1 / 240, deltaTime), 0.5, 2);
      const attack = clamp(positiveChange * cadenceScale / 0.12);
      this.bandLevels[bandIndex] = level;
      this.bandAttacks[bandIndex] = prime
        ? 0
        : Math.max(attack, decay(this.bandAttacks[bandIndex], deltaTime, 0.085));
      this.bandBaselines[bandIndex] = prime
        ? level
        : follow(this.bandBaselines[bandIndex], level, deltaTime, 0.11, 0.28);
    }
  }

  regionValue(values, minimumHz, maximumHz) {
    let peak = 0;
    let squares = 0;
    let count = 0;
    for (let index = 0; index < values.length; index += 1) {
      const center = this.bandCenters[index];
      if (center < minimumHz || center >= maximumHz) continue;
      const value = clamp(values[index]);
      peak = Math.max(peak, value);
      squares += value * value;
      count += 1;
    }
    return count ? clamp(peak * 0.7 + Math.sqrt(squares / count) * 0.3) : 0;
  }

  updateEvent(name, candidate, timestamp, deltaTime) {
    const state = this.events[name];
    state.pulse = decay(state.pulse, deltaTime, 0.085);
    state.strength = decay(state.strength, deltaTime, 0.28);
    state.ageSeconds = clamp(state.ageSeconds + deltaTime, 0, EXPRESSIVE_AGE_CAP_SECONDS);
    if (candidate < 0.025) state.armed = true;
    const threshold = 0.06;
    const triggered = state.armed
      && candidate >= threshold
      && timestamp - state.lastTriggeredAt >= 0.065;
    if (triggered) {
      state.pulse = Math.max(state.pulse, candidate);
      state.strength = Math.max(state.strength, candidate);
      state.ageSeconds = 0;
      state.lastTriggeredAt = timestamp;
      state.armed = false;
    } else if (!state.armed && state.ageSeconds <= 0.12 && candidate > state.strength) {
      state.pulse = Math.max(state.pulse, candidate);
      state.strength = candidate;
    }
    return triggered;
  }

  updateRhythm(timestamp, onsetStrength, triggered, deltaTime) {
    this.rhythmPulse = decay(this.rhythmPulse, deltaTime, 0.085);
    if (triggered && onsetStrength >= 0.2 && timestamp - this.lastRhythmOnsetAt >= 0.2) {
      if (Number.isFinite(this.lastRhythmOnsetAt) && timestamp - this.lastRhythmOnsetAt > 1.25) {
        this.rhythmOnsets = [];
        this.rhythmConfidence = 0;
        this.rhythmTempo = 0;
        this.rhythmPulse = 0;
      }
      this.lastRhythmOnsetAt = timestamp;
      this.rhythmOnsets.push(timestamp);
      if (this.rhythmOnsets.length > MAX_RHYTHM_ONSETS) this.rhythmOnsets.shift();

      const intervals = [];
      for (let index = 1; index < this.rhythmOnsets.length; index += 1) {
        intervals.push(this.rhythmOnsets[index] - this.rhythmOnsets[index - 1]);
      }
      const plausible = intervals.filter(interval => interval >= 0.25 && interval <= 1.25);
      if (plausible.length >= 3 && plausible.length === intervals.length) {
        const period = median(plausible);
        const nearDouble = plausible.filter(interval => {
          const ratio = interval / Math.max(0.001, period);
          return ratio >= 1.75 && ratio <= 2.25;
        });
        const tolerateMissedOnsets = nearDouble.length > 0
          && nearDouble.length <= Math.max(1, Math.floor(plausible.length * 0.25));
        const relativeDeviation = plausible.reduce((total, interval) => {
          const ratio = interval / Math.max(0.001, period);
          const representedInterval = tolerateMissedOnsets && ratio >= 1.75 && ratio <= 2.25
            ? interval / 2
            : interval;
          const missedPenalty = representedInterval === interval ? 0 : 0.035;
          return total + Math.abs(representedInterval - period) / Math.max(0.001, period) + missedPenalty;
        }, 0) / plausible.length;
        const regularity = clamp(1 - relativeDeviation / 0.16);
        const evidence = clamp((plausible.length - 2) / 4);
        const targetConfidence = regularity * regularity * evidence;
        this.rhythmConfidence = follow(this.rhythmConfidence, targetConfidence, 0.12, 0.22, 0.8);
        if (this.rhythmConfidence >= 0.42) {
          const tempo = 60 / period;
          this.rhythmTempo = tempo >= 48 && tempo <= 220 ? Math.round(tempo * 10) / 10 : 0;
        }
      } else {
        this.rhythmConfidence = decay(this.rhythmConfidence, 0.12, 0.45);
        this.rhythmTempo = this.rhythmConfidence >= 0.42 ? this.rhythmTempo : 0;
      }
      this.rhythmPulse = Math.max(this.rhythmPulse, onsetStrength * this.rhythmConfidence);
    }

    const period = this.rhythmTempo > 0 ? 60 / this.rhythmTempo : 0;
    const staleAfter = period > 0 ? Math.max(1.5, period * 2.4) : 1.5;
    if (Number.isFinite(this.lastRhythmOnsetAt) && timestamp - this.lastRhythmOnsetAt > staleAfter) {
      this.rhythmConfidence = decay(this.rhythmConfidence, deltaTime, 0.5);
      if (this.rhythmConfidence < 0.42) this.rhythmTempo = 0;
    }
  }

  process({
    timestampSeconds,
    connected = true,
    rawVolume = 0,
    rawPeak = 0,
    frequencyData = null,
    frequencyKind = 'decibels',
    frequencyMinDecibels = -100,
    frequencyMaxDecibels = -12,
    sampleRate = 48000,
    fftSize = 4096,
  } = {}) {
    const timestamp = Math.max(0, finite(timestampSeconds, this.lastTimestamp ?? 0));
    let elapsed = this.lastTimestamp === null ? 1 / 60 : timestamp - this.lastTimestamp;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 0.25) {
      this.reset(timestamp);
      elapsed = 0;
    }
    const timeDelta = clamp(elapsed, 0, 0.25);
    const deltaTime = clamp(timeDelta || 1 / 240, 1 / 240, 0.12);
    const prime = this.needsBaseline;
    this.lastTimestamp = timestamp;

    const volume = connected ? Math.max(0, finite(rawVolume)) : 0;
    const peak = connected ? Math.max(0, finite(rawPeak)) : 0;
    if (volume < 0.025) {
      const floorTarget = Math.min(0.008, volume);
      this.noiseFloor = follow(this.noiseFloor, floorTarget, deltaTime, 8, 1.5);
    }
    this.referenceLevel = volume > this.referenceLevel
      ? follow(this.referenceLevel, volume, deltaTime, 1.4, 18)
      : follow(this.referenceLevel, Math.max(0.08, volume), deltaTime, 1.4, 18);
    const adaptiveLevel = clamp((volume - this.noiseFloor) / Math.max(0.04, this.referenceLevel - this.noiseFloor));
    const absoluteLevel = clamp((volume - 0.0015) / 0.32);
    const level = clamp(absoluteLevel * 0.72 + adaptiveLevel * 0.28);
    const audibility = smoothstep(0.0015, 0.018, volume);

    const quietTarget = 1 - smoothstep(0.003, 0.025, volume);
    let rising = 0;
    if (prime) {
      this.fast = level;
      this.slow = level;
      this.levelBaseline = level;
      this.attack = 0;
      this.release = 0;
      this.quietness = quietTarget;
      this.surge = 0;
    } else {
      this.fast = follow(this.fast, level, deltaTime, 0.012, 0.12);
      this.slow = follow(this.slow, level, deltaTime, 0.38, 1.4);
      const cadenceScale = clamp((1 / 60) / Math.max(1 / 240, timeDelta), 0.5, 2);
      rising = clamp(Math.max(0, this.fast - this.levelBaseline - 0.008) * cadenceScale / 0.14);
      const falling = clamp(Math.max(0, this.levelBaseline - this.fast - 0.008) * cadenceScale / 0.14);
      this.levelBaseline = follow(this.levelBaseline, this.fast, deltaTime, 0.11, 0.28);
      this.attack = Math.max(rising, decay(this.attack, timeDelta, 0.09));
      this.release = Math.max(falling, decay(this.release, timeDelta, 0.22));
      this.quietness = follow(this.quietness, quietTarget, deltaTime, 0.15, 0.035);
      this.surge = Math.max(
        clamp((this.fast - this.slow - 0.035) / 0.55),
        decay(this.surge, timeDelta, 0.32),
      );
    }
    this.silenceSeconds = volume < SILENCE_THRESHOLD
      ? clamp(this.silenceSeconds + timeDelta, 0, EXPRESSIVE_SILENCE_CAP_SECONDS)
      : 0;
    const crest = audibility * clamp((peak / Math.max(0.0001, volume) - 1.45) / 4.2);

    this.analyzeBands(
      frequencyData,
      sampleRate,
      fftSize,
      frequencyKind,
      finite(frequencyMinDecibels, -100),
      finite(frequencyMaxDecibels, -12),
      audibility,
      deltaTime,
      prime,
    );
    const lowAttack = this.regionValue(this.bandAttacks, 30, 220);
    const midAttack = this.regionValue(this.bandAttacks, 220, 2500);
    const highAttack = this.regionValue(this.bandAttacks, 2500, 20000);
    const attackTotal = lowAttack + midAttack + highAttack + 0.001;
    const strengthScale = 0.32 + level * 0.68;
    const onsetCandidate = clamp(Math.max(rising, lowAttack, midAttack, highAttack) * strengthScale);
    const regionalCandidate = regionAttack => clamp(
      (regionAttack * 0.82 + rising * (regionAttack / attackTotal) * 0.28) * strengthScale,
    );
    const onsetTriggered = this.updateEvent('onset', onsetCandidate, timestamp, timeDelta);
    this.updateEvent('lowImpact', regionalCandidate(lowAttack), timestamp, timeDelta);
    this.updateEvent('midHit', regionalCandidate(midAttack), timestamp, timeDelta);
    this.updateEvent('highSpark', regionalCandidate(highAttack), timestamp, timeDelta);
    this.updateRhythm(timestamp, onsetCandidate, onsetTriggered, timeDelta);
    this.needsBaseline = false;

    return this.snapshot(crest);
  }

  snapshot(crest = 0) {
    const confidence = clamp(this.rhythmConfidence);
    let phase = 0;
    if (confidence >= 0.55 && this.rhythmTempo > 0 && Number.isFinite(this.lastTimestamp)) {
      const period = 60 / this.rhythmTempo;
      phase = ((Math.max(0, this.lastTimestamp - this.lastRhythmOnsetAt) / period) % 1 + 1) % 1;
    }
    return {
      version: EXPRESSIVE_AUDIO_VERSION,
      dynamics: {
        fast: clamp(this.fast),
        slow: clamp(this.slow),
        attack: clamp(this.attack),
        release: clamp(this.release),
        quietness: clamp(this.quietness),
        silenceSeconds: clamp(this.silenceSeconds, 0, EXPRESSIVE_SILENCE_CAP_SECONDS),
        crest: clamp(crest),
        surge: clamp(this.surge),
      },
      events: {
        onset: eventOutput(this.events.onset),
        lowImpact: eventOutput(this.events.lowImpact),
        midHit: eventOutput(this.events.midHit),
        highSpark: eventOutput(this.events.highSpark),
      },
      rhythm: {
        pulse: clamp(this.rhythmPulse),
        phase: clamp(phase),
        tempo: confidence >= 0.42 ? Math.max(0, finite(this.rhythmTempo)) : 0,
        confidence,
      },
      frequency: {
        logBands: Array.from(this.bandLevels, value => clamp(value)),
        bandAttack: Array.from(this.bandAttacks, value => clamp(value)),
      },
    };
  }
}
