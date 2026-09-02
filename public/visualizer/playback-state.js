export const PLAYBACK_STATE_SCHEMA = 'visualizer-playback-v1';
export const EXTERNAL_CAPTURE_PAUSE_COPY = 'Visual paused · music source still controlled externally';

const clone = value => structuredClone(value);

export function createPlaybackController({
  clock = () => Date.now(),
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function.');

  let state = {
    schema: PLAYBACK_STATE_SCHEMA,
    status: 'playing',
    paused: false,
    changedAt: clock(),
    revision: 0,
  };
  const listeners = new Set();

  function snapshot() {
    return clone(state);
  }

  function publish(paused) {
    const nextPaused = Boolean(paused);
    if (state.paused === nextPaused) return snapshot();
    state = {
      ...state,
      status: nextPaused ? 'paused' : 'playing',
      paused: nextPaused,
      changedAt: clock(),
      revision: state.revision + 1,
    };
    const current = snapshot();
    listeners.forEach(listener => listener(clone(current)));
    return current;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Playback listener must be a function.');
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    version: PLAYBACK_STATE_SCHEMA,
    snapshot,
    subscribe,
    setPaused: publish,
    pause: () => publish(true),
    play: () => publish(false),
    toggle: () => publish(!state.paused),
  });
}
