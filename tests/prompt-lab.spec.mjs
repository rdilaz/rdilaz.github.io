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
    supported_parameters: ['reasoning'],
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
  expect(neutralText).toContain('No rendering method, medium, style, composition, dimensionality, or interaction pattern is preferred.');
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
  await expect(editor).toContainText('complete artistic freedom');
  await expect(editor).not.toContainText('window.VIZ');
  await expect(page.locator('#promptLabContract')).toContainText('window.VIZ');

  await page.getByRole('button', { name: 'Original baseline' }).click();
  await expect(editor).toContainText('wow factor');
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
