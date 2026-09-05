import { expect, test } from '@playwright/test';

async function blockExternalEndpoints(page) {
  const calls = { completions: 0 };
  await page.route('https://openrouter.ai/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/v1/chat/completions') calls.completions += 1;
    await route.abort('blockedbyclient');
  });
  return calls;
}

async function openVisualizer(page) {
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
}

test('fresh story explains trust and its actions open existing paths without changing LIVE', async ({ page }) => {
  const calls = await blockExternalEndpoints(page);
  await openVisualizer(page);

  const story = page.locator('#firstSessionStory');
  await expect(story).toBeVisible();
  expect(await story.evaluate(element => element.contains(document.activeElement))).toBe(false);
  await expect(story).toContainText('AI creates the visual instrument. Your music stays on this device.');
  await expect(story).toContainText('A Dream is a reusable visual instrument, not a video generated from an uploaded song.');
  await expect(story).toContainText('Calibration Bloom is the built-in startup');
  const before = await page.evaluate(() => ({
    identity: window.VIZ_DEV.identity(),
    sessionId: window.VIZ_DEV.state().activeSessionId,
  }));

  await page.locator('#firstSessionExplore').click();
  await expect(story).toBeHidden();
  await expect(page.locator('#dreamSwitcherPanel')).toBeVisible();
  await expect(page.locator('[data-switcher-group="featured"] [data-switcher-choose]').first()).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('ai-visualizer.first-session.v1'))).toBe('complete');

  const klangGuide = page.locator('[data-dream-guide="klangfiguren"]');
  await klangGuide.locator('summary').focus();
  await klangGuide.locator('summary').press('Enter');
  await expect(klangGuide).toHaveAttribute('open', '');
  await expect(klangGuide).toContainText('not a scientifically exact simulation or a pitch detector');
  await expect(klangGuide).toContainText('move a pointer to stir the sand');
  const nexusGuide = page.locator('[data-dream-guide="nexus-beam"]');
  await nexusGuide.locator('summary').click();
  await expect(nexusGuide).toContainText('Kinetic Harmonic Astrolabe');
  const calibrationGuide = page.locator('[data-dream-guide="calibration-bloom"]');
  await calibrationGuide.locator('summary').click();
  await expect(calibrationGuide).toContainText('host-created, not AI-generated');

  const afterGuides = await page.evaluate(() => ({
    identity: window.VIZ_DEV.identity(),
    sessionId: window.VIZ_DEV.state().activeSessionId,
  }));
  expect(afterGuides).toEqual(before);
  await page.locator('#dreamSwitcherClose').click();

  await page.locator('#infoButton').click();
  await page.locator('#reopenFirstSession').click();
  await expect(story).toBeVisible();
  await expect(page.locator('#firstSessionConnect')).toBeFocused();
  await page.locator('#firstSessionConnect').click();
  await expect(page.locator('#audioPicker')).toBeVisible();
  expect(await page.evaluate(() => window.VIZ_DEV.state().audioConnected)).toBe(false);
  await page.locator('#audioPickerClose').click();
  await expect(page.locator('#audioButton')).toBeFocused();
  expect(await page.evaluate(() => window.VIZ_DEV.identity())).toEqual(before.identity);
  expect(calls.completions).toBe(0);
});

test('returning preference avoids interruption and storage denial falls back in memory', async ({ page, browser }) => {
  await blockExternalEndpoints(page);
  await page.addInitScript(() => localStorage.setItem('ai-visualizer.first-session.v1', 'complete'));
  await openVisualizer(page);
  await expect(page.locator('#firstSessionStory')).toBeHidden();
  await page.locator('#infoButton').click();
  await page.locator('#reopenFirstSession').click();
  await expect(page.locator('#firstSessionConnect')).toBeFocused();
  await page.locator('#firstSessionDismiss').click();
  await expect(page.locator('#firstSessionStory')).toBeHidden();
  await expect(page.locator('#infoButton')).toBeFocused();

  const deniedContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
  const deniedPage = await deniedContext.newPage();
  await blockExternalEndpoints(deniedPage);
  await deniedPage.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('test-only storage denial', 'SecurityError'); },
    });
  });
  await openVisualizer(deniedPage);
  await expect(deniedPage.locator('#firstSessionStory')).toBeVisible();
  await deniedPage.locator('#firstSessionDismiss').click();
  await expect(deniedPage.locator('#firstSessionStory')).toBeHidden();
  await deniedPage.reload();
  await expect.poll(() => deniedPage.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  await expect(deniedPage.locator('#firstSessionStory')).toBeVisible();
  await deniedContext.close();
});

test('fresh reduced-motion visit pauses before playback and remains usable at 320 CSS pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await blockExternalEndpoints(page);
  await openVisualizer(page);
  await expect(page.locator('#firstSessionStory')).toBeVisible();
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.VIZ_DEV.playback().paused)).toBe(true);
  expect(await page.evaluate(() => window.VIZ_DEV.immersive().blocker)).toBe('first-session-open');

  const layout = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    story: document.getElementById('firstSessionStory').getBoundingClientRect().toJSON(),
    connect: document.getElementById('firstSessionConnect').getBoundingClientRect().toJSON(),
    explore: document.getElementById('firstSessionExplore').getBoundingClientRect().toJSON(),
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  expect(layout.story.left).toBeGreaterThanOrEqual(0);
  expect(layout.story.right).toBeLessThanOrEqual(320);
  expect(layout.connect.height).toBeGreaterThanOrEqual(44);
  expect(layout.explore.height).toBeGreaterThanOrEqual(44);

  await page.locator('#firstSessionDismiss').click();
  const pausedProbe = await page.evaluate(() => window.VIZ_DEV.probeActive('reduced-paused'));
  await page.waitForTimeout(180);
  const heldProbe = await page.evaluate(() => window.VIZ_DEV.probeActive('reduced-held'));
  expect(heldProbe.viz.hostFrames).toBe(pausedProbe.viz.hostFrames);
  await page.locator('#playbackButton').click();
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await page.evaluate(() => window.VIZ_DEV.probeActive('reduced-resumed'))).viz.hostFrames).toBeGreaterThan(heldProbe.viz.hostFrames);
});
