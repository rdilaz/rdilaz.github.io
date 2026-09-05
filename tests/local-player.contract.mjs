import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_PLAYER_SCHEMA,
  MAX_LOCAL_FILE_BYTES,
  MAX_LOCAL_QUEUE_BYTES,
  MAX_LOCAL_QUEUE_FILES,
  LocalPlayer,
} from '../public/visualizer/local-player.js';

class FakeAudio {
  constructor(behaviors) {
    this.behaviors = behaviors;
    this.listeners = new Map();
    this._src = '';
    this._currentTime = 0;
    this.duration = Number.NaN;
    this.readyState = 0;
    this.paused = true;
    this.ended = false;
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.loadRevision = 0;
    this.removed = false;
  }

  set src(value) {
    this._src = String(value || '');
    this.readyState = 0;
    this.duration = Number.NaN;
    this.ended = false;
    this._currentTime = 0;
  }

  get src() { return this._src; }
  set currentTime(value) { this._currentTime = Number(value) || 0; }
  get currentTime() { return this._currentTime; }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  setAttribute() {}

  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }

  remove() { this.removed = true; }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener({ type, target: this });
  }

  load() {
    const revision = ++this.loadRevision;
    const source = this._src;
    if (!source) return;
    const behavior = this.behaviors.get(source) || {};
    setTimeout(() => {
      if (revision !== this.loadRevision || source !== this._src) return;
      if (behavior.metadataError) {
        this.dispatch('error');
        return;
      }
      this.duration = Number(behavior.duration) || 1;
      this.readyState = 1;
      this.dispatch('loadedmetadata');
      this.dispatch('durationchange');
    }, Number(behavior.delay) || 0);
  }

  async play() {
    this.playCalls += 1;
    const behavior = this.behaviors.get(this._src) || {};
    if (behavior.playReject) throw new DOMException('test-only rejection', 'NotAllowedError');
    this.paused = false;
    this.ended = false;
    this.dispatch('playing');
  }

  pause() {
    this.pauseCalls += 1;
    const changed = !this.paused;
    this.paused = true;
    if (changed) this.dispatch('pause');
  }

  finish() {
    this._currentTime = Number(this.duration) || 0;
    this.ended = true;
    this.paused = true;
    this.dispatch('ended');
  }
}

class FakeAudioEngine {
  constructor() {
    this.current = null;
    this.connected = false;
    this.sourceKind = null;
    this.connects = [];
    this.resumes = [];
    this.stops = [];
  }

  async connectMediaElement(element) {
    this.current?.pause();
    this.current = element;
    this.connected = true;
    this.sourceKind = 'local';
    this.connects.push(element);
  }

  async resumeMediaElement(element) {
    if (element !== this.current) throw new Error('stale media element');
    this.resumes.push(element);
  }

  async stopMediaElement(element, reason) {
    if (element !== this.current) return false;
    this.stops.push({ element, reason });
    this.current = null;
    this.connected = false;
    this.sourceKind = null;
    return true;
  }

  async stop(reason) {
    this.stops.push({ element: this.current, reason });
    this.current = null;
    this.connected = false;
    this.sourceKind = null;
  }

  diagnostics() {
    return { sourceKind: this.sourceKind };
  }
}

function file(name, options = {}) {
  return {
    name,
    size: options.size ?? 1024,
    duration: options.duration ?? 1,
    delay: options.delay ?? 0,
    metadataError: Boolean(options.metadataError),
    playReject: Boolean(options.playReject),
  };
}

function fixture() {
  const behaviors = new Map();
  const created = [];
  const revoked = [];
  const audioElements = [];
  const playback = [];
  const states = [];
  const errors = [];
  const engine = new FakeAudioEngine();
  const player = new LocalPlayer({
    audioEngine: engine,
    metadataTimeoutMs: 100,
    createObjectURL(source) {
      const url = `blob:test-${created.length + 1}`;
      created.push(url);
      behaviors.set(url, source);
      return url;
    },
    revokeObjectURL(url) { revoked.push(url); },
    createAudio() {
      const element = new FakeAudio(behaviors);
      audioElements.push(element);
      return element;
    },
    onState: state => states.push(state),
    onPlaybackChange: (playing, reason) => playback.push({ playing, reason }),
    onError: error => errors.push(error.message),
  });
  return { player, engine, created, revoked, audioElements, playback, states, errors };
}

async function waitFor(predicate, timeoutMs = 250) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for local-player fixture state.');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

test('local queue bounds reject count, empty, per-file, and total-size violations before URL allocation', async () => {
  const { player, created } = fixture();
  await assert.rejects(player.selectFiles(Array.from({ length: MAX_LOCAL_QUEUE_FILES + 1 }, (_, index) => file(`track-${index}.wav`))), /up to 24/i);
  await assert.rejects(player.selectFiles([file('empty.wav', { size: 0 })]), /empty/i);
  await assert.rejects(player.selectFiles([file('large.wav', { size: MAX_LOCAL_FILE_BYTES + 1 })]), /per-file limit/i);
  await assert.rejects(player.selectFiles(Array.from({ length: 5 }, (_, index) => (
    file(`queue-${index}.wav`, { size: MAX_LOCAL_FILE_BYTES })
  ))), /queue limit/i);
  assert.deepEqual(created, []);
  assert.equal(player.snapshot().selected, false);
});

test('selection never autoplays and queue transport preserves pause, seek, advance, removal, and disposal truth', async () => {
  const { player, engine, created, revoked, audioElements, playback } = fixture();
  const selected = await player.selectFiles([
    file('alpha.wav', { duration: 2 }),
    file('beta.wav', { duration: 3 }),
  ]);
  assert.equal(selected.schema, LOCAL_PLAYER_SCHEMA);
  assert.equal(selected.selected, true);
  assert.equal(selected.playing, false);
  assert.equal(engine.connects.length, 1);
  const element = engine.current;
  assert.equal(element.playCalls, 0);

  await player.play();
  assert.equal(player.snapshot().playing, true);
  assert.equal(engine.resumes.length, 1);
  player.pause();
  assert.equal(player.snapshot().playing, false);
  assert.equal(player.seek(1.25), true);
  assert.equal(player.snapshot().currentTime, 1.25);

  await player.next();
  assert.equal(player.snapshot().currentIndex, 1);
  assert.equal(player.snapshot().playing, false);
  assert.equal(element.playCalls, 1);
  await player.previous();
  assert.equal(player.snapshot().currentIndex, 0);
  await player.play();
  element.finish();
  await waitFor(() => player.snapshot().currentIndex === 1 && player.snapshot().playing);
  assert.equal(engine.connects.length, 1);
  element.finish();
  await waitFor(() => !player.snapshot().playing);
  assert.equal(player.snapshot().currentIndex, 1);
  assert.ok(playback.some(event => event.reason === 'queue-ended' && event.playing === false));

  const betaId = player.snapshot().queue[1].id;
  await player.remove(betaId);
  assert.equal(player.snapshot().queue.length, 1);
  assert.equal(player.snapshot().currentIndex, 0);
  await player.clear();
  assert.equal(player.snapshot().selected, false);
  assert.equal(engine.current, null);
  assert.deepEqual([...revoked].sort(), [...created].sort());
  assert.equal(new Set(revoked).size, revoked.length);
  const eventsBeforeStale = playback.length;
  element.dispatch('playing');
  assert.equal(playback.length, eventsBeforeStale);
  assert.ok(audioElements.every(audio => audio.removed));
});

test('cancel and corrupt replacement preserve the current source while rapid replacement cannot regain stale ownership', async () => {
  const { player, engine, revoked } = fixture();
  await player.selectFiles([file('current.wav', { duration: 4 })]);
  const currentElement = engine.current;
  assert.equal(await player.selectFiles([]), false);
  assert.equal(engine.current, currentElement);
  await assert.rejects(player.selectFiles([file('corrupt.wav', { metadataError: true })]), /browser-decodable/i);
  assert.equal(engine.current, currentElement);
  assert.equal(player.snapshot().queue[0].name, 'current.wav');

  const slow = player.selectFiles([file('slow.wav', { delay: 35 })]);
  const fast = player.selectFiles([file('fast.wav', { delay: 1 })]);
  const fastResult = await fast;
  assert.equal(fastResult.queue[0].name, 'fast.wav');
  assert.equal(await slow, false);
  assert.equal(player.snapshot().queue[0].name, 'fast.wav');
  assert.equal(engine.current, engine.connects.at(-1));
  assert.ok(revoked.length >= 2);
  await player.disconnect();
});

test('queued corruption and rejected play pause safely without silently choosing another source', async () => {
  const { player, engine, playback } = fixture();
  await player.selectFiles([
    file('<img src=x onerror=canary>.wav', { duration: 2, playReject: true }),
    file('corrupt-next.wav', { metadataError: true }),
    file('must-not-skip-to.wav', { duration: 2 }),
  ]);
  assert.equal(player.snapshot().queue[0].name, '<img src=x onerror=canary>.wav');
  await assert.rejects(player.play(), /could not start/i);
  assert.equal(player.snapshot().playing, false);
  assert.ok(playback.some(event => event.reason === 'play-rejected' && event.playing === false));

  engine.current.behaviors.get(engine.current.src).playReject = false;
  await assert.rejects(player.next(), /corrupt-next.*browser-decodable/i);
  assert.equal(player.snapshot().currentIndex, 1);
  assert.equal(player.snapshot().playing, false);
  assert.notEqual(player.snapshot().queue[player.snapshot().currentIndex].name, 'must-not-skip-to.wav');
  await player.disconnect();
});

test('repeated page disposal revokes each queue, detaches stale listeners, and ignores external capture', async () => {
  const { player, engine, created, revoked, playback } = fixture();
  await player.selectFiles([file('page-exit-a.wav')]);
  const elementA = engine.current;
  await player.play();
  const stoppingA = player.dispose();
  assert.equal(player.snapshot().selected, false);
  await stoppingA;
  await player.selectFiles([file('page-exit-b.wav')]);
  const elementB = engine.current;
  await player.play();
  const stoppingB = player.dispose();
  assert.equal(player.snapshot().selected, false);
  await stoppingB;
  assert.deepEqual(revoked, created);
  assert.equal(new Set(revoked).size, 2);
  const eventCount = playback.length;
  elementA.dispatch('playing');
  elementB.dispatch('playing');
  assert.equal(playback.length, eventCount);
  assert.equal(engine.current, null);

  const external = { kind: 'microphone' };
  engine.current = external;
  engine.connected = true;
  engine.sourceKind = 'microphone';
  const stopCount = engine.stops.length;
  await player.dispose();
  assert.equal(engine.current, external);
  assert.equal(engine.connected, true);
  assert.equal(engine.stops.length, stopCount);
});
