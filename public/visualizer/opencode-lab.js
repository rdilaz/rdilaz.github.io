(() => {
  'use strict';

  const LOCAL_BASE = 'http://127.0.0.1:4096';
  const MODEL_RE = /^local\//;
  const OPENROUTER_MODELS_RE = /^https:\/\/openrouter\.ai\/api\/v1\/models(?:\?|$)/;
  const OPENROUTER_COMPLETION_RE = /^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions(?:\?|$)/;
  const OPENROUTER_CACHE = 'ai-visualizer.openrouter.models-cache.v1';
  const USAGE_KEY = 'ai-visualizer.opencode-lab.usage.v1';
  const nativeFetch = window.fetch.bind(window);

  const state = {
    connected: false,
    checking: false,
    version: '',
    descriptors: new Map(),
    groups: [],
    connectedProviders: [],
    usage: readUsage(),
  };

  const els = {
    status: document.getElementById('modelLabStatus'),
    connect: document.getElementById('modelLabConnect'),
    setup: document.getElementById('modelLabSetup'),
    online: document.getElementById('modelLabOnline'),
    providers: document.getElementById('modelLabProviders'),
    search: document.getElementById('modelLabSearch'),
    list: document.getElementById('modelLabList'),
    usage: document.getElementById('modelLabUsage'),
    copy: document.getElementById('modelLabCopyCommand'),
    command: document.getElementById('modelLabCommand'),
    modelSearch: document.getElementById('modelSearch'),
    modelList: document.getElementById('modelList'),
    toast: document.getElementById('toast'),
    dreamConnection: document.getElementById('dreamStatusConnection'),
    dreamLive: document.getElementById('dreamStatusLive'),
  };

  // Local models are runtime truth. Do not reuse a stale OpenRouter cache that may
  // have been created while the local server was offline or online in a prior tab.
  sessionStorage.removeItem(OPENROUTER_CACHE);

  function readUsage() {
    try {
      const value = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}');
      return {
        calls: Number(value.calls || 0),
        dreams: Number(value.dreams || 0),
        repairs: Number(value.repairs || 0),
        input: Number(value.input || 0),
        output: Number(value.output || 0),
        reasoning: Number(value.reasoning || 0),
        recent: Array.isArray(value.recent) ? value.recent.slice(0, 30) : [],
      };
    } catch {
      return { calls: 0, dreams: 0, repairs: 0, input: 0, output: 0, reasoning: 0, recent: [] };
    }
  }

  function saveUsage() {
    localStorage.setItem(USAGE_KEY, JSON.stringify(state.usage));
    renderUsage();
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function compactNumber(value) {
    const n = number(value);
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
    return String(Math.round(n));
  }

  function unwrap(payload) {
    return payload && typeof payload === 'object' && 'data' in payload && payload.data != null ? payload.data : payload;
  }

  function localRequest(url, init = {}) {
    return nativeFetch(url, { ...init, targetAddressSpace: 'loopback' });
  }

  function notice(message, duration = 5200) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(notice.timer);
    notice.timer = setTimeout(() => { els.toast.hidden = true; }, duration);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function base64Url(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  }

  function fakeModelId(providerID, modelID, variant) {
    return `local/${base64Url(JSON.stringify([providerID, modelID, variant || '']))}`;
  }

  function providerLabel(providerID, providerName = '') {
    const id = String(providerID || '').toLowerCase();
    if (id === 'openai') return 'ChatGPT / OpenAI';
    if (id === 'opencode') return 'OpenCode Go / Zen';
    return providerName || providerID || 'OpenCode';
  }

  function variantNames(model) {
    const variants = model?.variants;
    if (Array.isArray(variants)) {
      return variants.map(item => typeof item === 'string' ? item : item?.id || item?.name).filter(Boolean);
    }
    if (variants && typeof variants === 'object') return Object.keys(variants);
    return [];
  }

  function providerArray(payload) {
    const value = unwrap(payload);
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.all)) return value.all;
    if (Array.isArray(value?.providers)) return value.providers;
    return [];
  }

  function connectedSet(payload, providers) {
    const value = unwrap(payload);
    if (Array.isArray(value?.connected)) return new Set(value.connected.map(String));
    return new Set(providers.map(provider => String(provider?.id || provider?.providerID || '')).filter(Boolean));
  }

  function modelsForProvider(provider) {
    const raw = provider?.models || provider?.model || {};
    if (Array.isArray(raw)) return raw.map(model => [model?.id || model?.modelID || model?.name, model]);
    if (raw && typeof raw === 'object') return Object.entries(raw);
    return [];
  }

  function rebuildLocalCatalog(providerPayload) {
    const providers = providerArray(providerPayload);
    const connected = connectedSet(providerPayload, providers);
    const descriptors = new Map();
    const groups = [];

    for (const provider of providers) {
      const providerID = String(provider?.id || provider?.providerID || '');
      if (!providerID || (connected.size && !connected.has(providerID))) continue;
      const providerName = provider?.name || providerID;
      for (const [key, rawModel] of modelsForProvider(provider)) {
        const model = rawModel || {};
        const modelID = String(model.id || model.modelID || key || '');
        if (!modelID) continue;
        const modelName = model.name || modelID;
        const variants = variantNames(model);
        const entries = [{ variant: '', label: 'default' }, ...variants.map(variant => ({ variant, label: variant }))];
        const variantsForUi = [];
        for (const entry of entries) {
          const id = fakeModelId(providerID, modelID, entry.variant);
          const descriptor = {
            id,
            providerID,
            providerName,
            modelID,
            modelName,
            variant: entry.variant,
            variantLabel: entry.label,
            context: number(model?.limit?.context || model?.context || model?.context_length),
            output: number(model?.limit?.output || model?.output || model?.max_output_tokens),
          };
          descriptors.set(id, descriptor);
          variantsForUi.push(descriptor);
        }
        groups.push({ providerID, providerName, modelID, modelName, variants: variantsForUi });
      }
    }

    groups.sort((a, b) => {
      const priority = value => /gpt|kimi|claude|gemini|deepseek|qwen|glm/i.test(value) ? 0 : 1;
      return priority(a.modelName) - priority(b.modelName) || a.providerID.localeCompare(b.providerID) || a.modelName.localeCompare(b.modelName);
    });
    state.descriptors = descriptors;
    state.groups = groups;
    state.connectedProviders = [...connected];
    renderLab();
  }

  function localCatalogEntries() {
    return [...state.descriptors.values()].map(descriptor => ({
      id: descriptor.id,
      name: `${descriptor.modelName}${descriptor.variant ? ` · ${descriptor.variant}` : ''}`,
      description: `Local OpenCode · ${descriptor.providerID}/${descriptor.modelID}${descriptor.variant ? ` · ${descriptor.variant}` : ''}`,
      context_length: descriptor.context || 0,
      created: 0,
      pricing: { prompt: '0', completion: '0', request: '0' },
      architecture: { output_modalities: ['text'] },
    }));
  }

  async function refreshLocal() {
    if (state.checking) return state.connected;
    state.checking = true;
    if (els.status) els.status.textContent = 'Checking this computer…';
    try {
      const healthResponse = await localRequest(`${LOCAL_BASE}/global/health`, { cache: 'no-store' });
      if (!healthResponse.ok) throw new Error(`HTTP ${healthResponse.status}`);
      const health = unwrap(await healthResponse.json());
      const providerResponse = await localRequest(`${LOCAL_BASE}/provider`, { cache: 'no-store' });
      if (!providerResponse.ok) throw new Error(`Provider list HTTP ${providerResponse.status}`);
      const providers = await providerResponse.json();
      state.connected = true;
      state.version = String(health?.version || '');
      rebuildLocalCatalog(providers);
      if (els.status) els.status.textContent = `Connected locally${state.version ? ` · ${state.version}` : ''}`;
      return true;
    } catch (error) {
      state.connected = false;
      state.descriptors.clear();
      state.groups = [];
      if (els.status) els.status.textContent = 'Local OpenCode not connected';
      renderLab();
      return false;
    } finally {
      state.checking = false;
    }
  }

  function renderUsage() {
    if (!els.usage) return;
    const u = state.usage;
    els.usage.textContent = u.calls
      ? `${u.calls} local calls · ${compactNumber(u.output)} output · ${compactNumber(u.reasoning)} reasoning tokens`
      : 'No subscription-backed Visualizer calls recorded in this browser yet.';
  }

  function renderLab() {
    if (els.setup) els.setup.hidden = state.connected;
    if (els.online) els.online.hidden = !state.connected;
    if (els.connect) els.connect.textContent = state.connected ? 'Refresh' : 'Connect';
    if (els.providers) {
      const labels = [...new Set(state.groups.map(group => providerLabel(group.providerID, group.providerName)))];
      els.providers.textContent = labels.length ? labels.join(' · ') : 'OpenCode is running; connect providers in OpenCode to expose models here.';
    }
    renderUsage();
    renderGroups();
  }

  function renderGroups() {
    if (!els.list) return;
    const query = (els.search?.value || '').trim().toLowerCase();
    const filtered = state.groups.filter(group => !query || `${group.modelName} ${group.modelID} ${group.providerID} ${group.variants.map(v => v.variant).join(' ')}`.toLowerCase().includes(query));
    els.list.replaceChildren();
    if (!state.connected) return;
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'model-lab__empty';
      empty.textContent = 'No connected OpenCode model matches that search.';
      els.list.appendChild(empty);
      return;
    }
    for (const group of filtered.slice(0, 36)) {
      const card = document.createElement('article');
      card.className = 'model-lab__model';
      const variants = group.variants;
      const variantButtons = variants.slice(0, 10).map(descriptor => `<button type="button" data-local-model="${escapeHtml(descriptor.id)}" title="${escapeHtml(`${descriptor.providerID}/${descriptor.modelID}${descriptor.variant ? ` # ${descriptor.variant}` : ''}`)}">${escapeHtml(descriptor.variantLabel)}</button>`).join('');
      card.innerHTML = `<div class="model-lab__model-head"><div><strong>${escapeHtml(group.modelName)}</strong><small>${escapeHtml(providerLabel(group.providerID, group.providerName))}</small></div><span>${variants.length > 1 ? `${variants.length - 1} effort levels` : 'default'}</span></div><div class="model-lab__variants">${variantButtons}</div>`;
      card.querySelectorAll('[data-local-model]').forEach(button => button.addEventListener('click', () => selectLocalModel(button.dataset.localModel)));
      els.list.appendChild(card);
    }
  }

  async function selectLocalModel(fakeID) {
    const descriptor = state.descriptors.get(fakeID);
    if (!descriptor) return notice('That local model is no longer available. Refresh OpenCode models.');
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (els.modelSearch) {
        els.modelSearch.value = fakeID;
        els.modelSearch.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const option = [...(els.modelList?.querySelectorAll('.model-option') || [])].find(button => button.querySelector('.model-option__name')?.textContent.includes(descriptor.modelName));
      if (option) {
        option.click();
        if (els.modelSearch) {
          els.modelSearch.value = '';
          els.modelSearch.dispatchEvent(new Event('input', { bubbles: true }));
        }
        notice(`${descriptor.modelName}${descriptor.variant ? ` · ${descriptor.variant}` : ''} selected from local OpenCode.`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    notice('The app catalog is still loading that local model. Try Refresh once.');
  }

  function isLocalModel(modelID) {
    return MODEL_RE.test(String(modelID || ''));
  }

  function combinedPrompt(messages) {
    return (messages || []).filter(message => message?.role !== 'system').map(message => String(message?.content || '')).join('\n\n');
  }

  function systemPrompt(messages) {
    return (messages || []).filter(message => message?.role === 'system').map(message => String(message?.content || '')).join('\n\n');
  }

  const disabledTools = {
    bash: false, edit: false, write: false, read: false, glob: false, grep: false,
    task: false, webfetch: false, websearch: false, todowrite: false, patch: false,
  };

  async function runOpenCodeCompletion(body, init) {
    const descriptor = state.descriptors.get(body.model);
    if (!descriptor) throw new Error('That local OpenCode model is unavailable. Make sure the local server is running and refresh the model list.');
    const repair = String(body?.messages?.[0]?.content || '').startsWith('Repair the visualizer');
    const signal = init?.signal;
    let sessionID = '';
    const started = performance.now();
    if (els.dreamConnection) els.dreamConnection.textContent = `OpenCode local · ${providerLabel(descriptor.providerID, descriptor.providerName)}`;
    if (els.dreamLive) els.dreamLive.textContent = `${descriptor.providerID}/${descriptor.modelID}${descriptor.variant ? ` · ${descriptor.variant}` : ''} · request live`;

    try {
      const sessionResponse = await localRequest(`${LOCAL_BASE}/session`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `AI Visualizer · ${descriptor.modelName}${descriptor.variant ? ` · ${descriptor.variant}` : ''}` }),
      });
      if (!sessionResponse.ok) throw new Error(`OpenCode could not create a session (${sessionResponse.status}).`);
      const session = unwrap(await sessionResponse.json());
      sessionID = session?.id || session?.sessionID || '';
      if (!sessionID) throw new Error('OpenCode created a session without an id.');

      const messageBody = {
        model: { providerID: descriptor.providerID, modelID: descriptor.modelID },
        ...(descriptor.variant ? { variant: descriptor.variant } : {}),
        system: systemPrompt(body.messages),
        tools: disabledTools,
        parts: [{ type: 'text', text: combinedPrompt(body.messages) }],
      };
      const messageResponse = await localRequest(`${LOCAL_BASE}/session/${encodeURIComponent(sessionID)}/message`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
      });
      if (!messageResponse.ok) throw new Error(`OpenCode model request failed (${messageResponse.status}).`);
      const message = unwrap(await messageResponse.json());
      const info = message?.info || {};
      if (info?.error) throw new Error(info.error?.data?.message || info.error?.message || 'OpenCode reported a model error.');
      const parts = Array.isArray(message?.parts) ? message.parts : [];
      const text = parts.filter(part => part?.type === 'text' && !part?.ignored).map(part => String(part.text || '')).join('');
      if (!text.trim()) throw new Error('OpenCode returned no visualizer text.');

      const tokens = info?.tokens || {};
      state.usage.calls += 1;
      state.usage[repair ? 'repairs' : 'dreams'] += 1;
      state.usage.input += number(tokens.input);
      state.usage.output += number(tokens.output);
      state.usage.reasoning += number(tokens.reasoning);
      state.usage.recent.unshift({
        at: Date.now(), providerID: descriptor.providerID, modelID: descriptor.modelID,
        modelName: descriptor.modelName, variant: descriptor.variant || '', repair,
        input: number(tokens.input), output: number(tokens.output), reasoning: number(tokens.reasoning),
        elapsedMs: Math.round(performance.now() - started), reportedCost: number(info.cost),
      });
      state.usage.recent = state.usage.recent.slice(0, 30);
      saveUsage();

      const synthetic = {
        choices: [{ message: { role: 'assistant', content: text } }],
        model: `${descriptor.providerID}/${descriptor.modelID}${descriptor.variant ? `#${descriptor.variant}` : ''}`,
        usage: {
          prompt_tokens: number(tokens.input),
          completion_tokens: number(tokens.output),
          reasoning_tokens: number(tokens.reasoning),
          cost: 0,
          source: 'opencode-local',
          source_reported_cost: number(info.cost),
        },
      };
      return new Response(JSON.stringify(synthetic), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-AI-Visualizer-Source': 'opencode-local' },
      });
    } catch (error) {
      if (sessionID && signal?.aborted) {
        nativeFetch(`${LOCAL_BASE}/session/${encodeURIComponent(sessionID)}/abort`, { method: 'POST', targetAddressSpace: 'loopback' }).catch(() => {});
      }
      throw error;
    } finally {
      if (sessionID) {
        nativeFetch(`${LOCAL_BASE}/session/${encodeURIComponent(sessionID)}`, { method: 'DELETE', targetAddressSpace: 'loopback' }).catch(() => {});
      }
    }
  }

  async function mergeModelResponse(response) {
    if (!response.ok) return response;
    try {
      if (!state.connected) await refreshLocal();
      const payload = await response.clone().json();
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const merged = { ...payload, data: [...data, ...localCatalogEntries()] };
      return new Response(JSON.stringify(merged), { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch {
      return response;
    }
  }

  window.fetch = async function opencodeLabFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (OPENROUTER_COMPLETION_RE.test(url)) {
      let body = null;
      try { body = typeof init?.body === 'string' ? JSON.parse(init.body) : null; } catch {}
      if (isLocalModel(body?.model)) return runOpenCodeCompletion(body, init);
    }
    const response = await nativeFetch(input, init);
    if (OPENROUTER_MODELS_RE.test(url)) return mergeModelResponse(response);
    return response;
  };

  els.connect?.addEventListener('click', async () => {
    const connected = await refreshLocal();
    if (connected) {
      sessionStorage.removeItem(OPENROUTER_CACHE);
      notice('Local OpenCode connected. Refresh the page once if new local models do not appear immediately.');
    } else {
      notice('Start the local OpenCode server using the command shown here, then press Connect again.', 6500);
    }
  });
  els.search?.addEventListener('input', renderGroups);
  els.copy?.addEventListener('click', async () => {
    const text = els.command?.textContent?.trim();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); notice('OpenCode server command copied.'); }
    catch { notice('Copy failed; select the command manually.'); }
  });

  renderLab();
  refreshLocal();
})();