export const DREAM_TRANSPORT_SCHEMA = 'visualizer-dream-transport-v1';
export const DREAM_STREAM_IDLE_TIMEOUT_MS = 180000;
export const DREAM_STREAM_HARD_TIMEOUT_MS = 1800000;

function positiveDuration(value, fallback, label) {
  const duration = Number(value ?? fallback);
  if (!Number.isFinite(duration) || duration <= 0) throw new TypeError(`${label} must be a positive duration.`);
  return Math.floor(duration);
}

export function dreamTransportError(kind, evidence = {}) {
  const timeout = kind === 'idle' || kind === 'hard';
  const error = new Error(kind === 'idle'
    ? 'The model stream went idle before it finished. Your current Dream is still here.'
    : kind === 'hard'
      ? 'The model exceeded the generation safety ceiling before it finished. Your current Dream is still here.'
      : 'Dream cancelled. Your previous visualizer is still running. Work completed before cancellation may still be billed.');
  error.name = timeout ? 'DreamTimeoutError' : 'AbortError';
  error.code = kind === 'idle' ? 'DREAM_IDLE_TIMEOUT' : kind === 'hard' ? 'DREAM_HARD_TIMEOUT' : 'CANCELLED';
  error.timeoutKind = timeout ? kind : null;
  error.transport = { ...evidence };
  return error;
}

/** A request-scoped idle deadline plus a non-resetting secondary hard ceiling. */
export function createActivityTimeoutController({
  idleTimeoutMs = DREAM_STREAM_IDLE_TIMEOUT_MS,
  hardTimeoutMs = DREAM_STREAM_HARD_TIMEOUT_MS,
  clock = () => Date.now(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = timer => clearTimeout(timer),
  onTimeout = () => {},
} = {}) {
  const idleMs = positiveDuration(idleTimeoutMs, DREAM_STREAM_IDLE_TIMEOUT_MS, 'idleTimeoutMs');
  const hardMs = positiveDuration(hardTimeoutMs, DREAM_STREAM_HARD_TIMEOUT_MS, 'hardTimeoutMs');
  if (typeof clock !== 'function' || typeof schedule !== 'function' || typeof cancel !== 'function' || typeof onTimeout !== 'function') {
    throw new TypeError('Activity timeout dependencies must be functions.');
  }
  let active = false;
  let startedAt = null;
  let lastActivityAt = null;
  let idleTimer = null;
  let hardTimer = null;
  let terminal = null;

  function snapshot(at = clock()) {
    return Object.freeze({
      schema: DREAM_TRANSPORT_SCHEMA,
      active,
      startedAt,
      lastActivityAt,
      elapsedMs: startedAt == null ? 0 : Math.max(0, at - startedAt),
      idleForMs: lastActivityAt == null ? 0 : Math.max(0, at - lastActivityAt),
      idleTimeoutMs: idleMs,
      hardTimeoutMs: hardMs,
      terminal,
    });
  }

  function clearTimers() {
    if (idleTimer !== null) cancel(idleTimer);
    if (hardTimer !== null) cancel(hardTimer);
    idleTimer = null;
    hardTimer = null;
  }

  function expire(kind) {
    if (!active || terminal) return false;
    const at = clock();
    if (kind === 'idle') {
      const remaining = idleMs - Math.max(0, at - lastActivityAt);
      if (remaining > 0) {
        idleTimer = schedule(() => expire('idle'), remaining);
        return false;
      }
    }
    if (kind === 'hard') {
      const remaining = hardMs - Math.max(0, at - startedAt);
      if (remaining > 0) {
        hardTimer = schedule(() => expire('hard'), remaining);
        return false;
      }
    }
    terminal = kind;
    active = false;
    clearTimers();
    onTimeout(kind, snapshot(at));
    return true;
  }

  function armIdle() {
    if (idleTimer !== null) cancel(idleTimer);
    idleTimer = schedule(() => expire('idle'), idleMs);
  }

  return Object.freeze({
    start(at = clock()) {
      if (active || terminal) return snapshot(at);
      if (!Number.isFinite(Number(at))) throw new TypeError('Activity timestamps must be finite numbers.');
      active = true;
      startedAt = Number(at);
      lastActivityAt = Number(at);
      armIdle();
      hardTimer = schedule(() => expire('hard'), hardMs);
      return snapshot(at);
    },
    activity(at = clock()) {
      if (!active || terminal) return snapshot(at);
      const timestamp = Number(at);
      if (!Number.isFinite(timestamp)) throw new TypeError('Activity timestamps must be finite numbers.');
      lastActivityAt = Math.max(lastActivityAt, timestamp);
      armIdle();
      return snapshot(timestamp);
    },
    stop(reason = 'completed', at = clock()) {
      if (!terminal) terminal = String(reason || 'completed');
      active = false;
      clearTimers();
      return snapshot(at);
    },
    snapshot,
  });
}
