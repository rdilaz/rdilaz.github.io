(() => {
  'use strict';

  const OPENROUTER_KEY_STORAGE = 'ai-visualizer.openrouter.key';
  const COMPLETION_RE = /^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions(?:\?|$)/;
  const DREAM_TIMEOUT_MS = 360000;
  const baseFetch = window.fetch.bind(window);

  const els = {
    center: document.getElementById('centerStatus'),
    title: document.getElementById('centerStatusTitle'),
    detail: document.getElementById('centerStatusDetail'),
    connection: document.getElementById('dreamStatusConnection'),
    elapsed: document.getElementById('dreamStatusElapsed'),
    progress: document.getElementById('dreamStatusProgressFill'),
    live: document.getElementById('dreamStatusLive'),
    cancel: document.getElementById('dreamCancelButton'),
    dreamButton: document.getElementById('dreamButton'),
    modelName: document.getElementById('selectedModelName'),
    topStatus: document.getElementById('topStatus'),
    steps: [...document.querySelectorAll('[data-dream-step]')],
  };

  const phases = {
    preparing: { progress: 10, step: 0 },
    sent: { progress: 26, step: 1 },
    working: { progress: 38, step: 1 },
    response: { progress: 62, step: 2 },
    repair: { progress: 54, step: 2 },
    checking: { progress: 78, step: 3 },
    opening: { progress: 92, step: 4 },
    done: { progress: 100, step: 4 },
  };

  const state = {
    active: false,
    startedAt: 0,
    requestStartedAt: 0,
    modelId: '',
    modelName: '',
    phase: 'preparing',
    controller: null,
    timeout: 0,
    tick: 0,
    userCancelled: false,
    timedOut: false,
  };

  function isCompletion(input) {
    const url = typeof input === 'string' ? input : input?.url || '';
    return COMPLETION_RE.test(url);
  }

  function parseBody(init) {
    if (typeof init?.body !== 'string') return null;
    try { return JSON.parse(init.body); } catch { return null; }
  }

  function modelLabel(modelId) {
    const visible = els.modelName?.textContent?.trim();
    if (visible && visible !== 'Choose a model') return visible;
    return String(modelId || '').split('/').pop() || 'the model';
  }

  function elapsedLabel(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function setSteps(current) {
    els.steps.forEach((step, index) => {
      step.classList.toggle('is-done', index < current);
      step.classList.toggle('is-current', index === current);
    });
  }

  function setPhase(phase, { title, detail, live, progress } = {}) {
    if (!els.center) return;
    state.phase = phase;
    const config = phases[phase] || phases.preparing;
    els.center.classList.add('dream-active');
    els.center.dataset.dreamPhase = phase;
    els.center.hidden = false;
    if (els.progress) els.progress.style.width = `${progress ?? config.progress}%`;
    setSteps(config.step);
    if (title && els.title) els.title.textContent = title;
    if (detail && els.detail) els.detail.textContent = detail;
    if (live && els.live) els.live.textContent = live;
    if (els.cancel) els.cancel.disabled = ['response', 'checking', 'opening', 'done'].includes(phase) || !state.controller;
  }

  function startClock() {
    clearInterval(state.tick);
    state.tick = setInterval(() => {
      if (!state.active) return;
      const now = performance.now();
      const elapsed = now - state.startedAt;
      if (els.elapsed) els.elapsed.textContent = elapsedLabel(elapsed);
      if (!['sent', 'working'].includes(state.phase)) return;
      const waiting = now - state.requestStartedAt;
      if (waiting >= 300000) {
        setPhase('working', {
          title: `${state.modelName} is very slow, but still connected`,
          detail: 'The request is still open after five minutes. Some large coding models can take this long; you can keep waiting or cancel without replacing your current visualizer.',
          live: `Request live · ${elapsedLabel(waiting)} waiting on model`,
          progress: 47,
        });
      } else if (waiting >= 180000) {
        setPhase('working', {
          title: `${state.modelName} is still generating`,
          detail: 'Three minutes is slow, but not automatically a failure for a large visual-coding response. The request is still open.',
          live: `Request live · ${elapsedLabel(waiting)} waiting on model`,
          progress: 46,
        });
      } else if (waiting >= 90000) {
        setPhase('working', {
          title: `${state.modelName} is still working`,
          detail: 'The request is still open. This is unusually slow, but it has not been declared stuck.',
          live: `Request live · ${elapsedLabel(waiting)} waiting on model`,
          progress: 44,
        });
      } else if (waiting >= 45000) {
        setPhase('working', {
          title: `${state.modelName} is taking a while`,
          detail: 'Still connected and waiting for the model response. Your current visualizer keeps running.',
          live: `Request live · ${elapsedLabel(waiting)} waiting on model`,
          progress: 42,
        });
      } else if (waiting >= 20000) {
        setPhase('working', {
          title: `${state.modelName} is working`,
          detail: 'Still waiting for the model to finish. Nothing has failed; the request remains open.',
          live: `Request live · ${elapsedLabel(waiting)} waiting on model`,
          progress: 40,
        });
      }
    }, 250);
  }

  function beginPreparation() {
    const key = sessionStorage.getItem(OPENROUTER_KEY_STORAGE) || '';
    const modelId = localStorage.getItem('ai-visualizer.selected-model') || '';
    if (!key || !modelId || els.dreamButton?.disabled) return;
    state.active = true;
    state.startedAt = performance.now();
    state.requestStartedAt = 0;
    state.modelId = modelId;
    state.modelName = modelLabel(modelId);
    state.controller = null;
    state.userCancelled = false;
    state.timedOut = false;
    if (els.connection) els.connection.textContent = 'OpenRouter connected';
    if (els.elapsed) els.elapsed.textContent = '0:00';
    setPhase('preparing', {
      title: `Preparing ${state.modelName}`,
      detail: 'Checking your spend guard and preparing the exact model request.',
      live: 'Connected ✓ · not sent yet',
    });
    startClock();
  }

  function requestSent(modelId, repair, controller) {
    state.active = true;
    if (!state.startedAt) state.startedAt = performance.now();
    state.requestStartedAt = performance.now();
    state.modelId = modelId;
    state.modelName = modelLabel(modelId);
    state.controller = controller;
    state.userCancelled = false;
    state.timedOut = false;
    if (els.connection) els.connection.textContent = `OpenRouter connected · ${state.modelName}`;
    setPhase(repair ? 'repair' : 'sent', {
      title: repair ? `${state.modelName} is repairing its dream` : `${state.modelName} is generating the visualizer`,
      detail: repair ? 'The first output needed a fix. A bounded repair request was sent to the same model.' : 'Request sent successfully. Waiting for the model to return its visualizer code.',
      live: repair ? 'Repair request sent ✓' : 'Request sent ✓ · model working',
    });
    startClock();
  }

  function responseStarted(response, repair) {
    state.controller = null;
    const status = response?.status ? `HTTP ${response.status}` : 'response';
    setPhase('response', {
      title: `${state.modelName} responded`,
      detail: repair ? 'Repair response arrived. Checking the repaired visualizer now.' : 'The model response arrived. Checking the returned visualizer before anything replaces your screen.',
      live: `OpenRouter responded ✓ · ${status}`,
    });
    setTimeout(() => {
      if (state.active && state.phase === 'response') {
        setPhase('checking', {
          title: 'Checking the visualizer',
          detail: 'Validating the returned code and preparing the isolated test sandbox.',
          live: 'Model response received ✓ · validating',
        });
      }
    }, 180);
  }

  function clearRequestTimer() {
    clearTimeout(state.timeout);
    state.timeout = 0;
  }

  function finishLifecycle({ hide = true, delay = 120 } = {}) {
    clearRequestTimer();
    state.controller = null;
    setTimeout(() => {
      if (!state.active) return;
      state.active = false;
      clearInterval(state.tick);
      state.tick = 0;
      els.center?.classList.remove('dream-active');
      if (els.center) {
        delete els.center.dataset.dreamPhase;
        if (hide) els.center.hidden = true;
      }
    }, delay);
  }

  function cancelDream() {
    if (!state.active || !state.controller) return;
    state.userCancelled = true;
    if (els.cancel) els.cancel.disabled = true;
    if (els.title) els.title.textContent = 'Cancelling Dream…';
    if (els.detail) els.detail.textContent = 'Stopping the in-flight browser request. Your current visualizer will stay in place.';
    if (els.live) els.live.textContent = 'Cancelling locally…';
    state.controller.abort();
  }

  els.dreamButton?.addEventListener('click', beginPreparation);
  els.cancel?.addEventListener('click', cancelDream);

  const titleObserver = new MutationObserver(() => {
    if (!state.active) return;
    const title = els.title?.textContent || '';
    if (/repairing/i.test(title)) {
      setPhase('repair', { live: 'First output needed repair · preparing same-model retry' });
    } else if (/opening the dream/i.test(title)) {
      setPhase('opening', {
        title: 'Testing and launching',
        detail: 'The visualizer is running in the hidden sandbox first. If it survives, it replaces the current one.',
        live: 'Code checked ✓ · sandbox test running',
      });
    }
  });
  if (els.title) titleObserver.observe(els.title, { childList: true, characterData: true, subtree: true });

  const hiddenObserver = new MutationObserver(() => {
    if (!state.active || !els.center?.hidden) return;
    const succeeded = els.topStatus?.textContent?.includes('just dreamed');
    if (succeeded) {
      setPhase('done', {
        title: `${state.modelName} is live`,
        detail: 'Generation, validation and sandbox testing completed successfully.',
        live: 'Dream launched ✓',
      });
      finishLifecycle({ hide: true, delay: 900 });
    } else {
      finishLifecycle({ hide: true, delay: 20 });
    }
  });
  if (els.center) hiddenObserver.observe(els.center, { attributes: true, attributeFilter: ['hidden'] });

  window.fetch = async function dreamLifecycleFetch(input, init = {}) {
    if (!isCompletion(input)) return baseFetch(input, init);
    const body = parseBody(init);
    if (!body?.model) return baseFetch(input, init);

    const repair = String(body?.messages?.[0]?.content || '').startsWith('Repair the visualizer');
    const controller = new AbortController();
    const externalSignal = init?.signal;
    const forwardAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) forwardAbort();
    else externalSignal?.addEventListener?.('abort', forwardAbort, { once: true });

    requestSent(body.model, repair, controller);
    clearRequestTimer();
    state.timeout = setTimeout(() => {
      state.timedOut = true;
      controller.abort();
    }, DREAM_TIMEOUT_MS);

    try {
      const response = await baseFetch(input, { ...init, signal: controller.signal });
      clearRequestTimer();
      responseStarted(response, repair);
      return response;
    } catch (error) {
      clearRequestTimer();
      state.controller = null;
      if (state.timedOut) {
        if (els.live) els.live.textContent = 'Timed out · request stopped';
        throw new Error('Dream timed out after 6 minutes. Your previous visualizer is still safe; try again or choose a faster model.');
      }
      if (state.userCancelled || controller.signal.aborted) {
        if (els.live) els.live.textContent = 'Cancelled · previous visualizer preserved';
        throw new Error('Dream cancelled. Your previous visualizer is still running. OpenRouter may still bill work completed before cancellation.');
      }
      if (els.live) els.live.textContent = 'Request failed before a usable response';
      throw error;
    } finally {
      externalSignal?.removeEventListener?.('abort', forwardAbort);
    }
  };
})();