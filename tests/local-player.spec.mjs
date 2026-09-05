import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openRouterSseBody, openRouterSseHeaders } from './helpers/openrouter-sse.mjs';
import { syntheticToneWav } from './helpers/synthetic-audio.mjs';

const MODEL_ID = 'fixture/first-session-model';
const MODEL_NAME = 'First Session Fixture';
const SENTINEL_KEY = 'sk-or-v1-FIRST_SESSION_NO_SPEND_FIXTURE';
const CANARY_FILENAME = '<img src=x onerror=filenameCanary>.wav';
const validHtml = await readFile(new URL('./fixtures/valid-canvas2d.html', import.meta.url), 'utf8');
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'x-request-id, x-generation-id',
  'content-type': 'application/json',
};
const catalog = {
  data: [{
    id: MODEL_ID,
    name: MODEL_NAME,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    top_provider: { max_completion_tokens: 32000 },
    supported_parameters: ['temperature', 'max_tokens'],
    pricing: { prompt: '0.000001', completion: '0.000001', request: '0' },
    context_length: 131072,
  }],
};

function audioFile(name, { durationSeconds = 2, frequency = 440 } = {}) {
  return {
    name,
    mimeType: 'audio/wav',
    buffer: syntheticToneWav({ durationSeconds, frequency }),
  };
}

async function blockProvider(page) {
  const state = { completions: 0 };
  await page.route('https://openrouter.ai/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/v1/chat/completions') state.completions += 1;
    await route.abort('blockedbyclient');
  });
  return state;
}

async function routeMockProvider(page, { delayMs = 0 } = {}) {
  const state = { completionBodies: [] };
  await page.route('https://openrouter.ai/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/models') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify(catalog) });
      return;
    }
    if (url.pathname === '/api/v1/key') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify({ data: { limit_remaining: 20 } }) });
      return;
    }
    if (url.pathname === '/api/v1/chat/completions') {
      state.completionBodies.push(route.request().postData() || '');
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      const payload = {
        id: 'first-session-fixture-generation',
        model: MODEL_ID,
        choices: [{ index: 0, message: { role: 'assistant', content: validHtml }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, cost: 0 },
      };
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, ...openRouterSseHeaders(payload, 'first-session-request') },
        body: openRouterSseBody(payload),
      });
      return;
    }
    await route.abort('blockedbyclient');
  });
  return state;
}

async function seedReturningVisit(page, { connectedModel = false, auditUrls = false } = {}) {
  await page.addInitScript(({ connected, key, modelId, trackUrls }) => {
    localStorage.setItem('ai-visualizer.first-session.v1', 'complete');
    if (connected) {
      localStorage.setItem('ai-visualizer.selected-model', modelId);
      localStorage.setItem('ai-visualizer.spend.settings.v1', JSON.stringify({
        perDream: 0.75,
        session: 5,
        daily: 10,
        confirmAbove: 0.15,
        confirmExpensive: false,
      }));
      sessionStorage.setItem('ai-visualizer.openrouter.key', key);
    }
    if (trackUrls) {
      const nativeCreate = URL.createObjectURL.bind(URL);
      const nativeRevoke = URL.revokeObjectURL.bind(URL);
      window.__localUrlAudit = { created: [], revoked: [] };
      URL.createObjectURL = value => {
        const url = nativeCreate(value);
        window.__localUrlAudit.created.push(url);
        return url;
      };
      URL.revokeObjectURL = url => {
        window.__localUrlAudit.revoked.push(url);
        nativeRevoke(url);
      };
    }
  }, { connected: connectedModel, key: SENTINEL_KEY, modelId: MODEL_ID, trackUrls: auditUrls });
}

async function openVisualizer(page) {
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  await expect.poll(() => page.evaluate(() => window.VIZ_DEV.state().activeSessionId)).not.toBe('');
}

async function chooseLocalFiles(page, files) {
  await page.locator('#audioButton').click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#audioLocalOption').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
}

test('real local WAV decoding drives normalized analysis and complete compact transport controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await seedReturningVisit(page, { auditUrls: true });
  const provider = await blockProvider(page);
  await openVisualizer(page);
  const sessionBefore = await page.evaluate(() => window.VIZ_DEV.state().activeSessionId);
  await chooseLocalFiles(page, [
    audioFile('alpha-tone.wav', { durationSeconds: 3, frequency: 220 }),
    audioFile('beta-tone.wav', { durationSeconds: 3, frequency: 660 }),
  ]);

  await expect(page.locator('#localTransport')).toBeVisible();
  const mobileLayout = await page.evaluate(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    transport: document.getElementById('localTransport').getBoundingClientRect().toJSON(),
  }));
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.viewport);
  expect(mobileLayout.transport.left).toBeGreaterThanOrEqual(0);
  expect(mobileLayout.transport.right).toBeLessThanOrEqual(320);
  await expect(page.locator('#localTrackName')).toHaveText('alpha-tone.wav');
  expect(await page.locator('#localTrackName').evaluate(element => element.tagName)).toBe('STRONG');
  await expect(page.locator('#audioButtonLabel')).toHaveText('Local music');
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-label', 'Play local music and visual');
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => ({
    paused: document.querySelector('[data-local-audio]').paused,
    currentTime: document.querySelector('[data-local-audio]').currentTime,
  }))).toEqual({ paused: true, currentTime: 0 });

  await page.locator('#playbackButton').click();
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-label', 'Pause local music and visual');
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => window.VIZ_DEV.audioAnalysis()?.volume || 0)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-local-audio]').currentTime)).toBeGreaterThan(.12);
  await page.locator('#localSeek').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.VIZ_DEV.immersive().blocker)).toBe('keyboard-focus');
  await expect(page.locator('body')).not.toHaveClass(/ui-hidden/);

  await page.locator('#localPlayButton').click();
  await expect(page.locator('#pauseMessage')).toHaveText('Local music and visual paused');
  const pausedAt = await page.evaluate(() => document.querySelector('[data-local-audio]').currentTime);
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => document.querySelector('[data-local-audio]').currentTime)).toBeLessThanOrEqual(pausedAt + .03);
  await page.locator('#localSeek').evaluate(element => {
    element.value = '1.2';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-local-audio]').currentTime)).toBeGreaterThan(1.15);

  await page.locator('#localNextButton').click();
  await expect(page.locator('#localTrackName')).toHaveText('beta-tone.wav');
  expect(await page.evaluate(() => document.querySelector('[data-local-audio]').paused)).toBe(true);
  await page.locator('#localPreviousButton').click();
  await expect(page.locator('#localTrackName')).toHaveText('alpha-tone.wav');
  expect(await page.evaluate(() => window.VIZ_DEV.state().activeSessionId)).toBe(sessionBefore);

  await page.locator('#localQueueDetails summary').click();
  const betaRow = page.locator('.local-queue__item').filter({ hasText: 'beta-tone.wav' });
  await betaRow.getByRole('button', { name: /Remove beta-tone/ }).click();
  await expect(page.locator('#localQueueSummary')).toHaveText('Queue (1)');
  const touchTargets = await page.locator('#localTransport button, #localTransport summary, #localSeek').evaluateAll(elements => (
    elements.filter(element => !element.disabled).map(element => element.getBoundingClientRect().height)
  ));
  expect(touchTargets.every(height => height >= 44)).toBe(true);
  await page.locator('#localClearQueue').click();
  await expect(page.locator('#localTransport')).toBeHidden();
  await expect(page.locator('#audioButtonLabel')).toHaveText('Connect audio');
  await expect(page.locator('#audioButton')).toBeFocused();
  const urlAudit = await page.evaluate(() => window.__localUrlAudit);
  expect(urlAudit.revoked.sort()).toEqual(urlAudit.created.sort());
  expect(new Set(urlAudit.revoked).size).toBe(urlAudit.revoked.length);
  expect(provider.completions).toBe(0);
});

test('a started queue advances once, then pauses local music and visuals at its end', async ({ page }) => {
  await seedReturningVisit(page);
  await blockProvider(page);
  await openVisualizer(page);
  const sessionBefore = await page.evaluate(() => window.VIZ_DEV.state().activeSessionId);
  await chooseLocalFiles(page, [
    audioFile('short-one.wav', { durationSeconds: .32, frequency: 330 }),
    audioFile('short-two.wav', { durationSeconds: .32, frequency: 550 }),
  ]);
  await expect(page.locator('#localTransport')).toBeVisible();
  await page.locator('#localPlayButton').click();
  await expect(page.locator('#localTrackName')).toHaveText('short-two.wav', { timeout: 5000 });
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
  await expect(page.locator('#pauseMessage')).toHaveText('Local music and visual paused');
  expect(await page.evaluate(() => document.querySelector('[data-local-audio]').paused)).toBe(true);
  expect(await page.evaluate(() => window.VIZ_DEV.state().activeSessionId)).toBe(sessionBefore);
});

test('picker cancellation and corrupt replacement preserve current playback; malicious names stay inert and play rejection is truthful', async ({ page }) => {
  await seedReturningVisit(page, { auditUrls: true });
  const provider = await blockProvider(page);
  await openVisualizer(page);
  await chooseLocalFiles(page, [audioFile('current-tone.wav', { durationSeconds: 8 })]);
  await expect(page.locator('#localTransport')).toBeVisible();
  await page.locator('#localPlayButton').click();
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-local-audio]').currentTime)).toBeGreaterThan(.1);
  await page.evaluate(() => { window.__currentLocalElement = document.querySelector('[data-local-audio]'); });

  await page.locator('#audioButton').click();
  const cancelChooserPromise = page.waitForEvent('filechooser');
  await page.locator('#audioLocalOption').click();
  const cancelChooser = await cancelChooserPromise;
  await cancelChooser.setFiles([]);
  const beforeCancelWait = await page.evaluate(() => document.querySelector('[data-local-audio]').currentTime);
  await page.waitForTimeout(160);
  expect(await page.evaluate(() => document.querySelector('[data-local-audio]').currentTime)).toBeGreaterThan(beforeCancelWait);

  await page.locator('#localFileInput').setInputFiles({
    name: 'corrupt-audio.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('not audio - deterministic test-only corrupt fixture'),
  });
  await expect(page.locator('#toast')).toContainText('could not be opened as browser-decodable audio');
  expect(await page.evaluate(() => document.querySelector('[data-local-audio]') === window.__currentLocalElement)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('[data-local-audio]').paused)).toBe(false);

  await page.locator('#localFileInput').setInputFiles(audioFile(CANARY_FILENAME, { durationSeconds: 4 }));
  await expect(page.locator('#localTrackName')).toHaveText(CANARY_FILENAME);
  await expect(page.locator('#localTransport img')).toHaveCount(0);
  expect(await page.evaluate(() => window.filenameCanary)).toBeUndefined();
  await page.evaluate(() => {
    const element = document.querySelector('[data-local-audio]');
    element.play = () => Promise.reject(new DOMException('test-only play rejection', 'NotAllowedError'));
  });
  await page.locator('#playbackButton').click();
  await expect(page.locator('#toast')).toContainText('Local audio could not start');
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.querySelector('[data-local-audio]').paused)).toBe(true);
  expect(provider.completions).toBe(0);
});

test('unavailable Web Audio rejects a valid local file without changing LIVE', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ai-visualizer.first-session.v1', 'complete');
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
  });
  const provider = await blockProvider(page);
  await openVisualizer(page);
  await page.locator('#localFileInput').setInputFiles(audioFile('valid-but-no-web-audio.wav'));
  await expect(page.locator('#toast')).toContainText('Web Audio is not available');
  await expect(page.locator('#localTransport')).toBeHidden();
  await expect(page.locator('#audioButtonLabel')).toHaveText('Connect audio');
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  expect(provider.completions).toBe(0);
});

test('Featured switching and mocked background Dream/Open never restart local music or leak its filename', async ({ page }) => {
  test.setTimeout(120000);
  await seedReturningVisit(page, { connectedModel: true });
  const provider = await routeMockProvider(page, { delayMs: 900 });
  await openVisualizer(page);
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await chooseLocalFiles(page, [audioFile(CANARY_FILENAME, { durationSeconds: 240, frequency: 262 })]);
  await expect(page.locator('#localTransport')).toBeVisible();
  await page.locator('#localPlayButton').click();
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-local-audio]').currentTime)).toBeGreaterThan(.1);
  await page.evaluate(() => { window.__longLocalElement = document.querySelector('[data-local-audio]'); });
  const beforeFeatured = await page.evaluate(() => window.__longLocalElement.currentTime);

  await page.locator('#switcherButton').click();
  await page.locator('[data-dream-key="featured:klangfiguren"] .dream-switcher__choose').click();
  await expect(page.locator('#liveIdentityName')).toHaveText('Klangfiguren', { timeout: 35000 });
  expect(await page.evaluate(() => document.querySelector('[data-local-audio]') === window.__longLocalElement)).toBe(true);
  expect(await page.evaluate(() => window.__longLocalElement.currentTime)).toBeGreaterThan(beforeFeatured);

  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPanel')).toBeVisible();
  await page.locator('#switcherButton').click();
  await page.locator('[data-dream-key="featured:calibration-bloom"] .dream-switcher__choose').click();
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom', { timeout: 35000 });
  await expect(page.locator('#dreamJobPillOpen')).toBeVisible({ timeout: 60000 });
  const beforeOpen = await page.evaluate(() => window.__longLocalElement.currentTime);
  await page.locator('#dreamJobPillOpen').click();
  await expect(page.locator('#liveIdentityName')).toContainText(MODEL_NAME, { timeout: 35000 });
  expect(await page.evaluate(() => document.querySelector('[data-local-audio]') === window.__longLocalElement)).toBe(true);
  expect(await page.evaluate(() => window.__longLocalElement.currentTime)).toBeGreaterThan(beforeOpen);
  expect(await page.evaluate(() => window.__longLocalElement.paused)).toBe(false);

  await page.locator('#favoriteButton').click();
  await page.locator('#switcherButton').click();
  await expect(page.locator('[data-switcher-group="favorites"]')).toContainText(MODEL_NAME);
  const downloadPromise = page.waitForEvent('download');
  const exportedDiagnostics = await page.evaluate(() => window.VIZ_DEV.exportAll());
  await downloadPromise;
  expect(JSON.stringify(exportedDiagnostics)).not.toContain(CANARY_FILENAME);
  const privacyEvidence = await page.evaluate(async canary => ({
    state: JSON.stringify(window.VIZ_DEV.state()),
    analysis: JSON.stringify(window.VIZ_DEV.audioAnalysis()),
    diagnostics: JSON.stringify(await window.VIZ_DEV.list()),
    trace: JSON.stringify(await window.VIZ_DEV.latestTrace()),
    modelMatrix: JSON.stringify(window.VIZ_DEV.modelTestMatrix()),
    canary,
  }), CANARY_FILENAME);
  for (const [kind, value] of Object.entries(privacyEvidence)) {
    if (kind === 'canary') continue;
    expect(value, `${kind} must omit local filenames`).not.toContain(CANARY_FILENAME);
  }
  expect(provider.completionBodies).toHaveLength(1);
  expect(provider.completionBodies[0]).not.toContain(CANARY_FILENAME);
  const probe = await page.evaluate(() => window.VIZ_DEV.probeActive('local-player-privacy'));
  expect(probe.viz.consumed).toBe(true);
  expect(JSON.stringify(probe)).not.toContain(CANARY_FILENAME);
});
