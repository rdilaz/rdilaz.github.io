import { expect, test } from '@playwright/test';

const SENTINEL_KEY = 'sk-or-v1-SPEND_RECONCILIATION_NOT_REAL';
const RECONCILIATION_KEY = 'ai-visualizer.spend.reconciliation.v1';

async function seedReservation(page, {
  reservationId = 'reservation-fixture',
  generationId = 'gen-fixture',
  reservedCost = 0.428,
  currentSessionId = 'session-fixture',
  reservationSessionId = currentSessionId,
  includeSessionReservation = true,
  dailySpent = reservedCost,
  dayOffset = 0,
} = {}) {
  await page.addInitScript(options => {
    const date = new Date();
    date.setDate(date.getDate() + options.dayOffset);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    sessionStorage.setItem('ai-visualizer.openrouter.key', options.key);
    sessionStorage.setItem('ai-visualizer.spend.session-id.v1', options.currentSessionId);
    sessionStorage.setItem('ai-visualizer.spend.session.v1', String(options.includeSessionReservation ? options.reservedCost : 0));
    sessionStorage.setItem('ai-visualizer.spend.ledger.v1', JSON.stringify(options.includeSessionReservation ? [{
      id: options.reservationId,
      at: Date.now(),
      modelId: 'fixture/model',
      modelName: 'Fixture Model',
      cost: options.reservedCost,
      estimated: true,
      uncertain: true,
      providerGenerationId: options.generationId,
      reconciliationState: 'pending',
    }] : []));
    localStorage.setItem('ai-visualizer.spend.daily.v1', JSON.stringify({ date: todayKey, spent: options.dailySpent }));
    localStorage.setItem('ai-visualizer.spend.reconciliation.v1', JSON.stringify({
      schema: 'visualizer-spend-reconciliation-v1',
      entries: [{
        reservationId: options.reservationId,
        state: 'pending',
        reservedAt: Date.now(),
        reservationDate: dateKey,
        reservedCost: options.reservedCost,
        sessionId: options.reservationSessionId,
        sessionAdjustmentApplied: false,
        dailyAdjustmentApplied: false,
        providerGenerationId: options.generationId,
        attemptCount: 0,
        lastAttemptAt: null,
        lastResult: 'generation-id-linked',
        settlementSource: '',
        settledCost: null,
        settledAt: null,
      }],
    }));
  }, {
    reservationId,
    generationId,
    reservedCost,
    currentSessionId,
    reservationSessionId,
    includeSessionReservation,
    dailySpent,
    dayOffset,
    key: SENTINEL_KEY,
  });
}

async function routeReadOnlyMetadata(page, lookup) {
  const state = { generationLookups: 0, completionRequests: [] };
  await page.route('https://openrouter.ai/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/generation') {
      state.generationLookups += 1;
      await lookup(route, state.generationLookups, url.searchParams.get('id'));
      return;
    }
    if (url.pathname === '/api/v1/key') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { limit_remaining: 20 } }) });
      return;
    }
    if (url.pathname === '/api/v1/models') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      return;
    }
    if (url.pathname === '/api/v1/chat/completions') state.completionRequests.push(request.method());
    await route.abort('blockedbyclient');
  });
  return state;
}

function metadata(id, totalCost) {
  return {
    data: {
      id,
      total_cost: totalCost,
      tokens_prompt: 20,
      tokens_completion: 0,
      finish_reason: 'error',
      model: 'fixture/model',
      provider_name: 'Fixture Provider',
    },
  };
}

async function accounting(page) {
  return page.evaluate(key => ({
    sessionSpent: Number(sessionStorage.getItem('ai-visualizer.spend.session.v1') || 0),
    daily: JSON.parse(localStorage.getItem('ai-visualizer.spend.daily.v1')),
    ledger: JSON.parse(sessionStorage.getItem('ai-visualizer.spend.ledger.v1') || '[]'),
    journal: JSON.parse(localStorage.getItem(key)),
    diagnostics: window.VIZ_COST_GUARD.reconciliation,
  }), RECONCILIATION_KEY);
}

test('too-early metadata retries and exact zero restores session and daily headroom', async ({ page }) => {
  await seedReservation(page);
  const router = await routeReadOnlyMetadata(page, async (route, attempt, id) => {
    await route.fulfill(attempt === 1
      ? { status: 404, contentType: 'application/json', body: JSON.stringify({ error: { message: 'too early' } }) }
      : { status: 200, contentType: 'application/json', body: JSON.stringify(metadata(id, 0)) });
  });
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => router.generationLookups, { timeout: 6000 }).toBe(2);
  await expect.poll(() => accounting(page).then(value => value.ledger[0]?.uncertain)).toBe(false);
  const value = await accounting(page);
  expect(value.sessionSpent).toBe(0);
  expect(value.daily.spent).toBe(0);
  expect(value.ledger[0]).toMatchObject({ cost: 0, uncertain: false, estimated: false, settlementSource: 'generation-metadata' });
  expect(value.journal.entries[0]).toMatchObject({ state: 'settled', settledCost: 0, sessionAdjustmentApplied: true, dailyAdjustmentApplied: true });
  expect(router.completionRequests).toEqual([]);
});

test('reload in the same session rehydrates a generation reservation and settles exact positive cost', async ({ page }) => {
  await seedReservation(page);
  let available = false;
  const router = await routeReadOnlyMetadata(page, async (route, _attempt, id) => {
    await route.fulfill(available
      ? { status: 200, contentType: 'application/json', body: JSON.stringify(metadata(id, 0.125)) }
      : { status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => router.generationLookups).toBe(1);
  available = true;
  await page.reload();
  await expect.poll(() => accounting(page).then(value => value.ledger[0]?.uncertain), { timeout: 5000 }).toBe(false);
  const value = await accounting(page);
  expect(value.sessionSpent).toBeCloseTo(0.125, 10);
  expect(value.daily.spent).toBeCloseTo(0.125, 10);
  expect(value.ledger[0]).toMatchObject({ cost: 0.125, settlementSource: 'generation-metadata' });
  expect(router.completionRequests).toEqual([]);
});

test('metadata ID mismatch never settles or changes protected counters', async ({ page }) => {
  await seedReservation(page);
  const router = await routeReadOnlyMetadata(page, async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metadata('gen-other', 0)) });
  });
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => router.generationLookups).toBe(1);
  await expect.poll(() => accounting(page).then(value => value.diagnostics.entries[0]?.lastResult)).toBe('metadata-generation-id-mismatch');
  const value = await accounting(page);
  expect(value.sessionSpent).toBeCloseTo(0.428, 10);
  expect(value.daily.spent).toBeCloseTo(0.428, 10);
  expect(value.ledger[0].uncertain).toBe(true);
  expect(router.completionRequests).toEqual([]);
});

test('a new browser session corrects only same-day daily spend', async ({ page }) => {
  await seedReservation(page, {
    currentSessionId: 'session-new',
    reservationSessionId: 'session-old',
    includeSessionReservation: false,
    dailySpent: 0.728,
  });
  const router = await routeReadOnlyMetadata(page, async (route, _attempt, id) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metadata(id, 0.1)) });
  });
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => accounting(page).then(value => value.journal.entries[0]?.state)).toBe('settled');
  const value = await accounting(page);
  expect(value.sessionSpent).toBe(0);
  expect(value.daily.spent).toBeCloseTo(0.4, 10);
  expect(value.journal.entries[0]).toMatchObject({ sessionAdjustmentApplied: false, dailyAdjustmentApplied: true });
  expect(router.completionRequests).toEqual([]);
});

test('old-day reconciliation cannot reduce current-day spend', async ({ page }) => {
  await seedReservation(page, {
    currentSessionId: 'session-new',
    reservationSessionId: 'session-old',
    includeSessionReservation: false,
    dailySpent: 0.3,
    dayOffset: -1,
  });
  const router = await routeReadOnlyMetadata(page, async (route, _attempt, id) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metadata(id, 0)) });
  });
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => accounting(page).then(value => value.journal.entries[0]?.state)).toBe('settled');
  const value = await accounting(page);
  expect(value.sessionSpent).toBe(0);
  expect(value.daily.spent).toBeCloseTo(0.3, 10);
  expect(value.journal.entries[0].dailyAdjustmentResult).toBe('skipped-old-day');
  expect(router.completionRequests).toEqual([]);
});

test('concurrent sweeps are idempotent and counter correction cannot underflow', async ({ page }) => {
  await seedReservation(page, { reservedCost: 0.5, dailySpent: 0.1 });
  const router = await routeReadOnlyMetadata(page, async (route, _attempt, id) => {
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metadata(id, 0)) });
  });
  await page.goto('/visualizer/index.html?dev=1');
  await page.evaluate(() => Promise.all([
    window.VIZ_COST_GUARD.reconcilePending(),
    window.VIZ_COST_GUARD.reconcilePending(),
  ]));
  const value = await accounting(page);
  expect(router.generationLookups).toBe(1);
  expect(value.sessionSpent).toBe(0);
  expect(value.daily.spent).toBe(0);
  expect(value.journal.entries[0]).toMatchObject({ state: 'settled', settledCost: 0 });
  expect(router.completionRequests).toEqual([]);
});

test('failed metadata remains visibly pending with bounded developer diagnostics', async ({ page }) => {
  await seedReservation(page);
  const router = await routeReadOnlyMetadata(page, async route => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => router.generationLookups).toBe(1);
  await page.evaluate(() => window.VIZ_COST_GUARD.openSpendProtection());
  await expect(page.locator('#pendingSpendVerification')).toContainText('Pending verification: $0.43 across 1 reservation');
  const value = await accounting(page);
  expect(value.diagnostics).toMatchObject({ pendingCount: 1, pendingReservedAmount: 0.428 });
  expect(value.diagnostics.entries[0]).toMatchObject({ providerGenerationId: 'gen-fixture', lastResult: 'metadata-http-503' });
  expect(value.diagnostics.retryDelaysMs).toEqual([0, 1500, 5000, 15000, 30000, 60000]);
  expect(router.completionRequests).toEqual([]);
});
