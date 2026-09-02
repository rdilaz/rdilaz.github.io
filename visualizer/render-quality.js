export const RENDER_QUALITY_SCHEMA = 'visualizer-render-quality-v1';
export const RENDER_QUALITY_STORAGE_KEY = 'ai-visualizer.render-quality.v1';

export const RENDER_QUALITY_PROFILES = Object.freeze({
  full: Object.freeze({ mode: 'full', label: 'Full', maxFps: 60, maxDpr: 2 }),
  balanced: Object.freeze({ mode: 'balanced', label: 'Balanced', maxFps: 45, maxDpr: 1.5 }),
  saver: Object.freeze({ mode: 'saver', label: 'Saver', maxFps: 30, maxDpr: 1 }),
});

export function normalizeRenderQualityMode(value) {
  const mode = String(value || '').toLowerCase();
  return Object.hasOwn(RENDER_QUALITY_PROFILES, mode) ? mode : 'full';
}

export function resolveRenderQuality(mode, nativeDpr = 1) {
  const profile = RENDER_QUALITY_PROFILES[normalizeRenderQualityMode(mode)];
  const parsedDpr = Number(nativeDpr);
  const physical = Number.isFinite(parsedDpr) && parsedDpr > 0 ? parsedDpr : 1;
  return Object.freeze({
    schema: RENDER_QUALITY_SCHEMA,
    mode: profile.mode,
    label: profile.label,
    maxFps: profile.maxFps,
    maxDpr: profile.maxDpr,
    nativeDpr: physical,
    effectiveDpr: Math.min(physical, profile.maxDpr),
  });
}

export function createCadenceGate(maxFps = 60) {
  let fps = Math.max(1, Number(maxFps) || 60);
  let interval = 1000 / fps;
  let nextDueAt = null;
  let lastRunAt = null;

  return Object.freeze({
    shouldRun(timestamp) {
      const now = Number(timestamp);
      if (!Number.isFinite(now)) return false;
      if (lastRunAt !== null && now <= lastRunAt) return false;
      if (nextDueAt === null) {
        nextDueAt = now + interval;
        lastRunAt = now;
        return true;
      }
      if (now + 0.25 < nextDueAt) return false;
      nextDueAt += (Math.floor(Math.max(0, now - nextDueAt) / interval) + 1) * interval;
      lastRunAt = now;
      return true;
    },
    setMaxFps(value) {
      const next = Math.max(1, Number(value) || 60);
      if (next === fps) return false;
      fps = next;
      interval = 1000 / fps;
      nextDueAt = null;
      return true;
    },
    reset() {
      nextDueAt = null;
      lastRunAt = null;
    },
    snapshot() {
      return Object.freeze({ maxFps: fps, intervalMs: interval, nextDueAt, lastRunAt });
    },
  });
}

export function createRenderQualityController({ storage = null, clock = () => Date.now() } = {}) {
  const persisted = (() => {
    try { return JSON.parse(storage?.getItem?.(RENDER_QUALITY_STORAGE_KEY) || 'null'); } catch { return null; }
  })();
  let mode = normalizeRenderQualityMode(persisted?.schema === RENDER_QUALITY_SCHEMA ? persisted.mode : 'full');
  let changedAt = Number.isFinite(Number(persisted?.changedAt)) ? Number(persisted.changedAt) : null;
  const listeners = new Set();

  function snapshot() {
    return Object.freeze({
      schema: RENDER_QUALITY_SCHEMA,
      mode,
      changedAt,
      profile: RENDER_QUALITY_PROFILES[mode],
    });
  }

  function persist() {
    try { storage?.setItem?.(RENDER_QUALITY_STORAGE_KEY, JSON.stringify({ schema: RENDER_QUALITY_SCHEMA, mode, changedAt })); } catch { /* In-memory selection remains usable. */ }
  }

  return Object.freeze({
    snapshot,
    setMode(value) {
      const next = normalizeRenderQualityMode(value);
      if (next === mode) return snapshot();
      mode = next;
      changedAt = Number(clock()) || Date.now();
      persist();
      const valueSnapshot = snapshot();
      listeners.forEach(listener => listener(valueSnapshot));
      return valueSnapshot;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  });
}
