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
    const completeMetadata = () => {
      if (revision !== this.loadRevision || source !== this._src) return;
      if (behavior.metadataError) {
        this.dispatch('error');
        return;
      }
      this.duration = Number(behavior.duration) || 1;
      this.readyState = 1;
      this.dispatch('loadedmetadata');
      this.dispatch('durationchange');
    };
    if (behavior.holdMetadata) {
      behavior.releaseMetadata = completeMetadata;
      return;
    }
    setTimeout(completeMetadata, Number(behavior.delay) || 0);
  }

  async play() {
    this.playCalls += 1;
    const behavior = this.behaviors.get(this._src) || {};
    if (behavior.playReject) throw new DOMException('test-only rejection', 'NotAllowedError');
    if (behavior.holdPlay) {
      behavior.pendingPlays ||= [];
      await new Promise((resolve, reject) => behavior.pendingPlays.push({ resolve, reject }));
    }
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
    this.expressiveResets = [];
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

  resetExpressiveState(reason) {
    this.expressiveResets.push(reason);
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
    holdMetadata: Boolean(options.holdMetadata),
    holdPlay: Boolean(options.holdPlay),
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
  assert.ok(engine.expressiveResets.includes('seek'));
  assert.ok(engine.expressiveResets.filter(reason => reason === 'source-replacement').length >= 3);

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

test('Next then Pause during delayed metadata stays paused and later explicit Play works', async () => {
  const { player, engine, playback } = fixture();
  const delayed = file('next-delayed.wav', { holdMetadata: true });
  await player.selectFiles([file('next-current.wav'), delayed]);
  await player.play();
  const transition = player.next();
  assert.equal(player.snapshot().loading, true);
  player.pause();
  delayed.releaseMetadata();
  await transition;
  assert.equal(player.snapshot().loading, false);
  assert.equal(player.snapshot().playing, false);
  assert.equal(engine.current.paused, true);
  assert.equal(engine.current.playCalls, 1);
  assert.ok(playback.some(event => event.reason === 'user-pause' && event.playing === false));

  await player.play();
  assert.equal(player.snapshot().playing, true);
  assert.equal(engine.current.paused, false);
  assert.equal(engine.current.playCalls, 2);
  await player.disconnect();
});

test('automatic advancement then Pause during delayed metadata stays paused', async () => {
  const { player, engine } = fixture();
  const delayed = file('automatic-delayed.wav', { holdMetadata: true });
  await player.selectFiles([file('automatic-current.wav'), delayed]);
  await player.play();
  engine.current.finish();
  await waitFor(() => player.snapshot().currentIndex === 1 && player.snapshot().loading);
  player.pause();
  delayed.releaseMetadata();
  await waitFor(() => !player.snapshot().loading);
  assert.equal(player.snapshot().playing, false);
  assert.equal(engine.current.paused, true);
  assert.equal(engine.current.playCalls, 1);
  await player.disconnect();
});

test('removing the current track then Pause during delayed metadata stays paused', async () => {
  const { player, engine } = fixture();
  const delayed = file('remove-delayed.wav', { holdMetadata: true });
  await player.selectFiles([file('remove-current.wav'), delayed]);
  await player.play();
  const currentId = player.snapshot().queue[0].id;
  const removal = player.remove(currentId);
  assert.equal(player.snapshot().loading, true);
  player.pause();
  delayed.releaseMetadata();
  await removal;
  assert.equal(player.snapshot().loading, false);
  assert.equal(player.snapshot().playing, false);
  assert.equal(engine.current.paused, true);
  assert.equal(engine.current.playCalls, 1);
  await player.disconnect();
});

test('uninterrupted delayed automatic advancement still plays exactly once', async () => {
  const { player, engine } = fixture();
  const delayed = file('control-delayed.wav', { holdMetadata: true });
  await player.selectFiles([file('control-current.wav'), delayed]);
  await player.play();
  engine.current.finish();
  await waitFor(() => player.snapshot().currentIndex === 1 && player.snapshot().loading);
  delayed.releaseMetadata();
  await waitFor(() => !player.snapshot().loading && player.snapshot().playing);
  assert.equal(engine.current.paused, false);
  assert.equal(engine.current.playCalls, 2);
  await player.disconnect();
});

test('one pending Play completes normally', async () => {
  const { player, engine } = fixture();
  const source = file('single-pending-play.wav', { holdPlay: true });
  await player.selectFiles([source]);
  const playing = player.play();
  await waitFor(() => source.pendingPlays?.length === 1);
  source.pendingPlays[0].resolve();
  await playing;
  assert.equal(player.snapshot().playing, true);
  assert.equal(engine.current.paused, false);
  assert.equal(engine.current.playCalls, 1);
  await player.disconnect();
});

test('older pending Play completion does not pause while newer Play is still pending', async () => {
  const { player, engine } = fixture();
  const source = file('older-first-pending-play.wav', { holdPlay: true });
  await player.selectFiles([source]);
  const olderPlay = player.play();
  await waitFor(() => source.pendingPlays?.length === 1);
  const newerPlay = player.play();
  await waitFor(() => source.pendingPlays?.length === 2);
  source.pendingPlays[0].resolve();
  await olderPlay;
  const afterOlder = { playing: player.snapshot().playing, paused: engine.current.paused };
  source.pendingPlays[1].resolve();
  await newerPlay;
  await player.disconnect();
  assert.deepEqual(afterOlder, { playing: true, paused: false });
});

test('newer Play remains authoritative when an older native Play resolves last', async () => {
  const { player, engine } = fixture();
  const source = file('newer-first-pending-play.wav', { holdPlay: true });
  await player.selectFiles([source]);
  const olderPlay = player.play();
  await waitFor(() => source.pendingPlays?.length === 1);
  const newerPlay = player.play();
  await waitFor(() => source.pendingPlays?.length === 2);
  source.pendingPlays[1].resolve();
  await newerPlay;
  source.pendingPlays[0].resolve();
  await olderPlay;
  const finalState = { playing: player.snapshot().playing, paused: engine.current.paused, playCalls: engine.current.playCalls };
  await player.disconnect();
  assert.deepEqual(finalState, { playing: true, paused: false, playCalls: 2 });
});

test('Pause remains authoritative over a pending native Play completion', async () => {
  const { player, engine, errors } = fixture();
  const source = file('pause-pending-play.wav', { holdPlay: true });
  await player.selectFiles([source]);
  const pendingPlay = player.play();
  await waitFor(() => source.pendingPlays?.length === 1);
  player.pause();
  source.pendingPlays[0].resolve();
  await pendingPlay;
  assert.equal(player.snapshot().playing, false);
  assert.equal(engine.current.paused, true);
  assert.deepEqual(errors, []);
  await player.disconnect();
});

test('stale pending Play rejection cannot publish over a newer successful Play', async () => {
  const { player, engine, errors } = fixture();
  const source = file('stale-rejection-pending-play.wav', { holdPlay: true });
  await player.selectFiles([source]);
  const olderPlay = player.play();
  await waitFor(() => source.pendingPlays?.length === 1);
  const newerPlay = player.play();
  await waitFor(() => source.pendingPlays?.length === 2);
  source.pendingPlays[1].resolve();
  await newerPlay;
  source.pendingPlays[0].reject(new DOMException('obsolete test-only rejection', 'AbortError'));
  await olderPlay;
  assert.equal(player.snapshot().playing, true);
  assert.equal(engine.current.paused, false);
  assert.deepEqual(errors, []);
  await player.disconnect();
});

test('pending Play completion on a replaced element stops only the retired element', async () => {
  const { player, engine } = fixture();
  const retiredSource = file('retired-pending-play.wav', { holdPlay: true });
  await player.selectFiles([retiredSource]);
  const retiredElement = engine.current;
  const retiredPlay = player.play();
  await waitFor(() => retiredSource.pendingPlays?.length === 1);
  await player.selectFiles([file('authoritative-replacement.wav')]);
  const authoritativeElement = engine.current;
  retiredSource.pendingPlays[0].resolve();
  await retiredPlay;
  assert.equal(retiredElement.paused, true);
  assert.equal(authoritativeElement.paused, true);
  assert.equal(player.snapshot().queue[0].name, 'authoritative-replacement.wav');
  await player.disconnect();
});
