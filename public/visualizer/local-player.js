export const LOCAL_PLAYER_SCHEMA = 'visualizer-local-player-v1';
export const MAX_LOCAL_QUEUE_FILES = 24;
export const MAX_LOCAL_FILE_BYTES = 512 * 1024 * 1024;
export const MAX_LOCAL_QUEUE_BYTES = 2 * 1024 * 1024 * 1024;
export const LOCAL_METADATA_TIMEOUT_MS = 8000;

const clone = value => structuredClone(value);
const megabytes = bytes => Math.round(bytes / (1024 * 1024));

function displayFileName(value) {
  let printable = '';
  for (const character of String(value || 'Local audio')) {
    const codePoint = character.codePointAt(0);
    printable += codePoint >= 32 && codePoint !== 127 ? character : ' ';
  }
  return [...printable.replace(/\s+/g, ' ').trim()].slice(0, 180).join('') || 'Local audio';
}

function validDuration(element) {
  const duration = Number(element?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function waitForMetadata(element, { timeoutMs, start = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      element.removeEventListener?.('loadedmetadata', loaded);
      element.removeEventListener?.('error', failed);
      callback(value);
    };
    const loaded = () => {
      const duration = validDuration(element);
      if (duration) finish(resolve, duration);
      else finish(reject, new Error('The selected file has no playable duration.'));
    };
    const failed = () => finish(reject, new Error('The browser could not read this audio file.'));
    const timer = setTimeout(() => finish(reject, new Error('Reading audio metadata took too long.')), timeoutMs);
    element.addEventListener?.('loadedmetadata', loaded);
    element.addEventListener?.('error', failed);
    try {
      start();
      if (Number(element.readyState) >= 1) queueMicrotask(loaded);
    } catch {
      failed();
    }
  });
}

function cleanupElement(element) {
  if (!element) return;
  try { element.pause?.(); } catch { /* Continue releasing the trusted element. */ }
  try { element.removeAttribute?.('src'); } catch { /* Continue releasing the trusted element. */ }
  try { element.load?.(); } catch { /* The element can still be discarded. */ }
  try { element.remove?.(); } catch { /* Detached elements need no further DOM cleanup. */ }
}

export class LocalPlayer {
  constructor({
    audioEngine,
    mount = null,
    createAudio = () => document.createElement('audio'),
    createObjectURL = file => URL.createObjectURL(file),
    revokeObjectURL = url => URL.revokeObjectURL(url),
    metadataTimeoutMs = LOCAL_METADATA_TIMEOUT_MS,
    onState = () => {},
    onPlaybackChange = () => {},
    onSourceSelected = () => {},
    onError = () => {},
  } = {}) {
    if (!audioEngine) throw new TypeError('LocalPlayer requires an AudioEngine.');
    this.audioEngine = audioEngine;
    this.mount = mount;
    this.createAudio = createAudio;
    this.createObjectURL = createObjectURL;
    this.revokeObjectURL = revokeObjectURL;
    this.metadataTimeoutMs = Math.max(1, Number(metadataTimeoutMs) || LOCAL_METADATA_TIMEOUT_MS);
    this.onState = onState;
    this.onPlaybackChange = onPlaybackChange;
    this.onSourceSelected = onSourceSelected;
    this.onError = onError;
    this.queue = [];
    this.currentIndex = -1;
    this.element = null;
    this.elementListeners = null;
    this.playing = false;
    this.playIntent = false;
    this.playbackSessionStarted = false;
    this.loading = false;
    this.currentTime = 0;
    this.duration = 0;
    this.operationRevision = 0;
    this.trackRevision = 0;
    this.idCounter = 0;
    this.commitTail = Promise.resolve();
    this.switchingTrack = false;
  }

  snapshot() {
    return clone({
      schema: LOCAL_PLAYER_SCHEMA,
      selected: Boolean(this.element && this.queue.length),
      playing: this.playing,
      loading: this.loading,
      currentIndex: this.currentIndex,
      currentTime: this.currentTime,
      duration: this.duration,
      queue: this.queue.map((entry, index) => ({
        id: entry.id,
        name: entry.name,
        size: entry.size,
        current: index === this.currentIndex,
      })),
    });
  }

  hasSelection() {
    return Boolean(this.element && this.queue.length);
  }

  isPlaying() {
    return this.playing;
  }

  publish() {
    const snapshot = this.snapshot();
    try { this.onState(clone(snapshot)); } catch { /* UI reporting cannot take playback ownership. */ }
    return snapshot;
  }

  reportError(error) {
    const safe = error instanceof Error ? error : new Error('Local audio could not be used.');
    try { this.onError(safe); } catch { /* Error presentation cannot alter source ownership. */ }
    return safe;
  }

  enqueue(task) {
    const result = this.commitTail.then(task, task);
    this.commitTail = result.catch(() => {});
    return result;
  }

  prepareEntries(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return [];
    if (files.length > MAX_LOCAL_QUEUE_FILES) {
      throw new RangeError(`Choose up to ${MAX_LOCAL_QUEUE_FILES} local audio files at a time.`);
    }
    let totalBytes = 0;
    for (const file of files) {
      const size = Number(file?.size) || 0;
      const name = displayFileName(file?.name);
      if (size <= 0) throw new RangeError(`${name} is empty and was not added.`);
      if (size > MAX_LOCAL_FILE_BYTES) {
        throw new RangeError(`${name} is larger than the ${megabytes(MAX_LOCAL_FILE_BYTES)} MiB per-file limit.`);
      }
      totalBytes += size;
    }
    if (totalBytes > MAX_LOCAL_QUEUE_BYTES) {
      throw new RangeError(`That selection is larger than the ${megabytes(MAX_LOCAL_QUEUE_BYTES)} MiB queue limit.`);
    }

    const entries = [];
    try {
      for (const file of files) {
        entries.push({
          id: `local-track-${++this.idCounter}`,
          name: displayFileName(file.name),
          size: Number(file.size),
          file,
          url: this.createObjectURL(file),
          duration: 0,
        });
      }
      return entries;
    } catch {
      this.revokeEntries(entries);
      throw new Error('The browser could not prepare those local files.');
    }
  }

  revokeEntries(entries) {
    for (const entry of entries || []) {
      if (!entry?.url) continue;
      try { this.revokeObjectURL(entry.url); } catch { /* Discard the reference even if revocation is unavailable. */ }
      entry.url = '';
    }
  }

  async probeEntry(entry) {
    const probe = this.createAudio();
    probe.preload = 'metadata';
    try {
      const duration = await waitForMetadata(probe, {
        timeoutMs: this.metadataTimeoutMs,
        start: () => {
          probe.src = entry.url;
          probe.load?.();
        },
      });
      return duration;
    } finally {
      cleanupElement(probe);
    }
  }

  configureElement(element) {
    element.preload = 'metadata';
    element.controls = false;
    element.autoplay = false;
    element.loop = false;
    element.playsInline = true;
    element.hidden = true;
    element.setAttribute?.('aria-hidden', 'true');
    element.setAttribute?.('data-local-audio', '');
  }

  bindElement(element) {
    const isOwner = () => this.element === element;
    const listeners = {
      playing: () => {
        if (!isOwner()) return;
        if (!this.playIntent) {
          try { element.pause(); } catch { /* A late event cannot reclaim playback. */ }
          return;
        }
        this.playbackSessionStarted = true;
        this.setPlaying(true, 'playing');
      },
      pause: () => {
        if (!isOwner() || this.switchingTrack || element.ended) return;
        this.setPlaying(false, 'pause');
      },
      timeupdate: () => {
        if (!isOwner()) return;
        this.currentTime = Math.max(0, Number(element.currentTime) || 0);
        this.duration = validDuration(element) || this.duration;
        this.publish();
      },
      durationchange: () => {
        if (!isOwner()) return;
        this.duration = validDuration(element) || this.duration;
        if (this.queue[this.currentIndex]) this.queue[this.currentIndex].duration = this.duration;
        this.publish();
      },
      ended: () => {
        if (isOwner()) void this.handleEnded();
      },
      error: () => {
        if (!isOwner() || this.loading) return;
        this.playIntent = false;
        this.setPlaying(false, 'error', { force: true });
        this.reportError(new Error('This local audio file became unreadable. Choose another file.'));
      },
    };
    for (const [type, listener] of Object.entries(listeners)) element.addEventListener?.(type, listener);
    this.elementListeners = listeners;
  }

  unbindElement(element = this.element) {
    if (!element || !this.elementListeners) return;
    for (const [type, listener] of Object.entries(this.elementListeners)) element.removeEventListener?.(type, listener);
    this.elementListeners = null;
  }

  setPlaying(next, reason, { force = false } = {}) {
    const playing = Boolean(next);
    const changed = this.playing !== playing;
    this.playing = playing;
    this.publish();
    if (changed || force) {
      try { this.onPlaybackChange(playing, reason); } catch { /* Host playback reporting cannot alter media state. */ }
    }
  }

  discardCurrent() {
    const element = this.element;
    const entries = this.queue;
    this.unbindElement(element);
    this.element = null;
    this.queue = [];
    this.currentIndex = -1;
    this.currentTime = 0;
    this.duration = 0;
    this.loading = false;
    this.playing = false;
    this.playIntent = false;
    this.playbackSessionStarted = false;
    cleanupElement(element);
    this.revokeEntries(entries);
  }

  async selectFiles(fileList) {
    const revision = ++this.operationRevision;
    let entries;
    try {
      entries = this.prepareEntries(fileList);
    } catch (error) {
      throw this.reportError(error);
    }
    if (!entries.length) return false;

    try {
      entries[0].duration = await this.probeEntry(entries[0]);
    } catch (error) {
      this.revokeEntries(entries);
      if (revision !== this.operationRevision) return false;
      throw this.reportError(new Error(`${entries[0].name} could not be opened as browser-decodable audio.`, { cause: error }));
    }
    if (revision !== this.operationRevision) {
      this.revokeEntries(entries);
      return false;
    }

    return this.enqueue(async () => {
      if (revision !== this.operationRevision) {
        this.revokeEntries(entries);
        return false;
      }
      const element = this.createAudio();
      this.configureElement(element);
      element.src = entries[0].url;
      try { element.load?.(); } catch { /* The graph connection below reports a safe failure. */ }
      try {
        await this.audioEngine.connectMediaElement(element);
      } catch (error) {
        cleanupElement(element);
        this.revokeEntries(entries);
        if (revision !== this.operationRevision || error?.code === 'AUDIO_SOURCE_SUPERSEDED') return false;
        this.discardCurrent();
        this.publish();
        throw this.reportError(error);
      }
      if (revision !== this.operationRevision) {
        await this.audioEngine.stopMediaElement?.(element, 'source-change');
        cleanupElement(element);
        this.revokeEntries(entries);
        return false;
      }

      this.discardCurrent();
      this.queue = entries;
      this.currentIndex = 0;
      this.element = element;
      this.currentTime = 0;
      this.duration = entries[0].duration;
      this.bindElement(element);
      this.mount?.replaceChildren?.(element);
      const snapshot = this.publish();
      try { this.onSourceSelected(clone(snapshot)); } catch { /* Host presentation cannot alter source ownership. */ }
      return snapshot;
    });
  }

  async play() {
    const element = this.element;
    if (!element || !this.queue.length) throw this.reportError(new Error('Choose local audio before pressing Play.'));
    this.playIntent = true;
    try {
      await this.audioEngine.resumeMediaElement(element);
      if (element !== this.element || !this.playIntent) return false;
      await element.play();
      if (element !== this.element || !this.playIntent) {
        try { element.pause(); } catch { /* A stale completion cannot reclaim playback. */ }
        return false;
      }
      if (!element.paused) {
        this.playbackSessionStarted = true;
        this.setPlaying(true, 'play-success');
      }
      return this.playing;
    } catch (error) {
      if (element === this.element) {
        this.playIntent = false;
        this.setPlaying(false, 'play-rejected', { force: true });
      }
      throw this.reportError(new Error('Local audio could not start. Press Play to try again or choose another file.', { cause: error }));
    }
  }

  pause() {
    this.playIntent = false;
    try { this.element?.pause?.(); } catch { /* State below remains truthful. */ }
    this.setPlaying(false, 'user-pause');
    return this.snapshot();
  }

  seek(seconds) {
    if (!this.element || !Number.isFinite(this.duration) || this.duration <= 0) return false;
    const target = Math.max(0, Math.min(this.duration, Number(seconds) || 0));
    try {
      this.element.currentTime = target;
      this.currentTime = target;
      this.publish();
      return true;
    } catch {
      this.reportError(new Error('This file could not seek to that position.'));
      return false;
    }
  }

  async changeTrack(index, { continuePlayback = this.playing } = {}) {
    const target = Math.max(0, Math.min(this.queue.length - 1, Number(index)));
    if (!this.element || !this.queue[target] || target === this.currentIndex) return false;
    const revision = ++this.trackRevision;
    const element = this.element;
    const entry = this.queue[target];
    this.switchingTrack = true;
    this.loading = true;
    this.playIntent = Boolean(continuePlayback);
    try { element.pause(); } catch { /* Loading the requested source remains authoritative. */ }
    this.currentIndex = target;
    this.currentTime = 0;
    this.duration = entry.duration || 0;
    this.publish();
    try {
      const duration = await waitForMetadata(element, {
        timeoutMs: this.metadataTimeoutMs,
        start: () => {
          element.src = entry.url;
          element.load?.();
        },
      });
      if (element !== this.element || revision !== this.trackRevision) return false;
      entry.duration = duration;
      this.duration = duration;
      this.loading = false;
      this.switchingTrack = false;
      this.publish();
      if (continuePlayback) return this.play();
      this.playIntent = false;
      this.setPlaying(false, 'track-change-paused');
      return true;
    } catch (error) {
      if (element === this.element && revision === this.trackRevision) {
        this.loading = false;
        this.switchingTrack = false;
        this.playIntent = false;
        this.setPlaying(false, 'track-load-failed', { force: true });
      }
      if (element !== this.element || revision !== this.trackRevision) return false;
      throw this.reportError(new Error(`${entry.name} could not be opened as browser-decodable audio.`, { cause: error }));
    }
  }

  previous() {
    return this.changeTrack(Math.max(0, this.currentIndex - 1), { continuePlayback: this.playing });
  }

  next() {
    return this.changeTrack(Math.min(this.queue.length - 1, this.currentIndex + 1), { continuePlayback: this.playing });
  }

  async handleEnded() {
    if (!this.element) return;
    if (this.playIntent && this.playbackSessionStarted && this.currentIndex < this.queue.length - 1) {
      try {
        await this.changeTrack(this.currentIndex + 1, { continuePlayback: true });
      } catch {
        // changeTrack already leaves playback paused and reports the exact failure.
      }
      return;
    }
    this.playIntent = false;
    this.playbackSessionStarted = false;
    this.currentTime = this.duration;
    this.setPlaying(false, 'queue-ended', { force: true });
  }

  async remove(id) {
    const index = this.queue.findIndex(entry => entry.id === id);
    if (index < 0) return false;
    if (this.queue.length === 1) {
      await this.disconnect('queue-cleared');
      return true;
    }
    const [removed] = this.queue.splice(index, 1);
    if (index !== this.currentIndex) {
      if (index < this.currentIndex) this.currentIndex -= 1;
      this.revokeEntries([removed]);
      this.publish();
      return true;
    }
    const continuePlayback = this.playing;
    this.currentIndex = Math.min(index, this.queue.length - 1);
    const targetIndex = this.currentIndex;
    this.currentIndex = -1;
    const changing = this.changeTrack(targetIndex, { continuePlayback });
    this.revokeEntries([removed]);
    await changing;
    return true;
  }

  async disconnect(reason = 'user-disconnect') {
    ++this.operationRevision;
    ++this.trackRevision;
    return this.enqueue(async () => {
      const element = this.element;
      this.playIntent = false;
      try { element?.pause?.(); } catch { /* Cleanup below remains authoritative. */ }
      if (element) await this.audioEngine.stopMediaElement?.(element, reason);
      else if (this.audioEngine.diagnostics?.().sourceKind === 'local') await this.audioEngine.stop(reason);
      this.discardCurrent();
      this.publish();
      return true;
    });
  }

  clear() {
    return this.disconnect('queue-cleared');
  }

  dispose(reason = 'page-hidden') {
    ++this.operationRevision;
    ++this.trackRevision;
    const element = this.element;
    this.playIntent = false;
    try { element?.pause?.(); } catch { /* Synchronous release continues below. */ }
    const stopping = element
      ? this.audioEngine.stopMediaElement?.(element, reason)
      : this.audioEngine.diagnostics?.().sourceKind === 'local'
        ? this.audioEngine.stop(reason)
        : null;
    this.discardCurrent();
    this.publish();
    return Promise.resolve(stopping);
  }
}
