(() => {
  'use strict';

  const selectedName = document.getElementById('selectedModelName');
  const billing = document.getElementById('billingSource');
  const keySummary = document.getElementById('keyBudgetSummary');
  const keyCopy = document.getElementById('keyBudgetCopy');
  const labSetup = document.getElementById('modelLabSetup');
  const labCommand = document.getElementById('modelLabCommand');
  const isWindows = navigator.userAgentData?.platform === 'Windows' || /Windows/i.test(navigator.userAgent || '');

  if (isWindows && labSetup) {
    const intro = labSetup.querySelector('p');
    if (intro) intro.textContent = 'Use your ChatGPT and OpenCode Go subscriptions with one small Windows companion. Download it once, open it, and Model Lab connects automatically.';

    const row = labSetup.querySelector('.model-lab__command-row');
    if (row) {
      const download = document.createElement('a');
      download.className = 'model-lab__companion-download';
      download.href = './AI-Visualizer-Model-Lab.exe';
      download.download = 'AI-Visualizer-Model-Lab.exe';
      download.textContent = 'Download Windows companion';
      download.setAttribute('aria-label', 'Download AI Visualizer Model Lab Windows companion');
      row.replaceChildren(download);
    }

    const note = labSetup.querySelector('small');
    if (note) note.innerHTML = 'No PowerShell, ports, or terminal window. OpenCode credentials stay on this computer. This early companion is unsigned, so Windows may show a one-time SmartScreen warning.';

    if (labCommand) labCommand.hidden = true;
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