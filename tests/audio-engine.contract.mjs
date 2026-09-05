import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioEngine } from '../public/visualizer/audio-engine.js';
import { applyAudioSensitivity } from '../public/visualizer/audio-sensitivity.js';
import { AUDIO_API_VERSION, buildGenerationMessages } from '../public/visualizer/prompt.js';

class FakeTrack {
  constructor({ kind = 'audio', settings = {}, capabilities = {} } = {}) {
    this.kind = kind;
    this.enabled = true;
    this.settings = settings;
    this.capabilities = capabilities;
    this.stopCount = 0;
    this.listeners = new Map();
  }

  getSettings() { return { ...this.settings }; }
  getCapabilities() { return structuredClone(this.capabilities); }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  stop() {
    this.stopCount += 1;
  }

  end() {
    this.listeners.get('ended')?.();
  }
}

class FakeStream {
  constructor({ audioTracks = [], videoTracks = [] } = {}) {
    this.audioTracks = audioTracks;
    this.videoTracks = videoTracks;
  }

  getAudioTracks() { return this.audioTracks; }
  getVideoTracks() { return this.videoTracks; }
  getTracks() { return [...this.audioTracks, ...this.videoTracks]; }
}

class FakeNode {
  constructor() {
    this.connections = [];
    this.disconnectCount = 0;
  }

  connect(target, output = 0) {
    this.connections.push({ target, output });
    return target;
  }

  disconnect() {
    this.disconnectCount += 1;
  }
}

class FakeAnalyser extends FakeNode {
  constructor(index) {
    super();
    this.index = index;
    this._fftSize = 2048;
    this.frequencyBinCount = 1024;
  }

  set fftSize(value) {
    this._fftSize = value;
    this.frequencyBinCount = value / 2;
  }

  get fftSize() { return this._fftSize; }

  getByteFrequencyData(target) {
    target.fill(this.index < 2 ? 96 : 0);
  }

  getFloatTimeDomainData(target) {
    const amplitude = this.index === 2 ? .08 : this.index === 3 ? .31 : .24;
    for (let index = 0; index < target.length; index += 1) {
      target[index] = Math.sin(index / 5) * amplitude;
    }
  }
}

class FakeAudioContext {
  static instances = [];

  constructor() {
    this.sampleRate = 48000;
    this.state = 'suspended';
    this.source = new FakeNode();
    this.destination = new FakeNode();
    this.mediaSources = [];
    this.splitters = [];
    this.analysers = [];
    this.resumeCount = 0;
    this.closeCount = 0;
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamSource() { return this.source; }

  createMediaElementSource(element) {
    const source = new FakeNode();
    source.element = element;
    this.mediaSources.push(source);
    return source;
  }

  createAnalyser() {
    const analyser = new FakeAnalyser(this.analysers.length);
    this.analysers.push(analyser);
    return analyser;
  }

  createChannelSplitter() {
    const splitter = new FakeNode();
    this.splitters.push(splitter);
    return splitter;
  }

  async resume() {
    this.resumeCount += 1;
    this.state = 'running';
  }

  async close() {
    this.closeCount += 1;
    this.state = 'closed';
  }
}

function installBrowser({ mediaDevices, AudioContextClass = FakeAudioContext }) {
  FakeAudioContext.instances = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { AudioContext: AudioContextClass },
  });
}

function mediaFixture({ channels = 1, noAudio = false } = {}) {
  const audioTrack = new FakeTrack({
    settings: {
      channelCount: channels,
      sampleRate: 44100,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: false,
      deviceId: 'never-export-this-device',
      groupId: 'never-export-this-group',
    },
    capabilities: { channelCount: { min: 1, max: channels } },
  });
  const videoTrack = new FakeTrack({ kind: 'video' });
  const stream = new FakeStream({ audioTracks: noAudio ? [] : [audioTrack], videoTracks: [videoTrack] });
  return { stream, audioTrack, videoTrack };
}

function supportedConstraints() {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: true,
    sampleRate: true,
    latency: true,
    voiceIsolation: true,
  };
}

test('capability matrix reports display and microphone independently', () => {
  assert.deepEqual(AudioEngine.capabilities({ getDisplayMedia() {}, getUserMedia() {} }), {
    display: { supported: true, reason: '' },
    microphone: { supported: true, reason: '' },
  });
  assert.equal(AudioEngine.capabilities({ getDisplayMedia() {} }).display.supported, true);
  assert.equal(AudioEngine.capabilities({ getDisplayMedia() {} }).microphone.supported, false);
  assert.equal(AudioEngine.capabilities({ getUserMedia() {} }).display.supported, false);
  assert.equal(AudioEngine.capabilities({ getUserMedia() {} }).microphone.supported, true);
  assert.equal(AudioEngine.capabilities({}).display.supported, false);
  assert.equal(AudioEngine.capabilities({}).microphone.supported, false);
});

test('display connection preserves preferred capture, disables video, and never requests microphone', async () => {
  const fixture = mediaFixture({ channels: 2 });
  const calls = { display: [], microphone: 0 };
  installBrowser({
    mediaDevices: {
      getDisplayMedia: async constraints => { calls.display.push(constraints); return fixture.stream; },
      getUserMedia: async () => { calls.microphone += 1; throw new Error('unexpected microphone'); },
    },
  });
  const engine = new AudioEngine();
  await engine.connectDisplayAudio();
  assert.equal(calls.display.length, 1);
  assert.equal(calls.microphone, 0);
  assert.equal(calls.display[0].audioSelection, 'preferred');
  assert.equal(calls.display[0].systemAudio, 'include');
  assert.deepEqual(calls.display[0].audio, { suppressLocalAudioPlayback: false });
  assert.equal(fixture.videoTrack.enabled, false);
  assert.equal(engine.connected, true);
  assert.equal(engine.diagnostics().sourceKind, 'display');
  await engine.stop();
});

test('display TypeError retains the existing conservative fallback call shape', async () => {
  const fixture = mediaFixture();
  const calls = [];
  installBrowser({
    mediaDevices: {
      getDisplayMedia: async constraints => {
        calls.push(constraints);
        if (calls.length === 1) throw new DOMException('unsupported hint', 'TypeError');
        return fixture.stream;
      },
    },
  });
  const engine = new AudioEngine();
  await engine.connectDisplayAudio();
  assert.deepEqual(calls[1], { video: true, audio: { suppressLocalAudioPlayback: false } });
  await engine.stop();
});

test('microphone connection requests only safe supported music preferences and never display capture', async () => {
  const fixture = mediaFixture();
  const calls = { microphone: [], display: 0 };
  installBrowser({
    mediaDevices: {
      getSupportedConstraints: supportedConstraints,
      getUserMedia: async constraints => { calls.microphone.push(constraints); return fixture.stream; },
      getDisplayMedia: async () => { calls.display += 1; throw new Error('unexpected display'); },
    },
  });
  const engine = new AudioEngine();
  await engine.connectMicrophone();
  assert.equal(calls.display, 0);
  assert.deepEqual(calls.microphone, [{
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
    },
  }]);
  assert.equal(Object.hasOwn(calls.microphone[0].audio, 'voiceIsolation'), false);
  assert.equal(Object.hasOwn(calls.microphone[0].audio, 'sampleRate'), false);
  assert.equal(Object.hasOwn(calls.microphone[0].audio, 'latency'), false);
  const context = FakeAudioContext.instances[0];
  assert.ok(context.analysers.every(analyser => analyser.connections.every(connection => connection.target !== context.destination)));
  await engine.stop();
});

test('trusted local media element has one audible route and reuses one analysis graph until disposal', async () => {
  installBrowser({ mediaDevices: {} });
  const element = {
    paused: true,
    pauseCount: 0,
    async play() { this.paused = false; },
    pause() { this.paused = true; this.pauseCount += 1; },
  };
  const states = [];
  const engine = new AudioEngine(state => states.push(state));
  await engine.connectMediaElement(element);
  const context = FakeAudioContext.instances[0];
  assert.equal(context.state, 'suspended');
  assert.equal(context.mediaSources.length, 1);
  assert.equal(context.mediaSources[0].connections.length, 2);
  assert.equal(context.analysers[0].connections.filter(connection => connection.target === context.destination).length, 1);
  assert.equal(context.analysers[1].connections.filter(connection => connection.target === context.destination).length, 0);
  assert.deepEqual(engine.diagnostics(), {
    sourceKind: 'local',
    effectiveChannelCount: null,
    effectiveSampleRate: 48000,
    requestedProcessing: {},
    effectiveProcessing: {},
    connectionReason: 'connected',
    connected: true,
  });
  assert.deepEqual(states.map(state => state.sourceKind), ['local']);

  await engine.resumeMediaElement(element);
  assert.equal(context.state, 'running');
  assert.equal(context.resumeCount, 1);
  assert.equal(context.mediaSources.length, 1);
  assert.equal(await engine.stopMediaElement({}), false);
  assert.equal(engine.connected, true);
  assert.equal(await engine.stopMediaElement(element), true);
  assert.equal(context.closeCount, 1);
  assert.equal(element.pauseCount, 1);
  assert.ok([context.mediaSources[0], ...context.analysers].every(node => node.disconnectCount === 1));
});

test('local media element fails safely when Web Audio is unavailable', async () => {
  installBrowser({ mediaDevices: {}, AudioContextClass: null });
  const element = { play() {}, pause() {} };
  const engine = new AudioEngine();
  await assert.rejects(engine.connectMediaElement(element), /Web Audio is not available/i);
  assert.equal(engine.connected, false);
  assert.equal(engine.diagnostics().sourceKind, 'local');
  assert.equal(engine.diagnostics().connectionReason, 'audio-context-unavailable');
});

test('unsupported microphone preferences are omitted instead of becoming fatal requirements', () => {
  assert.deepEqual(AudioEngine.microphoneConstraints({
    getSupportedConstraints: () => ({ echoCancellation: true }),
  }), { echoCancellation: false });
  assert.deepEqual(AudioEngine.microphoneConstraints({}), {});
});

test('microphone permission denial is clean and leaves disconnected truth', async () => {
  installBrowser({
    mediaDevices: {
      getSupportedConstraints: supportedConstraints,
      getUserMedia: async () => { throw new DOMException('denied fixture', 'NotAllowedError'); },
    },
  });
  const states = [];
  const engine = new AudioEngine(state => states.push(state));
  await assert.rejects(engine.connectMicrophone(), /permission was not granted/i);
  assert.equal(engine.connected, false);
  assert.equal(engine.sample().connected, false);
  assert.equal(engine.diagnostics().connectionReason, 'permission-denied');
  assert.deepEqual(states, []);
});

test('missing and unavailable microphones receive short truthful errors', async () => {
  for (const [name, message, reason] of [
    ['NotFoundError', /No microphone is available/i, 'no-microphone'],
    ['NotReadableError', /microphone is busy or unavailable/i, 'microphone-unavailable'],
  ]) {
    installBrowser({
      mediaDevices: {
        getUserMedia: async () => { throw new DOMException('private platform detail', name); },
      },
    });
    const engine = new AudioEngine();
    await assert.rejects(engine.connectMicrophone(), message);
    assert.equal(engine.diagnostics().connectionReason, reason);
    assert.doesNotMatch(JSON.stringify(engine.diagnostics()), /private platform detail/i);
  }
});

test('microphone no-audio stream fails cleanly and stops every returned track', async () => {
  const fixture = mediaFixture({ noAudio: true });
  installBrowser({
    mediaDevices: {
      getUserMedia: async () => fixture.stream,
      getSupportedConstraints: () => ({}),
    },
  });
  const engine = new AudioEngine();
  await assert.rejects(engine.connectMicrophone(), /did not include audio/i);
  assert.equal(fixture.videoTrack.stopCount, 1);
  assert.equal(engine.connected, false);
  assert.equal(engine.diagnostics().connectionReason, 'no-audio-track');
});

test('display no-audio stream fails truthfully and points to microphone recovery', async () => {
  const fixture = mediaFixture({ noAudio: true });
  installBrowser({ mediaDevices: { getDisplayMedia: async () => fixture.stream } });
  const engine = new AudioEngine();
  await assert.rejects(engine.connectDisplayAudio(), /use Listen with microphone/i);
  assert.equal(fixture.videoTrack.stopCount, 1);
  assert.equal(engine.connected, false);
});

test('missing or unresumable AudioContext releases capture and fails cleanly', async () => {
  const unavailable = mediaFixture();
  installBrowser({ mediaDevices: { getUserMedia: async () => unavailable.stream }, AudioContextClass: null });
  const unavailableEngine = new AudioEngine();
  await assert.rejects(unavailableEngine.connectMicrophone(), /Web Audio is not available/i);
  assert.equal(unavailable.audioTrack.stopCount, 1);

  class ResumeFailureContext extends FakeAudioContext {
    async resume() { throw new Error('fixture resume failure'); }
  }
  const unresumable = mediaFixture();
  installBrowser({ mediaDevices: { getUserMedia: async () => unresumable.stream }, AudioContextClass: ResumeFailureContext });
  const unresumableEngine = new AudioEngine();
  await assert.rejects(unresumableEngine.connectMicrophone(), /could not start/i);
  assert.equal(unresumable.audioTrack.stopCount, 1);
  assert.equal(FakeAudioContext.instances[0].closeCount, 1);
  assert.equal(unresumableEngine.diagnostics().connectionReason, 'audio-context-resume-failed');
});

test('microphone source-node failure cleans local resources and permits a later connection', async () => {
  let sourceAttempts = 0;
  class SourceFailureOnceContext extends FakeAudioContext {
    createMediaStreamSource() {
      sourceAttempts += 1;
      if (sourceAttempts === 1) throw new Error('private source construction detail');
      return super.createMediaStreamSource();
    }
  }
  const failed = mediaFixture();
  const recovered = mediaFixture();
  const streams = [failed.stream, recovered.stream];
  installBrowser({
    mediaDevices: {
      getSupportedConstraints: supportedConstraints,
      getUserMedia: async () => streams.shift(),
    },
    AudioContextClass: SourceFailureOnceContext,
  });
  const states = [];
  const engine = new AudioEngine(state => states.push(state));

  await assert.rejects(engine.connectMicrophone(), /could not start/i);
  const failedContext = FakeAudioContext.instances[0];
  assert.equal(failed.audioTrack.stopCount, 1);
  assert.equal(failed.videoTrack.stopCount, 1);
  assert.equal(failedContext.closeCount, 1);
  assert.equal(engine.connected, false);
  assert.deepEqual(states, []);
  assert.deepEqual(engine.diagnostics(), {
    sourceKind: 'microphone',
    effectiveChannelCount: null,
    effectiveSampleRate: null,
    requestedProcessing: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
    },
    effectiveProcessing: {},
    connectionReason: 'audio-graph-failed',
    connected: false,
  });
  assert.doesNotMatch(JSON.stringify(engine.diagnostics()), /private|deviceId|groupId|waveform|spectrum/i);

  await engine.connectMicrophone();
  assert.equal(engine.connected, true);
  assert.equal(states.length, 1);
  assert.equal(states[0].connected, true);
  assert.equal(engine.diagnostics().connectionReason, 'connected');
  await engine.stop();
  assert.equal(recovered.audioTrack.stopCount, 1);
  assert.equal(FakeAudioContext.instances[1].closeCount, 1);
});

test('display splitter failure disconnects partial graph and permits a later connection', async () => {
  let splitterAttempts = 0;
  class SplitterFailureOnceContext extends FakeAudioContext {
    createChannelSplitter() {
      splitterAttempts += 1;
      if (splitterAttempts === 1) throw new Error('private splitter construction detail');
      return super.createChannelSplitter();
    }
  }
  const failed = mediaFixture({ channels: 2 });
  const recovered = mediaFixture({ channels: 2 });
  const streams = [failed.stream, recovered.stream];
  installBrowser({
    mediaDevices: { getDisplayMedia: async () => streams.shift() },
    AudioContextClass: SplitterFailureOnceContext,
  });
  const states = [];
  const engine = new AudioEngine(state => states.push(state));

  await assert.rejects(engine.connectDisplayAudio(), /could not start/i);
  const failedContext = FakeAudioContext.instances[0];
  assert.equal(failed.audioTrack.stopCount, 1);
  assert.equal(failed.videoTrack.stopCount, 1);
  assert.equal(failedContext.closeCount, 1);
  assert.equal(failedContext.source.disconnectCount, 1);
  assert.ok(failedContext.analysers.every(analyser => analyser.disconnectCount === 1));
  assert.equal(engine.connected, false);
  assert.deepEqual(states, []);
  assert.equal(engine.diagnostics().sourceKind, 'display');
  assert.equal(engine.diagnostics().connectionReason, 'audio-graph-failed');
  assert.doesNotMatch(JSON.stringify(engine.diagnostics()), /private|deviceId|groupId|waveform|spectrum/i);

  await engine.connectDisplayAudio();
  assert.equal(engine.connected, true);
  assert.equal(states.length, 1);
  assert.equal(states[0].sourceKind, 'display');
  await engine.stop();
  assert.equal(recovered.audioTrack.stopCount, 1);
  assert.equal(recovered.videoTrack.stopCount, 1);
  assert.equal(FakeAudioContext.instances[1].closeCount, 1);
});

test('track ended transitions to disconnected truth and performs complete cleanup', async () => {
  const fixture = mediaFixture();
  const states = [];
  installBrowser({ mediaDevices: { getUserMedia: async () => fixture.stream } });
  const engine = new AudioEngine(state => states.push(state));
  await engine.connectMicrophone();
  const context = FakeAudioContext.instances[0];
  fixture.audioTrack.end();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.connected, false);
  assert.equal(context.closeCount, 1);
  assert.equal(engine.diagnostics().connectionReason, 'track-ended');
  assert.equal(states.at(-1).label, 'Audio source ended.');
});

test('track ending during AudioContext resume cannot publish a stale connection', async () => {
  let finishResume;
  class DeferredResumeContext extends FakeAudioContext {
    async resume() { await new Promise(resolve => { finishResume = resolve; }); }
  }
  const fixture = mediaFixture();
  installBrowser({
    mediaDevices: { getUserMedia: async () => fixture.stream },
    AudioContextClass: DeferredResumeContext,
  });
  const states = [];
  const engine = new AudioEngine(state => states.push(state));
  const connecting = engine.connectMicrophone();
  await new Promise(resolve => setImmediate(resolve));
  fixture.audioTrack.end();
  finishResume();
  await assert.rejects(connecting, /ended before analysis could start/i);
  assert.equal(engine.connected, false);
  assert.deepEqual(states, []);
  assert.equal(FakeAudioContext.instances[0].closeCount, 1);
});

test('rapid capture requests allow only the newest source to take ownership', async () => {
  const firstFixture = mediaFixture();
  const secondFixture = mediaFixture();
  const pending = [];
  installBrowser({
    mediaDevices: {
      getSupportedConstraints: () => ({}),
      getUserMedia: () => new Promise(resolve => pending.push(resolve)),
    },
  });
  const states = [];
  const engine = new AudioEngine(state => states.push(state));
  const first = engine.connectMicrophone();
  await new Promise(resolve => setImmediate(resolve));
  const second = engine.connectMicrophone();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[1](secondFixture.stream);
  await second;
  pending[0](firstFixture.stream);
  await assert.rejects(first, /newer audio source/i);
  assert.equal(firstFixture.audioTrack.stopCount, 1);
  assert.equal(secondFixture.audioTrack.stopCount, 0);
  assert.equal(engine.connected, true);
  assert.equal(states.filter(state => state.connected).length, 1);
  await engine.stop();
  assert.equal(secondFixture.audioTrack.stopCount, 1);
});

test('stop releases tracks, nodes, listeners and AudioContext idempotently', async () => {
  const fixture = mediaFixture({ channels: 2 });
  installBrowser({ mediaDevices: { getDisplayMedia: async () => fixture.stream } });
  const engine = new AudioEngine();
  await engine.connectDisplayAudio();
  const context = FakeAudioContext.instances[0];
  const nodes = [context.source, ...context.analysers, ...context.splitters];
  await engine.stop();
  await engine.stop();
  assert.equal(fixture.audioTrack.stopCount, 1);
  assert.equal(fixture.videoTrack.stopCount, 1);
  assert.equal(context.closeCount, 1);
  assert.equal(fixture.audioTrack.listeners.has('ended'), false);
  assert.ok(nodes.every(node => node.disconnectCount === 1));
});

test('synthetic mono remains reactive with neutral stereo truth', async () => {
  const fixture = mediaFixture({ channels: 1 });
  installBrowser({ mediaDevices: { getUserMedia: async () => fixture.stream } });
  const engine = new AudioEngine();
  await engine.connectMicrophone();
  const sample = engine.sample(performance.now() + 16);
  assert.equal(sample.connected, true);
  assert.equal(sample.silence, false);
  assert.ok(sample.volume > 0);
  assert.ok(sample.spectrum.some(value => value > 0));
  assert.ok(Object.values(sample.bands).some(value => value > 0));
  assert.deepEqual(sample.stereo, { balance: 0, width: 0 });
  assert.equal(FakeAudioContext.instances[0].splitters.length, 0);
  await engine.stop();
});

test('synthetic true stereo preserves balance and width analysis', async () => {
  const fixture = mediaFixture({ channels: 2 });
  installBrowser({ mediaDevices: { getDisplayMedia: async () => fixture.stream } });
  const engine = new AudioEngine();
  await engine.connectDisplayAudio();
  const sample = engine.sample(performance.now() + 16);
  assert.ok(sample.stereo.balance > 0);
  assert.ok(sample.stereo.width > 0);
  assert.equal(FakeAudioContext.instances[0].splitters.length, 1);
  await engine.stop();
});

test('capture source never changes VIZ schema, sensitivity semantics, or generation messages', async () => {
  const expectedKeys = [
    'connected', 'silence', 'volume', 'peak', 'transient', 'beat', 'tempo', 'tempoConfidence',
    'spectralFlux', 'spectralCentroid', 'bands', 'stereo', 'waveform', 'spectrum', 'time', 'deltaTime',
  ];
  const messagesBefore = buildGenerationMessages();
  const fixture = mediaFixture();
  installBrowser({ mediaDevices: { getUserMedia: async () => fixture.stream } });
  const engine = new AudioEngine();
  assert.deepEqual(Object.keys(engine.sample()), expectedKeys);
  await engine.connectMicrophone();
  const sample = engine.sample(performance.now() + 16);
  assert.deepEqual(Object.keys(sample), expectedKeys);
  assert.deepEqual(Object.keys(applyAudioSensitivity(sample, 130)), expectedKeys);
  assert.equal(AUDIO_API_VERSION, 'visualizer-audio-v1');
  assert.deepEqual(buildGenerationMessages(), messagesBefore);
  await engine.stop();
});

test('diagnostics expose compact settings but never identifiers or audio payloads', async () => {
  const fixture = mediaFixture();
  installBrowser({
    mediaDevices: {
      getSupportedConstraints: supportedConstraints,
      getUserMedia: async () => fixture.stream,
    },
  });
  const engine = new AudioEngine();
  await engine.connectMicrophone();
  const diagnostics = engine.diagnostics();
  assert.deepEqual(diagnostics, {
    sourceKind: 'microphone',
    effectiveChannelCount: 1,
    effectiveSampleRate: 44100,
    effectiveProcessing: {
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: false,
    },
    requestedProcessing: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
    },
    connectionReason: 'connected',
    connected: true,
  });
  const serialized = JSON.stringify(diagnostics);
  assert.doesNotMatch(serialized, /deviceId|groupId|waveform|spectrum|PCM|never-export/i);
  await engine.stop();
});

test('repeated connect and disconnect creates and closes exactly one graph per cycle', async () => {
  const fixtures = [mediaFixture(), mediaFixture(), mediaFixture()];
  let index = 0;
  installBrowser({ mediaDevices: { getUserMedia: async () => fixtures[index++].stream } });
  const engine = new AudioEngine();
  for (const fixture of fixtures) {
    await engine.connectMicrophone();
    await engine.stop();
    assert.equal(fixture.audioTrack.stopCount, 1);
  }
  assert.equal(FakeAudioContext.instances.length, 3);
  assert.ok(FakeAudioContext.instances.every(context => context.closeCount === 1));
});
