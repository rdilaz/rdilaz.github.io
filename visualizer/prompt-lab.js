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
import {
  MAX_PROMPT_LIBRARY_NAME_CHARS,
  createPromptLibrary,
} from './prompt-library.js';

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
    .prompt-lab textarea{box-sizing:border-box;width:100%;min-height:220px;resize:vertical;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:#101013;color:#f6f6f7;padding:16px;font:14px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none}.prompt-lab textarea:focus{border-color:rgba(255,255,255,.45)}
    .prompt-lab__meta{display:flex;justify-content:space-between;gap:16px;color:#8e8e96;font-size:12px;margin-top:-10px}.prompt-lab__status{min-height:18px}.prompt-lab__status.is-error{color:#ff9d9d}
    .prompt-lab__save{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:8px}.prompt-lab__save input,.prompt-lab__saved-name{box-sizing:border-box;min-width:0;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:#101013;color:#f4f4f5;padding:9px 11px;outline:none}.prompt-lab__save input:focus,.prompt-lab__saved-name:focus{border-color:rgba(255,255,255,.45)}
    .prompt-lab__save button,.prompt-lab__saved-actions button{border:1px solid rgba(255,255,255,.16);border-radius:999px;background:#18181c;color:#eee;padding:8px 11px;cursor:pointer}.prompt-lab__saved{display:grid;gap:8px;margin-top:8px}.prompt-lab__saved-empty{margin:0;color:#85858d;font-size:13px}.prompt-lab__saved-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:10px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:#101013}.prompt-lab__saved-row.is-active{border-color:rgba(255,255,255,.45)}.prompt-lab__saved-main{min-width:0;display:grid;gap:5px}.prompt-lab__saved-name{width:100%;font-weight:650}.prompt-lab__saved-id{color:#85858d;font:11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.prompt-lab__saved-state{color:#cfcfd5;font-family:ui-sans-serif,system-ui,sans-serif}.prompt-lab__saved-actions{display:flex;flex-wrap:wrap;align-content:start;justify-content:flex-end;gap:6px}.prompt-lab__saved-actions .is-delete{color:#ffb1b1;border-color:rgba(255,120,120,.3)}
    .prompt-lab__contract{border:1px solid rgba(255,255,255,.1);border-radius:12px;background:#0f0f12}.prompt-lab__contract summary{cursor:pointer;padding:13px 15px;color:#c9c9ce}.prompt-lab__contract pre{white-space:pre-wrap;word-break:break-word;margin:0;padding:0 15px 16px;color:#91919a;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
    .prompt-lab__foot{position:sticky;bottom:0;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:16px 24px;background:linear-gradient(180deg,rgba(11,11,13,.92),#0b0b0d 25%);border-top:1px solid rgba(255,255,255,.1)}
    .prompt-lab__foot button{border:1px solid rgba(255,255,255,.16);border-radius:999px;background:#18181c;color:#eee;padding:10px 15px;cursor:pointer}.prompt-lab__foot .prompt-lab__apply{background:#f2f2f3;color:#111;border-color:#f2f2f3;font-weight:700}.prompt-lab__current{margin-left:auto;color:#999;font-size:12px}
    @media(max-width:640px){.prompt-lab-dialog{width:100vw}.prompt-lab__head,.prompt-lab__body,.prompt-lab__foot{padding-left:18px;padding-right:18px}.prompt-lab textarea{min-height:180px}.prompt-lab__saved-row{grid-template-columns:1fr}.prompt-lab__saved-actions{justify-content:flex-start}.prompt-lab__current{width:100%;margin-left:0}}
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
        <section aria-labelledby="promptLabSavedLabel">
          <div class="prompt-lab__label" id="promptLabSavedLabel">Saved prompts</div>
          <div class="prompt-lab__save">
            <input id="promptLabName" maxlength="${MAX_PROMPT_LIBRARY_NAME_CHARS}" autocomplete="off" aria-label="Name for saved prompt" placeholder="Experiment name">
            <button type="button" id="promptLabSaveAs">Save as new</button>
          </div>
          <div class="prompt-lab__saved" id="promptLabSaved"></div>
        </section>
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
  const nameInput = dialog.querySelector('#promptLabName');
  const saveAs = dialog.querySelector('#promptLabSaveAs');
  const savedList = dialog.querySelector('#promptLabSaved');
  const current = dialog.querySelector('#promptLabCurrent');
  const apply = dialog.querySelector('#promptLabApply');
  const reset = dialog.querySelector('#promptLabReset');
  const close = dialog.querySelector('.prompt-lab__close');
  const contract = dialog.querySelector('#promptLabContract');

  contract.textContent = FIXED_RUNTIME_CONTRACT;
  const library = createPromptLibrary();
  let draftPresetId = '';
  let draftEntryId = null;
  let activeProfile = loadPromptProfile();

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

  function updateButton(profile = activeProfile) {
    button.title = `Edit creative prompt · ${profile.name}`;
    button.setAttribute('aria-label', `Edit creative prompt. Current: ${profile.name}`);
    const shellLabel = button.querySelector('strong');
    if (shellLabel) shellLabel.textContent = profile.name.replace(/ blank canvas$/i, '');
    const modified = editor.value.trim() !== profile.creativeBrief;
    current.textContent = `Current · ${profile.name}${modified ? ' · Unsaved modification' : ''}`;
  }

  function activeSavedEntry(profile = activeProfile) {
    return library.selected(profile);
  }

  function matchingDraftEntry() {
    const brief = editor.value.trim();
    const entries = library.saved();
    const draftProfile = profileForCreativeBrief(brief, draftPresetId);
    return entries.find(entry => entry.entryId === draftEntryId && entry.creativeBrief === brief)
      || entries.find(entry => entry.creativeBrief === brief && entry.profileId === draftProfile.id)
      || null;
  }

  function dispatchProfileChanged(profile) {
    window.dispatchEvent(new CustomEvent('visualizer:prompt-profile-changed', { detail: profile }));
  }

  function commitProfile(profile, entryId = null) {
    const saved = savePromptProfile(profile);
    library.setActiveEntry(entryId);
    activeProfile = saved;
    dispatchProfileChanged(saved);
    return saved;
  }

  function renderSaved() {
    savedList.replaceChildren();
    const entries = library.saved();
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'prompt-lab__saved-empty';
      empty.textContent = 'No named snapshots yet.';
      savedList.appendChild(empty);
      return;
    }
    const activeEntry = activeSavedEntry();
    const draftEntry = matchingDraftEntry();
    entries.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'prompt-lab__saved-row';
      row.dataset.entryId = entry.entryId;
      const isActive = activeEntry?.entryId === entry.entryId;
      row.classList.toggle('is-active', isActive);
      const main = document.createElement('div');
      main.className = 'prompt-lab__saved-main';
      const entryName = document.createElement('input');
      entryName.className = 'prompt-lab__saved-name';
      entryName.value = entry.name;
      entryName.maxLength = MAX_PROMPT_LIBRARY_NAME_CHARS;
      entryName.setAttribute('aria-label', `Name for ${entry.name}`);
      const identity = document.createElement('span');
      identity.className = 'prompt-lab__saved-id';
      const states = [isActive ? 'Active' : '', draftEntry?.entryId === entry.entryId ? 'Selected draft' : ''].filter(Boolean);
      if (states.length) {
        const state = document.createElement('span');
        state.className = 'prompt-lab__saved-state';
        state.textContent = states.join(' · ');
        identity.append(state, document.createTextNode(' · '));
      }
      identity.append(document.createTextNode(`${entry.profileId} · ${entry.briefHash}`));
      main.append(entryName, identity);

      const actions = document.createElement('div');
      actions.className = 'prompt-lab__saved-actions';
      const action = (label, handler, className = '') => {
        const control = document.createElement('button');
        control.type = 'button';
        control.textContent = label;
        control.className = className;
        control.setAttribute('aria-label', `${label} saved prompt ${entry.name}`);
        control.addEventListener('click', handler);
        actions.appendChild(control);
      };
      action('Use', () => {
        if (isDreamBusy()) {
          setStatus('Wait for the current Dream to finish before changing the prompt.', true);
          return;
        }
        const saved = commitProfile(library.profile(entry.entryId), entry.entryId);
        loadDraft(saved, entry.entryId);
        setStatus(`Using ${entry.name}. It will guide the next Dream.`);
        queueMicrotask(() => editor.focus());
      });
      action('Rename', () => {
        try {
          const renamed = library.rename(entry.entryId, entryName.value);
          if (activeEntry?.entryId === entry.entryId) {
            activeProfile = savePromptProfile(library.profile(renamed.entryId));
            dispatchProfileChanged(activeProfile);
          }
          renderSaved();
          updateButton();
          setStatus(`Renamed to ${renamed.name}. Prompt content and research identity are unchanged.`);
          queueMicrotask(() => savedList.querySelector(`[data-entry-id="${renamed.entryId}"] .prompt-lab__saved-name`)?.focus());
        } catch (error) {
          setStatus(error?.message || 'That saved prompt could not be renamed.', true);
        }
      });
      action('Duplicate', () => {
        try {
          const duplicate = library.duplicate(entry.entryId);
          editor.value = duplicate.creativeBrief;
          draftPresetId = duplicate.source === 'preset' ? duplicate.profileId : '';
          draftEntryId = duplicate.entryId;
          const preset = PROMPT_PRESETS.find(item => item.id === draftPresetId);
          description.textContent = preset?.description || 'Custom creative brief. The fixed music-response rules are included automatically.';
          refreshCount();
          refreshPresetState();
          renderSaved();
          updateButton();
          setStatus(`Duplicated as ${duplicate.name}. Edit the draft, then Save as new for a content variant.`);
          queueMicrotask(() => editor.focus());
        } catch (error) {
          setStatus(error?.message || 'That saved prompt could not be duplicated.', true);
        }
      });
      action('Delete', () => {
        try {
          library.delete(entry.entryId);
          if (draftEntryId === entry.entryId) draftEntryId = null;
          renderSaved();
          updateButton();
          setStatus(`Deleted ${entry.name} from Prompt Library. Existing Dreams and evidence are unchanged.`);
          queueMicrotask(() => nameInput.focus());
        } catch (error) {
          setStatus(error?.message || 'That saved prompt could not be deleted.', true);
        }
      }, 'is-delete');
      row.append(main, actions);
      savedList.appendChild(row);
    });
  }

  function loadDraft(profile = loadPromptProfile(), preferredEntryId = null) {
    activeProfile = profile;
    editor.value = profile.creativeBrief;
    draftPresetId = profile.source === 'preset' ? profile.id : '';
    draftEntryId = preferredEntryId || activeSavedEntry(profile)?.entryId || null;
    const preset = PROMPT_PRESETS.find(item => item.id === draftPresetId);
    description.textContent = preset?.description || 'Custom creative brief. The fixed music-response rules are included automatically.';
    refreshCount();
    refreshPresetState();
    renderSaved();
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
      draftEntryId = null;
      description.textContent = preset.description;
      refreshCount();
      refreshPresetState();
      renderSaved();
      updateButton();
      setStatus(preset.legacy
        ? 'Original baseline reproduces the complete old prompt exactly when applied.'
        : 'Neutral removes the old spectacle language and renderer list from the creative request.');
    });
    presets.appendChild(presetButton);
  });

  editor.addEventListener('input', () => {
    const matchingPreset = PROMPT_PRESETS.find(preset => preset.creativeBrief.trim() === editor.value.trim());
    draftPresetId = matchingPreset?.id || '';
    draftEntryId = matchingDraftEntry()?.entryId || null;
    description.textContent = matchingPreset?.description || 'Custom creative brief. The fixed music-response rules are included automatically.';
    refreshCount();
    refreshPresetState();
    renderSaved();
    updateButton();
    setStatus();
  });

  saveAs.addEventListener('click', () => {
    try {
      const matching = matchingDraftEntry();
      const profile = matching
        ? library.profile(matching.entryId)
        : profileForCreativeBrief(editor.value, draftPresetId);
      const entry = library.saveAs(nameInput.value, editor.value, profile);
      draftEntryId = entry.entryId;
      nameInput.value = '';
      renderSaved();
      updateButton();
      setStatus(`Saved ${entry.name} as a new immutable snapshot.`);
    } catch (error) {
      setStatus(error?.message || 'That prompt could not be saved.', true);
    }
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
      const draftEntry = matchingDraftEntry();
      const saved = commitProfile(
        draftEntry ? library.profile(draftEntry.entryId) : profile,
        draftEntry?.entryId || null,
      );
      loadDraft(saved, draftEntry?.entryId || null);
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
    library.setActiveEntry(null);
    loadDraft(saved);
    dispatchProfileChanged(saved);
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
      library.setActiveEntry(null);
      loadDraft(saved);
      dispatchProfileChanged(saved);
      return saved;
    },
    setCustom: creativeBrief => {
      if (isDreamBusy()) throw new Error('Wait for the current Dream to finish before changing the prompt.');
      const saved = savePromptProfile(customPromptProfile(escapeText(creativeBrief)));
      library.setActiveEntry(null);
      loadDraft(saved);
      dispatchProfileChanged(saved);
      return saved;
    },
    saved: () => library.saved().map(entry => ({ ...entry })),
    saveAs: name => {
      const matching = matchingDraftEntry();
      const profile = matching
        ? library.profile(matching.entryId)
        : profileForCreativeBrief(editor.value, draftPresetId);
      const entry = library.saveAs(name, editor.value, profile);
      draftEntryId = entry.entryId;
      renderSaved();
      updateButton();
      return { ...entry };
    },
    useSaved: entryId => {
      if (isDreamBusy()) throw new Error('Wait for the current Dream to finish before changing the prompt.');
      const saved = commitProfile(library.profile(entryId), entryId);
      loadDraft(saved, entryId);
      return saved;
    },
    renameSaved: (entryId, name) => {
      const selected = activeSavedEntry();
      const renamed = library.rename(entryId, name);
      if (selected?.entryId === renamed.entryId) {
        activeProfile = savePromptProfile(library.profile(renamed.entryId));
        dispatchProfileChanged(activeProfile);
      }
      renderSaved();
      updateButton();
      return { ...renamed };
    },
    duplicateSaved: (entryId, newName = '') => {
      const duplicated = library.duplicate(entryId, newName);
      renderSaved();
      return { ...duplicated };
    },
    deleteSaved: entryId => {
      const deleted = library.delete(entryId);
      if (draftEntryId === entryId) draftEntryId = null;
      renderSaved();
      updateButton();
      return { ...deleted };
    },
    open: () => button.click(),
  });

  if (!Object.prototype.hasOwnProperty.call(window, 'VIZ_PROMPT')) {
    Object.defineProperty(window, 'VIZ_PROMPT', { value: api, configurable: false, writable: false });
  }
}
