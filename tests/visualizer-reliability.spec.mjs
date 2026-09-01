import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

async function run(page, html, method = 'runReliabilityFixture') {
  await page.goto('/visualizer/reliability-test.html');
  await page.waitForFunction(() => window.__reliabilityHarnessReady === true);
  return page.evaluate(async ({ html, method }) => window[method](html), { html, method });
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
