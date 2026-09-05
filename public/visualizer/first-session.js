export const FIRST_SESSION_SCHEMA = 'visualizer-first-session-v1';
export const FIRST_SESSION_STORAGE_KEY = 'ai-visualizer.first-session.v1';
export const FIRST_SESSION_COMPLETE_VALUE = 'complete';

const clone = value => structuredClone(value);

export function createFirstSessionController({ storage = globalThis.localStorage } = {}) {
  let completedAtLoad = false;
  try {
    completedAtLoad = storage?.getItem?.(FIRST_SESSION_STORAGE_KEY) === FIRST_SESSION_COMPLETE_VALUE;
  } catch {
    completedAtLoad = false;
  }

  let state = {
    schema: FIRST_SESSION_SCHEMA,
    visible: !completedAtLoad,
    completed: completedAtLoad,
    revision: 0,
  };
  const listeners = new Set();

  function snapshot() {
    return clone(state);
  }

  function publish(patch) {
    state = { ...state, ...patch, revision: state.revision + 1 };
    const current = snapshot();
    listeners.forEach(listener => listener(clone(current)));
    return current;
  }

  function complete() {
    try {
      storage?.setItem?.(FIRST_SESSION_STORAGE_KEY, FIRST_SESSION_COMPLETE_VALUE);
    } catch {
      // The in-memory dismissal still prevents repeated interruption this session.
    }
    return publish({ visible: false, completed: true });
  }

  return Object.freeze({
    version: FIRST_SESSION_SCHEMA,
    freshVisit: () => !completedAtLoad,
    snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('First-session listener must be a function.');
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    dismiss: complete,
    complete,
    reopen: () => publish({ visible: true }),
  });
}

export function mountFirstSession({
  controller,
  root = document,
  onConnectAudio = () => {},
  onExploreFeatured = () => {},
  onVisibilityChange = () => {},
  fallbackFocus = null,
} = {}) {
  if (!controller) throw new TypeError('A first-session controller is required.');
  const story = root.getElementById('firstSessionStory');
  const connect = root.getElementById('firstSessionConnect');
  const explore = root.getElementById('firstSessionExplore');
  const dismiss = root.getElementById('firstSessionDismiss');
  let focusOnShow = false;

  function render(snapshot) {
    if (!story) return;
    story.hidden = !snapshot.visible;
    story.setAttribute('aria-hidden', String(!snapshot.visible));
    document.body.classList.toggle('first-session-open', snapshot.visible);
    onVisibilityChange(snapshot.visible);
    if (snapshot.visible && focusOnShow) {
      focusOnShow = false;
      queueMicrotask(() => connect?.focus({ preventScroll: true }));
    }
    if (!snapshot.visible && story.contains(document.activeElement)) {
      queueMicrotask(() => fallbackFocus?.focus({ preventScroll: true }));
    }
  }

  connect?.addEventListener('click', () => {
    controller.complete();
    onConnectAudio();
  });
  explore?.addEventListener('click', () => {
    controller.complete();
    onExploreFeatured();
  });
  dismiss?.addEventListener('click', () => controller.dismiss());
  controller.subscribe(render);

  return Object.freeze({
    reopen({ focus = true } = {}) {
      focusOnShow = Boolean(focus);
      return controller.reopen();
    },
    snapshot: controller.snapshot,
  });
}
