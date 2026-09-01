(() => {
  'use strict';
  const KEY = 'ai-visualizer.openrouter.key';
  const SENTINEL = '__ai_visualizer_local_opencode__';
  const button = document.getElementById('dreamButton');
  if (!button) return;
  button.addEventListener('click', () => {
    const modelID = localStorage.getItem('ai-visualizer.selected-model') || '';
    if (!modelID.startsWith('local/') || sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, SENTINEL);
    queueMicrotask(() => {
      if (sessionStorage.getItem(KEY) === SENTINEL) sessionStorage.removeItem(KEY);
    });
  });
})();