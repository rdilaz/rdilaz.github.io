import assert from 'node:assert/strict';
import test from 'node:test';
import { IMMERSIVE_HIDE_DELAY_MS, IMMERSIVE_UI_SCHEMA, createImmersiveUiController } from '../public/visualizer/immersive-ui.js';

class FakeScheduler {
  now = 0;
  sequence = 0;
  timers = new Map();

  schedule = (callback, delay) => {
    const id = ++this.sequence;
    this.timers.set(id, { callback, due: this.now + delay });
    return id;
  };

  cancel = id => this.timers.delete(id);

  advance(ms) {
    const target = this.now + ms;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      this.now = next[1].due;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.now = target;
  }
}

function fixture() {
  const scheduler = new FakeScheduler();
  let blocker = '';
  const changes = [];
  const controller = createImmersiveUiController({
    hideDelayMs: 3000,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    getBlocker: () => blocker,
    onChange: snapshot => changes.push(snapshot),
  });
  return { scheduler, controller, changes, setBlocker: value => { blocker = value; } };
}

test('immersive policy is explicitly versioned with a three-second default', () => {
  assert.equal(IMMERSIVE_UI_SCHEMA, 'visualizer-immersive-ui-v1');
  assert.equal(IMMERSIVE_HIDE_DELAY_MS, 3000);
});

test('inactivity hides once and trusted activity wakes immediately', () => {
  const { scheduler, controller } = fixture();
  controller.scheduleHide();
  scheduler.advance(2999);
  assert.equal(controller.snapshot().hidden, false);
  scheduler.advance(1);
  assert.equal(controller.snapshot().hidden, true);
  controller.wake('iframe-pointer', { mode: 'pointer' });
  assert.equal(controller.snapshot().hidden, false);
  assert.equal(controller.snapshot().lastActivity, 'iframe-pointer');
});

test('continuous activity invalidates stale timers and extends the deadline', () => {
  const { scheduler, controller } = fixture();
  controller.scheduleHide();
  scheduler.advance(2500);
  controller.wake('pointermove');
  scheduler.advance(2500);
  assert.equal(controller.snapshot().hidden, false);
  scheduler.advance(500);
  assert.equal(controller.snapshot().hidden, true);
});

test('real blockers pin visible chrome and clearing them restarts idle hiding', () => {
  const { scheduler, controller, setBlocker } = fixture();
  for (const reason of ['drawer-open', 'dialog-open', 'dream-switcher-open', 'playback-paused', 'keyboard-focus']) {
    setBlocker(reason);
    controller.sync();
    scheduler.advance(5000);
    assert.equal(controller.snapshot().hidden, false, `${reason} should pin the chrome`);
    assert.equal(controller.snapshot().blocker, reason);
  }
  setBlocker('');
  controller.sync();
  scheduler.advance(3000);
  assert.equal(controller.snapshot().hidden, true);
});

test('pointer-created focus can use pointer mode while keyboard navigation is retained', () => {
  const { controller } = fixture();
  controller.wake('button-click', { mode: 'pointer' });
  assert.equal(controller.snapshot().inputMode, 'pointer');
  controller.wake('host-keyboard', { mode: 'keyboard' });
  assert.equal(controller.snapshot().inputMode, 'keyboard');
});

test('destroy cancels a pending hide without changing visible state later', () => {
  const { scheduler, controller } = fixture();
  controller.scheduleHide();
  controller.destroy();
  scheduler.advance(10000);
  assert.equal(controller.snapshot().hidden, false);
});
