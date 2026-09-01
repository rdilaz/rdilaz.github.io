(() => {
  'use strict';
  const selectedName = document.getElementById('selectedModelName');
  const billing = document.getElementById('billingSource');
  const keySummary = document.getElementById('keyBudgetSummary');
  const keyCopy = document.getElementById('keyBudgetCopy');
  const labCommand = document.getElementById('modelLabCommand');
  const labSetup = document.getElementById('modelLabSetup');
  const isWindows = navigator.userAgentData?.platform === 'Windows' || /Windows/i.test(navigator.userAgent || '');

  if (isWindows && labCommand) {
    labCommand.textContent = '$l="$env:TEMP\\ai-visualizer-model-lab-launcher.mjs"; iwr https://ryo-nd.com/visualizer/model-lab-launcher.mjs -OutFile $l; node $l';
    const intro = labSetup?.querySelector('p');
    if (intro) intro.textContent = 'Windows: run the self-checking Model Lab launcher below, then press Connect. Keep its PowerShell window open only if it starts a new bridge.';
    const note = labSetup?.querySelector('small');
    if (note) note.innerHTML = 'The launcher first checks whether Model Lab is already running, then uses <strong>opencode run</strong> if a bridge is needed. It never kills an unknown process or reads your ChatGPT/OpenCode credentials directly.';
  }

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