(() => {
  'use strict';
  const selectedName = document.getElementById('selectedModelName');
  const billing = document.getElementById('billingSource');
  const keySummary = document.getElementById('keyBudgetSummary');
  const keyCopy = document.getElementById('keyBudgetCopy');
  const sync = () => {
    const local = (localStorage.getItem('ai-visualizer.selected-model') || '').startsWith('local/');
    if (local) {
      if (billing) billing.textContent = 'Local OpenCode subscription';
      if (keySummary) keySummary.textContent = 'OpenRouter not used';
      if (keyCopy) keyCopy.textContent = 'This Dream is routed through your local OpenCode connection. Visualizer-only subscription usage is tracked in Model Lab.';
    } else if (billing) {
      billing.textContent = 'Your OpenRouter credits';
    }
  };
  if (selectedName) new MutationObserver(sync).observe(selectedName, { childList: true, characterData: true, subtree: true });
  window.addEventListener('storage', sync);
  setInterval(sync, 1500);
  sync();
})();