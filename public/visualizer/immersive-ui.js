export const IMMERSIVE_UI_SCHEMA = 'visualizer-immersive-ui-v1';
export const IMMERSIVE_HIDE_DELAY_MS = 3000;

export function createImmersiveUiController({
  hideDelayMs = IMMERSIVE_HIDE_DELAY_MS,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = timer => clearTimeout(timer),
  getBlocker = () => '',
  onChange = () => {},
} = {}) {
  const delay = Math.max(1, Math.floor(Number(hideDelayMs) || IMMERSIVE_HIDE_DELAY_MS));
  let hidden = false;
  let timer = null;
  let revision = 0;
  let inputMode = 'pointer';
  let lastActivity = 'startup';
  let blocker = '';

  function snapshot() {
    return Object.freeze({
      schema: IMMERSIVE_UI_SCHEMA,
      hidden,
      blocker,
      inputMode,
      lastActivity,
      hideDelayMs: delay,
      hideScheduled: timer !== null,
      revision,
    });
  }

  function publish() {
    onChange(snapshot());
  }

  function clearTimer() {
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function currentBlocker() {
    const value = getBlocker({ inputMode, hidden });
    return typeof value === 'string' ? value : value ? 'blocked' : '';
  }

  function scheduleHide() {
    clearTimer();
    blocker = currentBlocker();
    const scheduledRevision = ++revision;
    if (blocker) {
      publish();
      return snapshot();
    }
    timer = schedule(() => {
      if (scheduledRevision !== revision) return;
      timer = null;
      blocker = currentBlocker();
      if (blocker) {
        publish();
        return;
      }
      hidden = true;
      publish();
    }, delay);
    publish();
    return snapshot();
  }

  return Object.freeze({
    wake(reason = 'activity', { mode = inputMode } = {}) {
      inputMode = mode === 'keyboard' ? 'keyboard' : 'pointer';
      lastActivity = String(reason || 'activity');
      hidden = false;
      blocker = '';
      revision += 1;
      clearTimer();
      publish();
      return scheduleHide();
    },
    scheduleHide,
    sync() {
      blocker = currentBlocker();
      if (blocker) {
        revision += 1;
        clearTimer();
        hidden = false;
        publish();
        return snapshot();
      }
      return scheduleHide();
    },
    setInputMode(mode) {
      inputMode = mode === 'keyboard' ? 'keyboard' : 'pointer';
      publish();
      return snapshot();
    },
    snapshot,
    destroy() {
      revision += 1;
      clearTimer();
    },
  });
}
