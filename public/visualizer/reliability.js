export const RELIABILITY_SCHEMA = 'dream-reliability-v2';
export const HEARTBEAT_STALE_MS = 4200;
export const STALL_CONFIRM_TIMEOUT_MS = 2600;
export const STALL_RETRY_TIMEOUT_MS = 900;

export const FAILURE_CODES = Object.freeze({
  INVALID_HTML: 'INVALID_HTML',
  BOOT_TIMEOUT: 'BOOT_TIMEOUT',
  RUNTIME_ERROR: 'RUNTIME_ERROR',
  VIZ_CALLBACK_ERROR: 'VIZ_CALLBACK_ERROR',
  RENDER_CONTEXT_FAILED: 'RENDER_CONTEXT_FAILED',
  SHADER_COMPILE_FAILED: 'SHADER_COMPILE_FAILED',
  PROGRAM_LINK_FAILED: 'PROGRAM_LINK_FAILED',
  NO_VISIBLE_OUTPUT: 'NO_VISIBLE_OUTPUT',
  VIZ_NOT_CONSUMED: 'VIZ_NOT_CONSUMED',
  RUNTIME_STALLED: 'RUNTIME_STALLED',
  WEBGL_CONTEXT_LOST: 'WEBGL_CONTEXT_LOST',
  PERFORMANCE_COLLAPSE: 'PERFORMANCE_COLLAPSE',
  PROBE_FAILED: 'PROBE_FAILED',
});

export class DreamReliabilityError extends Error {
  constructor(failure, report = null) {
    super(failure?.message || 'Dream reliability check failed.');
    this.name = 'DreamReliabilityError';
    this.code = failure?.code || FAILURE_CODES.RUNTIME_ERROR;
    this.failure = failure;
    this.report = report;
  }
}

function nowIso() {
  return new Date().toISOString();
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

function heartbeatSnapshot(sandbox) {
  if (typeof sandbox?.heartbeatSnapshot === 'function') return sandbox.heartbeatSnapshot();
  return {
    sessionId: String(sandbox?.sessionId || ''),
    receivedAt: null,
    sandboxAtMs: null,
    ageMs: Math.max(0, Number(sandbox?.heartbeatAgeMs?.()) || 0),
  };
}

function heartbeatAdvanced(start, end) {
  return (Number.isFinite(start?.receivedAt) && Number.isFinite(end?.receivedAt) && end.receivedAt > start.receivedAt)
    || (Number.isFinite(start?.sandboxAtMs) && Number.isFinite(end?.sandboxAtMs) && end.sandboxAtMs > start.sandboxAtMs);
}

export function activeStallConfirmationDecision({
  heartbeat,
  previousConfirmation = null,
  now = performance.now(),
  staleAfterMs = 8000,
} = {}) {
  const stale = Number(heartbeat?.ageMs) > staleAfterMs;
  const sameSession = Boolean(previousConfirmation?.sessionId)
    && previousConfirmation.sessionId === heartbeat?.sessionId;
  const distinctHeartbeatEpoch = sameSession
    && heartbeatAdvanced(previousConfirmation.heartbeat, heartbeat);
  const coolingDown = sameSession
    && !distinctHeartbeatEpoch
    && Number(now) < Number(previousConfirmation.recheckAt || 0);
  return Object.freeze({
    stale,
    due: stale && !coolingDown,
    distinctHeartbeatEpoch,
    coolingDown,
  });
}

function boundedProbeError(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 80),
    message: String(error?.message || 'Visualizer probe failed.').slice(0, 500),
  };
}

export async function confirmSandboxLiveness(sandbox, {
  label = 'runtime-stall-confirmation',
  staleAfterMs = HEARTBEAT_STALE_MS,
  timeoutMs = STALL_CONFIRM_TIMEOUT_MS,
  retryTimeoutMs = STALL_RETRY_TIMEOUT_MS,
  signal,
  fatalSince = 0,
} = {}) {
  if (signal?.aborted) throw abortError();
  const startedAt = performance.now();
  const start = heartbeatSnapshot(sandbox);
  const initialStale = start.ageMs > staleAfterMs;
  const initialFatal = sandbox.fatalEvents?.(fatalSince)?.[0] || null;
  const probeEvidence = { attempted: !initialFatal, responded: false, attempts: initialFatal ? 0 : 1, durationMs: 0, error: null };
  if (initialFatal) {
    return {
      status: 'fatal',
      fatal: initialFatal,
      report: null,
      evidence: {
        initialStale,
        heartbeat: { start, end: start, advanced: false },
        probe: probeEvidence,
        outcome: 'fatal',
      },
    };
  }
  let report = null;
  try {
    report = await sandbox.probe(label, { signal, timeoutMs });
    probeEvidence.responded = true;
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    probeEvidence.error = boundedProbeError(error);
  }
  let fatal = sandbox.fatalEvents?.(fatalSince)?.[0] || null;
  let end = heartbeatSnapshot(sandbox);
  let advanced = heartbeatAdvanced(start, end);

  if (!probeEvidence.responded && !fatal && advanced && end.ageMs <= staleAfterMs) {
    probeEvidence.attempts = 2;
    try {
      report = await sandbox.probe(`${label}-retry`, { signal, timeoutMs: retryTimeoutMs });
      probeEvidence.responded = true;
      probeEvidence.error = null;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      probeEvidence.error = boundedProbeError(error);
    }
    fatal = sandbox.fatalEvents?.(fatalSince)?.[0] || null;
    end = heartbeatSnapshot(sandbox);
    advanced = heartbeatAdvanced(start, end);
  }

  probeEvidence.durationMs = Math.max(0, Math.round(performance.now() - startedAt));
  const evidence = {
    initialStale,
    heartbeat: { start, end, advanced },
    probe: probeEvidence,
    recoverySignal: probeEvidence.responded ? (advanced ? 'heartbeat-and-probe' : 'probe') : null,
  };
  if (fatal) {
    evidence.outcome = 'fatal';
    return { status: 'fatal', fatal, report, evidence };
  }
  if (probeEvidence.responded) {
    evidence.outcome = initialStale ? 'recovered' : 'responsive';
    return { status: evidence.outcome, report, evidence };
  }
  if (!advanced && end.ageMs > staleAfterMs) {
    evidence.outcome = 'stalled';
    return { status: 'stalled', report: null, evidence };
  }
  evidence.outcome = 'probe-failed';
  return { status: 'probe-failed', report: null, evidence };
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function spectrumAt(index, frameIndex, profile) {
  const x = index / 95;
  const bassPeak = Math.exp(-Math.pow((x - 0.08) * 14, 2));
  const midPeak = Math.exp(-Math.pow((x - 0.38) * 9, 2));
  const highPeak = Math.exp(-Math.pow((x - 0.78) * 12, 2));
  const ripple = 0.08 * (Math.sin(index * 0.37 + frameIndex * 0.21) + 1);
  return clamp(
    profile.subBass * bassPeak
      + profile.mid * midPeak
      + profile.treble * highPeak
      + ripple,
  );
}

function waveformAt(index, frameIndex, profile) {
  const x = index / 127;
  const phase = frameIndex * 0.12;
  const fundamental = Math.sin(x * Math.PI * 2 * 2 + phase) * (0.12 + profile.bass * 0.42);
  const harmonic = Math.sin(x * Math.PI * 2 * 7 - phase * 1.7) * (0.04 + profile.treble * 0.18);
  return clamp(fundamental + harmonic, -1, 1);
}

function probeProfile(progress) {
  if (progress < 0.16) {
    return { volume: 0.03, peak: 0.05, transient: 0, beat: 0, subBass: 0.02, bass: 0.03, lowMid: 0.03, mid: 0.02, highMid: 0.02, treble: 0.02, flux: 0.01, centroid: 0.18, balance: 0, width: 0.35, tempo: 0, confidence: 0 };
  }
  if (progress < 0.36) {
    return { volume: 0.72, peak: 0.91, transient: 0.82, beat: 1, subBass: 0.94, bass: 0.86, lowMid: 0.42, mid: 0.18, highMid: 0.12, treble: 0.08, flux: 0.62, centroid: 0.25, balance: -0.35, width: 0.62, tempo: 124, confidence: 0.88 };
  }
  if (progress < 0.58) {
    return { volume: 0.46, peak: 0.57, transient: 0.12, beat: 0, subBass: 0.18, bass: 0.24, lowMid: 0.48, mid: 0.76, highMid: 0.68, treble: 0.32, flux: 0.3, centroid: 0.52, balance: 0.05, width: 0.78, tempo: 124, confidence: 0.82 };
  }
  if (progress < 0.78) {
    return { volume: 0.6, peak: 0.76, transient: 0.58, beat: 0.45, subBass: 0.12, bass: 0.2, lowMid: 0.3, mid: 0.48, highMid: 0.81, treble: 0.96, flux: 0.88, centroid: 0.82, balance: 0.42, width: 0.9, tempo: 156, confidence: 0.72 };
  }
  return { volume: 0.34, peak: 0.42, transient: 0.08, beat: 0, subBass: 0.28, bass: 0.38, lowMid: 0.44, mid: 0.4, highMid: 0.34, treble: 0.28, flux: 0.18, centroid: 0.46, balance: 0.2 * Math.sin(progress * 18), width: 0.7, tempo: 112, confidence: 0.56 };
}

export function createSyntheticFrame(frameIndex, elapsedMs, viewport) {
  const cycleMs = 1200;
  const progress = (elapsedMs % cycleMs) / cycleMs;
  const profile = probeProfile(progress);
  return {
    version: 'visualizer-audio-v1',
    time: elapsedMs / 1000,
    deltaTime: 1 / 60,
    audio: {
      connected: true,
      silence: false,
      volume: profile.volume,
      peak: profile.peak,
      transient: profile.transient,
      beat: profile.beat,
      tempo: profile.tempo,
      tempoConfidence: profile.confidence,
      spectralFlux: profile.flux,
      spectralCentroid: profile.centroid,
      bands: {
        subBass: profile.subBass,
        bass: profile.bass,
        lowMid: profile.lowMid,
        mid: profile.mid,
        highMid: profile.highMid,
        treble: profile.treble,
      },
      stereo: { balance: profile.balance, width: profile.width },
      waveform: Array.from({ length: 128 }, (_value, index) => waveformAt(index, frameIndex, profile)),
      spectrum: Array.from({ length: 96 }, (_value, index) => spectrumAt(index, frameIndex, profile)),
    },
    pointer: {
      x: 0.5 + Math.sin(elapsedMs / 430) * 0.23,
      y: 0.5 + Math.cos(elapsedMs / 570) * 0.18,
      active: progress > 0.5,
      down: progress > 0.69 && progress < 0.73,
    },
    viewport: {
      width: Math.max(1, Math.round(viewport.width)),
      height: Math.max(1, Math.round(viewport.height)),
      dpr: Math.max(1, Number(viewport.dpr) || 1),
    },
  };
}

async function stimulate(sandbox, viewport, {
  durationMs = 1200,
  signal,
  onFrame,
} = {}) {
  const started = performance.now();
  let frameIndex = 0;
  while (performance.now() - started < durationMs) {
    if (signal?.aborted) throw abortError();
    const elapsed = performance.now() - started;
    const frame = createSyntheticFrame(frameIndex, elapsed, viewport);
    sandbox.sendFrame(frame);
    onFrame?.(frameIndex, frame);
    frameIndex += 1;
    await wait(16, signal);
  }
  return { frames: frameIndex, durationMs: Math.round(performance.now() - started) };
}

function rendererTotals(report) {
  const canvases = report?.visual?.canvases || [];
  return canvases.reduce((totals, canvas) => {
    const activity = canvas.activity || {};
    totals.paintOps += Number(activity.paintOps || 0);
    totals.clearOps += Number(activity.clearOps || 0);
    totals.drawCalls += Number(activity.drawCalls || 0);
    totals.shadersCompiled += Number(activity.shadersCompiled || 0);
    totals.programsLinked += Number(activity.programsLinked || 0);
    totals.submits += Number(activity.submits || 0);
    return totals;
  }, { paintOps: 0, clearOps: 0, drawCalls: 0, shadersCompiled: 0, programsLinked: 0, submits: 0 });
}

function fingerprint(report) {
  const canvas = (report?.visual?.canvases || [])
    .map(item => `${item.pixel?.hash || 0}:${item.pixel?.uniqueBuckets || 0}:${item.activity?.paintOps || 0}:${item.activity?.drawCalls || 0}:${item.activity?.submits || 0}`)
    .join('|');
  const dom = report?.visual?.dom;
  return `${canvas}::${dom?.styleHash || 0}:${dom?.meaningfulNodes || 0}:${dom?.animations || 0}`;
}


function currentVisualSignal(report) {
  const canvases = report?.visual?.canvases || [];
  const dominant = canvases[0] || null;
  const canvasSignal = canvases.some(canvas => Boolean(canvas.pixel?.informative));
  const domSignal = Boolean(report?.visual?.dom?.visible);
  if (dominant?.coverage >= 0.45) {
    if (dominant.pixel?.sampled) return Boolean(dominant.pixel.informative);
    return Boolean(dominant.successfulActivity);
  }
  return canvasSignal || domSignal;
}

function firstFatal(report) {
  return (report?.events || []).find(event => event.severity === 'fatal') || null;
}

function makeFailure(code, message, detail = {}) {
  return { code, message, detail };
}

function evaluateProbe(report, {
  requireViz = true,
  previous = null,
  stage = 'preflight',
} = {}) {
  const warnings = [];
  const totals = rendererTotals(report);
  const fatal = firstFatal(report);
  if (fatal) {
    const code = FAILURE_CODES[fatal.code] || fatal.code || FAILURE_CODES.RUNTIME_ERROR;
    return {
      passed: false,
      failure: makeFailure(code, fatal.message || 'The visualizer raised a fatal runtime error.', fatal),
      warnings,
      changed: previous ? fingerprint(previous) !== fingerprint(report) : null,
      totals,
    };
  }

  const contextLoss = (report?.renderer?.contextLosses || []).find(item => !item.restored);
  if (contextLoss && (!report?.visual?.visibleProof || report?.visual?.dominantCanvasFailed)) {
    return {
      passed: false,
      failure: makeFailure(FAILURE_CODES.WEBGL_CONTEXT_LOST, 'The visualizer lost its WebGL context and did not establish a working visual fallback.', contextLoss),
      warnings,
      changed: previous ? fingerprint(previous) !== fingerprint(report) : null,
      totals,
    };
  }
  if (contextLoss) {
    warnings.push({ code: 'CONTEXT_LOSS_WITH_FALLBACK', message: 'A WebGL context was lost, but another visible renderer/fallback remained healthy.' });
  }

  const contextFailures = report?.renderer?.contextFailures || [];
  const rendererTypes = report?.renderer?.types || [];
  if (contextFailures.length && !rendererTypes.length && !report?.visual?.visibleProof) {
    return {
      passed: false,
      failure: makeFailure(FAILURE_CODES.RENDER_CONTEXT_FAILED, contextFailures[0].message || 'The requested rendering context is unavailable.', contextFailures[0]),
      warnings,
      changed: previous ? fingerprint(previous) !== fingerprint(report) : null,
      totals,
    };
  }

  const shaderFailures = report?.renderer?.shaderFailures || [];
  if (shaderFailures.length && totals.programsLinked === 0 && !report?.visual?.visibleProof) {
    return {
      passed: false,
      failure: makeFailure(FAILURE_CODES.SHADER_COMPILE_FAILED, shaderFailures[0].log || 'A WebGL shader failed to compile.', shaderFailures[0]),
      warnings,
      changed: previous ? fingerprint(previous) !== fingerprint(report) : null,
      totals,
    };
  }

  const programFailures = report?.renderer?.programFailures || [];
  if (programFailures.length && totals.drawCalls === 0 && !report?.visual?.visibleProof) {
    return {
      passed: false,
      failure: makeFailure(FAILURE_CODES.PROGRAM_LINK_FAILED, programFailures[0].log || 'A WebGL program failed to link.', programFailures[0]),
      warnings,
      changed: previous ? fingerprint(previous) !== fingerprint(report) : null,
      totals,
    };
  }

  if (!report?.visual?.visibleProof) {
    const dominant = report?.visual?.canvases?.[0];
    return {
      passed: false,
      failure: makeFailure(
        FAILURE_CODES.NO_VISIBLE_OUTPUT,
        dominant?.coverage >= 0.45
          ? 'The page loaded, but its dominant canvas produced no credible visible output.'
          : 'The page loaded, but the harness found no credible visible output.',
        {
          dominantCanvas: dominant || null,
          dom: report?.visual?.dom || null,
          rendererTypes,
        },
      ),
      warnings,
      changed: previous ? fingerprint(previous) !== fingerprint(report) : null,
      totals,
    };
  }

  if (requireViz && !report?.viz?.consumed) {
    return {
      passed: false,
      failure: makeFailure(
        FAILURE_CODES.VIZ_NOT_CONSUMED,
        'The artwork rendered, but it never read VIZ.frame or subscribed with VIZ.onFrame, so audio responsiveness is unproven.',
        report?.viz || {},
      ),
      warnings,
      changed: previous ? fingerprint(previous) !== fingerprint(report) : null,
      totals,
    };
  }

  if (contextFailures.length && report?.visual?.visibleProof) {
    warnings.push({ code: 'RENDERER_FALLBACK_USED', message: 'A requested canvas context was unavailable, but a visible fallback remained healthy.' });
  }
  if (shaderFailures.length && totals.programsLinked === 0 && report?.visual?.visibleProof) {
    warnings.push({ code: 'SHADER_FAILURE_WITH_FALLBACK', message: 'A shader failed, but non-WebGL fallback output remained visible.' });
  }
  if (programFailures.length && totals.drawCalls === 0 && report?.visual?.visibleProof) {
    warnings.push({ code: 'PROGRAM_FAILURE_WITH_FALLBACK', message: 'A WebGL program failed, but fallback output remained visible.' });
  }

  const monitor = report?.runtime?.monitor || {};
  if (monitor.approximateFps > 0 && monitor.approximateFps < 22) {
    warnings.push({
      code: 'HEAVY_RENDERER',
      message: `The visualizer remained alive but the browser monitor averaged about ${Math.round(monitor.approximateFps)} FPS during ${stage}.`,
    });
  }
  if ((report?.logs?.consoleErrors || []).length) {
    warnings.push({
      code: 'CONSOLE_ERRORS_RECORDED',
      message: 'The visualizer logged console errors even though it continued rendering.',
      count: report.logs.consoleErrors.length,
    });
  }
  if ((report?.renderer?.shaderFailures || []).length && totals.programsLinked > 0) {
    warnings.push({
      code: 'SHADER_FALLBACK_USED',
      message: 'At least one shader failed, but another program linked and rendered successfully.',
    });
  }

  const changed = previous ? fingerprint(previous) !== fingerprint(report) : null;
  if (previous && !changed) {
    warnings.push({
      code: 'NO_OBVIOUS_STIMULUS_DELTA',
      message: 'The harness did not observe an obvious visual fingerprint change during synthetic music. This is diagnostic only; subtle interpretations are allowed.',
    });
  }

  return { passed: true, failure: null, warnings, changed, totals };
}

function environmentSummary() {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemory: navigator.deviceMemory || null,
    webgpu: Boolean(navigator.gpu),
    crossOriginIsolated: Boolean(crossOriginIsolated),
    capturedAt: nowIso(),
  };
}

function repairMessage(failure, report) {
  const renderer = report?.renderer || {};
  const dominant = report?.visual?.canvases?.[0] || null;
  const lines = [
    `Failure code: ${failure.code}`,
    failure.message,
    `Viewport: ${report?.viewport?.width || '?'} x ${report?.viewport?.height || '?'} at DPR ${report?.viewport?.dpr || '?'}`,
    `Renderer types observed: ${(renderer.types || []).join(', ') || 'none'}`,
    `VIZ host frames: ${report?.viz?.hostFrames || 0}; frame reads: ${report?.viz?.frameReads || 0}; listener registrations: ${report?.viz?.listenerRegistrations || 0}`,
  ];
  if (dominant) {
    lines.push(`Dominant canvas: ${dominant.width} x ${dominant.height}, backing ${dominant.backingWidth} x ${dominant.backingHeight}, coverage ${(dominant.coverage * 100).toFixed(1)}%`);
    lines.push(`Canvas activity: ${dominant.activity?.type || 'unknown'}, ${dominant.activity?.drawCalls || 0} WebGL draws, ${dominant.activity?.paintOps || 0} Canvas2D paint calls, ${dominant.activity?.programsLinked || 0} linked programs`);
    lines.push(`Pixel probe: sampled=${Boolean(dominant.pixel?.sampled)}, uniqueBuckets=${dominant.pixel?.uniqueBuckets || 0}, nonBlackRatio=${Number(dominant.pixel?.nonBlackRatio || 0).toFixed(4)}, variance=${Number(dominant.pixel?.luminanceVariance || 0).toFixed(3)}`);
  }
  const shaderLog = renderer.shaderFailures?.[0]?.log;
  const programLog = renderer.programFailures?.[0]?.log;
  const runtimeError = report?.logs?.runtimeErrors?.[0];
  const consoleError = report?.logs?.consoleErrors?.[0];
  if (shaderLog) lines.push(`Shader compiler: ${shaderLog}`);
  if (programLog) lines.push(`Program linker: ${programLog}`);
  if (runtimeError) lines.push(`Runtime error: ${runtimeError}`);
  if (consoleError) lines.push(`Console error: ${consoleError}`);
  lines.push('Preserve the artistic concept. Fix the engineering failure instead of simplifying the artwork unless a resilient fallback is genuinely required.');
  return lines.join('\n').slice(0, 7000);
}

function failedReport({ startedAt, stages, failure, warnings = [], report = null }) {
  return {
    schema: RELIABILITY_SCHEMA,
    passed: false,
    startedAt,
    finishedAt: nowIso(),
    durationMs: Date.now() - Date.parse(startedAt),
    environment: environmentSummary(),
    stages,
    warnings,
    failure,
    repairProblem: repairMessage(failure, report),
  };
}

export class DreamReliabilityHarness {
  constructor({ sandbox, onStage = () => {} } = {}) {
    if (!sandbox) throw new TypeError('DreamReliabilityHarness requires a VisualizerSandbox.');
    this.sandbox = sandbox;
    this.onStage = onStage;
  }

  stage(name, detail = {}) {
    this.onStage({ name, at: nowIso(), ...detail });
  }

  async preflight(html, {
    viewport,
    signal,
    fastViewport = { width: 640, height: 360, dpr: Math.min(devicePixelRatio || 1, 2) },
  } = {}) {
    const startedAt = nowIso();
    const stages = [];
    const allWarnings = [];
    const actualViewport = {
      width: Math.max(1, Math.round(viewport?.width || innerWidth)),
      height: Math.max(1, Math.round(viewport?.height || innerHeight)),
      dpr: Math.max(1, Number(viewport?.dpr || devicePixelRatio || 1)),
    };

    this.sandbox.setPresentation('standby');
    this.stage('booting', { viewport: fastViewport });
    const boot = await this.sandbox.load(html, { viewport: fastViewport, signal });
    stages.push({ name: 'boot', ...boot });
    if (!boot.ready) {
      const fatal = boot.fatalEvents?.[0];
      const failure = fatal
        ? makeFailure(FAILURE_CODES[fatal.code] || fatal.code || FAILURE_CODES.RUNTIME_ERROR, fatal.message, fatal)
        : makeFailure(FAILURE_CODES.BOOT_TIMEOUT, 'The visualizer did not finish booting inside the isolated sandbox.', { durationMs: boot.durationMs });
      return failedReport({ startedAt, stages, failure, report: null });
    }

    this.stage('probing-baseline');
    let baseline;
    try {
      await wait(140, signal);
      baseline = await this.sandbox.probe('baseline', { signal });
      stages.push({ name: 'baseline', report: baseline });
    } catch (error) {
      const failure = makeFailure(FAILURE_CODES.PROBE_FAILED, error.message || 'The baseline visual probe failed.');
      return failedReport({ startedAt, stages, failure, report: null });
    }

    this.stage('stimulating', { viewport: fastViewport });
    const stimulation = await stimulate(this.sandbox, fastViewport, { durationMs: 1250, signal });
    stages.push({ name: 'stimulation', ...stimulation });

    this.stage('proving-visible-output');
    const stimulated = await this.sandbox.probe('after-synthetic-music', { signal });
    const stimulatedEvaluation = evaluateProbe(stimulated, { requireViz: true, previous: baseline, stage: 'synthetic-music' });
    stages.push({ name: 'synthetic-proof', report: stimulated, evaluation: stimulatedEvaluation });
    allWarnings.push(...stimulatedEvaluation.warnings);
    if (!stimulatedEvaluation.passed) {
      return failedReport({
        startedAt,
        stages,
        failure: stimulatedEvaluation.failure,
        warnings: allWarnings,
        report: stimulated,
      });
    }

    this.stage('canary-viewport', { viewport: actualViewport });
    this.sandbox.setViewport(actualViewport);
    await stimulate(this.sandbox, actualViewport, { durationMs: 720, signal });
    const canary = await this.sandbox.probe('actual-viewport-canary', { signal, timeoutMs: 2800 });
    const canaryEvaluation = evaluateProbe(canary, { requireViz: true, previous: stimulated, stage: 'actual-viewport' });
    stages.push({ name: 'viewport-canary', report: canary, evaluation: canaryEvaluation });
    allWarnings.push(...canaryEvaluation.warnings);
    if (!canaryEvaluation.passed) {
      return failedReport({
        startedAt,
        stages,
        failure: canaryEvaluation.failure,
        warnings: allWarnings,
        report: canary,
      });
    }

    return {
      schema: RELIABILITY_SCHEMA,
      passed: true,
      startedAt,
      finishedAt: nowIso(),
      durationMs: Date.now() - Date.parse(startedAt),
      environment: environmentSummary(),
      stages,
      warnings: allWarnings,
      failure: null,
      repairProblem: '',
      summary: {
        rendererTypes: canary.renderer?.types || [],
        visible: Boolean(canary.visual?.visibleProof),
        vizConsumed: Boolean(canary.viz?.consumed),
        visualChangedUnderProbe: Boolean(stimulatedEvaluation.changed || canaryEvaluation.changed),
        approximateFps: Math.round(canary.runtime?.monitor?.approximateFps || 0),
        heavy: allWarnings.some(warning => warning.code === 'HEAVY_RENDERER'),
      },
    };
  }

  async reopen(html, {
    viewport,
    signal,
    stimulationMs = 520,
  } = {}) {
    const startedAt = nowIso();
    const stages = [];
    const actualViewport = {
      width: Math.max(1, Math.round(viewport?.width || innerWidth)),
      height: Math.max(1, Math.round(viewport?.height || innerHeight)),
      dpr: Math.max(1, Number(viewport?.dpr || devicePixelRatio || 1)),
    };
    this.sandbox.setPresentation('standby');
    this.stage('reopening', { viewport: actualViewport });
    const boot = await this.sandbox.load(html, { viewport: actualViewport, signal });
    stages.push({ name: 'reopen-boot', ...boot });
    if (!boot.ready) {
      const fatal = boot.fatalEvents?.[0];
      const failure = fatal
        ? makeFailure(FAILURE_CODES[fatal.code] || fatal.code || FAILURE_CODES.RUNTIME_ERROR, fatal.message, fatal)
        : makeFailure(FAILURE_CODES.BOOT_TIMEOUT, 'The saved Dream did not finish booting inside the isolated sandbox.', { durationMs: boot.durationMs });
      return failedReport({ startedAt, stages, failure, report: null });
    }

    await wait(90, signal);
    const baseline = await this.sandbox.probe('reopen-baseline', { signal, timeoutMs: 2200 });
    stages.push({ name: 'reopen-baseline', report: baseline });
    const stimulation = await stimulate(this.sandbox, actualViewport, { durationMs: stimulationMs, signal });
    stages.push({ name: 'reopen-stimulation', ...stimulation });
    const report = await this.sandbox.probe('reopen-proof', { signal, timeoutMs: 2400 });
    const evaluation = evaluateProbe(report, { requireViz: true, previous: baseline, stage: 'safe-reopen' });
    stages.push({ name: 'reopen-proof', report, evaluation });
    if (!evaluation.passed) {
      return failedReport({
        startedAt,
        stages,
        failure: evaluation.failure,
        warnings: evaluation.warnings,
        report,
      });
    }

    return {
      schema: RELIABILITY_SCHEMA,
      passed: true,
      startedAt,
      finishedAt: nowIso(),
      durationMs: Date.now() - Date.parse(startedAt),
      environment: environmentSummary(),
      stages,
      warnings: evaluation.warnings,
      failure: null,
      repairProblem: '',
      summary: {
        rendererTypes: report.renderer?.types || [],
        visible: Boolean(report.visual?.visibleProof),
        vizConsumed: Boolean(report.viz?.consumed),
        visualChangedUnderProbe: Boolean(evaluation.changed),
        approximateFps: Math.round(report.runtime?.monitor?.approximateFps || 0),
        heavy: evaluation.warnings.some(warning => warning.code === 'HEAVY_RENDERER'),
        quickReopen: true,
      },
    };
  }

  async watchdog({ durationMs = 3600, signal } = {}) {
    const startedAt = nowIso();
    const eventStart = this.sandbox.events.length;
    let before = null;
    try {
      before = await this.sandbox.probe('post-launch-start', { signal, timeoutMs: 2200 });
    } catch {
      // The final probe below remains authoritative if the initial sample is unavailable.
    }

    this.stage('post-launch-watchdog', { durationMs });
    await wait(durationMs, signal);

    const newFatal = this.sandbox.fatalEvents(eventStart)[0];
    if (newFatal) {
      const failure = makeFailure(FAILURE_CODES[newFatal.code] || newFatal.code || FAILURE_CODES.RUNTIME_ERROR, newFatal.message, newFatal);
      return failedReport({ startedAt, stages: [{ name: 'watchdog', before, event: newFatal }], failure, report: before });
    }

    const liveness = await confirmSandboxLiveness(this.sandbox, {
      label: 'post-launch-end',
      staleAfterMs: HEARTBEAT_STALE_MS,
      timeoutMs: STALL_CONFIRM_TIMEOUT_MS,
      signal,
      fatalSince: eventStart,
    });
    if (liveness.evidence.initialStale) this.stage('heartbeat-stale', liveness.evidence);
    if (liveness.status === 'recovered') {
      this.stage(liveness.evidence.heartbeat.advanced ? 'heartbeat-recovered' : 'transient-stall-recovered', liveness.evidence);
    }
    if (liveness.status === 'fatal') {
      const fatal = liveness.fatal;
      const failure = makeFailure(FAILURE_CODES[fatal.code] || fatal.code || FAILURE_CODES.RUNTIME_ERROR, fatal.message, fatal);
      return failedReport({ startedAt, stages: [{ name: 'watchdog', before, liveness: liveness.evidence, event: fatal }], failure, report: before });
    }
    if (liveness.status === 'stalled') {
      this.stage('runtime-stall-confirmed', liveness.evidence);
      const failure = makeFailure(FAILURE_CODES.RUNTIME_STALLED, 'The promoted visualizer stopped responding to its heartbeat and bounded confirmation probe.', liveness.evidence);
      return failedReport({ startedAt, stages: [{ name: 'watchdog', before, liveness: liveness.evidence }], failure, report: before });
    }
    if (liveness.status === 'probe-failed') {
      const failure = makeFailure(FAILURE_CODES.PROBE_FAILED, liveness.evidence.probe.error?.message || 'The promoted visualizer did not complete its bounded confirmation probe.', liveness.evidence);
      return failedReport({ startedAt, stages: [{ name: 'watchdog', before, liveness: liveness.evidence }], failure, report: before });
    }
    let after = liveness.report;

    if (currentVisualSignal(before) && !currentVisualSignal(after)) {
      await wait(420, signal);
      const confirmation = await this.sandbox.probe('post-launch-visual-loss-confirmation', { signal, timeoutMs: 2600 });
      if (!currentVisualSignal(confirmation)) {
        const failure = makeFailure(
          FAILURE_CODES.NO_VISIBLE_OUTPUT,
          'The candidate rendered during preflight, then lost its visible output after promotion.',
          { before: before.visual, after: after.visual, confirmation: confirmation.visual },
        );
        return failedReport({
          startedAt,
          stages: [{ name: 'watchdog', before, after, confirmation }],
          failure,
          report: confirmation,
        });
      }
      after = confirmation;
    }

    const evaluation = evaluateProbe(after, { requireViz: true, previous: before, stage: 'post-launch' });
    if (!evaluation.passed) {
      return failedReport({ startedAt, stages: [{ name: 'watchdog', before, after, evaluation }], failure: evaluation.failure, warnings: evaluation.warnings, report: after });
    }

    return {
      schema: RELIABILITY_SCHEMA,
      passed: true,
      startedAt,
      finishedAt: nowIso(),
      durationMs: Date.now() - Date.parse(startedAt),
      stages: [{ name: 'watchdog', before, after, evaluation, liveness: liveness.evidence }],
      warnings: evaluation.warnings,
      failure: null,
      summary: {
        heartbeatAgeMs: Math.round(this.sandbox.heartbeatAgeMs()),
        approximateFps: Math.round(after.runtime?.monitor?.approximateFps || 0),
      },
    };
  }
}
