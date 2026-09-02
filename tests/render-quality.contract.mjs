import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RENDER_QUALITY_PROFILES,
  RENDER_QUALITY_SCHEMA,
  RENDER_QUALITY_STORAGE_KEY,
  createCadenceGate,
  createRenderQualityController,
  normalizeRenderQualityMode,
  resolveRenderQuality,
} from '../public/visualizer/render-quality.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    value: key => values.get(key) ?? null,
  };
}

test('Full, Balanced, and Saver are exact immutable host render profiles', () => {
  assert.deepEqual(RENDER_QUALITY_PROFILES.full, { mode: 'full', label: 'Full', maxFps: 60, maxDpr: 2 });
  assert.deepEqual(RENDER_QUALITY_PROFILES.balanced, { mode: 'balanced', label: 'Balanced', maxFps: 45, maxDpr: 1.5 });
  assert.deepEqual(RENDER_QUALITY_PROFILES.saver, { mode: 'saver', label: 'Saver', maxFps: 30, maxDpr: 1 });
  assert.equal(Object.isFrozen(RENDER_QUALITY_PROFILES), true);
  assert.equal(Object.isFrozen(RENDER_QUALITY_PROFILES.saver), true);
});

test('Full is the safe migration fallback and effective DPR never exceeds native DPR', () => {
  assert.equal(normalizeRenderQualityMode('unknown'), 'full');
  assert.deepEqual(resolveRenderQuality('full', 3), {
    schema: RENDER_QUALITY_SCHEMA,
    mode: 'full',
    label: 'Full',
    maxFps: 60,
    maxDpr: 2,
    nativeDpr: 3,
    effectiveDpr: 2,
  });
  assert.equal(resolveRenderQuality('balanced', 3).effectiveDpr, 1.5);
  assert.equal(resolveRenderQuality('saver', 3).effectiveDpr, 1);
  assert.equal(resolveRenderQuality('balanced', 1.25).effectiveDpr, 1.25);
  assert.equal(resolveRenderQuality('full', 1).effectiveDpr, 1);
  assert.equal(resolveRenderQuality('saver', 0.75).effectiveDpr, 0.75);
});

test('render quality persists locally and repeated selection is idempotent', () => {
  const storage = memoryStorage();
  let now = 10;
  const controller = createRenderQualityController({ storage, clock: () => ++now });
  let notifications = 0;
  controller.subscribe(() => { notifications += 1; });
  assert.equal(controller.snapshot().mode, 'full');
  controller.setMode('saver');
  controller.setMode('saver');
  assert.equal(notifications, 2);
  const persisted = JSON.parse(storage.value(RENDER_QUALITY_STORAGE_KEY));
  assert.equal(persisted.schema, RENDER_QUALITY_SCHEMA);
  assert.equal(persisted.mode, 'saver');
  assert.equal(createRenderQualityController({ storage }).snapshot().mode, 'saver');
});

test('corrupt or unavailable storage keeps Full usable in memory', () => {
  const corrupt = memoryStorage({ [RENDER_QUALITY_STORAGE_KEY]: '{broken' });
  assert.equal(createRenderQualityController({ storage: corrupt }).snapshot().mode, 'full');
  const denied = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  const controller = createRenderQualityController({ storage: denied });
  assert.equal(controller.setMode('balanced').mode, 'balanced');
});

test('cadence gates bound Full, Balanced, and Saver without catch-up bursts', () => {
  for (const [fps, expected] of [[60, 60], [45, 45], [30, 30]]) {
    const gate = createCadenceGate(fps);
    let count = 0;
    for (let index = 0; index < 120; index += 1) {
      if (gate.shouldRun(index * (1000 / 120))) count += 1;
    }
    assert.ok(Math.abs(count - expected) <= 1, `${fps} FPS gate emitted ${count} frames`);
    assert.equal(gate.shouldRun(5000), true);
    assert.equal(gate.shouldRun(5000), false);
  }
});

test('changing cadence resets only the next delivery decision', () => {
  const gate = createCadenceGate(60);
  assert.equal(gate.shouldRun(0), true);
  assert.equal(gate.shouldRun(4), false);
  assert.equal(gate.setMaxFps(30), true);
  assert.equal(gate.shouldRun(5), true);
  assert.equal(gate.shouldRun(20), false);
  assert.equal(gate.setMaxFps(30), false);
});

test('multi-day suspension recovery is constant-time and never catches up in a burst', () => {
  const gate = createCadenceGate(60);
  assert.equal(gate.shouldRun(0), true);
  const started = performance.now();
  assert.equal(gate.shouldRun(30 * 24 * 60 * 60 * 1000), true);
  const duration = performance.now() - started;
  assert.ok(duration < 20, `30-day recovery took ${duration.toFixed(2)}ms`);
  assert.equal(gate.shouldRun(30 * 24 * 60 * 60 * 1000), false);
});
