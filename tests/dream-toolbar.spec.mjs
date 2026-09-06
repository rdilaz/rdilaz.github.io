import { expect, test } from '@playwright/test';

const MODEL_ID = 'fixture/toolbar-long-unknown-cost-model';
const MODEL_NAME = 'Corrective Capture Fixture Long Unknown Cost Model';
const ESTIMATE_COST = 'Usually ~$0.12 · max $0.17';
const catalog = { data: [{
  id: MODEL_ID,
  name: MODEL_NAME,
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  top_provider: { max_completion_tokens: 32000 },
  supported_parameters: ['temperature', 'max_tokens'],
  pricing: { prompt: '0.000001', completion: '0.000001', request: '0' },
  context_length: 131072,
}] };
const headers = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

function overlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function routeToolbarProvider(page, { holdCompletion = false } = {}) {
  let releaseCompletion = () => {};
  const completionGate = holdCompletion ? new Promise(resolve => { releaseCompletion = resolve; }) : null;
  const state = { completionRequests: 0, releaseCompletion };
  await page.route('https://openrouter.ai/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/models') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify(catalog) });
      return;
    }
    if (path === '/api/v1/key') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ data: { limit_remaining: 20 } }) });
      return;
    }
    if (path === '/api/v1/chat/completions') {
      state.completionRequests += 1;
      if (completionGate) await completionGate;
      await route.abort('blockedbyclient');
      return;
    }
    await route.abort('blockedbyclient');
  });
  return state;
}

async function seedToolbar(page, { selectedModel = false } = {}) {
  await page.addInitScript(({ selected, modelId }) => {
    localStorage.setItem('ai-visualizer.first-session.v1', 'complete');
    if (!selected) return;
    localStorage.setItem('ai-visualizer.selected-model', modelId);
    localStorage.setItem('ai-visualizer.spend.settings.v1', JSON.stringify({
      perDream: 0.75,
      session: 5,
      daily: 10,
      confirmAbove: 0.15,
      confirmExpensive: false,
    }));
    sessionStorage.setItem('ai-visualizer.openrouter.key', 'sk-or-v1-TOOLBAR_LAYOUT_NOT_REAL');
  }, { selected: selectedModel, modelId: MODEL_ID });
}

async function openToolbarPage(page) {
  await page.goto('/visualizer/index.html');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  await expect(page.locator('#dreamButton')).toBeVisible();
  await page.evaluate(() => document.body.classList.remove('ui-hidden'));
}

async function toolbarGeometry(page) {
  return page.evaluate(() => {
    const bounds = element => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const textLines = element => {
      if (!element?.textContent) return [];
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()].map(rect => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }));
    };
    const button = document.getElementById('dreamButton');
    const label = document.getElementById('dreamButtonLabel');
    const cost = document.getElementById('dreamCost');
    const buttonBounds = bounds(button);
    const costBounds = bounds(cost);
    const hit = costBounds && costBounds.width && costBounds.height
      ? document.elementFromPoint(costBounds.left + costBounds.width / 2, costBounds.top + costBounds.height / 2)
      : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      button: buttonBounds,
      label: { text: label?.textContent || '', bounds: bounds(label), lines: textLines(label) },
      cost: {
        text: cost?.textContent || '',
        bounds: costBounds,
        lines: textLines(cost),
        visible: Boolean(costBounds?.width && costBounds?.height && getComputedStyle(cost).visibility !== 'hidden'),
      },
      adjacent: {
        model: bounds(document.getElementById('modelButton')),
        prompt: bounds(document.getElementById('promptLabButton')),
        favorite: bounds(document.getElementById('favoriteButton')),
        fullscreen: bounds(document.getElementById('fullscreenButton')),
      },
      disabled: button.disabled,
      costHitInsideButton: !hit || hit === button || button.contains(hit),
      ariaLabelledby: button.getAttribute('aria-labelledby'),
      ariaDescribedby: button.getAttribute('aria-describedby'),
    };
  });
}

function expectContained(inner, outer, message) {
  expect(inner.left, `${message} left`).toBeGreaterThanOrEqual(outer.left - .5);
  expect(inner.right, `${message} right`).toBeLessThanOrEqual(outer.right + .5);
  expect(inner.top, `${message} top`).toBeGreaterThanOrEqual(outer.top - .5);
  expect(inner.bottom, `${message} bottom`).toBeLessThanOrEqual(outer.bottom + .5);
}

function expectDreamLayout(geometry, { costExpected, disabled }) {
  expect(geometry.label.text).toBe('Dream');
  expectContained(geometry.label.bounds, geometry.button, 'Dream label');
  expect(geometry.button.height).toBeGreaterThanOrEqual(44);
  expect(geometry.disabled).toBe(disabled);
  expect(geometry.ariaLabelledby).toBe('dreamButtonLabel');
  expect(geometry.ariaDescribedby).toBe('dreamCost');
  expect(overlap(geometry.button, geometry.adjacent.model)).toBe(false);
  expect(overlap(geometry.button, geometry.adjacent.prompt)).toBe(false);
  expect(overlap(geometry.button, geometry.adjacent.favorite)).toBe(false);
  expect(overlap(geometry.button, geometry.adjacent.fullscreen)).toBe(false);
  if (!costExpected) {
    expect(geometry.cost.text).toBe('');
    expect(geometry.cost.visible).toBe(false);
    return;
  }
  expect(geometry.cost.visible).toBe(true);
  expect(geometry.cost.lines.length).toBeGreaterThan(0);
  for (const [index, line] of geometry.cost.lines.entries()) expectContained(line, geometry.button, `Cost line ${index + 1}`);
  expect(geometry.costHitInsideButton).toBe(true);
}

for (const viewport of [
  { label: 'minimum', width: 320, height: 700 },
  { label: 'mobile', width: 390, height: 844 },
  { label: 'desktop', width: 1024, height: 768 },
]) {
  test(`Dream action and cost fit every supported state at ${viewport.label} ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    test.setTimeout(60000);
    const noModelContext = await browser.newContext({ viewport });
    const noModelPage = await noModelContext.newPage();
    await seedToolbar(noModelPage);
    await routeToolbarProvider(noModelPage);
    await openToolbarPage(noModelPage);
    await expect(noModelPage.locator('#dreamButton')).toHaveAccessibleName('Dream');
    expectDreamLayout(await toolbarGeometry(noModelPage), { costExpected: false, disabled: false });
    await noModelContext.close();

    const selectedContext = await browser.newContext({ viewport });
    const page = await selectedContext.newPage();
    await seedToolbar(page, { selectedModel: true });
    const provider = await routeToolbarProvider(page, { holdCompletion: true });
    await openToolbarPage(page);
    await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
    await expect(page.locator('#dreamCost')).toContainText('Cost unknown');
    const unknownCost = (await page.locator('#dreamCost').textContent()).trim();
    await expect(page.locator('#dreamButton')).toHaveAccessibleName('Dream');
    await expect(page.locator('#dreamButton')).toHaveAccessibleDescription(unknownCost);
    expectDreamLayout(await toolbarGeometry(page), { costExpected: true, disabled: false });

    await page.locator('#dreamCost').evaluate((element, value) => { element.textContent = value; }, ESTIMATE_COST);
    await expect(page.locator('#dreamButton')).toHaveAccessibleDescription(ESTIMATE_COST);
    const estimated = await toolbarGeometry(page);
    expect(estimated.cost.text).toBe(ESTIMATE_COST);
    expectDreamLayout(estimated, { costExpected: true, disabled: false });

    await page.locator('#dreamCost').evaluate((element, value) => { element.textContent = value; }, unknownCost);
    await page.locator('#dreamButton').click();
    await expect.poll(() => provider.completionRequests).toBe(1);
    await expect(page.locator('#dreamButton')).toBeDisabled();
    expectDreamLayout(await toolbarGeometry(page), { costExpected: true, disabled: true });
    provider.releaseCompletion();
    await selectedContext.close();
  });
}
