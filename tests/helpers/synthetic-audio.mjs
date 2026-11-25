// Test-only deterministic PCM fixture. It contains a generated sine tone and no third-party media.
export function syntheticToneWav({ frequency = 440, durationSeconds = 1, sampleRate = 44100 } = {}) {
  const sampleCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const edge = Math.min(1, index / 180, (sampleCount - index - 1) / 180);
    const sample = Math.sin((index / sampleRate) * frequency * Math.PI * 2) * .42 * Math.max(0, edge);
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return buffer;
}

function deterministicNoise(index, seed = 1) {
  let value = (index + seed * 0x9e3779b9) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value / 0xffffffff) * 2 - 1;
}

function envelope(time, start, duration, release = 18) {
  const elapsed = time - start;
  if (elapsed < 0 || elapsed >= duration) return 0;
  return Math.min(1, elapsed / 0.004) * Math.exp(-elapsed * release);
}

function bandLimitedNoise(time, minimumHz, maximumHz, seed = 1) {
  let total = 0;
  const partials = 12;
  for (let index = 0; index < partials; index += 1) {
    const fraction = (index + 0.5) / partials;
    const frequency = minimumHz * Math.pow(maximumHz / minimumHz, fraction);
    const phase = deterministicNoise(index, seed) * Math.PI;
    total += Math.sin(time * frequency * Math.PI * 2 + phase);
  }
  return total / Math.sqrt(partials * 2);
}

export function syntheticPcmWav({
  durationSeconds = 1,
  sampleRate = 48000,
  channels = 1,
  sampleAt = () => 0,
} = {}) {
  const channelCount = Math.max(1, Math.min(2, Math.round(channels)));
  const sampleCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const dataBytes = sampleCount * channelCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * 2, 28);
  buffer.writeUInt16LE(channelCount * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const value = Math.max(-1, Math.min(1, Number(sampleAt(time, index, channel)) || 0));
      buffer.writeInt16LE(Math.round(value * 32767), 44 + (index * channelCount + channel) * 2);
    }
  }
  return buffer;
}

function toneFixture(frequency) {
  return syntheticPcmWav({
    durationSeconds: 1.15,
    sampleAt: time => time < 0.18 ? 0 : Math.sin(time * frequency * Math.PI * 2) * 0.34,
  });
}

function lowImpactFixture(amplitude) {
  return syntheticPcmWav({
    durationSeconds: 1,
    sampleAt: time => Math.sin(time * 68 * Math.PI * 2) * envelope(time, 0.34, 0.22, 17) * amplitude,
  });
}

function burstFixture(minimumHz, maximumHz, amplitude, seed) {
  return syntheticPcmWav({
    durationSeconds: 1,
    sampleAt: time => bandLimitedNoise(time, minimumHz, maximumHz, seed)
      * envelope(time, 0.34, 0.13, 24)
      * amplitude,
  });
}

function impactTrain(times) {
  return syntheticPcmWav({
    durationSeconds: Math.max(...times) + 0.7,
    sampleAt: time => times.reduce((total, start) => (
      total + Math.sin(time * 64 * Math.PI * 2) * envelope(time, start, 0.2, 13) * 0.7
    ), 0),
  });
}

export function deterministicExpressiveAudioCorpus() {
  const regularTimes = Array.from({ length: 10 }, (_unused, index) => 0.3 + index * 0.48);
  const irregularTimes = [0.3, 0.63, 1.46, 1.91, 2.94, 3.32, 4.05, 4.62, 5.71];
  const entranceFrequencies = [48, 92, 180, 360, 720, 1440, 2880, 5760, 10500];
  return Object.freeze({
    silence: syntheticPcmWav({ durationSeconds: 1.15 }),
    lowNoise: syntheticPcmWav({
      durationSeconds: 1.15,
      sampleAt: (_time, index) => deterministicNoise(index, 17) * 0.0011,
    }),
    sustainedLow: toneFixture(55),
    sustainedMid: toneFixture(900),
    sustainedHigh: toneFixture(8000),
    softLowImpact: lowImpactFixture(0.14),
    hardLowImpact: lowImpactFixture(0.72),
    midBurst: burstFixture(550, 2100, 0.52, 23),
    highBurst: burstFixture(5200, 12500, 0.55, 41),
    regular125: impactTrain(regularTimes),
    irregular: impactTrain(irregularTimes),
    silenceToFull: syntheticPcmWav({
      durationSeconds: 1.45,
      sampleAt: (time, index) => {
        if (time < 0.5) return 0;
        const mix = entranceFrequencies.reduce((total, frequency, frequencyIndex) => (
          total + Math.sin(time * frequency * Math.PI * 2 + frequencyIndex * 0.31)
        ), 0) / entranceFrequencies.length;
        return Math.max(-1, Math.min(1, mix * 0.72 + deterministicNoise(index, 73) * 0.08));
      },
    }),
  });
}
