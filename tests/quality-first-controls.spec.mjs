import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import {
  AUDIO_SENSITIVITY_SCHEMA,
  MAX_AUDIO_SENSITIVITY_PERCENT,
  MIN_AUDIO_SENSITIVITY_PERCENT,
  applyAudioSensitivity,
} from '../public/visualizer/audio-sensitivity.js';
import {
  buildGenerationMessages,
  promptPreset,
} from '../public/visualizer/prompt.js';

const MODEL_ID = 'deepseek/deepseek-v4-flash-0731';
const MODEL_NAME = 'DeepSeek: DeepSeek V4 Flash 0731';
const MODEL_MAX_TOKENS = 24000;
const MODEL_CONTEXT_TOKENS = 32768;
const SENTINEL_KEY = 'sk-or-v1-QUALITY_FIRST_SENTINEL_NOT_REAL_123456';
const validHtml = await readFile(new URL('./fixtures/valid-canvas2d.html', import.meta.url), 'utf8');
const openWatchdogCrashHtml = await readFile(new URL('./fixtures/open-watchdog-crash.html', import.meta.url), 'utf8');
const deepSeekLengthFixture = JSON.parse(await readFile(
  new URL('./fixtures/deepseek-v4-flash-0731-length.json', import.meta.url),
  'utf8',
));

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'x-request-id',
  'content-type': 'application/json',
};

const primaryModel = {
  id: MODEL_ID,
  name: MODEL_NAME,
  description: 'A current text and coding model.',
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  top_provider: {
    max_completion_tokens: MODEL_MAX_TOKENS,
    context_length: MODEL_CONTEXT_TOKENS,
  },
  supported_parameters: ['reasoning', 'temperature', 'max_tokens'],
  reasoning: {
    mandatory: false,
    default_enabled: true,
    supported_efforts: ['low', 'high'],
    default_effort: 'high',
  },
  pricing: {
    prompt: '0.0000002',
    completion: '0.000005',
    request: '0',
    internal_reasoning: '0.000001',
  },
  context_length: MODEL_CONTEXT_TOKENS,
  created: 1788200000,
  benchmarks: {
    artificial_analysis: { coding_index: 82, intelligence_index: 71 },
    design_arena: [{ category: 'website', elo: 1240 }],
  },
};

const experimentalModels = [
  {
    ...primaryModel,
    id: 'fixture/fast-canvas-model',
    name: 'Fixture Fast Canvas',
    description: 'A fast creative coding model.',
    reasoning: { supported_efforts: ['low'] },
    pricing: { prompt: '0', completion: '0', request: '0' },
    created: 1788300000,
  },
  {
    ...primaryModel,
    id: 'fixture/design-coding-model',
    name: 'Fixture Design Coding',
    description: 'A visual and frontend coding model.',
    reasoning: { supported_efforts: ['high'] },
    pricing: { prompt: '0.0000001', completion: '0.000002', request: '0' },
    created: 1788400000,
  },
];

function catalogFor(model = primaryModel, extras = experimentalModels) {
  return { data: [model, ...extras] };
}

function money(value) {
  const amount = Number(value || 0);
  if (amount === 0) return '$0.00';
  return `$${(Math.ceil(amount * 100 - 1e-10) / 100).toFixed(2)}`;
}

function providerPayload({
  id = 'quality-first-success',
  html = validHtml,
  model = MODEL_ID,
  reasoning = 'Fixture-visible reasoning.',
  usage = {
    prompt_tokens: 600,
    completion_tokens: 5000,
    total_tokens: 5600,
    completion_tokens_details: { reasoning_tokens: 321 },
    cost: 0.004004,
  },
} = {}) {
  return {
    id,
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: html, reasoning },
      finish_reason: 'stop',
      native_finish_reason: 'stop',
    }],
    usage,
  };
}

async function mockOpenRouter(page, {
  catalog = catalogFor(),
  completion = null,
  keyData = { limit: 20, usage: 0, limit_remaining: 20 },
} = {}) {
  const state = {
    completionBodies: [],
    completionRequests: 0,
    modelRequests: 0,
    keyRequests: 0,
    unexpected: [],
  };

  await page.route('https://openrouter.ai/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'OPTIONS' && [
      '/api/v1/models',
      '/api/v1/key',
      '/api/v1/chat/completions',
    ].includes(url.pathname)) {
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/v1/models') {
      state.modelRequests += 1;
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify(catalog) });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/v1/key') {
      state.keyRequests += 1;
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify({ data: keyData }) });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/v1/chat/completions' && completion) {
      const body = JSON.parse(request.postData() || '{}');
      state.completionRequests += 1;
      state.completionBodies.push(body);
      await completion(route, body, state);
      return;
    }

    state.unexpected.push(`${method} ${url.pathname}`);
    await route.abort('blockedbyclient');
  });

  return state;
}

async function seedConnectedSession(page, {
  confirmExpensive = false,
  confirmAbove = 0.01,
  sensitivityPercent = null,
  perDream = 0.75,
} = {}) {
  await page.addInitScript(({ modelId, key, settings, sensitivity }) => {
    localStorage.setItem('ai-visualizer.selected-model', modelId);
    localStorage.setItem('ai-visualizer.spend.settings.v1', JSON.stringify(settings));
    sessionStorage.setItem('ai-visualizer.openrouter.key', key);
    if (sensitivity !== null) {
      localStorage.setItem('ai-visualizer.audio-sensitivity.v1', JSON.stringify({
        schema: 'visualizer-audio-sensitivity-v1',
        sensitivityPercent: sensitivity,
        changedAt: 1,
      }));
    }
  }, {
    modelId: MODEL_ID,
    key: SENTINEL_KEY,
    settings: {
      perDream,
      session: 5,
      daily: 10,
      confirmAbove,
      confirmExpensive,
    },
    sensitivity: sensitivityPercent,
  });
}

async function installClipboardCapture(page) {
  await page.addInitScript(() => {
    window.__qualityFirstClipboard = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async writeText(value) {
          window.__qualityFirstClipboard.push(String(value));
        },
        async readText() {
          return window.__qualityFirstClipboard.at(-1) || '';
        },
      },
    });
  });
}

async function gotoVisualizer(page, path = '/visualizer/index.html') {
  await page.goto(path);
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await expect.poll(() => page.evaluate(() => Boolean(window.VIZ_COST_GUARD?.currentPreview?.envelope))).toBe(true);
}

async function closeDrawer(page, drawerSelector) {
  await page.locator(`${drawerSelector} [data-close-drawer], ${drawerSelector} .drawer__close`).first().click();
  await expect(page.locator(drawerSelector)).toHaveAttribute('aria-hidden', 'true');
}

function readyRecord({ id, name, createdAt, html = validHtml, favorite = true }) {
  return {
    schema: 'visualizer-generation-v1',
    id,
    source: 'local',
    jobId: `job-${id}`,
    modelId: `fixture/${id}`,
    modelName: name,
    title: name,
    provider: 'fixture',
    providerId: 'openrouter',
    resolvedModel: `fixture/${id}:resolved`,
    requestId: `request-${id}`,
    promptVersion: 'visualizer-prompt-v2',
    promptProfileId: 'neutral-v1',
    audioApiVersion: 'visualizer-audio-v1',
    createdAt,
    readyAt: createdAt,
    favorite,
    battleWins: 0,
    battleLosses: 0,
    attempt: 1,
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, cost: 0 },
    html,
    healthStatus: 'ready',
    openStatus: 'ready-to-open',
    healthSummary: { rendererTypes: ['canvas2d'], visible: true, vizConsumed: true },
    preflightEvidence: {
      schema: 'dream-reliability-v1',
      passed: true,
      checkedAt: createdAt,
      summary: { rendererTypes: ['canvas2d'], visible: true, vizConsumed: true },
      warnings: [],
    },
  };
}

async function seedReadyRecords(page, records) {
  await page.evaluate(async seededRecords => {
    const request = indexedDB.open('ai-visualizer-v0', 2);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('generations', 'readwrite');
    const store = transaction.objectStore('generations');
    seededRecords.forEach(record => store.put(record));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, records);
}

async function refreshLibraryUi(page) {
  await page.locator('#switcherButton').click();
  await page.locator('#libraryButton').click();
  await expect(page.locator('#libraryDrawer')).toHaveAttribute('aria-hidden', 'false');
  await closeDrawer(page, '#libraryDrawer');
}

function exactKeys(value, keys = []) {
  if (!value || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    exactKeys(child, keys);
  }
  return keys;
}

async function expectNoHorizontalOverflow(page) {
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(layout.document).toBeLessThanOrEqual(layout.viewport);
  expect(layout.body).toBeLessThanOrEqual(layout.viewport);
}

test('exact reasoning metadata snapshots High into one quality-first request', async ({ page }) => {
  let releaseCompletion;
  let markCompletionStarted;
  const completionGate = new Promise(resolve => { releaseCompletion = resolve; });
  const completionStarted = new Promise(resolve => { markCompletionStarted = resolve; });

  await seedConnectedSession(page, { sensitivityPercent: 170 });
  const router = await mockOpenRouter(page, {
    completion: async route => {
      markCompletionStarted();
      await completionGate;
      await route.fulfill({
        status: 503,
        headers: corsHeaders,
        body: JSON.stringify({ error: { message: 'fixture stop after immutable request capture' } }),
      });
    },
  });
  await gotoVisualizer(page);

  expect(await page.evaluate(() => window.VIZ_DEV.state().sensitivityPercent)).toBe(170);
  await page.locator('#modelButton').click();
  await expect(page.locator('#reasoningSelect')).toHaveValue('default');
  const options = await page.locator('#reasoningSelect option').evaluateAll(elements => (
    elements.map(option => ({ value: option.value, label: option.textContent }))
  ));
  expect(options).toEqual([
    { value: 'default', label: 'Default' },
    { value: 'low', label: 'Low' },
    { value: 'high', label: 'High' },
  ]);
  expect(options.map(option => option.value)).not.toEqual(expect.arrayContaining(['none', 'minimal', 'medium', 'xhigh', 'max']));
  await page.locator('#reasoningSelect').selectOption('high');
  await expect(page.locator('#reasoningState')).toHaveText('High');
  await closeDrawer(page, '#modelDrawer');
  const previewAtDispatch = await page.evaluate(() => window.VIZ_COST_GUARD.currentPreview.envelope);
  expect(previewAtDispatch.affordableCompletionTokens).toBeGreaterThan(14000);

  await page.locator('#dreamButton').click();
  await completionStarted;
  expect(router.completionBodies).toHaveLength(1);
  const dispatched = structuredClone(router.completionBodies[0]);
  const expectedMessages = buildGenerationMessages(promptPreset('neutral-v1'));
  expect(dispatched.messages).toEqual(expectedMessages);
  expect(dispatched.reasoning).toEqual({ effort: 'high' });
  expect(dispatched.provider.require_parameters).toBe(true);
  expect(dispatched.provider.max_price.prompt).toBeTruthy();
  expect(dispatched.provider.max_price.completion).toBeTruthy();
  expect(dispatched.provider.max_price.request).toBe('0');
  expect(JSON.stringify(dispatched)).not.toMatch(/sensitivityPercent|audio-sensitivity/i);
  expect(dispatched.usage).toEqual({ include: true });
  expect(dispatched.max_tokens).toBeGreaterThan(14000);
  expect(dispatched.max_tokens).toBeLessThanOrEqual(MODEL_MAX_TOKENS);

  await page.locator('#modelButton').click();
  await page.locator('#reasoningSelect').selectOption('low');
  await expect(page.locator('#reasoningState')).toHaveText('Low');
  expect(router.completionBodies[0]).toEqual(dispatched);
  releaseCompletion();
  await expect(page.locator('#dreamButton')).toBeEnabled({ timeout: 15000 });

  const trace = await page.evaluate(() => window.VIZ_DEV.latestTrace());
  const attempt = trace.attempts[0];
  expect(trace.providerRequestCount).toBe(1);
  expect(attempt.request.messages).toEqual(expectedMessages);
  expect(attempt.request.policy.appliedReasoningSelection.effort).toBe('high');
  expect(attempt.request.policy.dispatchedReasoning).toEqual({ effort: 'high' });
  expect(attempt.request.policy.finalMaxTokens).toBe(dispatched.max_tokens);
  expect(dispatched.max_tokens + attempt.request.policy.envelope.conservativePromptTokens)
    .toBeLessThanOrEqual(MODEL_CONTEXT_TOKENS);
  expect(JSON.parse(attempt.request.serializedBody)).toEqual(dispatched);
  expect(router.unexpected).toEqual([]);
});

test('enforced maximum requires explicit expensive-Dream authorization', async ({ page }) => {
  await seedConnectedSession(page, { confirmExpensive: true, confirmAbove: 0.01 });
  const router = await mockOpenRouter(page, {
    completion: async route => {
      await new Promise(resolve => setTimeout(resolve, 250));
      await route.fulfill({
        status: 503,
        headers: corsHeaders,
        body: JSON.stringify({ error: { message: 'fixture stop after authorized request' } }),
      });
    },
  });
  await gotoVisualizer(page);
  await page.locator('#modelButton').click();
  await page.locator('#reasoningSelect').selectOption('high');
  await closeDrawer(page, '#modelDrawer');

  const envelope = await page.evaluate(() => window.VIZ_COST_GUARD.currentPreview.envelope);
  const dreamMaximum = await page.evaluate(() => window.VIZ_COST_GUARD.currentPreview.dreamCostCeiling);
  const maximumLabel = money(dreamMaximum);
  const requestMaximumLabel = money(envelope.finalRequestCostCeiling);
  expect(envelope.finalRequestCostCeiling).toBeGreaterThan(0.01);
  expect(dreamMaximum).toBeGreaterThanOrEqual(envelope.finalRequestCostCeiling);

  await page.locator('#dreamButton').click();
  await expect(page.locator('#costConfirmBackdrop')).toBeVisible();
  await expect(page.locator('#costConfirmEstimate')).toContainText('Reasoning: High');
  await expect(page.locator('#costConfirmEstimate')).toContainText('Typical:');
  await expect(page.locator('#costConfirmCap')).toHaveText(`Maximum for this Dream, including one possible repair: ${maximumLabel}. The initial request is capped at ${requestMaximumLabel}.`);
  await expect(page.locator('#costConfirmContinue')).toHaveText(`Dream up to ${maximumLabel}`);
  await expect(page.locator('#costConfirmCancel')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#costConfirmContinue')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#costConfirmCancel')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#costConfirmBackdrop')).toBeHidden();
  await expect(page.locator('#dreamButton')).toBeEnabled({ timeout: 10000 });
  await expect(page.locator('#dreamButton')).toBeFocused();
  expect(router.completionRequests).toBe(0);

  await page.locator('#dreamButton').click();
  await expect(page.locator('#costConfirmBackdrop')).toBeVisible();
  await page.locator('#costConfirmCancel').click();
  await expect(page.locator('#costConfirmBackdrop')).toBeHidden();
  await expect(page.locator('#dreamButton')).toBeEnabled({ timeout: 10000 });
  expect(router.completionRequests).toBe(0);

  await page.locator('#dreamButton').click();
  await expect(page.locator('#costConfirmBackdrop')).toBeVisible();
  await expect(page.locator('#costConfirmContinue')).toHaveText(`Dream up to ${maximumLabel}`);
  await page.locator('#costConfirmContinue').click();
  await expect(page.locator('#dreamCancelButton')).toBeFocused();
  await expect(page.locator('#dreamButton')).toBeEnabled({ timeout: 15000 });
  expect(router.completionRequests).toBe(1);

  const body = router.completionBodies[0];
  expect(body.max_tokens).toBe(envelope.finalMaxTokens);
  expect(envelope.fixedCostReserve + body.max_tokens * envelope.completionPriceCeiling)
    .toBeCloseTo(envelope.finalRequestCostCeiling, 10);
  const trace = await page.evaluate(() => window.VIZ_DEV.latestTrace());
  expect(trace.providerRequestCount).toBe(1);
  expect(trace.attempts[0].request.policy.finalRequestCostCeiling)
    .toBeCloseTo(envelope.finalRequestCostCeiling, 10);
  expect(trace.attempts[0].request.policy.finalMaxTokens).toBe(body.max_tokens);
  expect(router.unexpected).toEqual([]);
});

test('insufficient High envelope blocks without downgrade and Spend protection can authorize it', async ({ page }) => {
  await seedConnectedSession(page, { perDream: 0.05, confirmExpensive: false });
  const router = await mockOpenRouter(page, {
    completion: async route => {
      await route.fulfill({
        status: 503,
        headers: corsHeaders,
        body: JSON.stringify({ error: { message: 'fixture authorized after budget increase' } }),
      });
    },
  });
  await gotoVisualizer(page);
  await page.locator('#modelButton').click();
  await page.locator('#reasoningSelect').selectOption('high');
  await closeDrawer(page, '#modelDrawer');

  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream failed safely', { timeout: 15000 });
  await expect(page.locator('#dreamJobDetail')).toContainText('more generation room for a full-quality Dream');
  await expect(page.locator('#dreamJobDetail')).toContainText('High reasoning is still selected');
  await expect(page.locator('#dreamJobSpend')).toBeVisible();
  expect(router.completionRequests).toBe(0);
  await page.locator('#modelButton').click();
  await expect(page.locator('#reasoningSelect')).toHaveValue('high');
  await closeDrawer(page, '#modelDrawer');

  await page.locator('#dreamJobSpend').click();
  await expect(page.locator('#spendDrawer')).toHaveAttribute('aria-hidden', 'false');
  await page.locator('#perDreamInput').fill('0.25');
  await page.locator('#perDreamInput').press('Tab');
  await expect.poll(() => page.evaluate(() => window.VIZ_COST_GUARD.settings.perDream)).toBe(0.25);
  await page.locator('#closeSpendDrawer').click();
  await page.locator('#dreamButton').click();
  await expect.poll(() => router.completionRequests).toBe(1);
  await expect(page.locator('#dreamButton')).toBeEnabled({ timeout: 15000 });
  expect(router.completionBodies[0].reasoning).toEqual({ effort: 'high' });
});

test('DeepSeek HTTP 200 length exhaustion is one TESTED failure with exact evidence', async ({ page }) => {
  const exactUsage = deepSeekLengthFixture.response.payload.usage;
  const regressionModel = {
    ...primaryModel,
    top_provider: { max_completion_tokens: 14000, context_length: MODEL_CONTEXT_TOKENS },
    reasoning: {
      mandatory: false,
      default_enabled: false,
      supported_efforts: ['max', 'high', 'low'],
      default_effort: 'high',
    },
  };
  await seedConnectedSession(page);
  const router = await mockOpenRouter(page, {
    catalog: catalogFor(regressionModel, []),
    completion: async route => {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'x-request-id': 'request-deepseek-length' },
        body: JSON.stringify(deepSeekLengthFixture.response.payload),
      });
    },
  });
  await gotoVisualizer(page);

  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream failed safely', { timeout: 15000 });
  await expect(page.locator('#dreamJobDetail')).toHaveText(
    'This model ran out of generation room before it finished the visual. Your current Dream is still here.',
  );
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');

  const trace = await page.evaluate(() => window.VIZ_DEV.latestTrace());
  const response = trace.attempts[0].response;
  expect(router.completionRequests).toBe(1);
  expect(router.completionBodies[0].model).toBe(deepSeekLengthFixture.request.model);
  expect(router.completionBodies[0].temperature).toBe(deepSeekLengthFixture.request.temperature);
  expect(router.completionBodies[0].max_tokens).toBe(deepSeekLengthFixture.request.max_tokens);
  expect(router.completionBodies[0].stream).toBe(deepSeekLengthFixture.request.stream);
  expect(router.completionBodies[0]).not.toHaveProperty('reasoning');
  expect(trace.providerRequestCount).toBe(1);
  expect(trace.attempts).toHaveLength(1);
  expect(trace.repairUsed).toBe(false);
  expect(trace.failureCode).toBe('OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT');
  expect(response.status).toBe(200);
  expect(response.finishReason).toBe('length');
  expect(response.nativeFinishReason).toBe('length');
  expect(response.native_finish_reason).toBe('length');
  expect(response.payload.choices[0].message.content).toBeNull();
  expect(response.usage).toEqual(exactUsage);
  expect(response.reasoning.tokenCount).toBe(12392);
  expect(response.cost).toBeCloseTo(0.004004, 10);
  expect(trace.totalReportedCost).toBeCloseTo(0.004004, 10);
  expect(trace.summary.usage).toEqual({
    prompt_tokens: 600,
    completion_tokens: 14000,
    reasoning_tokens: 12392,
    total_tokens: 14600,
  });

  const fit = await page.evaluate(() => window.VIZ_DEV.modelFit());
  const configuration = fit.configurations.find(entry => entry.identity.modelId === MODEL_ID);
  const model = fit.models.find(entry => entry.modelId === MODEL_ID);
  expect(configuration.status).toBe('TESTED');
  expect(configuration.knownIncompatible).toBeNull();
  expect(model.status).toBe('TESTED');
  expect(model.knownIncompatible).toBeNull();
  await page.locator('#modelButton').click();
  await page.locator('#browseAllModels').click();
  await expect(page.locator('#modelList .model-option').filter({ hasText: MODEL_NAME })).toBeVisible();
  expect(router.unexpected).toEqual([]);
});

test('Ready and explicit Open produce PROVEN evidence, recommendations, and a sanitized matrix', async ({ page }) => {
  test.setTimeout(70000);
  await installClipboardCapture(page);
  await seedConnectedSession(page);
  const router = await mockOpenRouter(page, {
    completion: async route => {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'x-request-id': 'request-proven-success' },
        body: JSON.stringify(providerPayload({ id: 'completion-proven-success' })),
      });
    },
  });
  await gotoVisualizer(page);

  await page.locator('#modelButton').click();
  await expect(page.locator('#allModelsPanel')).not.toHaveClass(/is-open/);
  await expect(page.locator('#modelGuideExperimentalSignals')).toBeHidden();
  await page.locator('#reasoningSelect').selectOption('high');
  await closeDrawer(page, '#modelDrawer');

  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream ready', { timeout: 35000 });
  expect(router.completionRequests).toBe(1);
  let fit = await page.evaluate(() => window.VIZ_DEV.modelFit());
  let configuration = fit.configurations.find(entry => entry.identity.modelId === MODEL_ID);
  let model = fit.models.find(entry => entry.modelId === MODEL_ID);
  expect(configuration.status).toBe('PROVEN');
  expect(configuration.aggregate.readySuccessCount).toBe(1);
  expect(configuration.aggregate.liveOpenSuccessCount).toBe(0);
  expect(model.status).toBe('PROVEN');

  await page.locator('#modelButton').click();
  const recommendation = page.locator('#modelGuidePicks .model-pick').filter({ hasText: MODEL_NAME });
  await expect(recommendation).toBeVisible();
  await expect(page.locator('#model-guide-heading')).toHaveText('Recommended AIs');
  const normalPickerText = await page.locator('#modelList').textContent();
  expect(normalPickerText).not.toMatch(/\b(?:PROVEN|TESTED|UNTESTED|KNOWN_INCOMPATIBLE)\b/);
  await expect(page.locator('#browseAllModels')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#allModelsPanel')).not.toHaveClass(/is-open/);
  await page.locator('#browseAllModels').click();
  await expect(page.locator('#browseAllModels')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#modelGuideExperimentalSignals')).toBeVisible();
  await expect(page.locator('#allModelsPanel')).toHaveClass(/is-open/);
  await closeDrawer(page, '#modelDrawer');

  await page.locator('#dreamJobOpen').click();
  await expect(page.locator('#liveIdentityName')).toContainText(MODEL_NAME, { timeout: 35000 });
  fit = await page.evaluate(() => window.VIZ_DEV.modelFit());
  configuration = fit.configurations.find(entry => entry.identity.modelId === MODEL_ID);
  model = fit.models.find(entry => entry.modelId === MODEL_ID);
  expect(configuration.status).toBe('PROVEN');
  expect(configuration.aggregate.readySuccessCount).toBe(1);
  expect(configuration.aggregate.liveOpenSuccessCount).toBe(1);
  expect(model.liveOpenSuccessCount).toBe(1);

  await gotoVisualizer(page, '/visualizer/index.html?dev=1');
  await page.locator('#modelButton').click();
  await expect(page.locator('#browseAllModels')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#allModelsPanel')).toHaveClass(/is-open/);
  await expect(page.locator('#modelGuideExperimentalSignals')).toBeVisible();
  await expect(page.locator('#modelGuideExperimentalCaveat')).toContainText('Developer view');
  const provenOption = page.locator('#modelList .model-option').filter({ hasText: MODEL_NAME });
  await expect(provenOption).toContainText('PROVEN');
  await closeDrawer(page, '#modelDrawer');

  await page.locator('#diagnosticsButton').click();
  const apiCopy = await page.evaluate(async () => {
    const bundle = await window.VIZ_DEV.copyModelTestMatrix();
    return {
      bundle,
      text: window.__qualityFirstClipboard.at(-1),
      copyCount: window.__qualityFirstClipboard.length,
    };
  });
  const matrixConfiguration = apiCopy.bundle.configurations.find(entry => entry.identity.modelId === MODEL_ID);
  expect(matrixConfiguration.configurationStatus).toBe('PROVEN');
  expect(matrixConfiguration.tokens.prompt.last).toBe(600);
  expect(matrixConfiguration.tokens.completion.last).toBe(5000);
  expect(matrixConfiguration.tokens.reasoning.last).toBe(321);
  expect(matrixConfiguration.tokens.total.last).toBe(5600);
  expect(matrixConfiguration.reasoning.choice).toBe('high');
  expect(matrixConfiguration.reasoning.tokenUsage.last).toBe(321);
  expect(matrixConfiguration.counts.repairs).toBe(0);
  expect(matrixConfiguration.exactBilledCostUsd.last).toBeCloseTo(0.004004, 10);
  expect(apiCopy.bundle.totals.repairs).toBe(0);
  expect(apiCopy.text).toContain('AI VISUALIZER MODEL TEST MATRIX');
  expect(JSON.stringify(apiCopy.bundle)).not.toContain(SENTINEL_KEY);
  const forbiddenExactKeys = new Set(['audio', 'waveform', 'spectrum', 'song']);
  expect(exactKeys(apiCopy.bundle).filter(key => forbiddenExactKeys.has(key.toLowerCase()))).toEqual([]);

  await page.locator('#copyModelTestMatrix').click();
  await expect.poll(() => page.evaluate(() => window.__qualityFirstClipboard.length)).toBe(apiCopy.copyCount + 1);
  const buttonText = await page.evaluate(() => window.__qualityFirstClipboard.at(-1));
  expect(buttonText).toContain('"exactBilledCostUsd"');
  expect(buttonText).toContain('"tokens"');
  expect(buttonText).toContain('"reasoning"');
  expect(buttonText).toContain('"repairs"');
  expect(buttonText).not.toContain(SENTINEL_KEY);
  expect(router.unexpected).toEqual([]);
});

test('Favorite arrows preserve LIVE, wrap exact order, and coexist with a slow Dream', async ({ page }) => {
  test.setTimeout(90000);
  let releaseCompletion;
  let markCompletionStarted;
  const completionGate = new Promise(resolve => { releaseCompletion = resolve; });
  const completionStarted = new Promise(resolve => { markCompletionStarted = resolve; });

  await seedConnectedSession(page);
  const router = await mockOpenRouter(page, {
    completion: async route => {
      markCompletionStarted();
      await completionGate;
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'x-request-id': 'request-background-ready' },
        body: JSON.stringify(providerPayload({ id: 'completion-background-ready' })),
      });
    },
  });
  await gotoVisualizer(page);

  const favorites = [
    readyRecord({ id: 'favorite-first', name: 'Favorite First', createdAt: 3000 }),
    readyRecord({ id: 'favorite-second', name: 'Favorite Second', createdAt: 2000 }),
    readyRecord({ id: 'favorite-crash', name: 'Favorite Crash', createdAt: 1000, html: openWatchdogCrashHtml }),
  ];
  await seedReadyRecords(page, favorites);
  await refreshLibraryUi(page);
  const favoriteOrder = await page.locator('[data-switcher-group="favorites"] .dream-switcher__choose strong')
    .allTextContents();
  expect(favoriteOrder).toEqual(['Favorite First', 'Favorite Second', 'Favorite Crash']);

  await page.evaluate(() => {
    window.__qualityFirstLiveNames = [document.getElementById('liveIdentityName').textContent];
    const target = document.getElementById('liveIdentityName');
    window.__qualityFirstLiveObserver = new MutationObserver(() => {
      const value = target.textContent;
      if (window.__qualityFirstLiveNames.at(-1) !== value) window.__qualityFirstLiveNames.push(value);
    });
    window.__qualityFirstLiveObserver.observe(target, { childList: true, subtree: true, characterData: true });
  });

  await page.locator('#dreamButton').click();
  await completionStarted;
  const beforeThreshold = await page.evaluate(async () => {
    const indicator = document.getElementById('favoriteOpeningStatus');
    const startedAt = performance.now();
    window.__qualityFirstOpeningTimeline = [];
    window.__qualityFirstOpeningObserver = new MutationObserver(() => {
      window.__qualityFirstOpeningTimeline.push({
        elapsed: performance.now() - startedAt,
        hidden: indicator.hidden,
        text: indicator.textContent,
      });
    });
    window.__qualityFirstOpeningObserver.observe(indicator, {
      attributes: true,
      attributeFilter: ['hidden'],
      childList: true,
      subtree: true,
      characterData: true,
    });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 100));
    return {
      hidden: indicator.hidden,
      live: document.getElementById('liveIdentityName').textContent,
    };
  });
  expect(beforeThreshold).toEqual({ hidden: true, live: 'Calibration Bloom' });
  await expect(page.locator('#favoriteOpeningStatus')).toHaveText('Opening · Favorite First', { timeout: 3000 });
  await expect(page.locator('#favoriteOpeningStatus')).toBeVisible();
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  releaseCompletion();

  await expect(page.locator('#liveIdentityName')).toContainText('Favorite First', { timeout: 20000 });
  await expect.poll(() => page.evaluate(() => window.VIZ_DEV.state().reopening)).toBe(false);
  const firstCommitNames = await page.evaluate(() => window.__qualityFirstLiveNames);
  expect(firstCommitNames).toHaveLength(2);
  expect(firstCommitNames.filter(name => name.includes('Favorite First'))).toHaveLength(1);
  const openingTimeline = await page.evaluate(() => window.__qualityFirstOpeningTimeline);
  const firstVisible = openingTimeline.find(entry => !entry.hidden && entry.text === 'Opening · Favorite First');
  expect(firstVisible.elapsed).toBeGreaterThanOrEqual(145);
  expect(openingTimeline.filter(entry => entry.elapsed < 145 && !entry.hidden)).toEqual([]);
  await expect(page.locator('#dreamJobPhase')).toHaveText('Dream ready', { timeout: 35000 });
  await expect(page.locator('#liveIdentityName')).toContainText('Favorite First');

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#liveIdentityName')).toContainText('Favorite Second', { timeout: 20000 });
  await expect.poll(() => page.evaluate(() => window.VIZ_DEV.state().reopening)).toBe(false);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#liveIdentityName')).toContainText('Favorite First', { timeout: 20000 });
  await expect.poll(() => page.evaluate(() => window.VIZ_DEV.state().reopening)).toBe(false);

  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.VIZ_DEV.state().reopening)).toBe(true);
  await expect(page.locator('#liveIdentityName')).toContainText('Favorite First');
  await expect.poll(() => page.evaluate(() => window.VIZ_DEV.state().reopening), { timeout: 20000 }).toBe(false);
  await expect(page.locator('#liveIdentityName')).toContainText('Favorite First');
  const failedFavorite = await page.evaluate(async () => {
    const request = indexedDB.open('ai-visualizer-v0', 2);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise((resolve, reject) => {
      const get = db.transaction('generations', 'readonly').objectStore('generations').get('favorite-crash');
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    db.close();
    return record;
  });
  expect(failedFavorite.openStatus).toBe('failed-to-open');
  expect(router.completionRequests).toBe(1);
  expect(router.unexpected).toEqual([]);
});

test('sensitivity UI, pure transform, and arrow ownership remain bounded', async ({ page }) => {
  const source = {
    schema: 'visualizer-audio-v1',
    connected: true,
    silence: false,
    volume: 0.4,
    peak: 0.8,
    transient: 0.6,
    beat: 0.75,
    tempo: 123.4,
    tempoConfidence: 0.67,
    spectralFlux: 0.7,
    spectralCentroid: 0.43,
    bands: { subBass: 0.2, bass: 0.4, lowMid: 0.6, mid: 0.8, highMid: 0.9, treble: 1 },
    stereo: { balance: -0.24, width: 0.86 },
    waveform: [-0.75, 0, 0.75],
    spectrum: [0.2, 0.6, 1],
    time: 42.5,
    deltaTime: 0.016,
  };
  const transformed = applyAudioSensitivity(source, 200);
  expect(AUDIO_SENSITIVITY_SCHEMA).toBe('visualizer-audio-sensitivity-v1');
  expect(transformed.tempo).toBe(source.tempo);
  expect(transformed.tempoConfidence).toBe(source.tempoConfidence);
  expect(transformed.spectralCentroid).toBe(source.spectralCentroid);
  expect(transformed.stereo).toBe(source.stereo);
  expect(transformed.connected).toBe(source.connected);
  expect(transformed.silence).toBe(source.silence);
  expect(Object.keys(transformed)).toEqual(Object.keys(source));

  await seedConnectedSession(page);
  const router = await mockOpenRouter(page);
  await gotoVisualizer(page);
  await seedReadyRecords(page, [readyRecord({ id: 'keyboard-favorite', name: 'Keyboard Favorite', createdAt: 1000 })]);
  await refreshLibraryUi(page);
  await page.locator('#dreamButton').focus();

  const sensitivity = () => page.evaluate(() => window.VIZ_DEV.state().sensitivityPercent);
  expect(await sensitivity()).toBe(100);
  await page.keyboard.press('ArrowUp');
  expect(await sensitivity()).toBe(110);
  await expect(page.locator('#sensitivityHud')).toHaveText('Sensitivity · 110%');
  await expect(page.locator('#sensitivityHud')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  expect(await sensitivity()).toBe(100);
  await page.keyboard.press('ArrowDown');
  expect(await sensitivity()).toBe(90);
  await expect(page.locator('#sensitivityHud')).toBeHidden({ timeout: 2500 });

  await page.evaluate(() => {
    for (let index = 0; index < 30; index += 1) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    }
  });
  expect(await sensitivity()).toBe(MIN_AUDIO_SENSITIVITY_PERCENT);
  await page.evaluate(() => {
    for (let index = 0; index < 30; index += 1) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    }
  });
  expect(await sensitivity()).toBe(MAX_AUDIO_SENSITIVITY_PERCENT);

  const assertFavoriteIdle = async () => {
    await page.waitForTimeout(220);
    expect(await page.evaluate(() => window.VIZ_DEV.state().reopening)).toBe(false);
    await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  };

  await page.locator('#infoButton').click();
  const range = page.locator('#sensitivityInput');
  await expect(range).toBeVisible();
  const rangeBounds = await range.boundingBox();
  expect(rangeBounds.width).toBeGreaterThan(100);
  expect(rangeBounds.height).toBeGreaterThanOrEqual(40);
  await range.fill('130');
  expect(await sensitivity()).toBe(130);
  await range.click({ position: { x: rangeBounds.width * 0.75, y: rangeBounds.height / 2 } });
  expect(await sensitivity()).toBeGreaterThan(130);
  await range.fill('130');
  await range.focus();
  await page.keyboard.press('ArrowRight');
  expect(await sensitivity()).toBe(140);
  await assertFavoriteIdle();
  await page.locator('#resetSensitivity').click();
  expect(await sensitivity()).toBe(100);
  await page.locator('#aboutDrawer [data-close-drawer]').focus();
  await page.keyboard.press('ArrowUp');
  expect(await sensitivity()).toBe(100);
  await assertFavoriteIdle();
  await closeDrawer(page, '#aboutDrawer');

  await page.locator('#modelButton').click();
  await page.locator('#browseAllModels').click();
  await page.locator('#modelSearch').fill(MODEL_ID);
  await page.locator('#modelSearch').press('ArrowRight');
  expect(await sensitivity()).toBe(100);
  await assertFavoriteIdle();
  await page.locator('#spendButton').click();
  await expect(page.locator('#spendDrawer')).toHaveAttribute('aria-hidden', 'false');
  await page.locator('#perDreamInput').focus();
  await page.keyboard.press('ArrowRight');
  expect(await sensitivity()).toBe(100);
  await assertFavoriteIdle();
  await page.locator('#closeSpendDrawer').click();
  await closeDrawer(page, '#modelDrawer');

  await page.locator('#promptLabButton').click();
  await expect(page.locator('#promptLabDialog')).toBeVisible();
  await page.locator('#promptLabEditor').focus();
  await page.keyboard.press('ArrowRight');
  expect(await sensitivity()).toBe(100);
  await assertFavoriteIdle();
  await page.locator('#promptLabApply').focus();
  await page.keyboard.press('ArrowUp');
  expect(await sensitivity()).toBe(100);
  await assertFavoriteIdle();
  await page.locator('.prompt-lab__close').click();

  await page.locator('#switcherButton').click();
  const switcherChoices = page.locator('#dreamSwitcherPanel [data-switcher-choose]');
  await switcherChoices.first().focus();
  const beforeFocus = await page.evaluate(() => document.activeElement?.dataset.switcherChoose || '');
  await page.keyboard.press('ArrowRight');
  const afterFocus = await page.evaluate(() => document.activeElement?.dataset.switcherChoose || '');
  expect(afterFocus).not.toBe(beforeFocus);
  expect(await sensitivity()).toBe(100);
  await assertFavoriteIdle();
  await page.locator('#dreamSwitcherClose').click();
  expect(router.completionRequests).toBe(0);
  expect(router.unexpected).toEqual([]);
});

test('390x844 exposes consumer controls without overflow or developer evidence leakage', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedConnectedSession(page, { confirmExpensive: true, confirmAbove: 0.01 });
  const router = await mockOpenRouter(page);
  await gotoVisualizer(page);
  await page.evaluate(() => document.body.classList.remove('ui-hidden'));

  await expect(page.locator('#dreamButton')).toBeVisible();
  await expect(page.locator('#dreamCost')).toBeVisible();
  await expect(page.locator('#dreamCost')).toContainText('max');
  const dreamBounds = await page.locator('#dreamButton').boundingBox();
  expect(dreamBounds.x).toBeGreaterThanOrEqual(0);
  expect(dreamBounds.x + dreamBounds.width).toBeLessThanOrEqual(390);
  await expectNoHorizontalOverflow(page);

  await page.locator('#modelButton').click();
  await page.locator('#reasoningControl').scrollIntoViewIfNeeded();
  await expect(page.locator('#reasoningControl')).toBeVisible();
  await expect(page.locator('#reasoningSelect')).toHaveValue('default');
  await expect(page.locator('#browseAllModels')).toBeVisible();
  await expect(page.locator('#browseAllModels')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#modelGuideExperimentalSignals')).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await page.locator('#browseAllModels').click();
  await expect(page.locator('#modelGuideExperimentalSignals')).toBeVisible();
  await expect(page.locator('#allModelsPanel')).toHaveClass(/is-open/);
  await expectNoHorizontalOverflow(page);
  const normalVisibleText = await page.locator('body').innerText();
  expect(normalVisibleText).not.toMatch(/\b(?:PROVEN|TESTED|UNTESTED|KNOWN_INCOMPATIBLE)\b/);
  expect(normalVisibleText).not.toMatch(/theoreticalModelCeiling|visualizer-model-fit|Developer view/i);
  await closeDrawer(page, '#modelDrawer');

  await page.locator('#infoButton').click();
  await page.locator('#sensitivityInput').scrollIntoViewIfNeeded();
  await expect(page.locator('#sensitivityInput')).toBeVisible();
  await expect(page.locator('#sensitivityValue')).toHaveText('100%');
  const sensitivityBounds = await page.locator('#sensitivityInput').boundingBox();
  expect(sensitivityBounds.x).toBeGreaterThanOrEqual(0);
  expect(sensitivityBounds.x + sensitivityBounds.width).toBeLessThanOrEqual(390);
  await expectNoHorizontalOverflow(page);
  await closeDrawer(page, '#aboutDrawer');
  await page.evaluate(() => document.body.classList.remove('ui-hidden'));
  await expect(page.locator('#dreamButton')).toBeVisible();
  await expect(page.locator('#dreamCost')).toContainText('max');
  await expectNoHorizontalOverflow(page);
  await page.locator('#dreamButton').click();
  await expect(page.locator('#costConfirmBackdrop')).toBeVisible();
  const confirmBounds = await page.locator('.cost-confirm__card').boundingBox();
  expect(confirmBounds.x).toBeGreaterThanOrEqual(0);
  expect(confirmBounds.x + confirmBounds.width).toBeLessThanOrEqual(390);
  expect(confirmBounds.y).toBeGreaterThanOrEqual(0);
  expect(confirmBounds.y + confirmBounds.height).toBeLessThanOrEqual(844);
  await expect(page.locator('#costConfirmCap')).toContainText('Maximum for this Dream');
  await page.keyboard.press('Escape');
  await expect(page.locator('#costConfirmBackdrop')).toBeHidden();
  expect(router.completionRequests).toBe(0);
  expect(router.unexpected).toEqual([]);
});

test('denied Web Storage keeps the built-in Visualizer available without a request', async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value() { throw new DOMException('Fixture storage denied.', 'SecurityError'); },
      });
    }
  });
  let completionRequests = 0;
  await page.route('https://openrouter.ai/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/models') {
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify({ data: [] }) });
      return;
    }
    if (url.pathname === '/api/v1/chat/completions') completionRequests += 1;
    await route.abort('blockedbyclient');
  });
  await page.goto('/visualizer/index.html');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  await expect(page.locator('#dreamButton')).toBeVisible();
  expect(completionRequests).toBe(0);
});
