import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openRouterSseBody, openRouterSseHeaders } from './helpers/openrouter-sse.mjs';

const MODEL_ID = 'moonshotai/kimi-k3';
const MODEL_NAME = 'MoonshotAI: Kimi K3';
const SENTINEL_KEY = 'sk-or-v1-SENTINEL_BROWSER_SECRET_123456789';
const validHtml = await readFile(new URL('./fixtures/valid-canvas2d.html', import.meta.url), 'utf8');
const openWatchdogCrashHtml = await readFile(new URL('./fixtures/open-watchdog-crash.html', import.meta.url), 'utf8');
const lateRuntimeCrashHtml = validHtml.replace('</script>', "setTimeout(() => { throw new Error('fixture late runtime crash'); }, 7000);</script>");
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
    pricing: { prompt: '0.000001', completion: '0.00008', request: '0' },
    context_length: 131072,
    created: 1788200000,
  }],
};

async function routeOpenRouter(page, completion) {
  await page.route('https://openrouter.ai/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/models') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify(catalog) });
      return;
    }
    if (url.pathname === '/api/v1/key') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify({ data: { limit: 20, usage: 0, limit_remaining: 20 } }) });
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

function providerPayload({ id, html, reasoning, reasoningTokens = 0, cost = 0.123 }) {
  const message = { role: 'assistant', content: html };
  if (reasoning !== undefined) message.reasoning = reasoning;
  return {
    id,
    model: MODEL_ID,
    choices: [{ index: 0, message, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 1337,
      completion_tokens: 4096,
      total_tokens: 5433,
      cost,
      completion_tokens_details: { reasoning_tokens: reasoningTokens },
      cost_details: { upstream_inference_cost: cost },
    },
  };
}

test('normal mode keeps compact, explicit LIVE and NEXT truth', async ({ page }) => {
  await routeOpenRouter(page, null);
  await page.goto('/visualizer/index.html');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');

  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  await expect(page.locator('#nextModelLabel')).toHaveText('NEXT');
  await expect(page.locator('#selectedModelName')).toHaveText('Choose a model');
  await expect(page.locator('#diagnosticsButton')).toBeHidden();
  await expect(page.locator('#traceViewer')).toBeHidden();

  const stage = await page.locator('#stage').boundingBox();
  expect(stage?.width).toBeGreaterThan(1000);
  expect(stage?.height).toBeGreaterThan(600);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#liveIdentity')).toBeVisible();
  await expect(page.locator('#nextModelLabel')).toBeVisible();
  await expect(page.locator('#traceViewer')).toBeHidden();
});

test('developer self-test renders inert full conversations and truthful reasoning', async ({ page }) => {
  await routeOpenRouter(page, null);
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  const fixture = await page.evaluate(() => window.VIZ_DEV.runTransparencySelfTest());

  await expect(page.locator('#traceViewer')).toBeVisible();
  await expect(page.getByText('ATTEMPT 1', { exact: false })).toBeVisible();
  await expect(page.getByText('ATTEMPT 2', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /copy all request messages/i }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /copy complete trace json/i })).toBeVisible();

  const conversation = page.getByText('Conversation', { exact: true }).first();
  await conversation.click();
  await expect(page.getByText('SYSTEM', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('USER', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('ASSISTANT / MODEL', { exact: true }).first()).toBeVisible();

  const generatedHtml = page.getByText('Generated HTML', { exact: true }).last();
  await generatedHtml.click();
  await expect(page.locator('#traceViewer pre').filter({ hasText: '<script' }).last()).toBeVisible();
  expect(await page.evaluate(() => window.__dreamTraceHtmlExecuted === true)).toBe(false);

  await expect(page.getByText('Provider-exposed reasoning', { exact: false })).toBeVisible();
  expect(fixture.traceIds).toHaveLength(2);
  await page.evaluate(id => window.VIZ_DEV.openTrace(id), fixture.hiddenReasoningTraceId);
  await expect(page.getByText('Reasoning text not exposed by provider.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Reasoning tokens:\s*11/)).toBeVisible();
  const tracesAfterVersionChange = await page.evaluate(async () => {
    const request = indexedDB.open('ai-visualizer-v0', 3);
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return window.VIZ_DEV.listTraces();
  });
  expect(tracesAfterVersionChange.map(trace => trace.id)).toEqual(expect.arrayContaining(fixture.traceIds));
});

test('legacy diagnostics remain readable and failed saved-Dream revalidation preserves LIVE', async ({ page }) => {
  await routeOpenRouter(page, null);
  await page.goto('/visualizer/index.html?dev=1');
  const ids = await page.evaluate(async () => {
    const request = indexedDB.open('ai-visualizer-v0', 2);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const legacyId = 'legacy-diagnostic-browser';
    const savedId = 'invalid-saved-browser';
    const transaction = db.transaction(['diagnostics', 'generations'], 'readwrite');
    transaction.objectStore('diagnostics').put({
      schema: 'dream-diagnostic-v1',
      id: legacyId,
      createdAt: Date.now() - 1000,
      updatedAt: Date.now() - 1000,
      status: 'succeeded',
      modelId: 'legacy/model',
      modelName: 'Legacy Model',
      rawOutput: 'legacy assistant output',
      html: '<!doctype html><html><body>legacy</body></html>',
      attempts: [],
      timeline: [],
    });
    transaction.objectStore('generations').put({
      id: savedId,
      modelId: 'legacy/broken',
      modelName: 'Broken Saved Dream',
      provider: 'legacy',
      providerId: 'openrouter',
      createdAt: Date.now(),
      favorite: false,
      html: '<!doctype html><html><body>incomplete</body></html>',
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
    return { legacyId, savedId };
  });

  await page.evaluate(id => window.VIZ_DEV.openTrace(id), ids.legacyId);
  await expect(page.locator('#traceViewer')).toBeVisible();
  const conversation = page.getByText('Conversation', { exact: true }).first();
  await conversation.click();
  await expect(page.getByText('Not captured by this app version.', { exact: true }).first()).toBeVisible();
  await page.locator('#closeTraceViewer').click();
  await page.locator('#diagnosticsDrawer [data-close-drawer]').click();

  await page.locator('#switcherButton').click();
  await page.locator('#libraryButton').click();
  const brokenCard = page.locator('.library-item').filter({ hasText: 'Broken Saved Dream' });
  await brokenCard.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  await expect(page.locator('.library-item').filter({ hasText: 'Broken Saved Dream' })).toContainText('failed safely');
});

test('provider failure closes its exact attempt without changing LIVE', async ({ page }) => {
  await seedConnectedModel(page);
  await routeOpenRouter(page, async route => {
    await route.fulfill({
      status: 503,
      headers: corsHeaders,
      body: JSON.stringify({ error: { code: 'provider_unavailable', message: 'Fixture provider unavailable.' } }),
    });
  });
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamButton')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream failed safely');
  await expect(page.locator('#dreamJobDetail')).toContainText(/AI service unavailable/i);
  await expect(page.locator('#dreamJobOpen')).toBeHidden();
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  const trace = await page.evaluate(() => window.VIZ_DEV.latestTrace());
  expect(trace.status).toBe('failed');
  expect(trace.providerRequestCount).toBe(1);
  expect(trace.attempts).toHaveLength(1);
  expect(trace.attempts[0].state).toBe('closed');
  expect(trace.attempts[0].response.status).toBe(503);
  expect(trace.attempts[0].response.rawBody).toContain('provider_unavailable');
  expect(trace.finalLiveIdentity.candidate).toBe(null);
});

test('documented no-ID terminal 429 failures release reservations and preserve truthful headroom', async ({ page }) => {
  const diagnosticCatalog = structuredClone(catalog);
  diagnosticCatalog.data[0].pricing = { prompt: '0', completion: '0.00004', request: '0' };
  diagnosticCatalog.data[0].supported_parameters = ['temperature', 'max_tokens'];
  let completionRequests = 0;
  await page.addInitScript(({ modelId, key }) => {
    localStorage.setItem('ai-visualizer.selected-model', modelId);
    localStorage.setItem('ai-visualizer.spend.settings.v1', JSON.stringify({
      perDream: 0.75,
      session: 0.876,
      daily: 10,
      confirmAbove: 0.15,
      confirmExpensive: false,
    }));
    sessionStorage.setItem('ai-visualizer.openrouter.key', key);
  }, { modelId: MODEL_ID, key: SENTINEL_KEY });
  await page.route('https://openrouter.ai/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/models') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify(diagnosticCatalog) });
      return;
    }
    if (url.pathname === '/api/v1/key') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify({ data: { limit_remaining: 20 } }) });
      return;
    }
    if (url.pathname === '/api/v1/chat/completions') {
      completionRequests += 1;
      await route.fulfill({
        status: 429,
        headers: corsHeaders,
        body: JSON.stringify({ error: { code: 429, message: 'Fixture rate limit with no usage or generation id.' } }),
      });
      return;
    }
    await route.abort('blockedbyclient');
  });

  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.locator('#dreamButton').click();
    await expect.poll(() => completionRequests).toBe(attempt);
    await expect(page.locator('#dreamButton')).toBeEnabled({ timeout: 15000 });
    await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem('ai-visualizer.spend.session.v1')))).toBe(0);
  }

  const accounting = await page.evaluate(() => ({
    sessionSpent: Number(sessionStorage.getItem('ai-visualizer.spend.session.v1')),
    daily: JSON.parse(localStorage.getItem('ai-visualizer.spend.daily.v1')),
    ledger: JSON.parse(sessionStorage.getItem('ai-visualizer.spend.ledger.v1')),
  }));
  expect(accounting.sessionSpent).toBe(0);
  expect(accounting.daily.spent).toBe(0);
  expect(accounting.ledger).toHaveLength(2);
  expect(accounting.ledger.every(entry => entry.uncertain === false && entry.estimated === false && entry.cost === 0)).toBe(true);
  expect(accounting.ledger.every(entry => entry.settlementSource === 'documented-terminal-429-no-generation')).toBe(true);

  await page.locator('#dreamButton').click();
  await expect.poll(() => completionRequests).toBe(3);
  await expect(page.locator('#dreamButton')).toBeEnabled({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem('ai-visualizer.spend.session.v1')))).toBe(0);
});

test('malformed or structured-output no-ID 429 responses remain conservatively reserved', async ({ page }) => {
  const diagnosticCatalog = structuredClone(catalog);
  diagnosticCatalog.data[0].pricing = { prompt: '0', completion: '0.00004', request: '0' };
  diagnosticCatalog.data[0].supported_parameters = ['temperature', 'max_tokens'];
  let completionRequests = 0;
  await seedConnectedModel(page);
  await page.route('https://openrouter.ai/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/models') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify(diagnosticCatalog) });
      return;
    }
    if (url.pathname === '/api/v1/key') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify({ data: { limit_remaining: 20 } }) });
      return;
    }
    if (url.pathname === '/api/v1/chat/completions') {
      completionRequests += 1;
      await route.fulfill({
        status: 429,
        headers: corsHeaders,
        body: completionRequests === 1
          ? '{malformed'
          : JSON.stringify({
            error: { code: 429, message: 'Fixture rate limit after structured reasoning.' },
            choices: [{ message: { content: '', reasoning_details: [{ type: 'reasoning.text', text: 'partial' }] } }],
          }),
      });
      return;
    }
    await route.abort('blockedbyclient');
  });
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.locator('#dreamButton').click();
    await expect.poll(() => completionRequests).toBe(attempt);
    await expect(page.locator('#dreamButton')).toBeEnabled({ timeout: 15000 });
  }
  const value = await page.evaluate(() => ({
    sessionSpent: Number(sessionStorage.getItem('ai-visualizer.spend.session.v1')),
    ledger: JSON.parse(sessionStorage.getItem('ai-visualizer.spend.ledger.v1')),
  }));
  expect(value.sessionSpent).toBeGreaterThan(0.85);
  expect(value.ledger).toHaveLength(2);
  expect(value.ledger.every(entry => entry.uncertain === true && entry.settlementSource === undefined)).toBe(true);
});

test('reconciliation storage failure blocks before completion dispatch', async ({ page }) => {
  let completionRequests = 0;
  await seedConnectedModel(page);
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function guardedSetItem(key, value) {
      if (key === 'ai-visualizer.spend.reconciliation.v1') throw new DOMException('Fixture storage denial.', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await routeOpenRouter(page, async route => {
    completionRequests += 1;
    await route.abort('blockedbyclient');
  });
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamButton')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#dreamJobDetail')).toContainText(/could not persist|cannot persist/i);
  expect(completionRequests).toBe(0);
  const value = await page.evaluate(() => ({
    sessionSpent: Number(sessionStorage.getItem('ai-visualizer.spend.session.v1') || 0),
    ledger: JSON.parse(sessionStorage.getItem('ai-visualizer.spend.ledger.v1') || '[]'),
  }));
  expect(value.sessionSpent).toBe(0);
  expect(value.ledger).toEqual([]);
});

test('availability failure creates no fake completion dispatch', async ({ page }) => {
  let available = true;
  let completionRequests = 0;
  await seedConnectedModel(page);
  await page.route('https://openrouter.ai/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/models') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify(available ? catalog : { data: [] }) });
      return;
    }
    if (url.pathname === '/api/v1/key') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify({ data: { limit_remaining: 20 } }) });
      return;
    }
    if (url.pathname === '/api/v1/chat/completions') completionRequests += 1;
    await route.abort('blockedbyclient');
  });
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  available = false;
  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamButton')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream failed safely');
  const trace = await page.evaluate(() => window.VIZ_DEV.latestTrace());
  expect(completionRequests).toBe(0);
  expect(trace.providerRequestCount).toBe(0);
  expect(trace.attempts[0].request.dispatched).toBe(false);
  expect(trace.attempts[0].artifact.availability.status).toBe('failed');
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
});

test('mocked generation captures the final spend-guard request and waits for explicit Open', async ({ page }) => {
  test.setTimeout(60000);
  const dispatchedBodies = [];
  let rawResponseBody = '';
  await seedConnectedModel(page);
  await routeOpenRouter(page, async route => {
    dispatchedBodies.push(JSON.parse(route.request().postData() || '{}'));
    const payload = providerPayload({
      id: 'gen-browser-success',
      html: validHtml,
      reasoning: 'Provider-visible fixture reasoning.',
      reasoningTokens: 17,
    });
    rawResponseBody = openRouterSseBody(payload);
    await route.fulfill({
      status: 200,
      headers: { ...corsHeaders, ...openRouterSseHeaders(payload, 'req-browser-success') },
      body: rawResponseBody,
    });
  });

  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  await page.locator('#dreamButton').click();
  await expect(page.locator('#liveIdentityName')).toContainText('Calibration Bloom');
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream ready', { timeout: 35000 });
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');

  expect(dispatchedBodies).toHaveLength(1);
  expect(dispatchedBodies[0].max_tokens).toBeLessThan(14000);
  expect(dispatchedBodies[0].max_tokens).toBeGreaterThanOrEqual(2200);
  expect(dispatchedBodies[0].usage).toEqual({ include: true });

  const trace = await page.evaluate(() => window.VIZ_DEV.latestTrace());
  const attempt = trace.attempts[0];
  expect(attempt.request.messages.map(message => message.role)).toEqual(['system', 'user']);
  expect(JSON.parse(attempt.request.serializedBody).max_tokens).toBe(dispatchedBodies[0].max_tokens);
  expect(attempt.request.headers.authorization).toBe('[redacted]');
  expect(attempt.response.rawBody).toBe(rawResponseBody);
  expect(attempt.response.assistantText).toBe(validHtml);
  expect(attempt.response.rawOutput).toBe(validHtml);
  expect(attempt.response.extractedHtml).toBe(validHtml.trim());
  expect(attempt.response.finishReason).toBe('stop');
  expect(attempt.response.requestId).toBe('req-browser-success');
  expect(attempt.response.providerGenerationId).toBe('gen-browser-success');
  expect(attempt.response.transport.outcome).toBe('completed');
  expect(attempt.response.transport.doneReceived).toBe(true);
  expect(attempt.response.streamAggregate.choices[0].message.content).toBe(validHtml);
  expect(attempt.response.usage.cost).toBe(0.123);
  expect(attempt.response.reasoning.exposed).toBe(true);
  expect(JSON.stringify(trace)).not.toContain(SENTINEL_KEY);
  expect(trace.providerRequestCount).toBe(1);
  expect(trace.status).toBe('ready');
  expect(trace.finalLiveIdentity.live.displayName).toBe('Calibration Bloom');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);

  await page.locator('#dreamJobOpen').click();
  await expect(page.locator('#liveIdentityName')).toContainText(/Kimi K3.*#[a-f0-9]{8}/i, { timeout: 35000 });

  const firstLiveLabel = await page.locator('#liveIdentityName').textContent();
  expect(firstLiveLabel).toMatch(/Kimi K3.*#[a-f0-9]{8}/i);
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await page.locator('#switcherButton').click();
  await page.locator('#libraryButton').click();
  const savedCard = page.locator('.library-item').filter({ hasText: MODEL_NAME }).first();
  await savedCard.getByRole('button', { name: 'Open', exact: true }).click();
  await savedCard.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(savedCard).toBeVisible();
  await expect(page.locator('#liveIdentityName')).toHaveText(firstLiveLabel || '', { timeout: 35000 });
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);

  await page.locator('#switcherButton').click();
  await page.locator('#libraryButton').click();
  await page.locator('.library-item').filter({ hasText: MODEL_NAME }).first().getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
});

test('mocked repair preserves both attempts and never sends attempt three', async ({ page }) => {
  test.setTimeout(60000);
  const requestBodies = [];
  await seedConnectedModel(page);
  await routeOpenRouter(page, async route => {
    const requestBody = JSON.parse(route.request().postData() || '{}');
    requestBodies.push(requestBody);
    const repair = String(requestBody.messages?.[0]?.content || '').startsWith('Repair the visualizer');
    const payload = providerPayload({
      id: repair ? 'gen-repair-success' : 'gen-initial-invalid',
      html: repair ? validHtml : '<!doctype html><html><body>incomplete</body></html>',
      cost: repair ? 0.02 : 0.01,
    });
    await route.fulfill({ status: 200, headers: { ...corsHeaders, ...openRouterSseHeaders(payload) }, body: openRouterSseBody(payload) });
  });

  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream ready', { timeout: 50000 });
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');

  expect(requestBodies).toHaveLength(2);
  expect(String(requestBodies[1].messages[0].content)).toMatch(/^Repair the visualizer/);
  expect(requestBodies[1].messages[1].content).toContain('incomplete');
  const trace = await page.evaluate(() => window.VIZ_DEV.latestTrace());
  expect(trace.attempts).toHaveLength(2);
  expect(trace.attempts[0].kind).toBe('generation');
  expect(trace.attempts[1].kind).toBe('repair');
  expect(trace.attempts[0].response.rawOutput).toContain('incomplete');
  expect(trace.attempts[1].response.rawOutput).toBe(validHtml);
  expect(trace.repairUsed).toBe(true);
  expect(trace.providerRequestCount).toBe(2);
  expect(trace.totalReportedCost).toBeCloseTo(0.03, 8);
});

test('failed explicit Open preserves prior LIVE and the ready artifact evidence', async ({ page }) => {
  test.setTimeout(60000);
  let requests = 0;
  await seedConnectedModel(page);
  await routeOpenRouter(page, async route => {
    requests += 1;
    const payload = providerPayload({
      id: `gen-watchdog-rollback-${requests}`,
      html: openWatchdogCrashHtml,
      cost: 0.01,
    });
    await route.fulfill({ status: 200, headers: { ...corsHeaders, ...openRouterSseHeaders(payload) }, body: openRouterSseBody(payload) });
  });

  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream ready', { timeout: 35000 });
  const readyTrace = await page.evaluate(() => window.VIZ_DEV.latestTrace());
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  await page.locator('#dreamJobOpen').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Could not open safely', { timeout: 35000 });
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  const traces = await page.evaluate(() => window.VIZ_DEV.listTraces());
  const openTrace = traces.find(trace => trace.id !== readyTrace.id);
  expect(requests).toBe(1);
  expect(readyTrace.status).toBe('ready');
  expect(openTrace.status).toBe('failed');
  expect(openTrace.finalLiveIdentity.candidate).toBe(null);
  await page.mouse.move(260, 240);
  await expect(page.locator('body')).not.toHaveClass(/ui-hidden/);
  await page.locator('#switcherButton').click();
  await expect(page.locator('[data-switcher-group="recent"]')).toContainText('Needs attention');
});

test('late runtime rollback persists aftercare and correlates recovered LIVE', async ({ page }) => {
  test.setTimeout(60000);
  await seedConnectedModel(page);
  await routeOpenRouter(page, async route => {
    const payload = providerPayload({ id: 'gen-late-runtime-crash', html: lateRuntimeCrashHtml, cost: 0.01 });
    await route.fulfill({ status: 200, headers: { ...corsHeaders, ...openRouterSseHeaders(payload) }, body: openRouterSseBody(payload) });
  });

  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream ready', { timeout: 35000 });
  await page.locator('#dreamJobOpen').click();
  await expect(page.locator('#liveIdentityName')).toContainText(/Kimi K3.*#[a-f0-9]{8}/i, { timeout: 35000 });
  const original = await page.evaluate(() => window.VIZ_DEV.latestTrace());
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom', { timeout: 35000 });
  const result = await page.evaluate(async originalId => {
    const traces = await window.VIZ_DEV.listTraces();
    return {
      original: traces.find(trace => trace.id === originalId),
      state: window.VIZ_DEV.state(),
    };
  }, original.id);
  expect(result.original.status).toBe('rolled-back');
  expect(result.original.aftercare.at(-1).stage).toBe('runtime:rolled-back');
  expect(result.original.finalLiveIdentity.live.displayName).toBe('Calibration Bloom');
  expect(result.state.currentModel).toBe('Calibration Bloom');
  expect(result.state.diagnosticId).not.toBe(original.diagnosticId);
});
