import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const MODEL_ID = 'fixture/streaming-visual-model';
const MODEL_NAME = 'Fixture Streaming Visual';
const SENTINEL_KEY = 'sk-or-v1-STREAMING_IMMERSIVE_QUALITY_NOT_REAL';
const validHtml = await readFile(new URL('./fixtures/valid-canvas2d.html', import.meta.url), 'utf8');
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'content-type': 'application/json',
};
const catalog = {
  data: [{
    id: MODEL_ID,
    name: MODEL_NAME,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    top_provider: { max_completion_tokens: 32000 },
    supported_parameters: ['temperature', 'max_tokens'],
    pricing: { prompt: '0.0000001', completion: '0.000001', request: '0' },
    context_length: 131072,
  }],
};

test.use({ deviceScaleFactor: 2 });

async function seedConnectedSession(page) {
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

async function routeOpenRouterMetadata(page, { generationData = null } = {}) {
  const state = { generationLookups: 0, unexpected: [] };
  await page.route('https://openrouter.ai/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
      return;
    }
    if (url.pathname === '/api/v1/models') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify(catalog) });
      return;
    }
    if (url.pathname === '/api/v1/key') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify({ data: { limit_remaining: 20 } }) });
      return;
    }
    if (url.pathname === '/api/v1/generation') {
      state.generationLookups += 1;
      await route.fulfill(generationData
        ? { status: 200, headers: corsHeaders, body: JSON.stringify({ data: generationData }) }
        : { status: 404, headers: corsHeaders, body: JSON.stringify({ error: { message: 'fixture metadata unavailable' } }) });
      return;
    }
    state.unexpected.push(`${request.method()} ${url.pathname}`);
    await route.abort('blockedbyclient');
  });
  return state;
}

async function installStreamFixture(page, mode = 'controlled') {
  await page.addInitScript(({ html, streamMode, modelId }) => {
    const originalFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    const state = {
      requests: [],
      abortCount: 0,
      readerCancelCount: 0,
      release: () => {},
    };
    const event = payload => `data: ${JSON.stringify(payload)}\n\n`;
    window.__streamFixture = state;
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.hostname !== 'openrouter.ai' || url.pathname !== '/api/v1/chat/completions') {
        return originalFetch(input, init);
      }
      state.requests.push(JSON.parse(init.body || '{}'));
      let source;
      let terminal = false;
      const finish = callback => {
        if (terminal) return;
        terminal = true;
        callback();
      };
      const body = new ReadableStream({
        start(controller) {
          source = controller;
          controller.enqueue(encoder.encode(': OPENROUTER PROCESSING\n\n'));
          controller.enqueue(encoder.encode(event({
            id: 'gen-controlled-stream',
            object: 'chat.completion.chunk',
            model: modelId,
            provider: 'Fixture Provider',
            choices: [{ index: 0, delta: { role: 'assistant', reasoning: 'Fixture exposed reasoning.' }, finish_reason: null }],
          })));
          controller.enqueue(encoder.encode(event({
            id: 'gen-controlled-stream',
            object: 'chat.completion.chunk',
            model: modelId,
            provider: 'Fixture Provider',
            choices: [{ index: 0, delta: { content: html }, finish_reason: null }],
          })));
          if (streamMode === 'incomplete') {
            terminal = true;
            controller.close();
          }
          if (streamMode === 'error' || streamMode === 'timeout-error') {
            controller.enqueue(encoder.encode(event({
              id: 'gen-controlled-stream',
              object: 'chat.completion.chunk',
              model: modelId,
              provider: 'Fixture Provider',
              error: streamMode === 'timeout-error'
                ? { code: 504, message: 'Fixture gateway failure' }
                : { code: 502, message: 'Fixture provider disconnected', metadata: { error_type: 'provider_unavailable' } },
              choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }],
            })));
            terminal = true;
            controller.close();
          }
        },
        cancel() {
          state.readerCancelCount += 1;
          terminal = true;
        },
      });
      state.release = () => finish(() => {
        source.enqueue(encoder.encode(event({
          id: 'gen-controlled-stream',
          object: 'chat.completion.chunk',
          model: modelId,
          provider: 'Fixture Provider',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop', native_finish_reason: 'stop' }],
          usage: { prompt_tokens: 20, completion_tokens: 40, total_tokens: 60, cost: 0 },
        })));
        source.enqueue(encoder.encode('data: [DONE]\n\n'));
        source.close();
      });
      const signal = init.signal;
      const abort = () => finish(() => {
        state.abortCount += 1;
        source.error(signal?.reason || new DOMException('Operation aborted.', 'AbortError'));
      });
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'x-request-id': 'request-controlled-stream',
          'x-generation-id': 'gen-controlled-stream',
        },
      });
    };
  }, { html: validHtml, streamMode: mode, modelId: MODEL_ID });
}

async function installNonSseHangingError(page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const state = { requests: [], abortCount: 0 };
    window.__nonSseFixture = state;
    window.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.hostname !== 'openrouter.ai' || url.pathname !== '/api/v1/chat/completions') return originalFetch(input, init);
      state.requests.push(JSON.parse(init.body || '{}'));
      let source;
      const body = new ReadableStream({ start(controller) { source = controller; } });
      const abort = () => {
        state.abortCount += 1;
        source.error(init.signal?.reason || new DOMException('Operation aborted.', 'AbortError'));
      };
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener('abort', abort, { once: true });
      return new Response(body, {
        status: 503,
        headers: {
          'content-type': 'application/json',
          'x-generation-id': 'gen-http-error-hanging',
          'x-request-id': 'request-http-error-hanging',
        },
      });
    };
  });
}

async function installFreshCatalogHang(page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const state = { calls: 0, abortCount: 0, hang: false };
    window.__catalogFixture = state;
    window.fetch = (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.hostname !== 'openrouter.ai' || url.pathname !== '/api/v1/models') return originalFetch(input, init);
      state.calls += 1;
      if (!state.hang) return originalFetch(input, init);
      return new Promise((resolve, reject) => {
        const abort = () => {
          state.abortCount += 1;
          reject(init.signal?.reason || new DOMException('Operation aborted.', 'AbortError'));
        };
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener('abort', abort, { once: true });
      });
    };
  });
}

async function generationCount(page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('ai-visualizer-v0', 2);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('generations', 'readonly');
    const countRequest = transaction.objectStore('generations').count();
    return new Promise((resolve, reject) => {
      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => reject(countRequest.error);
    });
  });
}

async function wakeChrome(page, x = 280, y = 260) {
  await page.mouse.move(x, y);
  await expect(page.locator('body')).not.toHaveClass(/ui-hidden/);
}

test('stream stays private until DONE, active job chrome hides, and iframe activity wakes it', async ({ page }) => {
  test.setTimeout(60000);
  await seedConnectedSession(page);
  const router = await routeOpenRouterMetadata(page);
  await installStreamFixture(page, 'controlled');
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await wakeChrome(page);

  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Receiving');
  expect(await generationCount(page)).toBe(0);
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  await expect(page.locator('body')).toHaveClass(/ui-hidden/, { timeout: 5000 });
  await expect(page.locator('#dreamJobPanel')).toHaveCSS('pointer-events', 'none');

  await page.mouse.move(280, 260);
  await expect(page.locator('body')).not.toHaveClass(/ui-hidden/);
  expect(await generationCount(page)).toBe(0);
  await page.evaluate(async () => {
    let acquired;
    const acquiredPromise = new Promise(resolve => { acquired = resolve; });
    const held = new Promise(resolve => { window.__releaseSpendLock = resolve; });
    void navigator.locks.request('ai-visualizer-spend-guard-v1', async () => {
      acquired();
      await held;
    });
    await acquiredPromise;
  });
  await page.evaluate(() => window.__streamFixture.release());
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream ready', { timeout: 20000 });
  expect(await generationCount(page)).toBe(1);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('ai-visualizer.spend.ledger.v1'))[0].uncertain)).toBe(true);
  await page.evaluate(() => window.__releaseSpendLock());
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('ai-visualizer.spend.ledger.v1'))[0].uncertain)).toBe(false);

  const evidence = await page.evaluate(async () => ({
    trace: await window.VIZ_DEV.latestTrace(),
    requests: window.__streamFixture.requests,
  }));
  expect(evidence.requests).toHaveLength(1);
  expect(evidence.requests[0].stream).toBe(true);
  expect(evidence.requests[0]).not.toHaveProperty('quality');
  expect(evidence.requests[0]).not.toHaveProperty('renderQuality');
  expect(evidence.trace.attempts[0].response.transport).toMatchObject({
    streamed: true,
    outcome: 'completed',
    doneReceived: true,
    usageReceived: true,
    providerGenerationId: 'gen-controlled-stream',
  });
  expect(evidence.trace.attempts[0].response.transport.commentCount).toBeGreaterThan(0);
  expect(evidence.trace.attempts[0].timing.firstReasoningDeltaAt).not.toBeNull();
  expect(evidence.trace.attempts[0].timing.firstContentDeltaAt).not.toBeNull();
  expect(evidence.trace.providerGenerationId).toBe('gen-controlled-stream');
  expect(router.unexpected).toEqual([]);
});

test('a mid-stream provider error keeps partial HTML diagnostic-only and never changes LIVE', async ({ page }) => {
  await seedConnectedSession(page);
  const router = await routeOpenRouterMetadata(page, {
    generationData: {
      id: 'gen-controlled-stream',
      total_cost: 0.002,
      tokens_prompt: 20,
      tokens_completion: 12,
      finish_reason: 'error',
      model: MODEL_ID,
      provider_name: 'Fixture Provider',
    },
  });
  await installStreamFixture(page, 'error');
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await wakeChrome(page);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream failed safely', { timeout: 10000 });
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  expect(await generationCount(page)).toBe(0);
  const trace = await page.evaluate(() => window.VIZ_DEV.latestTrace());
  const response = trace.attempts[0].response;
  expect(response.transport.outcome).toBe('provider-error');
  expect(response.assistantText).toBe(validHtml);
  expect(response.extractedHtml).toBe('');
  expect(trace.providerRequestCount).toBe(1);
  expect(trace.failureCode).toBe('PROVIDER_EXPLICIT_ERROR');
  await expect.poll(() => router.generationLookups).toBe(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('ai-visualizer.spend.ledger.v1'))?.[0]?.uncertain)).toBe(false);
  const settlement = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ai-visualizer.spend.ledger.v1'))[0]);
  expect(settlement).toMatchObject({ cost: 0.002, settlementSource: 'generation-metadata', providerGenerationId: 'gen-controlled-stream' });
});

test('generation metadata with a contradictory ID cannot settle another reservation', async ({ page }) => {
  await seedConnectedSession(page);
  const router = await routeOpenRouterMetadata(page, {
    generationData: {
      id: 'gen-different',
      total_cost: 0,
      tokens_prompt: 1,
      tokens_completion: 1,
      finish_reason: 'error',
    },
  });
  await installStreamFixture(page, 'error');
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await wakeChrome(page);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream failed safely');
  await expect.poll(() => router.generationLookups).toBe(1);
  const reservation = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ai-visualizer.spend.ledger.v1'))[0]);
  expect(reservation.uncertain).toBe(true);
  expect(reservation.settlementSource).toBeUndefined();
});

test('generation metadata without billed cost cannot clear a conservative reservation', async ({ page }) => {
  await seedConnectedSession(page);
  const router = await routeOpenRouterMetadata(page, {
    generationData: {
      id: 'gen-controlled-stream',
      tokens_prompt: null,
      tokens_completion: null,
      finish_reason: 'error',
    },
  });
  await installStreamFixture(page, 'error');
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await wakeChrome(page);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream failed safely');
  await expect.poll(() => router.generationLookups).toBe(1);
  const reservation = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ai-visualizer.spend.ledger.v1'))[0]);
  expect(reservation.uncertain).toBe(true);
  expect(reservation.cost).toBeGreaterThan(0);
  expect(reservation.settlementSource).toBeUndefined();
});

test('cancel aborts one active stream deterministically with no retry or partial promotion', async ({ page }) => {
  await seedConnectedSession(page);
  const router = await routeOpenRouterMetadata(page);
  await installStreamFixture(page, 'controlled');
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await wakeChrome(page);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Receiving');
  await page.locator('#dreamCancelButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Cancelled', { timeout: 10000 });
  const evidence = await page.evaluate(async () => ({
    trace: await window.VIZ_DEV.latestTrace(),
    requests: window.__streamFixture.requests.length,
    aborts: window.__streamFixture.abortCount,
  }));
  expect(evidence.requests).toBe(1);
  expect(evidence.aborts).toBe(1);
  expect(evidence.trace.failureCode).toBe('CANCELLED');
  expect(evidence.trace.attempts[0].response.transport.outcome).toBe('cancelled');
  expect(evidence.trace.attempts[0].response.extractedHtml).toBe('');
  expect(await generationCount(page)).toBe(0);
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  await expect.poll(() => router.generationLookups).toBe(1);
  await page.waitForTimeout(900);
  expect(router.generationLookups).toBe(1);
});

test('cancel during fresh catalog verification remains cancellation with zero completion dispatches', async ({ page }) => {
  await seedConnectedSession(page);
  await routeOpenRouterMetadata(page);
  await installFreshCatalogHang(page);
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await page.evaluate(() => { window.__catalogFixture.hang = true; });
  await wakeChrome(page);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamCancelButton')).toBeEnabled();
  await page.locator('#dreamCancelButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Cancelled');
  const evidence = await page.evaluate(async () => ({
    trace: await window.VIZ_DEV.latestTrace(),
    catalog: window.__catalogFixture,
  }));
  expect(evidence.catalog.abortCount).toBe(1);
  expect(evidence.trace.failureCode).toBe('CANCELLED');
  expect(evidence.trace.providerRequestCount).toBe(0);
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
});

test('cancel while reading a non-SSE error body is not relabeled as a provider error', async ({ page }) => {
  await seedConnectedSession(page);
  await routeOpenRouterMetadata(page);
  await installNonSseHangingError(page);
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await wakeChrome(page);
  await page.locator('#dreamButton').click();
  await expect.poll(() => page.evaluate(() => window.__nonSseFixture.requests.length)).toBe(1);
  await page.locator('#dreamCancelButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Cancelled');
  const evidence = await page.evaluate(async () => ({
    trace: await window.VIZ_DEV.latestTrace(),
    transport: window.__nonSseFixture,
  }));
  expect(evidence.transport.requests).toHaveLength(1);
  expect(evidence.transport.abortCount).toBe(1);
  expect(evidence.trace.failureCode).toBe('CANCELLED');
  expect(evidence.trace.providerRequestCount).toBe(1);
});

test('provider-declared streamed timeouts remain timeout evidence rather than generic errors', async ({ page }) => {
  await seedConnectedSession(page);
  await routeOpenRouterMetadata(page);
  await installStreamFixture(page, 'timeout-error');
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await wakeChrome(page);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream failed safely');
  const trace = await page.evaluate(() => window.VIZ_DEV.latestTrace());
  expect(trace.failureCode).toBe('PROVIDER_TIMEOUT');
  expect(trace.attempts[0].response.transport).toMatchObject({ outcome: 'provider-timeout', timeoutKind: 'provider' });
  expect(trace.providerRequestCount).toBe(1);
});

test('premature SSE EOF remains incomplete in both trace and live transport status', async ({ page }) => {
  await seedConnectedSession(page);
  await routeOpenRouterMetadata(page);
  await installStreamFixture(page, 'incomplete');
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await wakeChrome(page);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream failed safely');
  const evidence = await page.evaluate(async () => ({
    trace: await window.VIZ_DEV.latestTrace(),
    status: window.VIZ_DREAM_STATUS.snapshot(),
  }));
  expect(evidence.trace.attempts[0].response.transport.outcome).toBe('incomplete');
  expect(evidence.status.terminal).toBe('incomplete');
  expect(await generationCount(page)).toBe(0);
});

test('immersive chrome respects drawers and keyboard focus but pointer-focused controls still age out in fullscreen', async ({ page }) => {
  await routeOpenRouterMetadata(page);
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('body')).toHaveClass(/ui-hidden/, { timeout: 5000 });
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).cursor)).toBe('none');

  await page.locator('#visualizerFrame').contentFrame().locator('body').evaluate(() => {
    dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 20 }));
  });
  await page.waitForTimeout(250);
  await expect(page.locator('body')).toHaveClass(/ui-hidden/);
  await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointermove', { clientX: 30, clientY: 30 })));
  await page.waitForTimeout(250);
  await expect(page.locator('body')).toHaveClass(/ui-hidden/);
  await page.evaluate(() => document.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
  await page.waitForTimeout(250);
  await expect(page.locator('body')).toHaveClass(/ui-hidden/);

  await page.mouse.move(300, 250);
  await expect(page.locator('body')).not.toHaveClass(/ui-hidden/);
  await page.locator('#infoButton').click();
  await page.waitForTimeout(3400);
  await expect(page.locator('body')).not.toHaveClass(/ui-hidden/);
  expect((await page.evaluate(() => window.VIZ_DEV.immersive())).blocker).toBe('drawer-open');
  await page.locator('#aboutDrawer [data-close-drawer]').click();
  await expect(page.locator('body')).toHaveClass(/ui-hidden/, { timeout: 5000 });

  await page.mouse.move(330, 270);
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => window.VIZ_DEV.immersive().blocker)).toBe('keyboard-focus');
  await page.waitForTimeout(3400);
  await expect(page.locator('body')).not.toHaveClass(/ui-hidden/);
  expect((await page.evaluate(() => window.VIZ_DEV.immersive())).inputMode).toBe('keyboard');

  await page.mouse.move(360, 290);
  await page.locator('#fullscreenButton').click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await expect(page.locator('body')).toHaveClass(/ui-hidden/, { timeout: 5000 });
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('fullscreenButton');
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).cursor)).toBe('none');
  await page.mouse.move(410, 310);
  await expect(page.locator('body')).not.toHaveClass(/ui-hidden/);
});

test('a late fullscreen wake-lock grant is released after fullscreen already exited', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { requests: 0, releases: 0, resolve: () => {} };
    const sentinel = {
      addEventListener() {},
      async release() { state.releases += 1; },
    };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request() {
          state.requests += 1;
          return new Promise(resolve => { state.resolve = () => resolve(sentinel); });
        },
      },
    });
    window.__wakeLockFixture = state;
  });
  await routeOpenRouterMetadata(page);
  await page.goto('/visualizer/index.html?dev=1');
  await wakeChrome(page);
  await page.locator('#fullscreenButton').click();
  await expect.poll(() => page.evaluate(() => window.__wakeLockFixture.requests)).toBe(1);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await page.evaluate(() => window.__wakeLockFixture.resolve());
  await expect.poll(() => page.evaluate(() => window.__wakeLockFixture.releases)).toBe(1);
  expect(await page.locator('#fullscreenButton').getAttribute('aria-pressed')).toBe('false');
});

test('a rejected stale wake-lock request is reacquired after fullscreen reentry', async ({ page }) => {
  await page.addInitScript(() => {
    const pending = [];
    const state = {
      requests: 0,
      releases: 0,
      rejectOldest: () => pending.shift()?.reject(new Error('stale request rejected')),
      resolveOldest: () => pending.shift()?.resolve({
        addEventListener() {},
        async release() { state.releases += 1; },
      }),
    };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request() {
          state.requests += 1;
          return new Promise((resolve, reject) => pending.push({ resolve, reject }));
        },
      },
    });
    window.__wakeLockRejectFixture = state;
  });
  await routeOpenRouterMetadata(page);
  await page.goto('/visualizer/index.html?dev=1');
  await wakeChrome(page);
  await page.locator('#fullscreenButton').click();
  await expect.poll(() => page.evaluate(() => window.__wakeLockRejectFixture.requests)).toBe(1);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await page.locator('#fullscreenButton').click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  expect(await page.evaluate(() => window.__wakeLockRejectFixture.requests)).toBe(1);
  await page.evaluate(() => window.__wakeLockRejectFixture.rejectOldest());
  await expect.poll(() => page.evaluate(() => window.__wakeLockRejectFixture.requests)).toBe(2);
  await page.evaluate(() => window.__wakeLockRejectFixture.resolveOldest());
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => window.__wakeLockRejectFixture.releases)).toBe(1);
});

test('pseudo-fullscreen fallback has synchronized functional and accessible state', async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new Error('fixture fullscreen unavailable'));
  });
  await routeOpenRouterMetadata(page);
  await page.goto('/visualizer/index.html?dev=1');
  await wakeChrome(page);
  await page.locator('#fullscreenButton').click();
  await expect(page.locator('body')).toHaveClass(/pseudo-fullscreen/);
  await expect(page.locator('#fullscreenButton')).toHaveAttribute('aria-label', 'Exit fullscreen');
  await expect(page.locator('#fullscreenButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.app')).toHaveCSS('position', 'fixed');
  await page.locator('#infoButton').click();
  await expect(page.locator('#aboutDrawer')).toHaveClass(/is-open/);
  const drawerOwnsHitTest = await page.locator('#aboutDrawer').evaluate(drawer => {
    const rect = drawer.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('#aboutDrawer') === drawer;
  });
  expect(drawerOwnsHitTest).toBe(true);
  await page.locator('#aboutDrawer [data-close-drawer]').click();
  await page.locator('#fullscreenButton').click();
  await expect(page.locator('body')).not.toHaveClass(/pseudo-fullscreen/);
  await expect(page.locator('#fullscreenButton')).toHaveAttribute('aria-label', 'Enter fullscreen');
  await expect(page.locator('#fullscreenButton')).toHaveAttribute('aria-pressed', 'false');
});

test('quality persists and changes DPR plus generated cadence without reload or regeneration', async ({ page }) => {
  test.setTimeout(60000);
  const router = await routeOpenRouterMetadata(page);
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => page.evaluate(() => window.VIZ_DEV?.state().sandboxRenderQuality?.mode || '')).toBe('full');
  const before = await page.evaluate(async () => ({
    state: window.VIZ_DEV.state(),
    probe: await window.VIZ_DEV.probeActive('quality-before'),
    srcdoc: document.getElementById('visualizerFrame').getAttribute('srcdoc'),
  }));
  expect(before.state.renderQuality).toMatchObject({ mode: 'full', effectiveDpr: 2, maxFps: 60, audioAnalysisTargetFps: 60 });
  expect(before.probe.viewport.dpr).toBe(2);

  const dprTransition = await page.evaluate(async () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
    dispatchEvent(new Event('resize'));
    await new Promise(resolve => setTimeout(resolve, 100));
    const low = await window.VIZ_DEV.probeActive('quality-native-dpr-low');
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    dispatchEvent(new Event('resize'));
    await new Promise(resolve => setTimeout(resolve, 100));
    const high = await window.VIZ_DEV.probeActive('quality-native-dpr-high');
    return { low, high, sessionId: window.VIZ_DEV.state().activeSessionId };
  });
  expect(dprTransition.low.viewport.dpr).toBe(1);
  expect(dprTransition.high.viewport.dpr).toBe(2);
  expect(dprTransition.sessionId).toBe(before.state.activeSessionId);

  const fullStart = await page.evaluate(() => window.VIZ_DEV.state().renderQuality);
  await page.waitForTimeout(1200);
  const fullEnd = await page.evaluate(() => window.VIZ_DEV.state().renderQuality);
  const fullFrames = fullEnd.vizFrameDeliveries - fullStart.vizFrameDeliveries;
  const fullAnalysis = fullEnd.audioAnalysisSamples - fullStart.audioAnalysisSamples;

  await wakeChrome(page);
  await page.locator('#infoButton').click();
  await page.locator('input[name="renderQuality"][value="saver"]').check();
  await expect(page.locator('#renderQualityDetail')).toContainText('Saver · up to 30 FPS');
  const after = await page.evaluate(async () => ({
    state: window.VIZ_DEV.state(),
    probe: await window.VIZ_DEV.probeActive('quality-after'),
    srcdoc: document.getElementById('visualizerFrame').getAttribute('srcdoc'),
    persisted: JSON.parse(localStorage.getItem('ai-visualizer.render-quality.v1')),
  }));
  expect(after.state.activeSessionId).toBe(before.state.activeSessionId);
  expect(after.srcdoc).toBe(before.srcdoc);
  expect(after.state.renderQuality).toMatchObject({ mode: 'saver', effectiveDpr: 1, maxFps: 30, audioAnalysisTargetFps: 60 });
  expect(after.probe.viewport.dpr).toBe(1);
  expect(after.probe.runtime.renderQuality).toMatchObject({ mode: 'saver', effectiveDpr: 1, maxFps: 30 });
  expect(after.probe.visual.canvases[0].backingWidth).toBeLessThan(before.probe.visual.canvases[0].backingWidth);
  expect(after.persisted).toMatchObject({ schema: 'visualizer-render-quality-v1', mode: 'saver' });

  const saverStart = await page.evaluate(() => window.VIZ_DEV.state().renderQuality);
  await page.waitForTimeout(1200);
  const saverEnd = await page.evaluate(() => window.VIZ_DEV.state().renderQuality);
  const saverFrames = saverEnd.vizFrameDeliveries - saverStart.vizFrameDeliveries;
  const saverAnalysis = saverEnd.audioAnalysisSamples - saverStart.audioAnalysisSamples;
  expect(saverFrames).toBeLessThan(fullFrames);
  expect(saverFrames).toBeLessThanOrEqual(40);
  expect(fullAnalysis).toBeGreaterThanOrEqual(fullFrames);
  expect(saverAnalysis).toBeGreaterThanOrEqual(saverFrames);
  expect(router.unexpected).toEqual([]);

  const balanced = await page.evaluate(async () => {
    window.VIZ_DEV.setQuality('balanced');
    return {
      state: window.VIZ_DEV.state(),
      probe: await window.VIZ_DEV.probeActive('quality-balanced'),
    };
  });
  expect(balanced.state.renderQuality).toMatchObject({ mode: 'balanced', effectiveDpr: 1.5, maxFps: 45 });
  expect(balanced.probe.viewport.dpr).toBe(1.5);
  await page.evaluate(() => window.VIZ_DEV.setQuality('saver'));

  await page.reload();
  await expect(page.locator('input[name="renderQuality"][value="saver"]')).toBeChecked();
  expect((await page.evaluate(() => window.VIZ_DEV.quality())).mode).toBe('saver');
});

test('390x844 keeps Visual Performance controls usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeOpenRouterMetadata(page);
  await page.goto('/visualizer/index.html');
  await wakeChrome(page, 160, 180);
  await page.locator('#infoButton').click();
  await expect(page.locator('#aboutDrawer')).toHaveClass(/is-open/);
  await page.waitForTimeout(400);
  const layout = await page.evaluate(() => {
    const fieldset = document.querySelector('.render-quality-options').getBoundingClientRect();
    const labels = [...document.querySelectorAll('.render-quality-options label')].map(label => label.getBoundingClientRect());
    return {
      viewport: innerWidth,
      body: document.documentElement.scrollWidth,
      fieldset: { left: fieldset.left, right: fieldset.right, width: fieldset.width },
      minimumTarget: Math.min(...labels.map(label => label.height)),
    };
  });
  expect(layout.body).toBeLessThanOrEqual(layout.viewport);
  expect(layout.fieldset.left).toBeGreaterThanOrEqual(0);
  expect(layout.fieldset.right).toBeLessThanOrEqual(layout.viewport);
  expect(layout.minimumTarget).toBeGreaterThanOrEqual(44);
  await page.locator('input[name="renderQuality"][value="balanced"]').check();
  await expect(page.locator('#renderQualityDetail')).toContainText('Balanced · up to 45 FPS');
});

test('768px compact dock keeps the fullscreen target fully visible and touch-sized', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await routeOpenRouterMetadata(page);
  await page.goto('/visualizer/index.html');
  await wakeChrome(page, 240, 220);
  const layout = await page.evaluate(() => {
    const button = document.getElementById('fullscreenButton').getBoundingClientRect();
    const controls = document.querySelector('.controls');
    return {
      viewportWidth: innerWidth,
      right: button.right,
      width: button.width,
      height: button.height,
      controlsClientWidth: controls.clientWidth,
      controlsScrollWidth: controls.scrollWidth,
    };
  });
  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.width).toBeGreaterThanOrEqual(44);
  expect(layout.height).toBeGreaterThanOrEqual(44);
  expect(layout.controlsScrollWidth).toBeLessThanOrEqual(layout.controlsClientWidth);
});
