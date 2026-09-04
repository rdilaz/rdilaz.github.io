import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openRouterSseBody, openRouterSseHeaders } from './helpers/openrouter-sse.mjs';

const MODEL_ID = 'moonshotai/kimi-k3';
const MODEL_NAME = 'Kimi K3';
const SENTINEL_KEY = 'sk-or-v1-PRODUCT_SHELL_NO_SPEND_FIXTURE';
const validHtml = await readFile(new URL('./fixtures/valid-canvas2d.html', import.meta.url), 'utf8');
const blankHtml = await readFile(new URL('./fixtures/blank.html', import.meta.url), 'utf8');
const busyActiveCrashHtml = await readFile(new URL('./fixtures/busy-active-crash.html', import.meta.url), 'utf8');
const openWatchdogCrashHtml = await readFile(new URL('./fixtures/open-watchdog-crash.html', import.meta.url), 'utf8');
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
    supported_parameters: ['reasoning', 'temperature', 'max_tokens'],
    pricing: { prompt: '0.000001', completion: '0.00001', request: '0' },
    context_length: 131072,
  }],
};

async function routeOpenRouter(page, completion = null) {
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
    if (url.pathname === '/api/v1/chat/completions' && completion) {
      await completion(route);
      return;
    }
    await route.abort('blockedbyclient');
  });
}

async function seedConnectedModel(page) {
  await page.addInitScript(({ modelId, key }) => {
    localStorage.setItem('ai-visualizer.selected-model', modelId);
    localStorage.setItem('ai-visualizer.spend.settings.v1', JSON.stringify({
      perDream: 0.75,
      session: 5,
      daily: 10,
      confirmAbove: 0.15,
      confirmExpensive: false,
    }));
    sessionStorage.setItem('ai-visualizer.openrouter.key', key);
  }, { modelId: MODEL_ID, key: SENTINEL_KEY });
}

function providerPayload(html) {
  return {
    id: 'product-shell-generation',
    model: MODEL_ID,
    choices: [{ index: 0, message: { role: 'assistant', content: html }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, cost: 0 },
  };
}

function streamedCompletion(html, requestId = '') {
  const payload = providerPayload(html);
  return {
    headers: { ...corsHeaders, ...openRouterSseHeaders(payload, requestId) },
    body: openRouterSseBody(payload),
  };
}

async function seedReadyDream(page, html, { id = 'saved-while-working', modelName = 'Saved While Working', createdAt = Date.now() - 1000 } = {}) {
  await page.evaluate(async ({ visualizerHtml, generationId, generationModelName, generationCreatedAt }) => {
    const request = indexedDB.open('ai-visualizer-v0', 2);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('generations', 'readwrite');
    transaction.objectStore('generations').put({
      schema: 'visualizer-generation-v1',
      id: generationId,
      source: 'local',
      modelId: 'fixture/saved',
      modelName: generationModelName,
      provider: 'fixture',
      providerId: 'openrouter',
      resolvedModel: 'fixture/saved',
      promptVersion: 'visualizer-prompt-v2',
      audioApiVersion: 'visualizer-audio-v1',
      createdAt: generationCreatedAt,
      readyAt: generationCreatedAt,
      favorite: false,
      html: visualizerHtml,
      healthStatus: 'ready',
      openStatus: 'ready-to-open',
      preflightEvidence: { passed: true, schema: 'dream-reliability-v1' },
      modelFitConfiguration: {
        modelId: 'fixture/saved',
        reasoningChoice: 'default',
        promptProfileId: 'neutral-v1',
        promptVersion: 'visualizer-prompt-v2',
        promptHash: 'fixture-historical-prompt-hash',
        generationEnvelopeMajorVersion: 1,
        audioApiVersion: 'visualizer-audio-v1',
        reliabilityVersion: 'dream-reliability-v1',
        runtimeVersion: 'visualizer-runtime-v1',
      },
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, { visualizerHtml: html, generationId: id, generationModelName: modelName, generationCreatedAt: createdAt });
}

test('first visit is useful and trusted visual pause preserves LIVE and iframe state', async ({ page }) => {
  await routeOpenRouter(page);
  await page.goto('/visualizer/index.html');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  await expect.poll(() => page.evaluate(() => window.VIZ_DEV.identity().live.kind)).toBe('featured');
  const startupIdentity = await page.evaluate(() => window.VIZ_DEV.identity().live);
  expect(startupIdentity.kind).toBe('featured');
  expect(startupIdentity.artifactId).toBe('calibration-bloom');
  expect(await page.evaluate(async () => (await (await import('/visualizer/featured-dreams.js')).loadFeaturedDreams())[0].contentDigestVerified)).toBe(true);
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#audioButton')).toBeVisible();
  await expect(page.locator('#switcherButton')).toBeVisible();
  await expect(page.locator('#modelButton')).toBeVisible();
  await expect(page.locator('#promptLabButton')).toBeVisible();
  await expect(page.locator('#dreamButton')).toBeVisible();
  await expect(page.locator('#fullscreenButton')).toBeVisible();
  await expect(page.locator('#modelDrawer')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.top-chrome #spendButton')).toHaveCount(0);
  await expect(page.locator('#diagnosticsButton')).toBeHidden();

  await page.locator('#modelButton').click();
  await expect(page.locator('#modelDrawer')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#modelDrawer [data-close-drawer]')).toBeFocused();
  expect(await page.evaluate(() => document.getElementById('stage').inert)).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#modelDrawer')))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modelDrawer')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#modelButton')).toBeFocused();

  await page.locator('#switcherButton').click();
  await expect(page.locator('[data-switcher-group="featured"] h3')).toHaveText('Featured');
  await expect(page.locator('[data-switcher-group="favorites"] h3')).toHaveText('Favorites');
  await expect(page.locator('[data-switcher-group="recent"] h3')).toHaveText('Recent');
  await expect(page.getByRole('button', { name: /Current Dream: Calibration Bloom/ })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-switcher-group="featured"]')).toContainText('Klangfiguren');
  await expect(page.locator('[data-switcher-group="featured"]')).toContainText('Calibration Bloom');
  await expect(page.locator('[data-switcher-group="featured"]')).toContainText('Host-authored');
  await page.locator('#dreamSwitcherClose').click();

  const before = await page.evaluate(async () => ({
    state: window.VIZ_DEV.state(),
    probe: await window.VIZ_DEV.probeActive('product-before-pause'),
  }));
  expect(before.probe.visual.visibleProof).toBe(true);
  expect(before.probe.viz.consumed).toBe(true);
  await page.locator('#playbackButton').click();
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#pauseOverlay')).toBeVisible();
  await expect(page.locator('#pauseMessage')).toHaveText('Visual paused');
  await page.waitForTimeout(140);
  const pausedStart = await page.evaluate(() => window.VIZ_DEV.probeActive('product-pause-start'));
  await page.waitForTimeout(360);
  const pausedHeld = await page.evaluate(() => window.VIZ_DEV.probeActive('product-pause-held'));
  const pausedState = await page.evaluate(() => window.VIZ_DEV.state());
  expect(pausedState.activeSessionId).toBe(before.state.activeSessionId);
  expect(pausedHeld.viz.hostFrames).toBe(pausedStart.viz.hostFrames);
  expect(pausedHeld.runtime.rafCallbacks).toBe(pausedStart.runtime.rafCallbacks);
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');

  await page.locator('#playbackButton').click();
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(260);
  const resumed = await page.evaluate(() => window.VIZ_DEV.probeActive('product-resumed'));
  expect(resumed.viz.hostFrames).toBeGreaterThan(pausedHeld.viz.hostFrames);
  expect(resumed.runtime.rafCallbacks).toBeGreaterThan(pausedHeld.runtime.rafCallbacks);
});

test('390x844 keeps the canvas, product controls, switcher and Prompt usable without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await routeOpenRouter(page);
  await page.goto('/visualizer/index.html');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    controls: document.getElementById('controls').getBoundingClientRect().toJSON(),
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  expect(layout.controls.left).toBeGreaterThanOrEqual(0);
  expect(layout.controls.right).toBeLessThanOrEqual(layout.width);
  expect(layout.controls.bottom).toBeLessThanOrEqual(844);
  await expect(page.locator('#playbackButton')).toBeVisible();
  await expect(page.locator('#switcherButton')).toBeVisible();
  await expect(page.locator('#fullscreenButton')).toBeVisible();

  await page.locator('#switcherButton').click();
  const switcherBounds = await page.locator('#dreamSwitcherPanel').boundingBox();
  expect(switcherBounds.x).toBeGreaterThanOrEqual(0);
  expect(switcherBounds.x + switcherBounds.width).toBeLessThanOrEqual(390);
  await expect(page.locator('[data-switcher-group="featured"]')).toContainText('Aural Cymatics: Genesis of Harmonic Form');
  await expect(page.locator('[data-switcher-group="featured"]')).toContainText('Klangfiguren');
  await expect(page.locator('[data-switcher-group="featured"]')).toContainText('Calibration Bloom');
  await page.locator('#dreamSwitcherPanel').press('Escape');
  await expect(page.locator('#dreamSwitcherPanel')).toBeHidden();
  await expect(page.locator('#switcherButton')).toBeFocused();

  await page.locator('#promptLabButton').click();
  await expect(page.locator('#promptLabDialog')).toBeVisible();
  await expect(page.locator('#promptLabEditor')).toBeVisible();
  await page.locator('.prompt-lab__close').click();
  await expect(page.locator('#promptLabDialog')).toBeHidden();
});

test('slow background job collapses, survives pause and switching, persists Ready, then opens once', async ({ page }) => {
  test.setTimeout(90000);
  await seedConnectedModel(page);
  let completionRequests = 0;
  let completionStarted = false;
  let releaseCompletion;
  const completionGate = new Promise(resolve => { releaseCompletion = resolve; });
  await routeOpenRouter(page, async route => {
    completionRequests += 1;
    completionStarted = true;
    await completionGate;
    await route.fulfill({
      status: 200,
      ...streamedCompletion(validHtml, 'product-shell-request'),
    });
  });

  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await seedReadyDream(page, validHtml);
  await page.locator('#switcherButton').click();
  await page.locator('#libraryButton').click();
  await page.locator('#libraryDrawer [data-close-drawer]').click();

  await page.locator('#dreamButton').click();
  await expect.poll(() => completionStarted).toBe(true);
  await expect(page.locator('#dreamJobPhase')).toHaveText('Model working');
  await expect(page.locator('#dreamJobPanel')).toBeVisible();
  await expect(page.locator('#dreamJobPillButton')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#switcherButton').click();
  await expect(page.locator('#dreamJobPanel')).toBeHidden();
  await expect(page.locator('#dreamJobPill')).toBeVisible();
  await expect(page.locator('#dreamJobPillButton')).toHaveAttribute('aria-expanded', 'false');
  const desktopOverlayGap = await page.evaluate(() => {
    const switcher = document.getElementById('dreamSwitcherPanel').getBoundingClientRect();
    const pill = document.getElementById('dreamJobPill').getBoundingClientRect();
    return switcher.bottom <= pill.top || pill.bottom <= switcher.top || switcher.right <= pill.left || pill.right <= switcher.left;
  });
  expect(desktopOverlayGap).toBe(true);
  await page.locator('#dreamSwitcherClose').click();
  await page.locator('#dreamJobPillButton').click();
  await expect(page.locator('#dreamJobPanel')).toBeVisible();
  await page.locator('#dreamJobCollapse').click();
  await expect(page.locator('#dreamJobPanel')).toBeHidden();
  await expect(page.locator('#dreamJobPill')).toBeVisible();
  await expect(page.locator('#dreamJobPillButton')).toBeFocused();
  expect(completionRequests).toBe(1);
  await expect(page.locator('#dreamButton')).toBeDisabled();

  await page.locator('#playbackButton').click();
  await page.locator('#switcherButton').click();
  await page.locator('.dream-switcher__item').filter({ hasText: 'Saved While Working' }).locator('.dream-switcher__choose').click();
  await expect(page.locator('#liveIdentityName')).toContainText('Saved While Working', { timeout: 35000 });
  await expect(page.locator('#dreamJobPillPhase')).toHaveText('Model working');
  const reopenedEvidence = await page.evaluate(async () => {
    const fit = window.VIZ_DEV.modelFit().configurations.find(entry => entry.identity.modelId === 'fixture/saved');
    const request = indexedDB.open('ai-visualizer-v0', 2);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('generations', 'readonly');
    const getRequest = transaction.objectStore('generations').get('saved-while-working');
    const generation = await new Promise((resolve, reject) => {
      getRequest.onsuccess = () => resolve(getRequest.result);
      getRequest.onerror = () => reject(getRequest.error);
    });
    db.close();
    return { fit, generation };
  });
  expect(reopenedEvidence.fit.identity).toMatchObject({
    reliabilityVersion: 'dream-reliability-v3',
    runtimeVersion: 'visualizer-runtime-v3',
  });
  expect(reopenedEvidence.generation.modelFitConfiguration).toMatchObject({
    reliabilityVersion: 'dream-reliability-v1',
    runtimeVersion: 'visualizer-runtime-v1',
  });
  expect(reopenedEvidence.generation.preflightEvidence).toMatchObject({
    schema: 'dream-reliability-v3',
    passed: true,
    source: 'full-revalidation',
  });
  await expect(page.locator('#playbackButton')).toHaveAttribute('aria-pressed', 'true');
  const switchedPaused = await page.evaluate(() => window.VIZ_DEV.probeActive('switched-paused'));
  await page.waitForTimeout(300);
  const switchedHeld = await page.evaluate(() => window.VIZ_DEV.probeActive('switched-held'));
  expect(switchedHeld.runtime.rafCallbacks).toBe(switchedPaused.runtime.rafCallbacks);
  expect(completionRequests).toBe(1);
  const beforeStaleLifecycle = await page.evaluate(() => window.VIZ_DEV.state().job);
  await page.evaluate(modelId => {
    window.dispatchEvent(new CustomEvent('visualizer:dream-lifecycle', {
      detail: { phase: 'checking', modelId, traceId: 'unrelated-saved-dream-trace' },
    }));
  }, MODEL_ID);
  const afterStaleLifecycle = await page.evaluate(() => window.VIZ_DEV.state().job);
  expect(afterStaleLifecycle).toEqual(beforeStaleLifecycle);

  releaseCompletion();
  await expect(page.locator('#dreamJobPillPhase')).toHaveText('Checking');
  await expect(page.locator('#dreamJobPillPhase')).toHaveText('Dream ready', { timeout: 35000 });
  await expect(page.locator('#liveIdentityName')).toContainText('Saved While Working');
  await page.locator('#playbackButton').click();
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  await expect(page.locator('#dreamJobPillPhase')).toHaveText('Dream ready');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#dreamJobPillButton').click();
  await expect(page.locator('#dreamJobOpen')).toBeVisible();
  const expandedJobGap = await page.evaluate(() => {
    const panel = document.getElementById('dreamJobPanel').getBoundingClientRect();
    const pill = document.getElementById('dreamJobPill').getBoundingClientRect();
    return panel.bottom <= pill.top || pill.bottom <= panel.top || panel.right <= pill.left || pill.right <= panel.left;
  });
  expect(expandedJobGap).toBe(true);
  const openBounds = await page.locator('#dreamJobOpen').boundingBox();
  expect(openBounds.x + openBounds.width).toBeLessThanOrEqual(390);
  await page.locator('#dreamJobFavorite').click();
  await page.locator('#dreamJobCollapse').click();
  await page.locator('#switcherButton').click();
  await expect(page.locator('#dreamJobPill')).toBeVisible();
  const mobileOverlayGap = await page.evaluate(() => {
    const switcher = document.getElementById('dreamSwitcherPanel').getBoundingClientRect();
    const pill = document.getElementById('dreamJobPill').getBoundingClientRect();
    return switcher.bottom <= pill.top || pill.bottom <= switcher.top || switcher.right <= pill.left || pill.right <= switcher.left;
  });
  expect(mobileOverlayGap).toBe(true);
  await expect(page.locator('[data-switcher-group="favorites"]')).toContainText(MODEL_NAME);
  await page.locator('[data-switcher-group="favorites"] .dream-switcher__item').filter({ hasText: MODEL_NAME }).locator('.dream-switcher__favorite').click();
  await expect(page.locator('[data-switcher-group="favorites"]')).not.toContainText(MODEL_NAME);
  expect(await page.evaluate(() => document.activeElement?.dataset.switcherAction)).toBe('favorite');
  await page.locator('[data-switcher-group="recent"] .dream-switcher__item').filter({ hasText: MODEL_NAME }).locator('.dream-switcher__favorite').click();
  await expect(page.locator('[data-switcher-group="favorites"]')).toContainText(MODEL_NAME);
  await page.locator('#dreamSwitcherClose').click();
  await page.locator('#dreamJobPillOpen').click();
  await expect(page.locator('#liveIdentityName')).toContainText(/Kimi K3.*#[a-f0-9]{8}/i, { timeout: 35000 });
  await expect(page.locator('#favoriteButton')).toHaveAttribute('aria-pressed', 'true');
  expect(completionRequests).toBe(1);
  const finalLayout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(finalLayout.scrollWidth).toBeLessThanOrEqual(finalLayout.width);
});

test('cancellation is terminal, truthful, single-request, and never changes LIVE', async ({ page }) => {
  await seedConnectedModel(page);
  let requests = 0;
  let requestStarted = false;
  await routeOpenRouter(page, async route => {
    requests += 1;
    requestStarted = true;
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.fulfill({ status: 200, ...streamedCompletion(validHtml) });
  });
  await page.goto('/visualizer/index.html');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await page.locator('#dreamButton').click();
  await expect.poll(() => requestStarted).toBe(true);
  await expect(page.locator('#dreamButton')).toBeDisabled();
  await page.locator('#dreamCancelButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Cancelled', { timeout: 10000 });
  await expect(page.locator('#dreamJobOpen')).toBeHidden();
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  const uncertainSpend = await page.evaluate(() => ({
    spent: Number(sessionStorage.getItem('ai-visualizer.spend.session.v1') || 0),
    ledger: JSON.parse(sessionStorage.getItem('ai-visualizer.spend.ledger.v1') || '[]'),
  }));
  expect(uncertainSpend.spent).toBeGreaterThan(0);
  expect(uncertainSpend.ledger[0].uncertain).toBe(true);
  expect(requests).toBe(1);
});

test('unavailable durable storage blocks paid generation before dispatch', async ({ page }) => {
  await seedConnectedModel(page);
  await page.addInitScript(() => {
    Object.defineProperty(indexedDB, 'open', {
      configurable: true,
      value() { throw new Error('fixture IndexedDB unavailable'); },
    });
  });
  let completionRequests = 0;
  await routeOpenRouter(page, async route => {
    completionRequests += 1;
    await route.fulfill({ status: 200, ...streamedCompletion(validHtml) });
  });
  await page.goto('/visualizer/index.html');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#toast')).toContainText('no paid request was sent');
  await expect(page.locator('#dreamJobPill')).toBeHidden();
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  expect(completionRequests).toBe(0);
});

test('concurrent developer retests serialize the shared candidate slot', async ({ page }) => {
  test.setTimeout(30000);
  await routeOpenRouter(page);
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  const results = await page.evaluate(async ({ valid, blank }) => Promise.all([
    window.VIZ_DEV.testHtml(valid, 'serialized valid fixture'),
    window.VIZ_DEV.testHtml(blank, 'serialized blank fixture'),
  ]), { valid: validHtml, blank: blankHtml });
  expect(results.map(result => result.status).sort()).toEqual(['failed', 'succeeded']);
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
});

test('active failure during a failed Open is latched and recovered afterward', async ({ page }) => {
  test.setTimeout(60000);
  await routeOpenRouter(page);
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  await seedReadyDream(page, busyActiveCrashHtml, { id: 'busy-active', modelName: 'Busy Active Dream', createdAt: Date.now() - 2000 });
  await seedReadyDream(page, openWatchdogCrashHtml, { id: 'failed-next', modelName: 'Failed Next Dream', createdAt: Date.now() - 1000 });
  await page.locator('#switcherButton').click();
  await page.locator('#libraryButton').click();
  await page.locator('#libraryDrawer [data-close-drawer]').click();

  await page.locator('#switcherButton').click();
  await page.locator('.dream-switcher__item').filter({ hasText: 'Busy Active Dream' }).locator('.dream-switcher__choose').click();
  await expect(page.locator('#liveIdentityName')).toContainText('Busy Active Dream', { timeout: 20000 });
  await page.locator('#switcherButton').click();
  await page.locator('.dream-switcher__item').filter({ hasText: 'Failed Next Dream' }).locator('.dream-switcher__choose').click();
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom', { timeout: 30000 });
  await expect.poll(() => page.evaluate(() => window.VIZ_DEV.state().recovering)).toBe(false);
});
