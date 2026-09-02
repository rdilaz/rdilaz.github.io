import {
  FIXED_RUNTIME_CONTRACT,
  MAX_CREATIVE_BRIEF_CHARS,
  PROMPT_PRESETS,
  PROMPT_VERSION,
  customPromptProfile,
  loadPromptProfile,
  profileForCreativeBrief,
  savePromptProfile,
  selectPromptPreset,
} from './prompt.js';

const MOUNT_ID = 'promptLabDialog';

function escapeText(value) {
  return String(value ?? '');
}

function isDreamBusy() {
  try {
    const state = window.VIZ_DEV?.state?.();
    if (state) {
      return Boolean(
        state.generating
        || state.recovering
        || state.reopening
        || state.deletingGeneration
        || state.promotionActive
      );
    }
  } catch {
    // Fall through to the visible Dream control as a conservative backup.
  }
  return Boolean(document.getElementById('dreamButton')?.disabled);
}

function styleText() {
  return `
    .prompt-lab-button{min-width:auto!important;width:auto!important;padding-inline:12px!important;font-size:10px!important;letter-spacing:.14em!important}
    .prompt-lab-dialog{position:fixed;inset:0 0 0 auto;margin:0;width:min(620px,100vw);height:100dvh;max-height:none;border:0;border-left:1px solid rgba(255,255,255,.12);padding:0;background:#0b0b0d;color:#f4f4f5;box-shadow:-20px 0 60px rgba(0,0,0,.45)}
    .prompt-lab-dialog::backdrop{background:rgba(0,0,0,.62);backdrop-filter:blur(5px)}
    .prompt-lab{height:100%;display:flex;flex-direction:column}
    .prompt-lab__head{display:flex;justify-content:space-between;gap:20px;padding:24px 24px 18px;border-bottom:1px solid rgba(255,255,255,.1)}
    .prompt-lab__head h2{margin:4px 0 6px;font-size:24px}.prompt-lab__head p{margin:0;color:#a7a7ad;line-height:1.5}
    .prompt-lab__close{border:0;background:transparent;color:#ddd;font-size:26px;cursor:pointer;width:40px;height:40px}
    .prompt-lab__body{padding:20px 24px 28px;overflow:auto;display:grid;gap:18px}
    .prompt-lab__label{font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#9a9aa2}
    .prompt-lab__presets{display:flex;flex-wrap:wrap;gap:8px}.prompt-lab__preset{border:1px solid rgba(255,255,255,.14);background:#151518;color:#eee;border-radius:999px;padding:9px 13px;cursor:pointer}.prompt-lab__preset.is-active{border-color:rgba(255,255,255,.5);background:#25252a}
    .prompt-lab textarea{box-sizing:border-box;width:100%;min-height:260px;resize:vertical;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:#101013;color:#f6f6f7;padding:16px;font:14px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none}.prompt-lab textarea:focus{border-color:rgba(255,255,255,.45)}
    .prompt-lab__meta{display:flex;justify-content:space-between;gap:16px;color:#8e8e96;font-size:12px;margin-top:-10px}.prompt-lab__status{min-height:18px}.prompt-lab__status.is-error{color:#ff9d9d}
    .prompt-lab__contract{border:1px solid rgba(255,255,255,.1);border-radius:12px;background:#0f0f12}.prompt-lab__contract summary{cursor:pointer;padding:13px 15px;color:#c9c9ce}.prompt-lab__contract pre{white-space:pre-wrap;word-break:break-word;margin:0;padding:0 15px 16px;color:#91919a;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
    .prompt-lab__foot{position:sticky;bottom:0;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:16px 24px;background:linear-gradient(180deg,rgba(11,11,13,.92),#0b0b0d 25%);border-top:1px solid rgba(255,255,255,.1)}
    .prompt-lab__foot button{border:1px solid rgba(255,255,255,.16);border-radius:999px;background:#18181c;color:#eee;padding:10px 15px;cursor:pointer}.prompt-lab__foot .prompt-lab__apply{background:#f2f2f3;color:#111;border-color:#f2f2f3;font-weight:700}.prompt-lab__current{margin-left:auto;color:#999;font-size:12px}
    @media(max-width:640px){.prompt-lab-dialog{width:100vw}.prompt-lab__head,.prompt-lab__body,.prompt-lab__foot{padding-left:18px;padding-right:18px}.prompt-lab textarea{min-height:220px}.prompt-lab__current{width:100%;margin-left:0}}
  `;
}

function ensureStyle() {
  if (document.querySelector('style[data-prompt-lab-style]')) return;
  const style = document.createElement('style');
  style.dataset.promptLabStyle = 'v1';
  style.textContent = styleText();
  document.head.appendChild(style);
}

function updateAboutPromptVersion() {
  const codes = [...document.querySelectorAll('#aboutDrawer code')];
  const promptCode = codes.find(code => /^visualizer-prompt-v\d+$/i.test(code.textContent?.trim() || ''));
  if (promptCode) promptCode.textContent = PROMPT_VERSION;
}

export function mountPromptLab() {
  if (document.getElementById(MOUNT_ID)) return;
  const topActions = document.querySelector('.top-actions');
  const existingButton = document.getElementById('promptLabButton');
  if (!topActions && !existingButton) return;

  ensureStyle();
  updateAboutPromptVersion();

  const button = existingButton || document.createElement('button');
  if (!existingButton) {
    button.type = 'button';
    button.id = 'promptLabButton';
    button.className = 'icon-button prompt-lab-button';
    button.textContent = 'PROMPT';
  }

  const dialog = document.createElement('dialog');
  dialog.id = MOUNT_ID;
  dialog.className = 'prompt-lab-dialog';
  dialog.setAttribute('aria-labelledby', 'promptLabTitle');
  dialog.innerHTML = `
    <form class="prompt-lab" method="dialog">
      <header class="prompt-lab__head">
        <div>
          <span class="prompt-lab__label">PROMPT LAB</span>
          <h2 id="promptLabTitle">What should the model be told?</h2>
          <p>Edit the creative direction. Music-response and safety rules stay fixed so every AI gets the same blank canvas.</p>
        </div>
        <button class="prompt-lab__close" type="button" aria-label="Close Prompt Lab">×</button>
      </header>
      <div class="prompt-lab__body">
        <div>
          <div class="prompt-lab__label">Starting points</div>
          <div class="prompt-lab__presets" id="promptLabPresets"></div>
        </div>
        <label>
          <span class="prompt-lab__label">Creative brief</span>
          <textarea id="promptLabEditor" maxlength="${MAX_CREATIVE_BRIEF_CHARS}" spellcheck="true"></textarea>
        </label>
        <div class="prompt-lab__meta"><span id="promptLabDescription"></span><span id="promptLabCount"></span></div>
        <div class="prompt-lab__status" id="promptLabStatus" role="status" aria-live="polite"></div>
        <details class="prompt-lab__contract">
          <summary>Music-response rules · fixed</summary>
          <pre id="promptLabContract"></pre>
        </details>
      </div>
      <footer class="prompt-lab__foot">
        <button type="button" id="promptLabReset">Reset neutral</button>
        <button type="button" class="prompt-lab__apply" id="promptLabApply">Use this prompt</button>
        <span class="prompt-lab__current" id="promptLabCurrent"></span>
      </footer>
    </form>
  `;
  document.body.appendChild(dialog);

  const editor = dialog.querySelector('#promptLabEditor');
  const presets = dialog.querySelector('#promptLabPresets');
  const description = dialog.querySelector('#promptLabDescription');
  const count = dialog.querySelector('#promptLabCount');
  const status = dialog.querySelector('#promptLabStatus');
  const current = dialog.querySelector('#promptLabCurrent');
  const apply = dialog.querySelector('#promptLabApply');
  const reset = dialog.querySelector('#promptLabReset');
  const close = dialog.querySelector('.prompt-lab__close');
  const contract = dialog.querySelector('#promptLabContract');

  contract.textContent = FIXED_RUNTIME_CONTRACT;
  let draftPresetId = '';

  function setStatus(message = '', error = false) {
    status.textContent = message;
    status.classList.toggle('is-error', Boolean(error));
  }

  function refreshCount() {
    count.textContent = `${editor.value.length.toLocaleString()} / ${MAX_CREATIVE_BRIEF_CHARS.toLocaleString()}`;
  }

  function refreshPresetState() {
    [...presets.querySelectorAll('button[data-preset-id]')].forEach(presetButton => {
      presetButton.classList.toggle('is-active', presetButton.dataset.presetId === draftPresetId);
      presetButton.setAttribute('aria-pressed', String(presetButton.dataset.presetId === draftPresetId));
    });
  }

  function updateButton(profile = loadPromptProfile()) {
    button.title = `Edit creative prompt · ${profile.name}`;
    button.setAttribute('aria-label', `Edit creative prompt. Current: ${profile.name}`);
    const shellLabel = button.querySelector('strong');
    if (shellLabel) shellLabel.textContent = profile.name.replace(/ blank canvas$/i, '');
    current.textContent = `Current · ${profile.name}`;
  }

  function loadDraft(profile = loadPromptProfile()) {
    editor.value = profile.creativeBrief;
    draftPresetId = profile.source === 'preset' ? profile.id : '';
    const preset = PROMPT_PRESETS.find(item => item.id === draftPresetId);
    description.textContent = preset?.description || 'Custom creative brief. The fixed music-response rules are included automatically.';
    refreshCount();
    refreshPresetState();
    setStatus();
    updateButton(profile);
  }

  PROMPT_PRESETS.forEach(preset => {
    const presetButton = document.createElement('button');
    presetButton.type = 'button';
    presetButton.className = 'prompt-lab__preset';
    presetButton.dataset.presetId = preset.id;
    presetButton.textContent = preset.name;
    presetButton.addEventListener('click', () => {
      editor.value = preset.creativeBrief;
      draftPresetId = preset.id;
      description.textContent = preset.description;
      refreshCount();
      refreshPresetState();
      setStatus(preset.legacy
        ? 'Original baseline reproduces the complete old prompt exactly when applied.'
        : 'Neutral removes the old spectacle language and renderer list from the creative request.');
    });
    presets.appendChild(presetButton);
  });

  editor.addEventListener('input', () => {
    const matchingPreset = PROMPT_PRESETS.find(preset => preset.creativeBrief.trim() === editor.value.trim());
    draftPresetId = matchingPreset?.id || '';
    description.textContent = matchingPreset?.description || 'Custom creative brief. The fixed music-response rules are included automatically.';
    refreshCount();
    refreshPresetState();
    setStatus();
  });

  button.addEventListener('click', () => {
    loadDraft();
    dialog.showModal();
    editor.focus();
  });

  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  apply.addEventListener('click', () => {
    if (isDreamBusy()) {
      setStatus('Wait for the current Dream, repair, or rollback to finish before changing the prompt.', true);
      return;
    }
    try {
      const profile = profileForCreativeBrief(editor.value, draftPresetId);
      const saved = savePromptProfile(profile);
      loadDraft(saved);
      window.dispatchEvent(new CustomEvent('visualizer:prompt-profile-changed', { detail: saved }));
      setStatus(`Using ${saved.name}. It will guide the next Dream.`);
      setTimeout(() => dialog.open && dialog.close(), 450);
    } catch (error) {
      setStatus(error?.message || 'That creative brief could not be saved.', true);
    }
  });

  reset.addEventListener('click', () => {
    if (isDreamBusy()) {
      setStatus('Wait for the current Dream to finish before changing the prompt.', true);
      return;
    }
    const saved = selectPromptPreset('neutral-v1');
    loadDraft(saved);
    window.dispatchEvent(new CustomEvent('visualizer:prompt-profile-changed', { detail: saved }));
    setStatus('Neutral blank canvas restored.');
  });

  if (!existingButton) topActions.insertBefore(button, topActions.firstChild);
  loadDraft();

  const api = Object.freeze({
    current: () => loadPromptProfile(),
    presets: () => PROMPT_PRESETS.map(preset => ({ ...preset })),
    contract: () => FIXED_RUNTIME_CONTRACT,
    setPreset: id => {
      if (isDreamBusy()) throw new Error('Wait for the current Dream to finish before changing the prompt.');
      const saved = selectPromptPreset(id);
      loadDraft(saved);
      return saved;
    },
    setCustom: creativeBrief => {
      if (isDreamBusy()) throw new Error('Wait for the current Dream to finish before changing the prompt.');
      const saved = savePromptProfile(customPromptProfile(escapeText(creativeBrief)));
      loadDraft(saved);
      return saved;
    },
    open: () => button.click(),
  });

  if (!Object.prototype.hasOwnProperty.call(window, 'VIZ_PROMPT')) {
    Object.defineProperty(window, 'VIZ_PROMPT', { value: api, configurable: false, writable: false });
  }
}
