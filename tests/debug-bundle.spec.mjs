import { test, expect } from '@playwright/test';

async function isolateProvider(page) {
  const evidence = { completions: 0 };
  await page.route('https://openrouter.ai/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/chat/completions') evidence.completions += 1;
    if (url.pathname === '/api/v1/models') {
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

test('developer mode exposes one-click paste-ready debug bundle', async ({ page }) => {
  await isolateProvider(page);

  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEBUG_BUNDLE?.collect)).toBe('function');
  await page.locator('#diagnosticsButton').click();
  await expect(page.locator('#copyDebugBundle')).toBeVisible();
  await expect(page.locator('#debugBundleHint')).toContainText('paste the entire result into ChatGPT');

  const { bundle, state } = await page.evaluate(async () => ({
    bundle: await window.VIZ_DEBUG_BUNDLE.collect(),
    state: window.VIZ_DEV.state(),
  }));
  expect(bundle.schema).toBe('visualizer-debug-bundle-v1');
  expect(bundle.identity.live.displayName).toBe('Calibration Bloom');
  expect(bundle.identity.next.displayName).toBe('Choose a model');
  expect(bundle.page.developerMode).toBe(true);
  expect(state.renderQuality.audioAnalysisTargetFps).toBe(60);
  expect(bundle.runtime.renderQuality).toEqual(expect.objectContaining({
    vizFrameDeliveries: expect.any(Number),
    deliveryGate: expect.any(Object),
  }));
  expect(bundle.runtime.frameDelivery).toEqual({
    receivedFrames: expect.any(Number),
    deliveredFrames: expect.any(Number),
    coalescedFrames: expect.any(Number),
    droppedFrames: expect.any(Number),
    inFlightFrames: expect.any(Number),
    pendingFrames: expect.any(Number),
    inFlightSequence: expect.any(Number),
    pendingSequence: expect.any(Number),
    lastSettledSequence: expect.any(Number),
    blockedByFatal: expect.any(Boolean),
  });
  expect(JSON.stringify(bundle)).not.toMatch(/waveform|spectrum|authorization/i);
});

test('raw diagnostic JSON stays open across same-trace rerenders and resets on trace change', async ({ page }) => {
  const provider = await isolateProvider(page);
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV?.runTransparencySelfTest)).toBe('function');
  await page.evaluate(() => window.VIZ_DEV.runTransparencySelfTest());
  await expect(page.locator('#diagnosticsList .diagnostic-item')).toHaveCount(2);
  await page.locator('#closeTraceViewer').click();

  const first = page.locator('#diagnosticsList .diagnostic-item').first();
  const firstId = await first.getAttribute('data-diagnostic-id');
  await first.locator('summary', { hasText: 'Raw diagnostic JSON' }).click();
  await expect(first.locator('details')).toHaveAttribute('open', '');
  await expect(first.locator('details pre')).toContainText('"schema"');

  await page.evaluate(() => window.VIZ_DEV.open());
  const rerendered = page.locator(`[data-diagnostic-id="${firstId}"]`);
  await expect(rerendered.locator('details')).toHaveAttribute('open', '');
  await expect(rerendered.locator('details pre')).toContainText('"schema"');

  const other = page.locator('#diagnosticsList .diagnostic-item').nth(1);
  const otherId = await other.getAttribute('data-diagnostic-id');
  await page.evaluate(id => window.VIZ_DEV.openTrace(id), otherId);
  await expect(rerendered.locator('details')).not.toHaveAttribute('open', '');
  expect(provider.completions).toBe(0);
});
