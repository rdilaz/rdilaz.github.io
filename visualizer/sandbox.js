const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const BRIDGE_INIT_CHANNEL = 'visualizer-private-bridge-v1';

function sandboxBootstrap(sessionId, initialRenderQuality, initialPaused) {
  'use strict';

  const BRIDGE_INIT_CHANNEL_INNER = 'visualizer-private-bridge-v1';
  const MAX_EVENTS = 80;
  const MAX_TEXT = 2200;
  const originalRAF = window.requestAnimationFrame.bind(window);
  const originalCancelRAF = window.cancelAnimationFrame.bind(window);
  const originalSetTimeout = window.setTimeout.bind(window);
  const originalSetInterval = window.setInterval.bind(window);
  const originalConsole = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    log: console.log.bind(console),
  };
  let nativeDevicePixelRatio = Number(window.devicePixelRatio) > 0 ? Number(window.devicePixelRatio) : 1;
  function normalizeRenderQuality(value) {
    const suppliedNativeDpr = Number(value?.nativeDpr);
    if (Number.isFinite(suppliedNativeDpr) && suppliedNativeDpr > 0) nativeDevicePixelRatio = suppliedNativeDpr;
    const mode = ['full', 'balanced', 'saver'].includes(value?.mode) ? value.mode : 'full';
    const defaults = mode === 'saver'
      ? { maxFps: 30, maxDpr: 1 }
      : mode === 'balanced'
        ? { maxFps: 45, maxDpr: 1.5 }
        : { maxFps: 60, maxDpr: 2 };
    const maxFps = Math.min(60, Math.max(15, Number(value?.maxFps) || defaults.maxFps));
    const effectiveDpr = Math.min(
      nativeDevicePixelRatio,
      Math.max(0.1, Number(value?.effectiveDpr) || Math.min(nativeDevicePixelRatio, defaults.maxDpr)),
    );
    return { schema: 'visualizer-render-quality-v1', mode, maxFps, effectiveDpr, nativeDpr: nativeDevicePixelRatio };
  }
  let renderQuality = normalizeRenderQuality(initialRenderQuality);
  try {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: false,
      enumerable: true,
      get: () => renderQuality.effectiveDpr,
    });
  } catch {
    // VIZ viewport remains authoritative if this browser locks the native getter.
  }
  const bridgeChannel = new MessageChannel();
  const bridgePort = bridgeChannel.port1;
  const bridgePost = bridgePort.postMessage.bind(bridgePort);
  bridgePort.start();
  parent.postMessage({ channel: BRIDGE_INIT_CHANNEL_INNER, sessionId }, '*', [bridgeChannel.port2]);

  const state = {
    startedAt: performance.now(),
    readyAt: 0,
    mode: 'full',
    paused: false,
    pausedAt: 0,
    totalPausedMs: 0,
    hostFrames: 0,
    lastHostFrameAt: 0,
    frameReads: 0,
    listenerRegistrations: 0,
    listenerCallbacks: 0,
    activeListeners: 0,
    rafRequests: 0,
    rafCallbacks: 0,
    monitorFrames: 0,
    monitorIntervals: [],
    longFrames: 0,
    maxFrameGapMs: 0,
    mutations: 0,
    contextFailures: [],
    shaderFailures: [],
    programFailures: [],
    contextLosses: [],
    securityViolations: [],
    consoleErrors: [],
    consoleWarnings: [],
    runtimeErrors: [],
    events: [],
    lastActivityAt: performance.now(),
    lastDomStyleHash: 0,
    rootSurfaceEverChanged: false,
    qualityChanges: 0,
    viewportCanvasStabilizations: 0,
    renderQuality,
  };

  const listeners = new Set();
  const contextByObject = new WeakMap();
  const contextByCanvas = new WeakMap();
  const contextRecords = [];
  const intensiveRestores = [];
  const pendingAnimationFrames = new Map();
  const hostPausedAnimations = new Set();
  let animationFrameSequence = 0;
  let hostAnimationOperation = false;
  let currentFrame = {
    version: 'visualizer-audio-v1',
    time: 0,
    deltaTime: 0,
    audio: {
      connected: false,
      silence: true,
      volume: 0,
      peak: 0,
      transient: 0,
      beat: 0,
      tempo: 0,
      tempoConfidence: 0,
      spectralFlux: 0,
      spectralCentroid: 0,
      bands: { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 },
      stereo: { balance: 0, width: 0 },
      waveform: Array(128).fill(0),
      spectrum: Array(96).fill(0),
    },
    pointer: { x: 0.5, y: 0.5, active: false, down: false },
    viewport: { width: innerWidth, height: innerHeight, dpr: renderQuality.effectiveDpr },
  };
  let viewport = currentFrame.viewport;
  let nextGeneratedFrameAt = 0;
  let allowedGeneratedFrameAt = -1;
  let qualityResizePending = false;
  const stabilizedViewportCanvases = new Set();
  const observedViewportCanvases = new Set();
  let viewportCanvasRecheckTimer = 0;
  function autoCssSize(canvas) {
    try {
      const map = canvas.computedStyleMap?.();
      return String(map?.get('width') || '').toLowerCase() === 'auto'
        && String(map?.get('height') || '').toLowerCase() === 'auto';
    } catch {
      return false;
    }
  }

  function zeroInset(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && Math.abs(parsed) <= 1;
  }

  function stabilizeViewportCanvas(canvas) {
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected) return false;
    observedViewportCanvases.add(canvas);
    const wasStabilized = canvas.hasAttribute('data-visualizer-host-viewport-canvas');
    if (wasStabilized) canvas.removeAttribute('data-visualizer-host-viewport-canvas');
    const style = getComputedStyle(canvas);
    if (style.position !== 'fixed'
      || !autoCssSize(canvas)
      || ![style.top, style.right, style.bottom, style.left].every(zeroInset)) {
      stabilizedViewportCanvases.delete(canvas);
      return false;
    }
    canvas.setAttribute('data-visualizer-host-viewport-canvas', '');
    const rect = canvas.getBoundingClientRect();
    const matchesViewport = Math.abs(rect.left) <= 1
      && Math.abs(rect.top) <= 1
      && Math.abs(rect.width - innerWidth) <= 1
      && Math.abs(rect.height - innerHeight) <= 1;
    if (!matchesViewport) {
      canvas.removeAttribute('data-visualizer-host-viewport-canvas');
      stabilizedViewportCanvases.delete(canvas);
      return false;
    }
    stabilizedViewportCanvases.add(canvas);
    if (!wasStabilized) state.viewportCanvasStabilizations += 1;
    return true;
  }

  function stabilizeViewportCanvases(root = document) {
    stabilizedViewportCanvases.forEach(canvas => {
      if (!canvas.isConnected) stabilizedViewportCanvases.delete(canvas);
    });
    observedViewportCanvases.forEach(canvas => {
      if (!canvas.isConnected) observedViewportCanvases.delete(canvas);
    });
    if (root instanceof HTMLCanvasElement) stabilizeViewportCanvas(root);
    root.querySelectorAll?.('canvas').forEach(stabilizeViewportCanvas);
  }

  function scheduleViewportCanvasRecheck() {
    if (viewportCanvasRecheckTimer) return;
    viewportCanvasRecheckTimer = originalSetTimeout(() => {
      viewportCanvasRecheckTimer = 0;
      recheckObservedViewportCanvases();
    }, 0);
  }

  function recheckObservedViewportCanvases() {
    observedViewportCanvases.forEach(canvas => {
      if (!canvas.isConnected) {
        stabilizedViewportCanvases.delete(canvas);
        observedViewportCanvases.delete(canvas);
        return;
      }
      stabilizeViewportCanvas(canvas);
    });
  }

  function post(type, payload = {}) {
    try {
      bridgePost({ type, ...payload });
    } catch {
      // A detached parent may stop accepting diagnostics during teardown.
    }
  }

  function compactText(value) {
    try {
      if (value instanceof Error) return String(value.stack || value.message || value);
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value);
      return JSON.stringify(value, (_key, nested) => {
        if (nested instanceof Error) return String(nested.stack || nested.message || nested);
        if (typeof nested === 'bigint') return String(nested);
        return nested;
      });
    } catch {
      try { return String(value); } catch { return '[unprintable]'; }
    }
  }

  function argsText(args) {
    return args.map(compactText).join(' ').slice(0, MAX_TEXT);
  }

  function recordList(list, value, limit = 24) {
    list.push(value);
    if (list.length > limit) list.shift();
  }

  function recordEvent(severity, code, message, detail = {}) {
    const event = {
      atMs: Math.round(performance.now() - state.startedAt),
      severity,
      code,
      message: String(message || code).slice(0, MAX_TEXT),
      detail,
    };
    recordList(state.events, event, MAX_EVENTS);
    if (severity === 'fatal' || severity === 'error' || code === 'WEBGL_CONTEXT_LOST') {
      post('diagnostic-event', { event });
    }
    return event;
  }

  function replaceFunction(target, name, replacement, restoreBucket = null) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      const original = target[name];
      if (typeof original !== 'function') return null;
      const wrapped = replacement(original);
      Object.defineProperty(target, name, {
        ...descriptor,
        configurable: descriptor?.configurable !== false,
        writable: descriptor?.writable !== false,
        value: wrapped,
      });
      const restore = () => {
        try {
          if (descriptor) Object.defineProperty(target, name, descriptor);
          else target[name] = original;
        } catch {
          // Non-configurable browser functions cannot always be restored.
        }
      };
      if (restoreBucket) restoreBucket.push(restore);
      return restore;
    } catch {
      return null;
    }
  }

  replaceFunction(console, 'error', original => function (...args) {
    const message = argsText(args);
    recordList(state.consoleErrors, message);
    recordEvent('error', 'CONSOLE_ERROR', message);
    return Reflect.apply(original, console, args);
  });

  replaceFunction(console, 'warn', original => function (...args) {
    const message = argsText(args);
    recordList(state.consoleWarnings, message);
    return Reflect.apply(original, console, args);
  });

  function generatedFrameDue(timestamp) {
    if (timestamp === allowedGeneratedFrameAt) return true;
    const interval = 1000 / renderQuality.maxFps;
    if (nextGeneratedFrameAt && timestamp + 0.25 < nextGeneratedFrameAt) return false;
    allowedGeneratedFrameAt = timestamp;
    if (!nextGeneratedFrameAt) nextGeneratedFrameAt = timestamp + interval;
    else nextGeneratedFrameAt += (Math.floor(Math.max(0, timestamp - nextGeneratedFrameAt) / interval) + 1) * interval;
    return true;
  }

  function scheduleAnimationFrame(id, record) {
    if (state.paused || record.cancelled || record.nativeId) return;
    record.nativeId = originalRAF(timestamp => {
      record.nativeId = 0;
      if (record.cancelled) {
        pendingAnimationFrames.delete(id);
        return;
      }
      if (state.paused) return;
      if (!generatedFrameDue(timestamp)) {
        scheduleAnimationFrame(id, record);
        return;
      }
      pendingAnimationFrames.delete(id);
      state.rafCallbacks += 1;
      state.lastActivityAt = performance.now();
      record.callback(timestamp - state.totalPausedMs);
    });
  }

  try {
    window.requestAnimationFrame = function pausableRequestAnimationFrame(callback) {
      if (typeof callback !== 'function') throw new TypeError('requestAnimationFrame callback must be a function.');
      state.rafRequests += 1;
      animationFrameSequence += 1;
      const id = animationFrameSequence;
      const record = { callback, nativeId: 0, cancelled: false };
      pendingAnimationFrames.set(id, record);
      scheduleAnimationFrame(id, record);
      return id;
    };
    window.cancelAnimationFrame = function pausableCancelAnimationFrame(id) {
      const record = pendingAnimationFrames.get(Number(id));
      if (!record) return;
      record.cancelled = true;
      if (record.nativeId) originalCancelRAF(record.nativeId);
      pendingAnimationFrames.delete(Number(id));
    };
  } catch {
    // A locked-down browser may reject replacing animation-frame globals.
  }

  if (typeof Animation !== 'undefined') {
    for (const name of ['pause', 'cancel', 'finish']) {
      replaceFunction(Animation.prototype, name, original => function (...args) {
        if (!hostAnimationOperation) hostPausedAnimations.delete(this);
        return Reflect.apply(original, this, args);
      });
    }
    for (const name of ['play', 'reverse']) {
      replaceFunction(Animation.prototype, name, original => function (...args) {
        const result = Reflect.apply(original, this, args);
        if (state.paused && !hostAnimationOperation) pauseAnimation(this);
        return result;
      });
    }
  }

  if (typeof Element !== 'undefined') {
    replaceFunction(Element.prototype, 'animate', original => function (...args) {
      const animation = Reflect.apply(original, this, args);
      if (state.paused) pauseAnimation(animation);
      return animation;
    });
  }

  function pauseAnimation(animation) {
    if (!animation || (animation.playState !== 'running' && animation.playState !== 'pending')) return;
    try {
      hostAnimationOperation = true;
      animation.pause();
      hostPausedAnimations.add(animation);
    } catch {
      // Animation pausing is best-effort across browser-native media.
    } finally {
      hostAnimationOperation = false;
    }
  }

  function pauseCurrentAnimations() {
    let animations = [];
    try { animations = document.getAnimations(); } catch {
      // Web Animations inspection is optional in older browser engines.
    }
    for (const animation of animations) {
      pauseAnimation(animation);
    }
  }

  function dispatchQualityResize() {
    if (state.paused) {
      qualityResizePending = true;
      return;
    }
    qualityResizePending = false;
    originalSetTimeout(() => dispatchEvent(new Event('resize')), 0);
  }

  function applyRenderQuality(value, revision = 0) {
    const previous = renderQuality;
    const next = normalizeRenderQuality(value);
    const changed = previous.mode !== next.mode
      || previous.maxFps !== next.maxFps
      || previous.effectiveDpr !== next.effectiveDpr;
    renderQuality = next;
    state.renderQuality = next;
    nextGeneratedFrameAt = 0;
    allowedGeneratedFrameAt = -1;
    viewport = { ...viewport, dpr: next.effectiveDpr };
    currentFrame = { ...currentFrame, viewport };
    if (changed) {
      state.qualityChanges += 1;
      if (previous.effectiveDpr !== next.effectiveDpr) {
        stabilizeViewportCanvases();
        dispatchQualityResize();
      }
    }
    post('render-quality-applied', {
      revision: Number(revision) || 0,
      quality: { ...next },
      changed,
    });
  }

  function pauseGeneratedPlayback() {
    if (state.paused) return;
    state.paused = true;
    state.pausedAt = performance.now();
    for (const record of pendingAnimationFrames.values()) {
      if (!record.nativeId) continue;
      originalCancelRAF(record.nativeId);
      record.nativeId = 0;
    }
    pauseCurrentAnimations();
    post('playback-state', {
      playback: {
        paused: true,
        queuedAnimationFrames: pendingAnimationFrames.size,
        hostPausedAnimations: hostPausedAnimations.size,
      },
    });
  }

  function resumeGeneratedPlayback() {
    if (!state.paused) return;
    state.totalPausedMs += Math.max(0, performance.now() - state.pausedAt);
    state.pausedAt = 0;
    state.paused = false;
    nextGeneratedFrameAt = 0;
    allowedGeneratedFrameAt = -1;
    for (const animation of hostPausedAnimations) {
      try {
        if (animation.playState === 'paused') {
          hostAnimationOperation = true;
          animation.play();
        }
      } catch {
        // Cancelled or detached animations are intentionally not recreated.
      } finally {
        hostAnimationOperation = false;
      }
    }
    hostPausedAnimations.clear();
    if (qualityResizePending) dispatchQualityResize();
    pendingAnimationFrames.forEach((record, id) => scheduleAnimationFrame(id, record));
    post('playback-state', {
      playback: {
        paused: false,
        queuedAnimationFrames: pendingAnimationFrames.size,
        hostPausedAnimations: 0,
      },
    });
  }

  for (const eventName of ['animationstart', 'transitionrun']) {
    addEventListener(eventName, () => {
      if (state.paused) originalSetTimeout(pauseCurrentAnimations, 0);
    }, true);
  }

  function contextRecord(canvas, type, context) {
    let record = contextByCanvas.get(canvas);
    if (!record) {
      record = {
        id: `canvas-${contextRecords.length + 1}`,
        type,
        canvas,
        context,
        createdAtMs: Math.round(performance.now() - state.startedAt),
        paintOps: 0,
        clearOps: 0,
        drawCalls: 0,
        shaderCompiles: 0,
        shadersCompiled: 0,
        programsLinked: 0,
        programLinkAttempts: 0,
        submits: 0,
        lastActivityAt: 0,
      };
      contextRecords.push(record);
      contextByCanvas.set(canvas, record);
      contextByObject.set(context, record);
      canvas.addEventListener('webglcontextlost', event => {
        const item = {
          canvasId: record.id,
          statusMessage: String(event.statusMessage || ''),
          restored: false,
        };
        recordList(state.contextLosses, item);
        recordEvent('error', 'WEBGL_CONTEXT_LOST', `WebGL context lost${item.statusMessage ? `: ${item.statusMessage}` : '.'}`, item);
        originalSetTimeout(() => {
          if (!item.restored) recordEvent('fatal', 'WEBGL_CONTEXT_LOST', 'WebGL context did not recover after being lost.', item);
        }, 500);
      });
      canvas.addEventListener('webglcontextrestored', () => {
        const item = [...state.contextLosses].reverse().find(candidate => candidate.canvasId === record.id && !candidate.restored);
        if (item) item.restored = true;
        recordEvent('info', 'WEBGL_CONTEXT_RESTORED', 'WebGL context restored.', { canvasId: record.id });
      });
    }
    return record;
  }

  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  try {
    HTMLCanvasElement.prototype.getContext = function instrumentedGetContext(type, ...args) {
      stabilizeViewportCanvas(this);
      let context;
      try {
        context = Reflect.apply(originalGetContext, this, [type, ...args]);
      } catch (error) {
        const item = { type: String(type), message: compactText(error) };
        recordList(state.contextFailures, item);
        recordEvent('error', 'RENDER_CONTEXT_FAILED', `Canvas context ${type} threw during creation.`, item);
        throw error;
      }
      if (context) contextRecord(this, String(type).toLowerCase(), context);
      else if (['2d', 'webgl', 'experimental-webgl', 'webgl2', 'webgpu'].includes(String(type).toLowerCase())) {
        const item = { type: String(type), message: 'getContext returned null' };
        recordList(state.contextFailures, item);
        recordEvent('error', 'RENDER_CONTEXT_FAILED', `Canvas context ${type} is unavailable.`, item);
      }
      return context;
    };
  } catch {
    // A locked-down browser may reject replacing getContext.
  }

  function bumpContext(context, field) {
    const record = contextByObject.get(context);
    if (!record || state.mode !== 'full') return;
    record[field] = (record[field] || 0) + 1;
    record.lastActivityAt = Math.round(performance.now() - state.startedAt);
    state.lastActivityAt = performance.now();
  }

  function instrument2D() {
    if (typeof CanvasRenderingContext2D === 'undefined') return;
    const paintMethods = [
      'fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText',
      'drawImage', 'putImageData', 'drawFocusIfNeeded',
    ];
    for (const name of paintMethods) {
      replaceFunction(CanvasRenderingContext2D.prototype, name, original => function (...args) {
        bumpContext(this, 'paintOps');
        return Reflect.apply(original, this, args);
      }, intensiveRestores);
    }
    replaceFunction(CanvasRenderingContext2D.prototype, 'clearRect', original => function (...args) {
      bumpContext(this, 'clearOps');
      return Reflect.apply(original, this, args);
    }, intensiveRestores);
  }

  function instrumentWebGLPrototype(Prototype) {
    if (!Prototype) return;
    const drawMethods = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'];
    for (const name of drawMethods) {
      replaceFunction(Prototype, name, original => function (...args) {
        bumpContext(this, 'drawCalls');
        return Reflect.apply(original, this, args);
      }, intensiveRestores);
    }
    replaceFunction(Prototype, 'clear', original => function (...args) {
      bumpContext(this, 'clearOps');
      return Reflect.apply(original, this, args);
    }, intensiveRestores);
    replaceFunction(Prototype, 'compileShader', original => function (shader) {
      bumpContext(this, 'shaderCompiles');
      const result = Reflect.apply(original, this, [shader]);
      try {
        const ok = this.getShaderParameter(shader, this.COMPILE_STATUS);
        const record = contextByObject.get(this);
        if (ok) {
          if (record) record.shadersCompiled += 1;
        } else {
          const item = {
            canvasId: record?.id || null,
            log: String(this.getShaderInfoLog(shader) || 'Unknown shader compilation error').slice(0, MAX_TEXT),
          };
          recordList(state.shaderFailures, item);
          recordEvent('error', 'SHADER_COMPILE_FAILED', item.log, item);
        }
      } catch {
        // Driver status inspection is best-effort after the native call.
      }
      return result;
    });
    replaceFunction(Prototype, 'linkProgram', original => function (program) {
      const record = contextByObject.get(this);
      if (record) record.programLinkAttempts += 1;
      const result = Reflect.apply(original, this, [program]);
      try {
        const ok = this.getProgramParameter(program, this.LINK_STATUS);
        if (ok) {
          if (record) record.programsLinked += 1;
        } else {
          const item = {
            canvasId: record?.id || null,
            log: String(this.getProgramInfoLog(program) || 'Unknown program link error').slice(0, MAX_TEXT),
          };
          recordList(state.programFailures, item);
          recordEvent('error', 'PROGRAM_LINK_FAILED', item.log, item);
        }
      } catch {
        // Driver status inspection is best-effort after the native call.
      }
      return result;
    });
  }

  function instrumentWebGPU() {
    if (typeof GPUCanvasContext !== 'undefined') {
      replaceFunction(GPUCanvasContext.prototype, 'configure', original => function (configuration) {
        const record = contextByObject.get(this);
        if (record && configuration?.device?.queue) contextByObject.set(configuration.device.queue, record);
        return Reflect.apply(original, this, [configuration]);
      });
    }
    if (typeof GPUQueue === 'undefined') return;
    replaceFunction(GPUQueue.prototype, 'submit', original => function (...args) {
      bumpContext(this, 'submits');
      return Reflect.apply(original, this, args);
    }, intensiveRestores);
  }

  instrument2D();
  instrumentWebGLPrototype(typeof WebGLRenderingContext === 'undefined' ? null : WebGLRenderingContext.prototype);
  instrumentWebGLPrototype(typeof WebGL2RenderingContext === 'undefined' ? null : WebGL2RenderingContext.prototype);
  instrumentWebGPU();

  const mutationObserver = new MutationObserver(records => {
    state.mutations += records.length;
    state.lastActivityAt = performance.now();
  });
  mutationObserver.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  const viewportCanvasObserver = new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(node => {
        if (node instanceof Element) stabilizeViewportCanvases(node);
      });
      const canvasTreeChanged = [...record.addedNodes, ...record.removedNodes].some(node => (
        node instanceof HTMLCanvasElement || (node instanceof Element && node.querySelector('canvas'))
      ));
      if (canvasTreeChanged) scheduleViewportCanvasRecheck();
      if (record.type === 'attributes' && record.attributeName !== 'data-visualizer-host-viewport-canvas') {
        const target = record.target;
        const affectsStabilizedCanvas = target instanceof HTMLCanvasElement
          || [...observedViewportCanvases].some(canvas => target instanceof Element && target.contains(canvas));
        if (affectsStabilizedCanvas) scheduleViewportCanvasRecheck();
      }
      if (record.type === 'attributes' && record.attributeName === 'data-visualizer-host-viewport-canvas') {
        const canvas = record.target;
        if (!stabilizedViewportCanvases.has(canvas) && canvas.hasAttribute('data-visualizer-host-viewport-canvas')) {
          canvas.removeAttribute('data-visualizer-host-viewport-canvas');
        } else if (stabilizedViewportCanvases.has(canvas) && !canvas.hasAttribute('data-visualizer-host-viewport-canvas')) {
          scheduleViewportCanvasRecheck();
        }
      }
      const stylesheetNodeChanged = [...record.addedNodes, ...record.removedNodes].some(node => (
        node instanceof HTMLStyleElement
        || (node instanceof HTMLLinkElement && node.relList?.contains('stylesheet'))
      ));
      if (stylesheetNodeChanged
        || record.target instanceof HTMLStyleElement
        || record.target.parentElement instanceof HTMLStyleElement) {
        scheduleViewportCanvasRecheck();
      }
    }
  });
  viewportCanvasObserver.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  function colorHasInk(value) {
    if (!value || value === 'transparent') return false;
    const normalized = value.replaceAll(' ', '').toLowerCase();
    if (normalized === 'rgba(0,0,0,0)' || normalized.endsWith(',0)')) return false;
    return true;
  }

  function visibleRect(element) {
    try {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.001) return null;
      const rect = element.getBoundingClientRect();
      if (rect.width < 0.5 || rect.height < 0.5) return null;
      if (rect.bottom < 0 || rect.right < 0 || rect.left > innerWidth || rect.top > innerHeight) return null;
      return { rect, style };
    } catch {
      return null;
    }
  }

  function hashStep(hash, value) {
    let next = hash >>> 0;
    const text = String(value);
    for (let i = 0; i < text.length; i += 1) {
      next ^= text.charCodeAt(i);
      next = Math.imul(next, 16777619);
    }
    return next >>> 0;
  }

  function sampleCanvas(canvas) {
    const record = contextByCanvas.get(canvas) || null;
    const visible = visibleRect(canvas);
    if (!visible) return null;
    const viewportArea = Math.max(1, innerWidth * innerHeight);
    const coverage = Math.min(1, Math.max(0, visible.rect.width * visible.rect.height) / viewportArea);
    const sample = document.createElement('canvas');
    sample.width = 32;
    sample.height = 18;
    const sampleContext = originalGetContext.call(sample, '2d', { willReadFrequently: true });
    let pixel = {
      sampled: false,
      hash: 0,
      uniqueBuckets: 0,
      nonTransparentRatio: 0,
      nonBlackRatio: 0,
      luminanceVariance: 0,
      informative: false,
      error: '',
    };
    try {
      sampleContext.clearRect(0, 0, sample.width, sample.height);
      sampleContext.drawImage(canvas, 0, 0, sample.width, sample.height);
      const data = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
      const buckets = new Set();
      let hash = 2166136261;
      let nonTransparent = 0;
      let nonBlack = 0;
      let sum = 0;
      let sumSq = 0;
      const pixels = data.length / 4;
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const a = data[index + 3];
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (a > 8) nonTransparent += 1;
        if (a > 8 && luminance > 2) nonBlack += 1;
        sum += luminance;
        sumSq += luminance * luminance;
        const bucket = `${r >> 5}:${g >> 5}:${b >> 5}:${a >> 6}`;
        buckets.add(bucket);
        hash = hashStep(hash, bucket);
      }
      const mean = sum / Math.max(1, pixels);
      const variance = Math.max(0, sumSq / Math.max(1, pixels) - mean * mean);
      pixel = {
        sampled: true,
        hash,
        uniqueBuckets: buckets.size,
        nonTransparentRatio: nonTransparent / Math.max(1, pixels),
        nonBlackRatio: nonBlack / Math.max(1, pixels),
        luminanceVariance: variance,
        informative: buckets.size > 1 || nonBlack > 0 || variance > 0.25,
        error: '',
      };
    } catch (error) {
      pixel.error = compactText(error).slice(0, 500);
    }

    const activity = record ? {
      type: record.type,
      paintOps: record.paintOps,
      clearOps: record.clearOps,
      drawCalls: record.drawCalls,
      shaderCompiles: record.shaderCompiles,
      shadersCompiled: record.shadersCompiled,
      programsLinked: record.programsLinked,
      programLinkAttempts: record.programLinkAttempts,
      submits: record.submits,
      lastActivityAt: record.lastActivityAt,
    } : {
      type: 'unknown',
      paintOps: 0,
      clearOps: 0,
      drawCalls: 0,
      shaderCompiles: 0,
      shadersCompiled: 0,
      programsLinked: 0,
      programLinkAttempts: 0,
      submits: 0,
      lastActivityAt: 0,
    };

    const contextType = activity.type;
    const successfulActivity = pixel.informative
      || (contextType === '2d' && activity.paintOps > 0)
      || ((contextType === 'webgl' || contextType === 'experimental-webgl' || contextType === 'webgl2') && activity.drawCalls > 0 && activity.programsLinked > 0)
      || (contextType === 'webgpu' && activity.submits > 0)
      || (!record && colorHasInk(visible.style.backgroundColor));

    return {
      id: record?.id || null,
      elementId: canvas.id || '',
      width: Math.round(visible.rect.width),
      height: Math.round(visible.rect.height),
      left: Math.round(visible.rect.left),
      top: Math.round(visible.rect.top),
      right: Math.round(visible.rect.right),
      bottom: Math.round(visible.rect.bottom),
      centerX: Math.round(visible.rect.left + visible.rect.width / 2),
      centerY: Math.round(visible.rect.top + visible.rect.height / 2),
      backingWidth: canvas.width,
      backingHeight: canvas.height,
      hostViewportStabilized: stabilizedViewportCanvases.has(canvas)
        && canvas.hasAttribute('data-visualizer-host-viewport-canvas'),
      coverage,
      pixel,
      activity,
      successfulActivity,
    };
  }

  function collectDomElements(limit = 500) {
    const elements = [];
    const queue = document.documentElement ? [document.documentElement] : [];
    const seen = new Set();
    let shadowRoots = 0;

    while (queue.length && elements.length < limit) {
      const element = queue.shift();
      if (!(element instanceof Element) || seen.has(element)) continue;
      seen.add(element);
      elements.push(element);
      for (const child of element.children || []) queue.push(child);
      if (element.shadowRoot) {
        shadowRoots += 1;
        for (const child of element.shadowRoot.children || []) queue.push(child);
      }
    }

    return { elements, shadowRoots };
  }

  function inspectPseudo(element, pseudo, rect, viewportArea) {
    let style;
    try { style = getComputedStyle(element, pseudo); } catch { return null; }
    if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.001) return null;
    const content = String(style.content || '').trim();
    const hasContent = content && content !== 'none' && content !== 'normal' && content !== '""' && content !== "''";
    const hasBackgroundImage = Boolean(style.backgroundImage && style.backgroundImage !== 'none');
    const hasBackgroundColor = colorHasInk(style.backgroundColor);
    const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some(side => Number.parseFloat(style[`border${side}Width`]) > 0 && colorHasInk(style[`border${side}Color`]));
    const hasEffect = (style.boxShadow && style.boxShadow !== 'none') || (style.filter && style.filter !== 'none');
    if (!(hasContent || hasBackgroundImage || hasBackgroundColor || hasBorder || hasEffect)) return null;
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);
    const estimatedArea = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
      ? Math.min(viewportArea, width * height)
      : Math.max(1, rect.width * rect.height);
    return {
      coverage: Math.min(1, estimatedArea / viewportArea),
      content: hasContent ? content.slice(0, 80) : '',
      style,
    };
  }

  function inspectDom() {
    const viewportArea = Math.max(1, innerWidth * innerHeight);
    let meaningfulNodes = 0;
    let substantiveNodes = 0;
    let rootSurfaceNodes = 0;
    let pseudoElements = 0;
    let totalCoverage = 0;
    let maxCoverage = 0;
    let textCharacters = 0;
    let svgPrimitives = 0;
    let styleHash = 2166136261;
    const collected = collectDomElements();

    const recordEvidence = ({ label, rect, style, text = '', coverage, rootSurface = false, substantive = true }) => {
      meaningfulNodes += 1;
      if (rootSurface) rootSurfaceNodes += 1;
      if (substantive) substantiveNodes += 1;
      totalCoverage = Math.min(4, totalCoverage + coverage);
      maxCoverage = Math.max(maxCoverage, coverage);
      textCharacters += text.length;
      styleHash = hashStep(styleHash, `${label}:${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${style.opacity}:${style.transform}:${style.color}:${style.backgroundColor}:${style.backgroundImage}:${style.filter}:${text.slice(0, 80)}`);
    };

    for (const element of collected.elements) {
      if (element instanceof HTMLCanvasElement) continue;
      if (['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'HEAD'].includes(element.tagName)) continue;
      const visible = visibleRect(element);
      if (!visible) continue;
      const { rect, style } = visible;
      const text = (element.childElementCount === 0 ? element.textContent : '').trim();
      const isSvgPrimitive = ['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'use'].includes(element.localName);
      const hasBackgroundImage = Boolean(style.backgroundImage && style.backgroundImage !== 'none');
      const hasBackgroundColor = colorHasInk(style.backgroundColor);
      const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some(side => Number.parseFloat(style[`border${side}Width`]) > 0 && colorHasInk(style[`border${side}Color`]));
      const hasEffect = (style.boxShadow && style.boxShadow !== 'none') || (style.filter && style.filter !== 'none');
      const hasSvgPaint = isSvgPrimitive && ((style.fill && style.fill !== 'none' && colorHasInk(style.fill)) || (style.stroke && style.stroke !== 'none' && colorHasInk(style.stroke)));
      const meaningful = Boolean(text || hasBackgroundImage || hasBackgroundColor || hasBorder || hasEffect || hasSvgPaint);
      const rootSurface = element === document.documentElement || element === document.body;
      const substantive = Boolean(text || hasBackgroundImage || hasBorder || hasEffect || hasSvgPaint || !rootSurface);

      if (meaningful) {
        const coverage = Math.min(1, Math.max(0, rect.width * rect.height) / viewportArea);
        if (hasSvgPaint) svgPrimitives += 1;
        recordEvidence({ element, label: element.tagName, rect, style, text, coverage, rootSurface, substantive });
      }

      for (const pseudo of ['::before', '::after']) {
        const evidence = inspectPseudo(element, pseudo, rect, viewportArea);
        if (!evidence) continue;
        pseudoElements += 1;
        recordEvidence({
          element,
          label: `${element.tagName}${pseudo}`,
          rect,
          style: evidence.style,
          text: evidence.content,
          coverage: evidence.coverage,
          substantive: true,
        });
      }
    }

    let animations = 0;
    try {
      animations = document.getAnimations().filter(animation => animation.playState !== 'finished').length;
    } catch {
      // Animation evidence is optional in older browser engines.
    }

    const rootSurfaceHash = styleHash;
    if (state.lastDomStyleHash && state.lastDomStyleHash !== rootSurfaceHash && rootSurfaceNodes > 0) {
      state.rootSurfaceEverChanged = true;
    }
    state.lastDomStyleHash = rootSurfaceHash;
    const dynamicRootSurface = rootSurfaceNodes > 0 && (animations > 0 || state.rootSurfaceEverChanged);
    const visible = substantiveNodes > 0 || dynamicRootSurface;

    return {
      meaningfulNodes,
      substantiveNodes,
      rootSurfaceNodes,
      dynamicRootSurface,
      pseudoElements,
      shadowRoots: collected.shadowRoots,
      totalCoverage,
      maxCoverage,
      textCharacters,
      svgPrimitives,
      animations,
      styleHash,
      visible,
    };
  }

  function monitorSummary() {
    const recent = state.monitorIntervals.slice(-120);
    const average = recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : 0;
    return {
      frames: state.monitorFrames,
      averageFrameMs: average,
      approximateFps: average > 0 ? Math.min(240, 1000 / average) : 0,
      longFrames: state.longFrames,
      maxFrameGapMs: state.maxFrameGapMs,
      heartbeatAgeMs: Math.round(performance.now() - state.lastActivityAt),
    };
  }

  function collectProbe(label) {
    const canvases = [...document.querySelectorAll('canvas')]
      .map(sampleCanvas)
      .filter(Boolean)
      .sort((a, b) => b.coverage - a.coverage);
    const dom = inspectDom();
    const dominantCanvas = canvases[0] || null;
    const anyCanvasProof = canvases.some(canvas => canvas.successfulActivity);
    const dominantDomFallback = dom.visible && dom.maxCoverage >= 0.45;
    const dominantCanvasFailed = Boolean(
      dominantCanvas
      && dominantCanvas.coverage >= 0.45
      && !dominantCanvas.successfulActivity
      && !dominantDomFallback
    );
    const visibleProof = dominantCanvasFailed ? false : Boolean(anyCanvasProof || dom.visible);
    const rendererTypes = [...new Set(contextRecords.map(record => record.type))];

    return {
      schema: 'visualizer-probe-v1',
      label,
      atMs: Math.round(performance.now() - state.startedAt),
      ready: state.readyAt > 0,
      viewport: { width: innerWidth, height: innerHeight, dpr: renderQuality.effectiveDpr },
      viz: {
        hostFrames: state.hostFrames,
        frameReads: state.frameReads,
        listenerRegistrations: state.listenerRegistrations,
        listenerCallbacks: state.listenerCallbacks,
        activeListeners: state.activeListeners,
        consumed: state.frameReads > 0 || state.listenerRegistrations > 0 || state.listenerCallbacks > 0,
      },
      runtime: {
        rafRequests: state.rafRequests,
        rafCallbacks: state.rafCallbacks,
        mutations: state.mutations,
        renderQuality: {
          ...renderQuality,
          changes: state.qualityChanges,
        },
        viewportCanvasStabilizations: state.viewportCanvasStabilizations,
        observedViewportCanvasCount: observedViewportCanvases.size,
        stabilizedViewportCanvasCount: stabilizedViewportCanvases.size,
        monitor: monitorSummary(),
        playback: {
          paused: state.paused,
          queuedAnimationFrames: pendingAnimationFrames.size,
          hostPausedAnimations: hostPausedAnimations.size,
          totalPausedMs: Math.round(state.totalPausedMs + (state.paused ? performance.now() - state.pausedAt : 0)),
        },
      },
      renderer: {
        types: rendererTypes,
        contextFailures: [...state.contextFailures],
        shaderFailures: [...state.shaderFailures],
        programFailures: [...state.programFailures],
        contextLosses: [...state.contextLosses],
      },
      visual: {
        visibleProof,
        dominantCanvasFailed,
        canvases,
        dom,
      },
      logs: {
        consoleErrors: [...state.consoleErrors],
        consoleWarnings: [...state.consoleWarnings],
        runtimeErrors: [...state.runtimeErrors],
        securityViolations: [...state.securityViolations],
      },
      events: [...state.events],
    };
  }

  async function nextPaint() {
    await Promise.race([
      new Promise(resolve => originalRAF(() => originalRAF(resolve))),
      new Promise(resolve => originalSetTimeout(resolve, 160)),
    ]);
  }

  function enterPassiveMode() {
    if (state.mode === 'passive') return;
    state.mode = 'passive';
    monitorActive = false;
    try { mutationObserver.disconnect(); } catch {
      // A detached document can already have discarded the observer.
    }
    while (intensiveRestores.length) {
      const restore = intensiveRestores.pop();
      try { restore(); } catch {
        // Restoration is best-effort for browser-native prototypes.
      }
    }
    post('mode', { mode: state.mode });
  }

  const api = {
    version: 'visualizer-audio-v1',
    get frame() {
      state.frameReads += 1;
      return currentFrame;
    },
    get viewport() {
      return viewport;
    },
    onFrame(callback) {
      if (typeof callback !== 'function') return () => {};
      state.listenerRegistrations += 1;
      state.activeListeners += 1;
      listeners.add(callback);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(callback);
        state.activeListeners = Math.max(0, state.activeListeners - 1);
      };
    },
  };
  Object.freeze(api);
  Object.defineProperty(window, 'VIZ', {
    value: api,
    configurable: false,
    writable: false,
  });

  bridgePort.addEventListener('message', async event => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'host-pause') {
      pauseGeneratedPlayback();
      return;
    }

    if (message.type === 'host-resume') {
      resumeGeneratedPlayback();
      return;
    }

    if (message.type === 'host-render-quality') {
      applyRenderQuality(message.quality, message.revision);
      return;
    }

    if (message.type === 'frame') {
      if (state.paused) return;
      state.hostFrames += 1;
      state.lastHostFrameAt = performance.now();
      currentFrame = message.frame;
      viewport = message.frame?.viewport || viewport;
      listeners.forEach(listener => {
        try {
          state.listenerCallbacks += 1;
          listener(currentFrame);
        } catch (error) {
          const text = compactText(error);
          recordList(state.runtimeErrors, text);
          recordEvent('fatal', 'VIZ_CALLBACK_ERROR', text);
        }
      });
      return;
    }

    if (message.type === 'probe') {
      await nextPaint();
      post('probe-result', { probeId: message.probeId, report: collectProbe(message.label || 'probe') });
      return;
    }

    if (message.type === 'mode' && message.mode === 'passive') {
      enterPassiveMode();
    }
  });

  addEventListener('error', event => {
    const text = String(event.error?.stack || event.message || 'Visualizer runtime error').slice(0, MAX_TEXT);
    recordList(state.runtimeErrors, text);
    recordEvent('fatal', 'RUNTIME_ERROR', text, {
      filename: String(event.filename || ''),
      line: event.lineno || 0,
      column: event.colno || 0,
    });
  });

  addEventListener('unhandledrejection', event => {
    const text = compactText(event.reason || 'Unhandled promise rejection').slice(0, MAX_TEXT);
    recordList(state.runtimeErrors, text);
    recordEvent('fatal', 'UNHANDLED_REJECTION', text);
  });

  addEventListener('securitypolicyviolation', event => {
    const item = {
      directive: event.violatedDirective,
      blockedURI: String(event.blockedURI || '').slice(0, 500),
    };
    recordList(state.securityViolations, item);
    recordEvent('warning', 'CSP_BLOCKED_RESOURCE', `${item.directive} blocked ${item.blockedURI || 'a resource'}.`, item);
  });

  let lastTrustedPointerMoveAt = 0;
  for (const name of ['pointermove', 'pointerdown', 'pointerup', 'pointerleave']) {
    addEventListener(name, event => {
      if (!event.isTrusted) return;
      const now = performance.now();
      if (name === 'pointermove' && now - lastTrustedPointerMoveAt < 80) return;
      if (name === 'pointermove') lastTrustedPointerMoveAt = now;
      post('pointer', {
        trustedActivity: true,
        pointer: {
          x: event.clientX / Math.max(1, innerWidth),
          y: event.clientY / Math.max(1, innerHeight),
          active: name !== 'pointerleave',
          down: name === 'pointerdown' || (name === 'pointermove' && event.buttons > 0),
        },
      });
    }, { passive: true, capture: true });
  }

  for (const [name, kind] of [['keydown', 'keyboard'], ['wheel', 'wheel'], ['touchstart', 'touch']]) {
    addEventListener(name, event => {
      if (!event.isTrusted) return;
      post('user-activity', { kind });
    }, { passive: name !== 'keydown', capture: true });
  }

  let lastMonitorAt = 0;
  let monitorActive = true;
  function monitor(timestamp) {
    if (lastMonitorAt) {
      const delta = timestamp - lastMonitorAt;
      state.monitorIntervals.push(delta);
      if (state.monitorIntervals.length > 180) state.monitorIntervals.shift();
      if (delta > 120) state.longFrames += 1;
      state.maxFrameGapMs = Math.max(state.maxFrameGapMs, delta);
    }
    lastMonitorAt = timestamp;
    state.monitorFrames += 1;
    state.lastActivityAt = performance.now();
    if (monitorActive) originalRAF(monitor);
  }
  originalRAF(monitor);

  originalSetInterval(() => {
    recheckObservedViewportCanvases();
    post('heartbeat', {
      heartbeat: {
        atMs: Math.round(performance.now() - state.startedAt),
        paused: state.paused,
        monitor: monitorSummary(),
        contextLosses: state.contextLosses.length,
        runtimeErrors: state.runtimeErrors.length,
      },
    });
  }, 1000);

  if (initialPaused) pauseGeneratedPlayback();

  addEventListener('DOMContentLoaded', () => {
    stabilizeViewportCanvases();
    originalSetTimeout(stabilizeViewportCanvases, 0);
    state.readyAt = performance.now();
    post('ready', {
      ready: {
        atMs: Math.round(state.readyAt - state.startedAt),
        viewport: { width: innerWidth, height: innerHeight, dpr: renderQuality.effectiveDpr },
      },
    });
  });

  // Preserve the originals in case a generated visualizer intentionally references them.
  void originalConsole;
}

function injectRuntime(html, sessionId, renderQuality, paused) {
  const parser = new DOMParser();
  const document = parser.parseFromString(String(html || ''), 'text/html');
  document.querySelectorAll('base').forEach(element => element.remove());
  document.querySelectorAll('meta[http-equiv]').forEach(element => {
    if (element.httpEquiv.toLowerCase() === 'content-security-policy') element.remove();
  });

  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = SANDBOX_CSP;
  const baseStyle = document.createElement('style');
  baseStyle.dataset.visualizerHostStyle = '';
  baseStyle.textContent = 'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}*{box-sizing:border-box}canvas[data-visualizer-host-viewport-canvas]{width:100vw!important;height:100vh!important}';
  const bridge = document.createElement('script');
  bridge.dataset.visualizerHostBridge = '';
  bridge.textContent = `;(${sandboxBootstrap.toString()})(${JSON.stringify(sessionId)},${JSON.stringify(renderQuality)},${JSON.stringify(Boolean(paused))});`.replace(/<\/script/gi, '<\\/script');
  document.head.prepend(meta, baseStyle, bridge);
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

export function validateVisualizerHtml(html) {
  const value = String(html || '').trim();
  const problems = [];
  if (value.length < 120) problems.push('The returned HTML is too short to be a visualizer.');
  if (value.length > 350000) problems.push('The returned HTML exceeds the 350 KB visualizer limit.');
  if (!/<(?:!doctype\s+html|html)[\s>]/i.test(value)) problems.push('Return one complete HTML document.');
  if (!/<\/html\s*>/i.test(value)) problems.push('The HTML document is incomplete because it has no closing </html> tag.');
  if (!/<body[\s>]/i.test(value)) problems.push('The HTML document has no <body> element.');
  if (!/<script[\s>]/i.test(value)) problems.push('The visualizer contains no executable script.');
  if (/\b(?:src|href)\s*=\s*["']https?:/i.test(value) || /url\(\s*["']?https?:/i.test(value)) {
    problems.push('External assets are unavailable; make the visualizer fully self-contained.');
  }
  return problems;
}

function abortError() {
  return new DOMException('Operation aborted.', 'AbortError');
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

function sandboxRenderQuality(value = {}) {
  const mode = ['full', 'balanced', 'saver'].includes(value.mode) ? value.mode : 'full';
  const fallback = mode === 'saver'
    ? { maxFps: 30, effectiveDpr: 1 }
    : mode === 'balanced'
      ? { maxFps: 45, effectiveDpr: 1.5 }
      : { maxFps: 60, effectiveDpr: 2 };
  const parsedNativeDpr = Number(value.nativeDpr ?? globalThis.devicePixelRatio);
  const nativeDpr = Number.isFinite(parsedNativeDpr) && parsedNativeDpr > 0 ? parsedNativeDpr : 1;
  const requestedDpr = Number(value.effectiveDpr) || fallback.effectiveDpr;
  return Object.freeze({
    schema: 'visualizer-render-quality-v1',
    mode,
    maxFps: Math.min(60, Math.max(15, Number(value.maxFps) || fallback.maxFps)),
    effectiveDpr: Math.min(nativeDpr, 2, Math.max(0.1, requestedDpr)),
    nativeDpr,
  });
}

export class VisualizerSandbox {
  constructor(iframe, onEvent = () => {}) {
    this.iframe = iframe;
    this.onEvent = onEvent;
    this.sessionId = '';
    this.ready = false;
    this.readyDetail = null;
    this.events = [];
    this.desiredPaused = false;
    this.paused = false;
    this.reportedPaused = false;
    this.playbackDetail = null;
    this.lastHeartbeatAt = 0;
    this.lastHeartbeat = null;
    this.pendingProbes = new Map();
    this.bridgePort = null;
    this.renderQuality = sandboxRenderQuality();
    this.renderQualityRevision = 0;
    this.appliedRenderQuality = null;
    this.bridgeMessageHandler = event => {
      const message = event.data;
      if (!message || typeof message.type !== 'string') return;
      if (message.type === 'ready') {
        this.ready = true;
        this.readyDetail = message.ready || null;
      }
      if (message.type === 'heartbeat') {
        this.lastHeartbeatAt = performance.now();
        this.lastHeartbeat = message.heartbeat || null;
      }
      if (message.type === 'playback-state') {
        this.paused = Boolean(message.playback?.paused);
        this.reportedPaused = this.paused;
        this.playbackDetail = message.playback || null;
      }
      if (message.type === 'render-quality-applied') {
        this.appliedRenderQuality = message.quality || null;
      }
      if (message.type === 'diagnostic-event' && message.event) {
        this.events.push(message.event);
        if (this.events.length > 120) this.events.splice(0, this.events.length - 120);
      }
      if (message.type === 'probe-result') {
        const pending = this.pendingProbes.get(message.probeId);
        if (pending) {
          this.pendingProbes.delete(message.probeId);
          pending.resolve(message.report);
        }
      }
      this.onEvent(message);
    };
    this.messageHandler = event => {
      if (event.source !== this.iframe.contentWindow || this.bridgePort) return;
      const message = event.data;
      const port = event.ports?.[0];
      if (!message || message.channel !== BRIDGE_INIT_CHANNEL || message.sessionId !== this.sessionId || !port) return;
      this.bridgePort = port;
      port.addEventListener('message', this.bridgeMessageHandler);
      port.start();
      this.sendHost({
        type: 'host-render-quality',
        quality: this.renderQuality,
        revision: this.renderQualityRevision,
      });
      this.sendHost({ type: this.desiredPaused ? 'host-pause' : 'host-resume' });
    };
    window.addEventListener('message', this.messageHandler);
  }

  sendHost(message) {
    if (!this.bridgePort) return false;
    try {
      this.bridgePort.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  closeBridge() {
    if (!this.bridgePort) return;
    this.bridgePort.removeEventListener('message', this.bridgeMessageHandler);
    this.bridgePort.close();
    this.bridgePort = null;
  }

  setPresentation(state) {
    this.iframe.dataset.slotState = state;
    const active = state === 'active' || state === 'promoting';
    this.iframe.setAttribute('aria-hidden', String(!active));
    this.iframe.tabIndex = active ? 0 : -1;
    this.iframe.title = active ? 'Generated audio visualizer' : 'Visualizer candidate sandbox';
  }

  setViewport({ width, height }) {
    const safeWidth = Math.max(1, Math.round(width || 1));
    const safeHeight = Math.max(1, Math.round(height || 1));
    this.iframe.style.setProperty('--candidate-width', `${safeWidth}px`);
    this.iframe.style.setProperty('--candidate-height', `${safeHeight}px`);
  }

  setRenderQuality(value) {
    const next = sandboxRenderQuality(value);
    const changed = !this.renderQuality
      || this.renderQuality.mode !== next.mode
      || this.renderQuality.maxFps !== next.maxFps
      || this.renderQuality.effectiveDpr !== next.effectiveDpr;
    this.renderQuality = next;
    if (!changed) return false;
    this.renderQualityRevision += 1;
    this.sendHost({
      type: 'host-render-quality',
      quality: next,
      revision: this.renderQualityRevision,
    });
    return true;
  }

  async load(html, {
    viewport = { width: 640, height: 360 },
    readyTimeoutMs = 3500,
    signal,
  } = {}) {
    if (signal?.aborted) throw abortError();
    this.closeBridge();
    this.sessionId = crypto.randomUUID();
    this.ready = false;
    this.readyDetail = null;
    this.events = [];
    this.paused = this.desiredPaused;
    this.reportedPaused = false;
    this.playbackDetail = null;
    this.lastHeartbeatAt = performance.now();
    this.lastHeartbeat = null;
    for (const pending of this.pendingProbes.values()) pending.reject(new Error('Sandbox was reloaded.'));
    this.pendingProbes.clear();
    this.setViewport(viewport);
    this.iframe.srcdoc = injectRuntime(html, this.sessionId, this.renderQuality, this.desiredPaused);

    const started = performance.now();
    while (!this.ready && performance.now() - started < readyTimeoutMs) {
      if (signal?.aborted) throw abortError();
      await wait(40, signal);
      if (this.fatalEvents().length) break;
    }

    return {
      ready: this.ready,
      readyDetail: this.readyDetail,
      events: [...this.events],
      fatalEvents: this.fatalEvents(),
      durationMs: Math.round(performance.now() - started),
    };
  }

  sendFrame(frame) {
    this.sendHost({
      type: 'frame',
      frame,
    });
  }

  setPaused(paused) {
    const next = Boolean(paused);
    if (this.desiredPaused === next) return false;
    this.desiredPaused = next;
    this.paused = next;
    this.sendHost({ type: next ? 'host-pause' : 'host-resume' });
    return true;
  }

  isPaused() {
    return this.desiredPaused;
  }

  async waitForPlayback(paused, timeoutMs = 320) {
    const expected = Boolean(paused);
    const started = performance.now();
    while (this.reportedPaused !== expected && performance.now() - started < timeoutMs) {
      await wait(10);
    }
    return this.reportedPaused === expected;
  }

  async probe(label = 'probe', { timeoutMs = 2200, signal } = {}) {
    if (!this.sessionId || !this.bridgePort) throw new Error('Sandbox bridge is not ready.');
    if (signal?.aborted) throw abortError();
    const probeId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingProbes.delete(probeId);
        reject(new Error(`Visualizer probe "${label}" timed out.`));
      }, timeoutMs);
      const finishResolve = report => {
        clearTimeout(timer);
        resolve(report);
      };
      const finishReject = error => {
        clearTimeout(timer);
        reject(error);
      };
      this.pendingProbes.set(probeId, { resolve: finishResolve, reject: finishReject });
      signal?.addEventListener('abort', () => {
        this.pendingProbes.delete(probeId);
        finishReject(abortError());
      }, { once: true });
      this.sendHost({
        type: 'probe',
        probeId,
        label,
      });
    });
  }

  enterPassiveMode() {
    this.sendHost({
      type: 'mode',
      mode: 'passive',
    });
  }

  fatalEvents(since = 0) {
    return this.events.slice(since).filter(event => event.severity === 'fatal');
  }

  heartbeatAgeMs() {
    return performance.now() - this.lastHeartbeatAt;
  }

  heartbeatSnapshot() {
    return Object.freeze({
      sessionId: this.sessionId,
      receivedAt: Number.isFinite(this.lastHeartbeatAt) ? this.lastHeartbeatAt : null,
      sandboxAtMs: Number.isFinite(Number(this.lastHeartbeat?.atMs)) ? Number(this.lastHeartbeat.atMs) : null,
      ageMs: Math.max(0, this.heartbeatAgeMs()),
    });
  }

  clear() {
    this.closeBridge();
    this.sessionId = '';
    this.ready = false;
    this.events = [];
    this.desiredPaused = false;
    this.paused = false;
    this.reportedPaused = false;
    this.playbackDetail = null;
    this.iframe.srcdoc = '<!doctype html><html><body style="margin:0;background:#050506"></body></html>';
  }

  destroy() {
    window.removeEventListener('message', this.messageHandler);
    for (const pending of this.pendingProbes.values()) pending.reject(new Error('Sandbox destroyed.'));
    this.pendingProbes.clear();
    this.clear();
  }
}
