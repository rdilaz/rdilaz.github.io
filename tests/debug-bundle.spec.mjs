import { test, expect } from '@playwright/test';

test('developer mode exposes one-click paste-ready debug bundle', async ({ page }) => {
  await page.route('https://openrouter.ai/**', async route => {
    const url = new URL(route.request().url());
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

  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEBUG_BUNDLE?.collect)).toBe('function');
  await page.locator('#diagnosticsButton').click();
  await expect(page.locator('#copyDebugBundle')).toBeVisible();
  await expect(page.locator('#debugBundleHint')).toContainText('paste the entire result into ChatGPT');

  const bundle = await page.evaluate(() => window.VIZ_DEBUG_BUNDLE.collect());
  expect(bundle.schema).toBe('visualizer-debug-bundle-v1');
  expect(bundle.identity.live.displayName).toBe('Calibration Bloom');
  expect(bundle.identity.next.displayName).toBe('Choose a model');
  expect(bundle.page.developerMode).toBe(true);
  expect(JSON.stringify(bundle)).not.toMatch(/waveform|spectrum|authorization/i);
});
