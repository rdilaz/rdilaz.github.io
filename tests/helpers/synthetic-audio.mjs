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
