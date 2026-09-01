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
    labCommand.textContent = '$b="$env:TEMP\\ai-visualizer-model-lab-bridge.mjs"; iwr https://ryo-nd.com/visualizer/model-lab-bridge.mjs -OutFile $b; node $b';
    const intro = labSetup?.querySelector('p');
    if (intro) intro.textContent = 'Windows: start the Visualizer compatibility bridge below, then press Connect. Keep that PowerShell window open while using subscription models.';
    const note = labSetup?.querySelector('small');
    if (note) note.innerHTML = 'This uses <strong>opencode run</strong> because the current OpenCode Windows <strong>serve</strong> command can fail with ServeError. The bridge stays on 127.0.0.1 and never reads your ChatGPT/OpenCode credentials directly.';
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