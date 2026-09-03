import { test, expect } from '@playwright/test';
import {
  FIXED_RUNTIME_CONTRACT,
  LEGACY_CANONICAL_VISUALIZER_PROMPT,
  PROMPT_VERSION,
  buildGenerationMessages,
  buildRepairMessages,
  customPromptProfile,
  promptPreset,
} from '../public/visualizer/prompt.js';

const MODEL_ID = 'x-ai/grok-4.6';
const MODEL_NAME = 'SpaceXAI: Grok 4.6';

const catalog = {
  data: [{
    id: MODEL_ID,
    name: MODEL_NAME,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    top_provider: { max_completion_tokens: 32000 },
    supported_parameters: ['reasoning', 'temperature', 'max_tokens'],
    pricing: { prompt: '0', completion: '0', request: '0' },
    context_length: 131072,
    created: 1788200000,
  }],
};

async function routeOpenRouter(page, onCompletion = null) {
  await page.route('https://openrouter.ai/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/models') {
      await route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify(catalog),
      });
      return;
    }
    if (url.pathname === '/api/v1/key') {
      await route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
        body: JSON.stringify({ data: { limit_remaining: 20 } }),
      });
      return;
    }
    if (url.pathname === '/api/v1/chat/completions' && onCompletion) {
      await onCompletion(route);
      return;
    }
    await route.abort('blockedbyclient');
  });
}

test('neutral default removes spectacle and renderer priming while preserving the exact old baseline', async () => {
  expect(PROMPT_VERSION).toBe('visualizer-prompt-v2');
  const neutral = promptPreset('neutral-v1');
  const neutralMessages = buildGenerationMessages(neutral);
  const neutralText = neutralMessages.map(message => message.content).join('\n');

  for (const loadedPhrase of [
    'wow factor',
    'generic audio visualizer',
    'happily leave fullscreen',
    'Canvas 2D',
    'WebGL/WebGL2',
    'WebGPU when available',
    'SVG',
    'shaders',
    'typography',
    'procedural graphics',
  ]) {
    expect(neutralText).not.toContain(loadedPhrase);
  }
  expect(neutralText).toContain('complete artistic freedom');
  expect(neutralText).toContain('any browser-native capability available inside the sandbox');
  expect(neutralText).toContain('The host does not prefer or recommend any particular implementation or visual approach.');
  expect(FIXED_RUNTIME_CONTRACT).toContain('window.VIZ');

  const baseline = promptPreset('baseline-v1');
  const baselineMessages = buildGenerationMessages(baseline);
  expect(baselineMessages[1].content).toBe(LEGACY_CANONICAL_VISUALIZER_PROMPT);
  expect(baselineMessages[1].content).toContain('wow factor');
  expect(baselineMessages[1].content).toContain('WebGL/WebGL2');
});

test('custom prompts are appended to a fixed runtime contract and reused by repair', async () => {
  const profile = customPromptProfile('Make the relationship between sound and image whatever you think it should be.');
  const generation = buildGenerationMessages(profile);
  const repair = buildRepairMessages('<html>old</html>', 'NO_VISIBLE_OUTPUT', profile);

  expect(generation[1].content).toContain(profile.creativeBrief);
  expect(generation[1].content).toContain(FIXED_RUNTIME_CONTRACT);
  expect(repair[1].content).toContain(profile.creativeBrief);
  expect(repair[1].content).toContain('NO_VISIBLE_OUTPUT');
  expect(repair[1].content).toContain('<html>old</html>');
});

test('Prompt Lab edits and persists the creative brief without exposing the fixed contract as editable text', async ({ page }) => {
  await routeOpenRouter(page);
  await page.goto('/visualizer/index.html');

  const button = page.locator('#promptLabButton');
  await expect(button).toBeVisible();
  await button.click();
  const dialog = page.locator('#promptLabDialog');
  await expect(dialog).toBeVisible();
  const editor = page.locator('#promptLabEditor');
  await expect(editor).toHaveValue(/complete artistic freedom/);
  await expect(editor).not.toHaveValue(/window\.VIZ/);
  await expect(page.locator('#promptLabContract')).toContainText('window.VIZ');

  await page.getByRole('button', { name: 'Original baseline' }).click();
  await expect(editor).toHaveValue(/wow factor/);
  await page.locator('#promptLabApply').click();
  await expect(dialog).toBeHidden();
  await expect(button).toHaveAttribute('title', /Original baseline/);

  await button.click();
  const custom = 'Interpret the music visually in real time. Make every other creative decision yourself.';
  await editor.fill(custom);
  await page.locator('#promptLabApply').click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.locator('#promptLabButton')).toBeVisible();
  await page.locator('#promptLabButton').click();
  await expect(page.locator('#promptLabEditor')).toHaveValue(custom);
  await expect(page.locator('#promptLabCurrent')).toContainText('Custom prompt');
});

test('named Prompt Library snapshots remain immutable through rename, duplicate, draft editing, delete, and reload', async ({ page }) => {
  await routeOpenRouter(page);
  await page.goto('/visualizer/index.html');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_PROMPT)).toBe('object');
  await page.locator('#promptLabButton').click();

  const editor = page.locator('#promptLabEditor');
  const firstBrief = 'Build a crisp visual field that responds only to meaningful musical changes.';
  await editor.fill(firstBrief);
  await page.locator('#promptLabName').fill('Neutral Crisp v1');
  await page.locator('#promptLabSaveAs').click();
  const first = await page.evaluate(() => window.VIZ_PROMPT.saved()[0]);
  const firstRow = () => page.locator(`.prompt-lab__saved-row[data-entry-id="${first.entryId}"]`);
  await expect(firstRow()).toContainText(first.profileId);
  await firstRow().getByRole('button', { name: /Use saved prompt/ }).click();
  await expect(firstRow()).toContainText('Active');
  const identityBeforeRename = await page.evaluate(() => window.VIZ_PROMPT.current());

  await firstRow().locator('.prompt-lab__saved-name').fill('Neutral Crisp renamed');
  await firstRow().getByRole('button', { name: /Rename saved prompt/ }).click();
  const identityAfterRename = await page.evaluate(() => window.VIZ_PROMPT.current());
  expect(identityAfterRename.name).toBe('Neutral Crisp renamed');
  expect(identityAfterRename.creativeBrief).toBe(identityBeforeRename.creativeBrief);
  expect(identityAfterRename.id).toBe(identityBeforeRename.id);
  expect(identityAfterRename.briefHash).toBe(identityBeforeRename.briefHash);

  await firstRow().getByRole('button', { name: /Duplicate saved prompt/ }).click();
  const afterDuplicate = await page.evaluate(() => window.VIZ_PROMPT.saved());
  const duplicate = afterDuplicate.find(entry => entry.entryId !== first.entryId);
  expect(duplicate.entryId).not.toBe(first.entryId);
  expect(duplicate.creativeBrief).toBe(firstBrief);
  expect(duplicate.profileId).toBe(first.profileId);
  expect(duplicate.briefHash).toBe(first.briefHash);

  const editedBrief = `${firstBrief} Keep transitions geometrically spare.`;
  await editor.fill(editedBrief);
  await expect(page.locator('#promptLabCurrent')).toContainText('Unsaved modification');
  expect(await page.evaluate(() => window.VIZ_PROMPT.saved().map(entry => entry.creativeBrief))).toEqual([firstBrief, firstBrief]);
  await page.locator('#promptLabName').fill('Neutral Crisp v2');
  await page.locator('#promptLabSaveAs').click();
  const edited = await page.evaluate(() => window.VIZ_PROMPT.saved().find(entry => entry.name === 'Neutral Crisp v2'));
  expect(edited.creativeBrief).toBe(editedBrief);
  expect(edited.profileId).not.toBe(first.profileId);
  expect(edited.briefHash).not.toBe(first.briefHash);
  expect(await page.evaluate(id => window.VIZ_PROMPT.saved().find(entry => entry.entryId === id).creativeBrief, first.entryId)).toBe(firstBrief);

  await page.locator(`.prompt-lab__saved-row[data-entry-id="${duplicate.entryId}"]`).getByRole('button', { name: /Delete saved prompt/ }).click();
  expect(await page.evaluate(id => window.VIZ_PROMPT.saved().some(entry => entry.entryId === id), duplicate.entryId)).toBe(false);
  await expect(page.getByRole('button', { name: 'Neutral blank canvas', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Original baseline', exact: true })).toBeVisible();

  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_PROMPT)).toBe('object');
  const reloaded = await page.evaluate(() => window.VIZ_PROMPT.saved());
  expect(reloaded.map(entry => entry.name)).toEqual(['Neutral Crisp v2', 'Neutral Crisp renamed']);
  expect(reloaded.find(entry => entry.entryId === first.entryId).creativeBrief).toBe(firstBrief);
});

test('an in-flight Dream prevents applying an unsafe prompt draft', async ({ page }) => {
  let completionStarted = false;
  let releaseCompletion;
  const completionGate = new Promise(resolve => { releaseCompletion = resolve; });
  await page.addInitScript(({ modelId }) => {
    localStorage.setItem('ai-visualizer.selected-model', modelId);
    localStorage.setItem('ai-visualizer.spend.settings.v1', JSON.stringify({
      perDream: 0.75,
      session: 5,
      daily: 10,
      confirmAbove: 0.15,
      confirmExpensive: false,
    }));
    sessionStorage.setItem('ai-visualizer.openrouter.key', 'sk-or-v1-PROMPT_BUSY_FIXTURE_NOT_REAL');
  }, { modelId: MODEL_ID });
  await routeOpenRouter(page, async route => {
    completionStarted = true;
    await completionGate;
    await route.fulfill({
      status: 503,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ error: { message: 'fixture completion released' } }),
    });
  });
  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await page.locator('#dreamButton').click();
  await expect.poll(() => completionStarted).toBe(true);

  const before = await page.evaluate(() => window.VIZ_PROMPT.current());
  await page.locator('#promptLabButton').click();
  await page.locator('#promptLabEditor').fill('This draft must not become active while the Dream is running.');
  await page.locator('#promptLabApply').click();
  await expect(page.locator('#promptLabStatus')).toContainText('Wait for the current Dream');
  expect(await page.evaluate(() => window.VIZ_PROMPT.current())).toEqual(before);

  releaseCompletion();
  await expect(page.locator('#dreamButton')).toBeEnabled({ timeout: 15000 });
});

test('Prompt Library remains usable at 390x844 without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeOpenRouter(page);
  await page.goto('/visualizer/index.html');
  await page.locator('#promptLabButton').click();
  await page.locator('#promptLabName').fill('Mobile research snapshot');
  await page.locator('#promptLabSaveAs').click();
  const layout = await page.evaluate(() => {
    const dialog = document.getElementById('promptLabDialog').getBoundingClientRect();
    const row = document.querySelector('.prompt-lab__saved-row').getBoundingClientRect();
    return { viewport: innerWidth, dialog: dialog.toJSON(), row: row.toJSON() };
  });
  expect(layout.dialog.left).toBeGreaterThanOrEqual(0);
  expect(layout.dialog.right).toBeLessThanOrEqual(layout.viewport);
  expect(layout.row.left).toBeGreaterThanOrEqual(0);
  expect(layout.row.right).toBeLessThanOrEqual(layout.viewport);
  await expect(page.locator('.prompt-lab__saved-row').getByRole('button', { name: /Delete saved prompt/ })).toBeVisible();
});

test('the final OpenRouter request contains the selected custom creative brief plus the fixed neutral runtime contract', async ({ page }) => {
  const dispatched = [];
  await page.addInitScript(({ modelId }) => {
    localStorage.setItem('ai-visualizer.selected-model', modelId);
    localStorage.setItem('ai-visualizer.spend.settings.v1', JSON.stringify({
      perDream: 0.75,
      session: 5,
      daily: 10,
      confirmAbove: 0.15,
      confirmExpensive: false,
    }));
    sessionStorage.setItem('ai-visualizer.openrouter.key', 'sk-or-v1-PROMPTLAB_SENTINEL_NOT_REAL');
  }, { modelId: MODEL_ID });

  await routeOpenRouter(page, async route => {
    dispatched.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({
      status: 503,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
      body: JSON.stringify({ error: { message: 'fixture stop after request capture' } }),
    });
  });

  await page.goto('/visualizer/index.html?dev=1');
  await expect(page.locator('#selectedModelName')).toHaveText(MODEL_NAME);
  await page.locator('#promptLabButton').click();
  const custom = 'Take the music as input and invent the visual idea from scratch. Do not optimize for any conventional visualizer aesthetic.';
  await page.locator('#promptLabEditor').fill(custom);
  await page.locator('#promptLabApply').click();
  await expect(page.locator('#promptLabDialog')).toBeHidden();

  await page.locator('#dreamButton').click();
  await expect(page.locator('#dreamButton')).toBeEnabled({ timeout: 15000 });
  expect(dispatched).toHaveLength(1);
  const messages = dispatched[0].messages;
  expect(messages.map(message => message.role)).toEqual(['system', 'user']);
  expect(messages[1].content).toContain(custom);
  expect(messages[1].content).toContain('any browser-native capability available inside the sandbox');
  expect(messages[1].content).toContain('window.VIZ');
  expect(messages[1].content).not.toContain('WebGL/WebGL2');
  expect(messages[1].content).not.toContain('wow factor');
});
