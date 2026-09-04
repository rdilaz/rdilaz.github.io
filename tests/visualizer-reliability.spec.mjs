import { chromium, test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { currentVisualSignal, latestCurrentVisualReport } from '../public/visualizer/reliability.js';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const crispPromotionTraces = JSON.parse(await fixture('gemini-neutral-crisp-promotion-traces.json'));
const crispHtmlBlobHashes = new Set(await Promise.all([
  'gemini-neutral-crisp-1.html',
  'gemini-neutral-crisp-2.html',
].map(async name => {
  const content = await readFile(new URL(`./fixtures/${name}`, import.meta.url));
  return createHash('sha1').update(`blob ${content.byteLength}\0`).update(content).digest('hex');
})));

async function run(page, html, method = 'runReliabilityFixture') {
  await page.goto('/visualizer/reliability-test.html');
  await page.waitForFunction(() => window.__reliabilityHarnessReady === true);
  return page.evaluate(async ({ html, method }) => window[method](html), { html, method });
}

async function runWithArgs(page, method, ...args) {
  await page.goto('/visualizer/reliability-test.html');
  await page.waitForFunction(() => window.__reliabilityHarnessReady === true);
  return page.evaluate(({ method, args }) => window[method](...args), { method, args });
}

test('Canvas2D art renders, consumes VIZ, and passes without aesthetic assumptions', async ({ page }) => {
  const result = await run(page, await fixture('valid-canvas2d.html'));
  expect(result.passed).toBe(true);
  expect(result.summary.visible).toBe(true);
  expect(result.summary.vizConsumed).toBe(true);
  expect(result.summary.rendererTypes).toContain('2d');
});

test('DOM/SVG art is accepted without requiring canvas or WebGL', async ({ page }) => {
  const result = await run(page, await fixture('valid-svg-dom.html'));
  expect(result.passed).toBe(true);
  expect(result.summary.visible).toBe(true);
  expect(result.summary.vizConsumed).toBe(true);
});

test('CSS-only root and pseudo-capable art is accepted without child elements', async ({ page }) => {
  const result = await run(page, await fixture('valid-css-only.html'));
  expect(result.passed).toBe(true);
  expect(result.summary.visible).toBe(true);
  const proof = result.stages.find(stage => stage.name === 'viewport-canary').report.visual.dom;
  expect(proof.rootSurfaceNodes).toBeGreaterThan(0);
});

test('silent WebGL shader failure is rejected with the compiler diagnostic', async ({ page }) => {
  const result = await run(page, await fixture('broken-webgl.html'));
  expect(result.passed).toBe(false);
  expect(result.failure.code).toBe('SHADER_COMPILE_FAILED');
  expect(result.repairProblem).toContain('Shader compiler');
});

test('a failed advanced renderer may preserve a healthy DOM fallback', async ({ page }) => {
  const result = await run(page, await fixture('webgl-dom-fallback.html'));
  expect(result.passed).toBe(true);
  expect(result.warnings.some(warning => warning.code === 'SHADER_FAILURE_WITH_FALLBACK')).toBe(true);
});

test('DOMContentLoaded with no visible artwork is not promoted', async ({ page }) => {
  const result = await run(page, await fixture('blank.html'));
  expect(result.passed).toBe(false);
  expect(result.failure.code).toBe('NO_VISIBLE_OUTPUT');
});

test('intentional all-black WebGL remains valid when the renderer demonstrably draws', async ({ page }) => {
  const result = await run(page, await fixture('valid-black-webgl.html'));
  expect(result.passed).toBe(true);
  expect(result.summary.rendererTypes).toContain('webgl2');
  const canary = result.stages.find(stage => stage.name === 'viewport-canary');
  const canvas = canary.report.visual.canvases[0];
  expect(canvas.activity.drawCalls).toBeGreaterThan(0);
  expect(canvas.activity.programsLinked).toBeGreaterThan(0);
});

test('a delayed post-launch crash is caught by the rollback watchdog', async ({ page }) => {
  const result = await run(page, await fixture('delayed-crash.html'), 'runWatchdogFixture');
  expect(result.preflight.passed).toBe(true);
  expect(result.watchdog.passed).toBe(false);
  expect(['RUNTIME_ERROR', 'UNHANDLED_REJECTION']).toContain(result.watchdog.failure.code);
});

test('fresh pre-compositing proof does not hide continuously invalid WebGL draws', async ({ page }) => {
  const result = await run(page, await fixture('invalid-draw-after-visible-webgl.html'), 'runWatchdogFixture');
  expect(result.preflight.passed).toBe(true);
  expect(result.watchdog.passed).toBe(false);
  expect(result.watchdog.failure.code).toBe('NO_VISIBLE_OUTPUT');
  const confirmation = result.watchdog.stages[0].confirmation;
  const canvas = confirmation.visual.canvases[0];
  expect(canvas.activity.drawCalls).toBeGreaterThan(0);
  expect(canvas.renderPixel.informative).toBe(false);
});

test('visible qualification still catches output lost before the watchdog initial probe', async ({ page }) => {
  const result = await run(page, '', 'runPriorVisualLossWatchdogFixture');
  expect(result.passed).toBe(false);
  expect(result.failure.code).toBe('NO_VISIBLE_OUTPUT');
  expect(result.failure.detail.qualification.canvases[0].pixel.informative).toBe(false);
  expect(result.failure.detail.qualification.canvases[0].renderPixel.informative).toBe(true);
  expect(result.failure.detail.before.canvases[0].pixel.informative).toBe(false);
});

test('reduced saved Crisp traces treat post-compositing readback as inconclusive, not failed', () => {
  const canvas = (drawCalls, lastActivityAt, informative, {
    preserveDrawingBuffer = false,
    renderInformative = true,
    renderCaptureRequest = 2,
  } = {}) => ({
    id: 'canvas-1',
    elementId: 'gl-canvas',
    coverage: 1,
    pixel: { sampled: true, informative },
    activity: { type: 'webgl2', drawCalls, programsLinked: 2, lastActivityAt, preserveDrawingBuffer },
    renderPixel: { sampled: true, informative: renderInformative },
    renderCaptureRequest,
    renderPixelDrawCalls: drawCalls,
    successfulActivity: true,
  });
  const report = dominant => ({
    renderer: { contextLosses: [], shaderFailures: [], programFailures: [] },
    visual: { renderCaptureRequest: dominant.renderCaptureRequest, canvases: [dominant], dom: { visible: false } },
  });
  for (const evidence of crispPromotionTraces.cases) {
    expect(crispHtmlBlobHashes.has(evidence.htmlGitBlob), evidence.generationId).toBe(true);
    const before = report(canvas(evidence.before.drawCalls, evidence.before.lastActivityAt, evidence.before.pixelInformative, { renderCaptureRequest: 1 }));
    const composited = report(canvas(evidence.after.drawCalls, evidence.after.lastActivityAt, evidence.after.pixelInformative));
    expect(currentVisualSignal(before), evidence.generationId).toBe(true);
    expect(currentVisualSignal(composited, before), evidence.generationId).toBe(true);
    expect(currentVisualSignal(report(canvas(evidence.before.drawCalls, evidence.before.lastActivityAt, false)), before), evidence.generationId).toBe(false);
    expect(currentVisualSignal(report(canvas(evidence.after.drawCalls, evidence.after.lastActivityAt, false, { preserveDrawingBuffer: true })), before), evidence.generationId).toBe(false);
    expect(currentVisualSignal(report(canvas(evidence.after.drawCalls, evidence.after.lastActivityAt, false, { renderInformative: false })), before), evidence.generationId).toBe(false);
    expect(currentVisualSignal({ ...composited, renderer: { ...composited.renderer, contextLosses: [{ restored: false }] } }, before), evidence.generationId).toBe(false);
    expect(latestCurrentVisualReport({ stages: [{ report: before }, { report: report(canvas(evidence.after.drawCalls, evidence.after.lastActivityAt, false, { renderInformative: false })) }] })).toBe(before);
  }
});

for (const fixtureName of ['gemini-neutral-crisp-1.html', 'gemini-neutral-crisp-2.html']) {
  test(`saved ${fixtureName} remains viable through promotion watchdog`, async ({ page }) => {
    const result = await run(page, await fixture(fixtureName), 'runWatchdogFixture');
    expect(result.preflight.passed).toBe(true);
    const stage = result.watchdog.stages[0];
    const before = stage.before.visual.canvases.find(canvas => canvas.activity.type === 'webgl2');
    const after = stage.after.visual.canvases.find(canvas => canvas.id === before.id);
    expect(after.activity.drawCalls).toBeGreaterThan(before.activity.drawCalls);
    expect(after.activity.programsLinked).toBeGreaterThan(0);
    expect(after.activity.preserveDrawingBuffer).toBe(false);
    expect(after.renderPixel.informative).toBe(true);
    expect(after.renderCaptureRequest).toBe(stage.after.visual.renderCaptureRequest);
    expect(stage.after.renderer.contextLosses).toEqual([]);
    expect(result.watchdog.passed).toBe(true);
  });

  test(`saved ${fixtureName} reopens and remains viable through promotion watchdog`, async ({ page }) => {
    const result = await run(page, await fixture(fixtureName), 'runReopenWatchdogFixture');
    expect(result.reopen.passed).toBe(true);
    expect(result.reopen.summary.quickReopen).toBe(true);
    expect(result.watchdog.passed).toBe(true);
  });
}

test('trusted pause suspends generated RAF and host frames without reloading', async ({ page }) => {
  const result = await run(page, await fixture('pause-observable.html'), 'runPauseFixture');
  expect(result.boot.ready).toBe(true);
  expect(result.sessionUnchanged).toBe(true);
  expect(result.firstPause).toBe(true);
  expect(result.repeatedPause).toBe(false);
  expect(result.firstResume).toBe(true);
  expect(result.repeatedResume).toBe(false);
  expect(result.paused.runtime.playback.paused).toBe(true);
  expect(result.paused.runtime.playback.queuedAnimationFrames).toBe(1);
  expect(result.paused.runtime.playback.hostPausedAnimations).toBeGreaterThan(0);
  expect(result.paused.runtime.rafCallbacks).toBe(result.pauseApplied.runtime.rafCallbacks);
  expect(result.paused.viz.hostFrames).toBe(result.pauseApplied.viz.hostFrames);
  expect(result.paused.viz.deliveredFrames).toBe(result.pauseApplied.viz.deliveredFrames);
  expect(result.pausedHeartbeatAgeMs).toBeLessThan(1300);
  expect(result.resumed.runtime.playback.paused).toBe(false);
  expect(result.resumed.runtime.playback.hostPausedAnimations).toBe(0);
  expect(result.resumed.runtime.rafCallbacks).toBe(result.pauseApplied.runtime.rafCallbacks + 1);
  expect(result.resumed.viz.hostFrames).toBeGreaterThan(result.paused.viz.hostFrames);
  expect(result.resumed.viz.lastFrameSequence).toBeGreaterThan(result.paused.viz.lastFrameSequence);
});

test('pause selected before bridge startup is applied before generated RAF can advance', async ({ page }) => {
  const result = await run(page, await fixture('pause-observable.html'), 'runPreBridgePauseFixture');
  expect(result.boot.ready).toBe(true);
  expect(result.firstPause).toBe(true);
  expect(result.repeatedPause).toBe(false);
  expect(result.applied.runtime.playback.paused).toBe(true);
  expect(result.held.runtime.playback.paused).toBe(true);
  expect(result.held.runtime.rafCallbacks).toBe(result.applied.runtime.rafCallbacks);
  expect(result.firstResume).toBe(true);
});

test('clearing a paused standby slot cannot leak pause intent into its next preflight', async ({ page }) => {
  const result = await run(page, await fixture('valid-canvas2d.html'), 'runClearedSlotPauseFixture');
  expect(result.staleAfterClear).toBe(false);
  expect(result.nextPreflight.passed).toBe(true);
  expect(result.nextPreflight.summary.visible).toBe(true);
});

test('fixed inset auto canvas keeps CSS geometry through every render-quality transition', async ({ page }) => {
  const result = await run(page, await fixture('fixed-inset-auto-canvas.html'), 'runQualityGeometryFixture');
  expect(result.boot.ready).toBe(true);
  const expected = [
    { mode: 'saver', dpr: 1, fps: 30, backingWidth: 800, backingHeight: 450 },
    { mode: 'balanced', dpr: 1.5, fps: 45, backingWidth: 1200, backingHeight: 675 },
    { mode: 'full', dpr: 2, fps: 60, backingWidth: 1600, backingHeight: 900 },
    { mode: 'balanced', dpr: 1.5, fps: 45, backingWidth: 1200, backingHeight: 675 },
    { mode: 'saver', dpr: 1, fps: 30, backingWidth: 800, backingHeight: 450 },
  ];
  for (const [index, transition] of result.transitions.entries()) {
    const report = transition.report;
    const scene = report.visual.canvases.find(canvas => canvas.elementId === 'scene');
    const half = report.visual.canvases.find(canvas => canvas.elementId === 'half');
    const small = report.visual.canvases.find(canvas => canvas.elementId === 'small');
    expect(transition.mode).toBe(expected[index].mode);
    expect(transition.sessionId).toBe(result.sessionId);
    expect(transition.srcdocUnchanged).toBe(true);
    expect(report.viewport).toEqual({ width: 800, height: 450, dpr: expected[index].dpr });
    expect(report.runtime.renderQuality.maxFps).toBe(expected[index].fps);
    expect(scene).toMatchObject({
      left: 0,
      top: 0,
      right: 800,
      bottom: 450,
      width: 800,
      height: 450,
      centerX: 400,
      centerY: 225,
      backingWidth: expected[index].backingWidth,
      backingHeight: expected[index].backingHeight,
      hostViewportStabilized: true,
    });
    expect(scene.width / scene.height).toBeCloseTo(800 / 450, 4);
    expect(scene.coverage).toBe(1);
    expect(half).toMatchObject({ width: 400, height: 225, hostViewportStabilized: false });
    expect(small).toMatchObject({ width: 96, height: 64, backingWidth: 96, backingHeight: 64, hostViewportStabilized: false });
  }
  expect(result.authoredInset.visual.canvases.find(canvas => canvas.elementId === 'scene').hostViewportStabilized).toBe(false);
  expect(result.restoredViewport.visual.canvases.find(canvas => canvas.elementId === 'scene')).toMatchObject({
    width: 800,
    height: 450,
    hostViewportStabilized: true,
  });
  for (const transition of result.requalification) {
    expect(transition.report.visual.canvases.find(canvas => canvas.elementId === 'scene').hostViewportStabilized, transition.label).toBe(transition.expected);
  }
  expect(result.markerForgery.visual.canvases.find(canvas => canvas.elementId === 'small')).toMatchObject({
    width: 96,
    height: 64,
    hostViewportStabilized: false,
  });
  expect(result.markerForgery.runtime.stabilizedViewportCanvasCount).toBe(1);
  expect(result.detachedCanvas.runtime.observedViewportCanvasCount).toBe(3);
});

test('heavy actual-viewport renderer qualifies at Saver cadence with full canvas geometry', async ({ page }) => {
  const providerRequests = [];
  page.on('request', request => {
    if (/openrouter|chat\/completions/i.test(request.url())) providerRequests.push(request.url());
  });
  const result = await run(page, await fixture('heavy-actual-viewport.html'), 'runHeavyReliabilityFixture');
  expect(result.passed).toBe(true);
  expect(result.schema).toBe('dream-reliability-v3');
  const fast = result.stages.find(stage => stage.name === 'stimulation');
  const actual = result.stages.find(stage => stage.name === 'viewport-stimulation');
  const canary = result.stages.find(stage => stage.name === 'viewport-canary').report;
  expect(result.stages.find(stage => stage.name === 'boot').readyDetail.viewport.dpr).toBe(1);
  expect(fast).toMatchObject({ targetFps: 30 });
  expect(actual).toMatchObject({ targetFps: 30 });
  expect(fast.frames).toBeLessThanOrEqual(Math.ceil(fast.durationMs / 1000 * 30) + 1);
  expect(actual.frames).toBeLessThanOrEqual(Math.ceil(actual.durationMs / 1000 * 30) + 1);
  expect(fast.delivery).toMatchObject({ pendingFrames: 0, inFlightFrames: 0 });
  expect(actual.delivery).toMatchObject({ pendingFrames: 0, inFlightFrames: 0 });
  expect(canary.viewport).toEqual({ width: 2048, height: 1100, dpr: 1 });
  expect(canary.visual.visibleProof).toBe(true);
  expect(canary.viz.consumed).toBe(true);
  expect(canary.viz.latestFrame.deltaTime).toBeGreaterThan(0);
  expect(canary.events.filter(event => event.severity === 'fatal')).toEqual([]);
  expect(canary.visual.canvases[0]).toMatchObject({
    elementId: 'scene',
    width: 2048,
    height: 1100,
    backingWidth: 2048,
    backingHeight: 1100,
    coverage: 1,
    hostViewportStabilized: true,
  });
  expect(canary.visual.canvases[0].width / canary.visual.canvases[0].height).toBeCloseTo(2048 / 1100, 4);
  expect(providerRequests).toEqual([]);
});

test('faster producer stays bounded and deterministically delivers the newest frame', async ({ page }) => {
  const result = await runWithArgs(page, 'runFrameBackpressureFixture', await fixture('heavy-actual-viewport.html'), 180);
  expect(result.boot.ready).toBe(true);
  expect(result.queued).toMatchObject({ inFlightFrames: 1, pendingFrames: 1, receivedFrames: 180, coalescedFrames: 178 });
  expect(result.queued.inFlightFrames + result.queued.pendingFrames).toBeLessThanOrEqual(2);
  expect(result.settled).toMatchObject({ inFlightFrames: 0, pendingFrames: 0, receivedFrames: 180 });
  expect(result.report.viz).toMatchObject({
    receivedFrames: 180,
    deliveredFrames: 2,
    coalescedFrames: 178,
    droppedFrames: 0,
    lastFrameSequence: 180,
    latestFrame: { sequence: 180, version: 'visualizer-audio-v1', time: 2.864, deltaTime: 2.864 },
  });
  expect(result.report.visual.visibleProof).toBe(true);
});

test('session replacement cannot leak an old pending frame', async ({ page }) => {
  const result = await runWithArgs(
    page,
    'runFrameSessionReplacementFixture',
    await fixture('heavy-actual-viewport.html'),
    await fixture('valid-canvas2d.html'),
  );
  expect(result.oldSessionId).not.toBe(result.newSessionId);
  expect(result.oldDelivery).toMatchObject({ inFlightFrames: 1, pendingFrames: 1, receivedFrames: 120 });
  expect(result.oldWaitError).toContain('Sandbox was reloaded');
  expect(result.replacementBoot.ready).toBe(true);
  expect(result.newDelivery).toMatchObject({ receivedFrames: 1, deliveredFrames: 1, pendingFrames: 0, inFlightFrames: 0 });
  expect(result.report.viz).toMatchObject({
    receivedFrames: 1,
    deliveredFrames: 1,
    coalescedFrames: 0,
    lastFrameSequence: 1,
    latestFrame: { sequence: 1, time: 0.999, deltaTime: 1 / 30 },
  });
});

test('pause drops pending work and resume starts from a fresh newest frame', async ({ page }) => {
  const result = await runWithArgs(page, 'runFramePauseBackpressureFixture', await fixture('heavy-actual-viewport.html'));
  expect(result.queued).toMatchObject({ inFlightFrames: 1, pendingFrames: 1, receivedFrames: 180, coalescedFrames: 178 });
  expect(result.pausedReport.runtime.playback.paused).toBe(true);
  expect(result.pausedReport.viz).toMatchObject({ receivedFrames: 180, coalescedFrames: 178, droppedFrames: 1 });
  expect(result.pausedDelivery).toMatchObject({ pendingFrames: 0, inFlightFrames: 0, droppedFrames: 1 });
  expect(result.acceptedWhilePaused).toBe(false);
  expect(result.resumedReport.runtime.playback.paused).toBe(false);
  expect(result.resumedReport.viz).toMatchObject({
    receivedFrames: 181,
    deliveredFrames: 2,
    coalescedFrames: 178,
    droppedFrames: 1,
    lastFrameSequence: 181,
    latestFrame: { sequence: 181, time: 20, deltaTime: 1 / 30 },
  });
  expect(result.resumedDelivery).toMatchObject({ pendingFrames: 0, inFlightFrames: 0 });
});

test('render-quality change drops stale pending DPR and keeps the session intact', async ({ page }) => {
  const result = await runWithArgs(page, 'runFrameQualityBackpressureFixture', await fixture('heavy-actual-viewport.html'));
  expect(result.queued).toMatchObject({ inFlightFrames: 1, pendingFrames: 1, receivedFrames: 180 });
  expect(result.sessionUnchanged).toBe(true);
  expect(result.srcdocUnchanged).toBe(true);
  expect(result.afterQuality.runtime.renderQuality).toMatchObject({ mode: 'balanced', maxFps: 45, effectiveDpr: 1.5 });
  expect(result.afterQuality.viz).toMatchObject({ receivedFrames: 180, coalescedFrames: 178, droppedFrames: 1 });
  expect(result.report.viz).toMatchObject({
    receivedFrames: 181,
    deliveredFrames: 2,
    coalescedFrames: 178,
    droppedFrames: 1,
    lastFrameSequence: 181,
    latestFrame: { sequence: 181, time: 20, deltaTime: 20 },
  });
  expect(result.report.visual.canvases[0]).toMatchObject({ width: 2048, height: 1100, backingWidth: 3072, backingHeight: 1650 });
  expect(result.delivery).toMatchObject({ pendingFrames: 0, inFlightFrames: 0 });
});

test('delivered deltaTime follows actual delivered music-state progression across coalescing cycles', async ({ page }) => {
  const result = await runWithArgs(page, 'runFrameTimingFixture', await fixture('heavy-actual-viewport.html'));
  expect(result.boot.ready).toBe(true);
  expect(result.noCoalescing).toHaveLength(2);
  expect(result.noCoalescing[0]).toMatchObject({ sequence: 1, time: 1, deltaTime: 0.02 });
  expect(result.noCoalescing[1]).toMatchObject({ sequence: 2, time: 1.1 });
  expect(result.noCoalescing[1].deltaTime).toBeCloseTo(0.1, 10);
  expect(result.firstQueued).toMatchObject({ inFlightSequence: 3, pendingSequence: 13, coalescedFrames: 9 });
  expect(result.firstCycle.map(delivery => delivery.sequence)).toEqual([3, 13]);
  expect(result.firstCycle.map(delivery => delivery.time)).toEqual([1.2, 2.2]);
  expect(result.firstCycle[0].deltaTime).toBeCloseTo(0.1, 10);
  expect(result.firstCycle[1].deltaTime).toBeCloseTo(1, 10);
  expect(result.secondQueued).toMatchObject({ inFlightSequence: 14, pendingSequence: 24, coalescedFrames: 18 });
  expect(result.secondCycle.map(delivery => delivery.sequence)).toEqual([14, 24]);
  expect(result.secondCycle.map(delivery => delivery.time)).toEqual([2.3, 3.3]);
  expect(result.secondCycle[0].deltaTime).toBeCloseTo(0.1, 10);
  expect(result.secondCycle[1].deltaTime).toBeCloseTo(1, 10);
  expect(result.deliveries.map(delivery => delivery.sequence)).toEqual([1, 2, 3, 13, 14, 24]);
  expect(result.deliveries.map(delivery => delivery.time)).toEqual([1, 1.1, 1.2, 2.2, 2.3, 3.3]);
  const representedTime = result.deliveries.slice(1).reduce((total, delivery) => total + delivery.deltaTime, 0);
  expect(representedTime).toBeCloseTo(3.3 - 1, 10);
  expect(result.report.viz.latestFrame).toMatchObject({ sequence: 24, time: 3.3, deltaTime: 1 });
});

test('permanently unresponsive actual-viewport renderer still fails within a bound', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--site-per-process'] });
  const isolatedPage = await browser.newPage({ viewport: { width: 2200, height: 1250 } });
  try {
    const result = await run(isolatedPage, await fixture('unresponsive-actual-viewport.html'), 'runFrozenQualificationFixture');
    expect(result.report).toBeNull();
    expect(result.error.message).toContain('actual-viewport drain');
    expect(result.error.message).toContain('timed out');
    expect(result.elapsedMs).toBeLessThan(8000);
  } finally {
    await browser.close();
  }
});

test('fatal VIZ callback remains an immediate authenticated failure', async ({ page }) => {
  const result = await run(page, await fixture('fatal-viz-callback.html'), 'runFatalDeliveryFixture');
  expect(result.boot.ready).toBe(true);
  expect(result.fatal).toMatchObject({ severity: 'fatal', code: 'VIZ_CALLBACK_ERROR' });
  expect(result.delivery).toMatchObject({
    receivedFrames: 180,
    deliveredFrames: 1,
    coalescedFrames: 178,
    droppedFrames: 1,
    pendingFrames: 0,
    inFlightFrames: 0,
    blockedByFatal: true,
  });
  expect(result.acceptedAfterFatal).toBe(false);
  expect(result.elapsedMs).toBeLessThan(900);
});

test('fatal callback terminates full qualification without completing stimulation', async ({ page }) => {
  const result = await run(page, await fixture('fatal-viz-callback.html'));
  expect(result.passed).toBe(false);
  expect(result.failure.code).toBe('VIZ_CALLBACK_ERROR');
  expect(result.durationMs).toBeLessThan(1500);
  const stimulation = result.stages.find(stage => stage.name === 'stimulation');
  expect(stimulation.frames).toBe(1);
  expect(stimulation.attemptedFrames).toBe(1);
});

test('visible renderer that never consumes VIZ still fails closed', async ({ page }) => {
  const result = await run(page, await fixture('visible-viz-nonconsumer.html'));
  expect(result.passed).toBe(false);
  expect(result.failure.code).toBe('VIZ_NOT_CONSUMED');
});

test('stale heartbeat with a responsive authenticated probe is a transient stall', async ({ page }) => {
  const transient = await runWithArgs(page, 'runHeartbeatWatchdogFixture', await fixture('valid-canvas2d.html'), 'transient');
  expect(transient.preflight.passed).toBe(true);
  expect(transient.watchdog.passed).toBe(true);
  expect(transient.watchdog.stages[0].liveness.initialStale).toBe(true);
  expect(transient.watchdog.stages[0].liveness.probe.responded).toBe(true);
});

test('permanent heartbeat and probe stall remains a bounded RUNTIME_STALLED failure', async ({ page }) => {
  const permanent = await runWithArgs(page, 'runHeartbeatWatchdogFixture', await fixture('valid-canvas2d.html'), 'permanent');
  expect(permanent.preflight.passed).toBe(true);
  expect(permanent.watchdog.passed).toBe(false);
  expect(permanent.watchdog.failure.code).toBe('RUNTIME_STALLED');
  expect(permanent.watchdog.failure.detail.heartbeat.advanced).toBe(false);
  expect(permanent.watchdog.failure.detail.probe.attempts).toBe(1);
  expect(permanent.elapsedMs).toBeLessThan(1200);
});

test('fatal runtime event still fails before heartbeat confirmation grace', async ({ page }) => {
  const fatal = await runWithArgs(page, 'runHeartbeatWatchdogFixture', await fixture('valid-canvas2d.html'), 'fatal');
  expect(fatal.preflight.passed).toBe(true);
  expect(fatal.watchdog.passed).toBe(false);
  expect(fatal.watchdog.failure.code).toBe('RUNTIME_ERROR');
  expect(fatal.watchdog.stages[0].liveness).toBeUndefined();
  expect(fatal.elapsedMs).toBeLessThan(1000);
});

test('shipped Calibration Bloom Featured art passes without provider authentication', async ({ page }) => {
  const html = await readFile(new URL('../public/visualizer/featured/calibration-bloom.html', import.meta.url), 'utf8');
  const result = await run(page, html);
  expect(result.passed).toBe(true);
  expect(result.summary.visible).toBe(true);
  expect(result.summary.vizConsumed).toBe(true);
  expect(result.summary.rendererTypes).toContain('2d');
});

test('hostile head comments cannot displace CSP or allow generated network access', async ({ page }) => {
  let networkRequests = 0;
  await page.route('https://attacker.invalid/**', async route => {
    networkRequests += 1;
    await route.abort('blockedbyclient');
  });
  const result = await run(page, await fixture('hostile-comment-csp.html'));
  expect(result.passed).toBe(true);
  expect(networkRequests).toBe(0);
  const finalReport = result.stages.at(-1).report;
  expect(finalReport.logs.securityViolations.length).toBeGreaterThan(0);
});

test('generated window messages cannot forge bridge resume or readiness', async ({ page }) => {
  const result = await run(page, await fixture('bridge-forgery.html'), 'runPauseFixture');
  expect(result.boot.ready).toBe(true);
  expect(result.boot.readyDetail.forged).not.toBe(true);
  expect(result.paused.runtime.playback.paused).toBe(true);
  expect(result.paused.runtime.rafCallbacks).toBe(result.pauseApplied.runtime.rafCallbacks);
  expect(result.paused.viz.hostFrames).toBe(result.pauseApplied.viz.hostFrames);
});

test('Web Animations created or replayed during pause remain host-paused', async ({ page }) => {
  const result = await run(page, await fixture('waapi-during-pause.html'), 'runPauseFixture');
  expect(result.paused.runtime.playback.paused).toBe(true);
  expect(result.paused.runtime.playback.hostPausedAnimations).toBeGreaterThanOrEqual(2);
  expect(result.paused.runtime.rafCallbacks).toBe(result.pauseApplied.runtime.rafCallbacks);
  expect(result.resumed.runtime.playback.hostPausedAnimations).toBe(0);
});

test('real Gemini AETHERIA output can never silently pass as a blank Dream', async ({ page }) => {
  const result = await run(page, await fixture('aetheria-gemini-3.7-flash.html'));
  if (result.passed) {
    expect(result.summary.visible).toBe(true);
    expect(result.summary.vizConsumed).toBe(true);
    const canary = result.stages.find(stage => stage.name === 'viewport-canary');
    expect(canary.report.visual.visibleProof).toBe(true);
  } else {
    expect(result.failure.code).not.toBe('UNKNOWN');
    expect(result.repairProblem.length).toBeGreaterThan(20);
  }
});
