const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const PROCESSING_CONSTRAINTS = ['echoCancellation', 'noiseSuppression', 'autoGainControl'];

function downsample(source, targetLength, transform = value => value) {
  const result = new Array(targetLength);
  const stride = source.length / targetLength;
  for (let index = 0; index < targetLength; index += 1) {
    const start = Math.floor(index * stride);
    const end = Math.max(start + 1, Math.floor((index + 1) * stride));
    let total = 0;
    for (let sourceIndex = start; sourceIndex < end && sourceIndex < source.length; sourceIndex += 1) {
      total += transform(source[sourceIndex]);
    }
    result[index] = total / Math.max(1, end - start);
  }
  return result;
}

function rms(values) {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) total += values[index] * values[index];
  return Math.sqrt(total / Math.max(1, values.length));
}

function peak(values) {
  let result = 0;
  for (let index = 0; index < values.length; index += 1) result = Math.max(result, Math.abs(values[index]));
  return result;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function stopStream(stream) {
  stream?.getTracks?.().forEach(track => track.stop());
}

async function cleanupLocalAudio(stream, context, nodes) {
  let tracks = [];
  try { tracks = stream?.getTracks?.() || []; } catch { /* Continue releasing the local graph. */ }
  for (const track of tracks) {
    try { track.stop(); } catch { /* Continue stopping the remaining returned tracks. */ }
  }
  for (const node of nodes) {
    try { node?.disconnect(); } catch { /* Continue releasing the remaining local graph. */ }
  }
  try {
    if (context?.state !== 'closed') await context.close();
  } catch { /* Local references are discarded by the caller. */ }
}

function safeTrackInfo(track, context) {
  let settings = {};
  let capabilities = {};
  try { settings = track.getSettings?.() || {}; } catch { /* Some capture tracks expose no settings. */ }
  try { capabilities = track.getCapabilities?.() || {}; } catch { /* Capabilities are optional. */ }

  const reportedChannels = Number(settings.channelCount);
  const monoOnlyCapability = Number(capabilities.channelCount?.max) === 1;
  const effectiveChannelCount = Number.isFinite(reportedChannels) && reportedChannels > 0
    ? reportedChannels
    : monoOnlyCapability ? 1 : null;
  const reportedSampleRate = Number(settings.sampleRate);
  const effectiveProcessing = {};
  for (const key of PROCESSING_CONSTRAINTS) {
    if (typeof settings[key] === 'boolean') effectiveProcessing[key] = settings[key];
  }

  return {
    effectiveChannelCount,
    effectiveSampleRate: Number.isFinite(reportedSampleRate) && reportedSampleRate > 0
      ? reportedSampleRate
      : Number(context?.sampleRate) || null,
    effectiveProcessing,
  };
}

function microphoneError(error) {
  if (error?.name === 'NotAllowedError') return new Error('Microphone permission was not granted. Allow microphone access to use this mode.');
  if (error?.name === 'NotFoundError') return new Error('No microphone is available on this device.');
  if (error?.name === 'NotReadableError') return new Error('The microphone is busy or unavailable. Close other apps using it and try again.');
  return error instanceof Error ? error : new Error('The microphone could not be connected.');
}

function microphoneFailureReason(error) {
  if (error?.name === 'NotAllowedError') return 'permission-denied';
  if (error?.name === 'NotFoundError') return 'no-microphone';
  if (error?.name === 'NotReadableError') return 'microphone-unavailable';
  return 'capture-failed';
}

function emptyDiagnostics() {
  return {
    sourceKind: null,
    effectiveChannelCount: null,
    effectiveSampleRate: null,
    requestedProcessing: {},
    effectiveProcessing: {},
    connectionReason: 'not-connected',
  };
}

function createAnalysisGraph(context, source, { trueStereo = false, audible = false } = {}) {
  const nodes = [source];
  try {
    const analyser = context.createAnalyser();
    const detailAnalyser = context.createAnalyser();
    nodes.push(analyser, detailAnalyser);
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = .08;
    analyser.minDecibels = -96;
    analyser.maxDecibels = -18;
    detailAnalyser.fftSize = 2048;
    detailAnalyser.smoothingTimeConstant = .12;
    detailAnalyser.minDecibels = -96;
    detailAnalyser.maxDecibels = -18;
    source.connect(analyser);
    source.connect(detailAnalyser);

    // Media elements are the only source the host owns and may monitor audibly.
    // Routing the primary analyser to the destination creates one output path.
    if (audible) analyser.connect(context.destination);

    let splitter = null;
    let leftAnalyser = null;
    let rightAnalyser = null;
    if (trueStereo) {
      splitter = context.createChannelSplitter(2);
      leftAnalyser = context.createAnalyser();
      rightAnalyser = context.createAnalyser();
      nodes.push(splitter, leftAnalyser, rightAnalyser);
      leftAnalyser.fftSize = rightAnalyser.fftSize = 256;
      leftAnalyser.smoothingTimeConstant = rightAnalyser.smoothingTimeConstant = 0;
      source.connect(splitter);
      splitter.connect(leftAnalyser, 0);
      splitter.connect(rightAnalyser, 1);
    }

    return {
      nodes,
      analyser,
      detailAnalyser,
      splitter,
      leftAnalyser,
      rightAnalyser,
      frequency: new Uint8Array(analyser.frequencyBinCount),
      detailFrequency: new Uint8Array(detailAnalyser.frequencyBinCount),
      waveform: new Float32Array(analyser.fftSize),
      leftWave: leftAnalyser ? new Float32Array(leftAnalyser.fftSize) : null,
      rightWave: rightAnalyser ? new Float32Array(rightAnalyser.fftSize) : null,
    };
  } catch (error) {
    for (const node of nodes) {
      try { node?.disconnect(); } catch { /* Continue releasing the partial graph. */ }
    }
    throw error;
  }
}

class AdaptiveSignal {
  constructor({ floor = 0, ceiling = .12, floorRise = .0005, ceilingFall = .996 } = {}) {
    this.floor = floor;
    this.ceiling = ceiling;
    this.floorRise = floorRise;
    this.ceilingFall = ceilingFall;
  }

  update(value) {
    if (value < this.floor) this.floor = value;
    else this.floor += (value - this.floor) * this.floorRise;
    if (value > this.ceiling) this.ceiling = value;
    else this.ceiling = Math.max(this.floor + .018, this.ceiling * this.ceilingFall);
    return clamp((value - this.floor) / Math.max(.018, this.ceiling - this.floor));
  }
}

export class AudioEngine {
  constructor(onState = () => {}) {
    this.onState = onState;
    this.stream = null;
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.detailAnalyser = null;
    this.leftAnalyser = null;
    this.rightAnalyser = null;
    this.splitter = null;
    this.frequency = null;
    this.detailFrequency = null;
    this.waveform = null;
    this.leftWave = null;
    this.rightWave = null;
    this.track = null;
    this.trackEndedHandler = null;
    this.mediaElement = null;
    this.connected = false;
    this.trueStereo = false;
    this.connectionRevision = 0;
    this.audioDiagnostics = emptyDiagnostics();
    this.resetAdaptiveState();
  }

  static capabilities(mediaDevices = globalThis.navigator?.mediaDevices) {
    const displaySupported = typeof mediaDevices?.getDisplayMedia === 'function';
    const microphoneSupported = typeof mediaDevices?.getUserMedia === 'function';
    return {
      display: {
        supported: displaySupported,
        reason: displaySupported ? '' : 'This browser does not offer tab or system audio sharing.',
      },
      microphone: {
        supported: microphoneSupported,
        reason: microphoneSupported ? '' : 'This browser does not offer microphone capture.',
      },
    };
  }

  static support(mediaDevices = globalThis.navigator?.mediaDevices) {
    return AudioEngine.capabilities(mediaDevices).display;
  }

  static microphoneConstraints(mediaDevices = globalThis.navigator?.mediaDevices) {
    let supported = {};
    try { supported = mediaDevices?.getSupportedConstraints?.() || {}; } catch { /* Empty preferences remain valid. */ }
    const audio = {};
    for (const key of PROCESSING_CONSTRAINTS) {
      if (supported[key]) audio[key] = false;
    }
    if (supported.channelCount) audio.channelCount = { ideal: 2 };
    return audio;
  }

  resetAdaptiveState() {
    this.previousSpectrum = new Float32Array(96);
    this.previousRawVolume = 0;
    this.previousRawPeak = 0;
    this.lastSampleTime = performance.now();
    this.lastOnsetTime = 0;
    this.onsets = [];
    this.beatPulse = 0;
    this.fluxAverage = .035;
    this.signals = Object.fromEntries(
      ['volume', 'peak', 'subBass', 'bass', 'lowMid', 'mid', 'highMid', 'treble', 'flux']
        .map(name => [name, new AdaptiveSignal()]),
    );
  }

  diagnostics() {
    return {
      ...this.audioDiagnostics,
      connected: this.connected,
      requestedProcessing: { ...this.audioDiagnostics.requestedProcessing },
      effectiveProcessing: { ...this.audioDiagnostics.effectiveProcessing },
    };
  }

  async connect() {
    return this.connectDisplayAudio();
  }

  async connectDisplayAudio() {
    const support = AudioEngine.capabilities().display;
    if (!support.supported) throw new Error(support.reason);
    await this.stop('source-change');
    const requestRevision = ++this.connectionRevision;
    const preferred = {
      video: { displaySurface: 'browser', frameRate: { ideal: 1, max: 2 }, cursor: 'never' },
      audio: { suppressLocalAudioPlayback: false },
      audioSelection: 'preferred',
      systemAudio: 'include',
      windowAudio: 'system',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
    };
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(preferred);
    } catch (error) {
      if (error?.name !== 'TypeError') throw error;
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { suppressLocalAudioPlayback: false },
      });
    }
    if (requestRevision !== this.connectionRevision) {
      stopStream(stream);
      throw new Error('A newer audio source was chosen before sharing completed.');
    }
    stream.getVideoTracks().forEach(track => { track.enabled = false; });
    return this.attachStream(stream, 'display', {}, requestRevision);
  }

  async connectMicrophone() {
    const support = AudioEngine.capabilities().microphone;
    if (!support.supported) throw new Error(support.reason);
    await this.stop('source-change');
    const requestRevision = ++this.connectionRevision;
    const requestedProcessing = AudioEngine.microphoneConstraints();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: requestedProcessing });
    } catch (error) {
      this.audioDiagnostics = {
        ...emptyDiagnostics(),
        sourceKind: 'microphone',
        requestedProcessing: { ...requestedProcessing },
        connectionReason: microphoneFailureReason(error),
      };
      throw microphoneError(error);
    }
    if (requestRevision !== this.connectionRevision) {
      stopStream(stream);
      throw new Error('A newer audio source was chosen before microphone access completed.');
    }
    return this.attachStream(stream, 'microphone', requestedProcessing, requestRevision);
  }

  async attachStream(stream, sourceKind, requestedProcessing, expectedRevision = this.connectionRevision) {
    if (expectedRevision !== this.connectionRevision) {
      stopStream(stream);
      throw new Error('A newer audio source was chosen before analysis could start.');
    }
    const [audioTrack] = stream?.getAudioTracks?.() || [];
    if (!audioTrack) {
      stopStream(stream);
      this.audioDiagnostics = {
        ...emptyDiagnostics(),
        sourceKind,
        requestedProcessing: { ...requestedProcessing },
        connectionReason: 'no-audio-track',
      };
      throw new Error(sourceKind === 'display'
        ? 'That share did not include audio. Choose a source with audio enabled, or use Listen with microphone.'
        : 'The microphone stream did not include audio. Try reconnecting or check browser microphone access.');
    }

    const AudioContextClass = globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
    if (!AudioContextClass) {
      stopStream(stream);
      this.audioDiagnostics = {
        ...emptyDiagnostics(),
        sourceKind,
        requestedProcessing: { ...requestedProcessing },
        connectionReason: 'audio-context-unavailable',
      };
      throw new Error('Web Audio is not available in this browser.');
    }

    let context;
    try {
      context = new AudioContextClass({ latencyHint: 'interactive' });
    } catch (error) {
      if (error?.name !== 'TypeError') {
        stopStream(stream);
        this.audioDiagnostics = {
          ...emptyDiagnostics(),
          sourceKind,
          requestedProcessing: { ...requestedProcessing },
          connectionReason: 'audio-context-failed',
        };
        throw new Error('Audio analysis could not start. Try reconnecting.', { cause: error });
      }
      try {
        context = new AudioContextClass();
      } catch {
        stopStream(stream);
        this.audioDiagnostics = {
          ...emptyDiagnostics(),
          sourceKind,
          requestedProcessing: { ...requestedProcessing },
          connectionReason: 'audio-context-failed',
        };
        throw new Error('Audio analysis could not start. Try reconnecting.');
      }
    }

    let localNodes = [];
    let trackInfo;
    let trueStereo;
    let source;
    let analyser;
    let detailAnalyser;
    let splitter;
    let leftAnalyser;
    let rightAnalyser;
    let frequency;
    let detailFrequency;
    let waveform;
    let leftWave;
    let rightWave;
    try {
      trackInfo = safeTrackInfo(audioTrack, context);
      trueStereo = Number(trackInfo.effectiveChannelCount) > 1;
      source = context.createMediaStreamSource(stream);
      const graph = createAnalysisGraph(context, source, { trueStereo });
      localNodes = graph.nodes;
      ({
        analyser,
        detailAnalyser,
        splitter,
        leftAnalyser,
        rightAnalyser,
        frequency,
        detailFrequency,
        waveform,
        leftWave,
        rightWave,
      } = graph);
    } catch {
      await cleanupLocalAudio(stream, context, localNodes);
      this.connected = false;
      this.audioDiagnostics = {
        ...emptyDiagnostics(),
        sourceKind,
        requestedProcessing: { ...requestedProcessing },
        connectionReason: 'audio-graph-failed',
      };
      throw new Error('Audio analysis could not start. Try reconnecting.');
    }

    this.stream = stream;
    this.context = context;
    this.source = source;
    this.analyser = analyser;
    this.detailAnalyser = detailAnalyser;
    this.splitter = splitter;
    this.leftAnalyser = leftAnalyser;
    this.rightAnalyser = rightAnalyser;
    this.frequency = frequency;
    this.detailFrequency = detailFrequency;
    this.waveform = waveform;
    this.leftWave = leftWave;
    this.rightWave = rightWave;
    this.track = audioTrack;
    this.mediaElement = null;
    this.trueStereo = trueStereo;
    const connectionRevision = ++this.connectionRevision;
    this.audioDiagnostics = {
      sourceKind,
      ...trackInfo,
      requestedProcessing: { ...requestedProcessing },
      connectionReason: 'connected',
    };
    try {
      this.trackEndedHandler = () => { void this.stop('track-ended'); };
      audioTrack.addEventListener('ended', this.trackEndedHandler, { once: true });
      this.resetAdaptiveState();
    } catch {
      await this.stop('audio-graph-failed');
      throw new Error('Audio analysis could not start. Try reconnecting.');
    }

    try {
      await context.resume();
    } catch {
      await this.stop('audio-context-resume-failed');
      throw new Error('Audio analysis could not start. Try reconnecting.');
    }

    if (connectionRevision !== this.connectionRevision || this.stream !== stream) {
      throw new Error('The audio source ended before analysis could start.');
    }

    this.connected = true;
    this.onState({
      connected: true,
      sourceKind,
      label: sourceKind === 'microphone' ? 'Microphone' : 'Shared audio',
      diagnostics: this.diagnostics(),
    });
    return this.diagnostics();
  }

  async connectMediaElement(element) {
    if (!element || typeof element.play !== 'function' || typeof element.pause !== 'function') {
      throw new TypeError('A trusted HTML audio element is required for local playback.');
    }
    await this.stop('source-change');
    const requestRevision = ++this.connectionRevision;
    const AudioContextClass = globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
    if (!AudioContextClass) {
      this.audioDiagnostics = {
        ...emptyDiagnostics(),
        sourceKind: 'local',
        connectionReason: 'audio-context-unavailable',
      };
      throw new Error('Web Audio is not available in this browser.');
    }

    let context;
    const localNodes = [];
    try {
      try {
        context = new AudioContextClass({ latencyHint: 'interactive' });
      } catch (error) {
        if (error?.name !== 'TypeError') throw error;
        context = new AudioContextClass();
      }
      const source = context.createMediaElementSource(element);
      const graph = createAnalysisGraph(context, source, { audible: true });
      localNodes.push(...graph.nodes);
      if (requestRevision !== this.connectionRevision) {
        throw new Error('A newer audio source was chosen before local playback was ready.');
      }

      this.stream = null;
      this.context = context;
      this.source = source;
      this.analyser = graph.analyser;
      this.detailAnalyser = graph.detailAnalyser;
      this.splitter = null;
      this.leftAnalyser = null;
      this.rightAnalyser = null;
      this.frequency = graph.frequency;
      this.detailFrequency = graph.detailFrequency;
      this.waveform = graph.waveform;
      this.leftWave = null;
      this.rightWave = null;
      this.track = null;
      this.trackEndedHandler = null;
      this.mediaElement = element;
      this.trueStereo = false;
      ++this.connectionRevision;
      this.audioDiagnostics = {
        ...emptyDiagnostics(),
        sourceKind: 'local',
        effectiveSampleRate: Number(context.sampleRate) || null,
        connectionReason: 'connected',
      };
      this.resetAdaptiveState();
      this.connected = true;
      this.onState({
        connected: true,
        sourceKind: 'local',
        label: 'Local files selected',
        diagnostics: this.diagnostics(),
      });
      return this.diagnostics();
    } catch (error) {
      if (this.context !== context) await cleanupLocalAudio(null, context, localNodes);
      this.connected = false;
      this.audioDiagnostics = {
        ...emptyDiagnostics(),
        sourceKind: 'local',
        connectionReason: error?.message?.includes('newer audio source') ? 'source-superseded' : 'audio-graph-failed',
      };
      if (error?.message?.includes('newer audio source')) throw error;
      throw new Error('Local audio analysis could not start. Try another browser or reconnect the source.', { cause: error });
    }
  }

  async resumeMediaElement(element) {
    if (!this.connected || this.mediaElement !== element || this.audioDiagnostics.sourceKind !== 'local' || !this.context) {
      throw new Error('That local audio source is no longer connected.');
    }
    const context = this.context;
    const revision = this.connectionRevision;
    try {
      if (context.state !== 'running') await context.resume();
    } catch (error) {
      throw new Error('Local audio analysis could not resume.', { cause: error });
    }
    if (revision !== this.connectionRevision || context !== this.context || element !== this.mediaElement) {
      throw new Error('That local audio source was replaced before playback began.');
    }
    return true;
  }

  async stopMediaElement(element, reason = 'user-disconnect') {
    if (this.mediaElement !== element) return false;
    await this.stop(reason);
    return true;
  }

  band(minHz, maxHz, { detail = false } = {}) {
    const analyser = detail ? this.detailAnalyser : this.analyser;
    const frequency = detail ? this.detailFrequency : this.frequency;
    if (!frequency || !this.context || !analyser) return 0;
    const binHz = this.context.sampleRate / analyser.fftSize;
    const start = Math.max(0, Math.floor(minHz / binHz));
    const end = Math.min(frequency.length, Math.ceil(maxHz / binHz));
    let total = 0;
    for (let index = start; index < end; index += 1) total += frequency[index] / 255;
    return total / Math.max(1, end - start);
  }

  estimateTempo(nowSeconds, transient) {
    if (transient > .68 && nowSeconds - this.lastOnsetTime > .22) {
      this.lastOnsetTime = nowSeconds;
      this.onsets.push(nowSeconds);
      if (this.onsets.length > 14) this.onsets.shift();
      this.beatPulse = 1;
    }
    this.beatPulse *= .84;
    if (this.onsets.length < 4) return { tempo: 0, confidence: 0, pulse: this.beatPulse };
    const intervals = [];
    for (let index = 1; index < this.onsets.length; index += 1) {
      const interval = this.onsets[index] - this.onsets[index - 1];
      if (interval >= .25 && interval <= 1.5) intervals.push(interval);
    }
    if (intervals.length < 3) return { tempo: 0, confidence: 0, pulse: this.beatPulse };
    const middle = median(intervals);
    let tempo = 60 / middle;
    while (tempo < 65) tempo *= 2;
    while (tempo > 190) tempo /= 2;
    const deviation = intervals.reduce((sum, value) => sum + Math.abs(value - middle), 0) / intervals.length;
    const confidence = clamp(1 - deviation / Math.max(.08, middle * .42));
    return { tempo: Math.round(tempo * 10) / 10, confidence, pulse: this.beatPulse };
  }

  sample(timestamp = performance.now()) {
    const nowSeconds = timestamp / 1000;
    const deltaTime = clamp((timestamp - this.lastSampleTime) / 1000, 0, .12);
    this.lastSampleTime = timestamp;
    if (!this.connected || !this.analyser) {
      return {
        connected: false,
        silence: true,
        volume: 0,
        peak: 0,
        transient: 0,
        beat: 0,
        tempo: 0,
        tempoConfidence: 0,
        spectralFlux: 0,
        spectralCentroid: 0,
        bands: { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 },
        stereo: { balance: 0, width: 0 },
        waveform: Array(128).fill(0),
        spectrum: Array(96).fill(0),
        time: nowSeconds,
        deltaTime,
      };
    }

    this.analyser.getByteFrequencyData(this.frequency);
    this.detailAnalyser.getByteFrequencyData(this.detailFrequency);
    this.analyser.getFloatTimeDomainData(this.waveform);
    if (this.trueStereo) {
      this.leftAnalyser.getFloatTimeDomainData(this.leftWave);
      this.rightAnalyser.getFloatTimeDomainData(this.rightWave);
    }
    const rawVolume = rms(this.waveform);
    const rawPeak = peak(this.waveform);
    const amplitudeAttack = clamp(
      Math.max(0, rawPeak - this.previousRawPeak) * 8
      + Math.max(0, rawVolume - this.previousRawVolume) * 14,
    );
    this.previousRawVolume = rawVolume;
    this.previousRawPeak = rawPeak;
    const bandsRaw = {
      subBass: this.band(20, 60, { detail: true }),
      bass: this.band(60, 180),
      lowMid: this.band(180, 450),
      mid: this.band(450, 1400),
      highMid: this.band(1400, 4200),
      treble: this.band(4200, 14000),
    };
    const spectrum = downsample(this.frequency, 96, value => value / 255);
    let flux = 0;
    let weightedFrequency = 0;
    let spectrumTotal = 0;
    for (let index = 0; index < spectrum.length; index += 1) {
      flux += Math.max(0, spectrum[index] - this.previousSpectrum[index]);
      this.previousSpectrum[index] = spectrum[index];
      weightedFrequency += index * spectrum[index];
      spectrumTotal += spectrum[index];
    }
    flux /= spectrum.length;
    const centroid = spectrumTotal > 0
      ? (weightedFrequency / spectrumTotal) / Math.max(1, spectrum.length - 1)
      : 0;
    this.fluxAverage += (flux - this.fluxAverage) * .06;
    const volume = this.signals.volume.update(rawVolume);
    const peakValue = this.signals.peak.update(rawPeak);
    const normalizedFlux = this.signals.flux.update(flux);
    const onsetRatio = flux / Math.max(.004, this.fluxAverage);
    const spectralTransient = clamp((onsetRatio - 1.12) / 1.45) * clamp(volume * 1.25 + peakValue * .3);
    const transient = Math.max(amplitudeAttack, spectralTransient);
    const tempo = this.estimateTempo(nowSeconds, transient);
    const stereo = this.trueStereo ? this.sampleStereo() : { balance: 0, width: 0 };

    return {
      connected: true,
      silence: rawVolume < .0025,
      volume,
      peak: peakValue,
      transient,
      beat: tempo.pulse,
      tempo: tempo.tempo,
      tempoConfidence: tempo.confidence,
      spectralFlux: normalizedFlux,
      spectralCentroid: centroid,
      bands: {
        subBass: this.signals.subBass.update(bandsRaw.subBass),
        bass: this.signals.bass.update(bandsRaw.bass),
        lowMid: this.signals.lowMid.update(bandsRaw.lowMid),
        mid: this.signals.mid.update(bandsRaw.mid),
        highMid: this.signals.highMid.update(bandsRaw.highMid),
        treble: this.signals.treble.update(bandsRaw.treble),
      },
      stereo,
      waveform: downsample(this.waveform, 128),
      spectrum,
      time: nowSeconds,
      deltaTime,
    };
  }

  sampleStereo() {
    const leftRms = rms(this.leftWave);
    const rightRms = rms(this.rightWave);
    const balance = clamp((rightRms - leftRms) / Math.max(.0001, leftRms + rightRms), -1, 1);
    let midEnergy = 0;
    let sideEnergy = 0;
    for (let index = 0; index < this.leftWave.length; index += 1) {
      const mid = (this.leftWave[index] + this.rightWave[index]) * .5;
      const side = (this.leftWave[index] - this.rightWave[index]) * .5;
      midEnergy += mid * mid;
      sideEnergy += side * side;
    }
    const width = clamp(Math.sqrt(sideEnergy / Math.max(.000001, midEnergy + sideEnergy)) * 1.55);
    return { balance, width };
  }

  async stop(reason = 'user-disconnect') {
    this.connectionRevision += 1;
    const wasConnected = this.connected;
    const sourceKind = this.audioDiagnostics.sourceKind;
    this.connected = false;
    try { this.mediaElement?.pause?.(); } catch { /* Graph cleanup remains authoritative. */ }
    if (this.track && this.trackEndedHandler) {
      this.track.removeEventListener?.('ended', this.trackEndedHandler);
    }
    stopStream(this.stream);
    for (const node of [this.source, this.splitter, this.analyser, this.detailAnalyser, this.leftAnalyser, this.rightAnalyser]) {
      try { node?.disconnect(); } catch { /* A partially-created graph may already be disconnected. */ }
    }
    if (this.context && this.context.state !== 'closed') {
      try { await this.context.close(); } catch { /* Release every remaining graph reference below. */ }
    }
    this.stream = this.context = this.source = this.analyser = this.detailAnalyser = null;
    this.splitter = this.leftAnalyser = this.rightAnalyser = null;
    this.frequency = this.detailFrequency = this.waveform = this.leftWave = this.rightWave = null;
    this.track = this.trackEndedHandler = null;
    this.mediaElement = null;
    this.trueStereo = false;
    this.audioDiagnostics = { ...this.audioDiagnostics, connectionReason: reason };
    if (wasConnected) {
      this.onState({
        connected: false,
        sourceKind,
        label: reason === 'source-change'
          ? ''
          : reason === 'track-ended'
            ? 'Audio source ended.'
            : sourceKind === 'local' && reason === 'queue-cleared'
              ? 'Local queue cleared.'
              : 'Audio disconnected.',
        diagnostics: this.diagnostics(),
      });
    }
  }
}
