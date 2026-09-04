import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const KLANG_PATH = '**/visualizer/featured/klangfiguren.html';
const CALIBRATION_PATH = '**/visualizer/featured/calibration-bloom.html';
const klangHtml = await readFile(new URL('../public/visualizer/featured/klangfiguren.html', import.meta.url), 'utf8');
const calibrationHtml = await readFile(new URL('../public/visualizer/featured/calibration-bloom.html', import.meta.url), 'utf8');
let wakeStep = 0;

async function wakeHost(page) {
  wakeStep += 1;
  await page.mouse.move(220 + wakeStep % 5 * 30, 180 + wakeStep % 4 * 25);
  await expect(page.locator('body')).not.toHaveClass(/ui-hidden/);
}

async function isolateProvider(page) {
  const evidence = { completions: 0, catalogRequests: 0 };
  await page.route('https://openrouter.ai/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/chat/completions') evidence.completions += 1;
    if (path === '/api/v1/models') {
      evidence.catalogRequests += 1;
      await route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify({ data: [] }),
      });
      return;
    }
    await route.abort('blockedbyclient');
  });
  return evidence;
}

async function waitForStartup(page, expected = 'Calibration Bloom') {
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  await expect(page.locator('#liveIdentityName')).toHaveText(expected, { timeout: 12000 });
  let probe;
  await expect.poll(async () => {
    try {
      probe = await page.evaluate(() => window.VIZ_DEV.probeActive('featured-startup-proof'));
      return probe.visual.visibleProof && probe.viz.consumed;
    } catch {
      return false;
    }
  }, { timeout: 12000 }).toBe(true);
  expect(probe.visual.visibleProof).toBe(true);
  expect(probe.viz.consumed).toBe(true);
  expect(probe.events.filter(event => event.severity === 'fatal')).toEqual([]);
  return probe;
}

async function featuredOpenFailureEvidence(page) {
  return page.evaluate(async () => {
    const diagnostic = await window.VIZ_DEV.latest();
    const stages = diagnostic?.reliability?.stages || [];
    return {
      identity: window.VIZ_DEV.identity(),
      state: {
        reopening: window.VIZ_DEV.state().reopening,
        recovering: window.VIZ_DEV.state().recovering,
        activeSessionId: window.VIZ_DEV.state().activeSessionId,
      },
      diagnostic: diagnostic ? {
        id: diagnostic.id,
        kind: diagnostic.kind,
        status: diagnostic.status,
        failureCode: diagnostic.failureCode,
        failureMessage: diagnostic.failureMessage,
        modelId: diagnostic.modelId,
        reliability: {
          passed: diagnostic.reliability?.passed,
          failure: diagnostic.reliability?.failure,
          summary: diagnostic.reliability?.summary,
          warnings: diagnostic.reliability?.warnings,
          stages: stages.map(stage => ({
            name: stage.name,
            ready: stage.ready,
            frames: stage.frames,
            targetFps: stage.targetFps,
            failure: stage.failure,
            report: stage.report ? {
              renderer: {
                types: stage.report.renderer?.types,
                contextLosses: stage.report.renderer?.contextLosses,
                contextFailures: stage.report.renderer?.contextFailures,
                shaderFailures: stage.report.renderer?.shaderFailures,
                programFailures: stage.report.renderer?.programFailures,
              },
              viz: {
                consumed: stage.report.viz?.consumed,
                receivedFrames: stage.report.viz?.receivedFrames,
                deliveredFrames: stage.report.viz?.deliveredFrames,
                lastFrameSequence: stage.report.viz?.lastFrameSequence,
              },
              visual: {
                visibleProof: stage.report.visual?.visibleProof,
                canvases: stage.report.visual?.canvases?.map(canvas => ({
                  id: canvas.id,
                  coverage: canvas.coverage,
                  informative: canvas.pixel?.informative,
                  renderInformative: canvas.renderPixel?.informative,
                  drawCalls: canvas.activity?.drawCalls,
                })),
              },
              fatalEvents: stage.report.events?.filter(event => event.severity === 'fatal'),
              consoleErrors: stage.report.logs?.consoleErrors,
            } : null,
          })),
        },
      } : null,
    };
  });
}

async function openFeatured(page, id, title) {
  await wakeHost(page);
  await page.locator('#switcherButton').click();
  await page.locator(`[data-dream-key="featured:${id}"] .dream-switcher__choose`).click();
  try {
    await expect(page.locator('#liveIdentityName')).toHaveText(title, { timeout: 30000 });
  } catch (error) {
    const evidence = await featuredOpenFailureEvidence(page);
    throw new Error(`Featured ${id} did not become LIVE. Evidence: ${JSON.stringify(evidence)}`, { cause: error });
  }
  const probe = await page.evaluate(label => window.VIZ_DEV.probeActive(label), `featured-open-${id}`);
  expect(probe.visual.visibleProof).toBe(true);
  expect(probe.viz.consumed).toBe(true);
}

test('fresh desktop visitor sees and switches the exact launch set without inference or Library writes', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    localStorage.setItem('ai-visualizer.render-quality.v1', JSON.stringify({
      schema: 'visualizer-render-quality-v1',
      mode: 'balanced',
      changedAt: 1,
    }));
  });
  const provider = await isolateProvider(page);
  const externalArtworkRequests = [];
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:4173/') && !url.startsWith('https://openrouter.ai/')) externalArtworkRequests.push(url);
  });
  const shellStartedAt = Date.now();
  await page.goto('/visualizer/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#switcherButton')).toBeVisible();
  expect(Date.now() - shellStartedAt).toBeLessThan(3000);
  await waitForStartup(page);
  expect(await page.evaluate(() => window.VIZ_DEV.quality().mode)).toBe('balanced');
  expect(await page.evaluate(() => sessionStorage.getItem('ai-visualizer.openrouter.key'))).toBeNull();

  await wakeHost(page);
  await page.locator('#switcherButton').click();
  const featured = page.locator('[data-switcher-group="featured"]');
  await expect(featured.locator('.dream-switcher__item')).toHaveCount(2);
  await expect(featured).toContainText('Klangfiguren');
  await expect(featured).toContainText('Z.ai: GLM 5.3 Flash');
  await expect(featured).toContainText('Calibration Bloom');
  await page.locator('#dreamSwitcherClose').click();

  await openFeatured(page, 'klangfiguren', 'Klangfiguren');
  await openFeatured(page, 'calibration-bloom', 'Calibration Bloom');

  const sessionBeforePause = await page.evaluate(() => window.VIZ_DEV.state().activeSessionId);
  await wakeHost(page);
  await page.locator('#playbackButton').click();
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playbackButton').click();
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.VIZ_DEV.state().activeSessionId)).toBe(sessionBeforePause);

  await wakeHost(page);
  await page.locator('#switcherButton').click();
  await page.locator('#libraryButton').click();
  await expect(page.locator('#libraryList .library-item')).toHaveCount(0);
  await expect(page.locator('#libraryList')).toContainText('Nothing here yet');
  expect(provider.completions).toBe(0);
  expect(externalArtworkRequests).toEqual([]);
});

test('Calibration repeatedly cold-starts while Klangfiguren remains first in editorial order', async ({ browser }) => {
  test.setTimeout(70000);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const provider = await isolateProvider(page);
    const startedAt = Date.now();
    await page.goto('/visualizer/index.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#audioButton')).toBeVisible();
    await waitForStartup(page);
    expect(Date.now() - startedAt).toBeLessThan(8000);
    expect(provider.completions).toBe(0);
    await context.close();
  }
});

test('390x844 Saver open and quality sequence preserve Klangfiguren geometry and session', async ({ browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('ai-visualizer.render-quality.v1', JSON.stringify({
      schema: 'visualizer-render-quality-v1',
      mode: 'saver',
      changedAt: 1,
    }));
  });
  const provider = await isolateProvider(page);
  await page.goto('/visualizer/index.html');
  await waitForStartup(page);
  await openFeatured(page, 'klangfiguren', 'Klangfiguren');
  const initial = await page.evaluate(() => window.VIZ_DEV.state());
  expect(initial.renderQuality).toMatchObject({ mode: 'saver', maxFps: 30, effectiveDpr: 1 });
  const sessionId = initial.activeSessionId;
  for (const [mode, expected] of [
    ['saver', { maxFps: 30, effectiveDpr: 1 }],
    ['balanced', { maxFps: 45, effectiveDpr: 1.5 }],
    ['full', { maxFps: 60, effectiveDpr: 2 }],
    ['saver', { maxFps: 30, effectiveDpr: 1 }],
  ]) {
    await page.evaluate(value => window.VIZ_DEV.setQuality(value), mode);
    await page.waitForTimeout(260);
    const evidence = await page.evaluate(async label => ({
      state: window.VIZ_DEV.state(),
      probe: await window.VIZ_DEV.probeActive(label),
    }), `featured-quality-${mode}`);
    expect(evidence.state.activeSessionId).toBe(sessionId);
    expect(evidence.state.renderQuality).toMatchObject({ mode, ...expected });
    expect(evidence.probe.visual.visibleProof).toBe(true);
    expect(evidence.probe.viz.consumed).toBe(true);
    expect(evidence.probe.renderer.contextLosses).toEqual([]);
  }
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    stage: document.getElementById('stage').getBoundingClientRect().toJSON(),
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  expect(layout.stage.width).toBeLessThanOrEqual(390);
  expect(provider.completions).toBe(0);
  await context.close();
});

test('Featured fetch and digest failures retain a visible Calibration fallback without inference', async ({ browser }) => {
  test.setTimeout(70000);
  const cases = [
    {
      name: 'non-startup unavailable',
      route: KLANG_PATH,
      fulfill: { status: 404, body: '' },
      expectedLive: 'Calibration Bloom',
      expectedFailure: { id: 'klangfiguren', code: 'FEATURED_UNAVAILABLE' },
      expectedIds: ['calibration-bloom'],
    },
    {
      name: 'startup unavailable',
      route: CALIBRATION_PATH,
      fulfill: { status: 404, body: '' },
      expectedLive: 'Calibration Bloom',
      expectedFailure: { id: 'calibration-bloom', code: 'FEATURED_UNAVAILABLE' },
      expectedIds: ['klangfiguren', 'calibration-bloom'],
    },
    {
      name: 'startup digest mismatch',
      route: CALIBRATION_PATH,
      fulfill: { status: 200, contentType: 'text/html', body: `${calibrationHtml} ` },
      expectedLive: 'Calibration Bloom',
      expectedFailure: { id: 'calibration-bloom', code: 'FEATURED_DIGEST_MISMATCH' },
      expectedIds: ['klangfiguren', 'calibration-bloom'],
    },
    {
      name: 'non-startup digest mismatch',
      route: KLANG_PATH,
      fulfill: { status: 200, contentType: 'text/html', body: `${klangHtml} ` },
      expectedLive: 'Calibration Bloom',
      expectedFailure: { id: 'klangfiguren', code: 'FEATURED_DIGEST_MISMATCH' },
      expectedIds: ['calibration-bloom'],
    },
  ];
  for (const fault of cases) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const provider = await isolateProvider(page);
    await page.route(fault.route, route => route.fulfill(fault.fulfill));
    await page.goto('/visualizer/index.html?dev=1');
    await waitForStartup(page, fault.expectedLive);
    const failures = await page.evaluate(() => window.VIZ_DEV.state().featuredLoadFailures);
    expect(failures, fault.name).toContainEqual(fault.expectedFailure);
    await wakeHost(page);
    await page.locator('#switcherButton').click();
    const ids = await page.locator('[data-switcher-group="featured"] .dream-switcher__item').evaluateAll(rows => rows.map(row => row.dataset.dreamKey.replace('featured:', '')));
    expect(ids, fault.name).toEqual(fault.expectedIds);
    expect(provider.completions).toBe(0);
    await context.close();
  }
});
