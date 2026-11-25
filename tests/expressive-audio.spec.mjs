import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { deterministicExpressiveAudioCorpus } from './helpers/synthetic-audio.mjs';

const corpus = deterministicExpressiveAudioCorpus();
const referenceHtml = await readFile(new URL('./fixtures/expressive-audio-reference.html', import.meta.url), 'utf8');

function maximum(values) {
  return Math.max(...values.map(value => Number(value) || 0));
}

function maximumIndex(values) {
  let index = 0;
  for (let candidate = 1; candidate < values.length; candidate += 1) {
    if (values[candidate] > values[index]) index = candidate;
  }
  return index;
}

async function attachJson(testInfo, name, value) {
  const path = testInfo.outputPath(name);
  await writeFile(path, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function installCorpusRoutes(page) {
  const providerRequests = [];
  page.on('request', request => {
    if (/openrouter|chat\/completions/i.test(request.url())) providerRequests.push(request.url());
  });
  await page.route('**/__expressive-audio-fixture__/*.wav', async route => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)).replace(/\.wav$/, '');
    const body = corpus[name];
    if (!body) {
      await route.fulfill({ status: 404, body: 'Unknown deterministic audio fixture.' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'audio/wav', body });
  });
  await page.route('https://openrouter.ai/**', route => route.abort('blockedbyclient'));
  return providerRequests;
}

async function openHarness(page) {
  await page.goto('/visualizer/reliability-test.html');
  await page.waitForFunction(() => window.__reliabilityHarnessReady === true);
}

async function runFixture(page, name, mode = 'local') {
  const url = `/__expressive-audio-fixture__/${encodeURIComponent(name)}.wav`;
  await page.evaluate(({ fixtureUrl, fixtureMode }) => window.prepareDecodedAudioFixture(fixtureUrl, fixtureMode), {
    fixtureUrl: url,
    fixtureMode: mode,
  });
  await page.locator('#audioFixtureStart').click();
  return page.evaluate(() => window.audioFixtureResult());
}

test('native local decoding proves quiet, regional, strength, frequency, attack, and surge distinctions', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const providerRequests = await installCorpusRoutes(page);
  await openHarness(page);

  const silence = await runFixture(page, 'silence');
  const noise = await runFixture(page, 'lowNoise');
  expect(silence.finite).toBe(true);
  expect(silence.shapeValid).toBe(true);
  expect(silence.maxDynamics.quietness).toBeGreaterThan(0.95);
  expect(silence.maxDynamics.silenceSeconds).toBeGreaterThan(0.8);
  expect(maximum(Object.values(silence.maxEvents).map(event => event.strength))).toBeLessThan(0.08);
  expect(noise.maxDynamics.quietness).toBeGreaterThan(0.85);
  expect(maximum(noise.maxLogBands)).toBeLessThan(0.1);
  expect(maximum(Object.values(noise.maxEvents).map(event => event.strength))).toBeLessThan(0.1);

  const lowTone = await runFixture(page, 'sustainedLow');
  const midTone = await runFixture(page, 'sustainedMid');
  const highTone = await runFixture(page, 'sustainedHigh');
  expect(maximumIndex(lowTone.maxLogBands)).toBeGreaterThanOrEqual(1);
  expect(maximumIndex(lowTone.maxLogBands)).toBeLessThanOrEqual(6);
  expect(maximumIndex(midTone.maxLogBands)).toBeGreaterThanOrEqual(11);
  expect(maximumIndex(midTone.maxLogBands)).toBeLessThanOrEqual(15);
  expect(maximumIndex(highTone.maxLogBands)).toBeGreaterThanOrEqual(20);
  expect(maximumIndex(highTone.maxLogBands)).toBeLessThanOrEqual(23);
  for (const tone of [lowTone, midTone, highTone]) {
    expect(maximum(tone.maxBandAttack)).toBeGreaterThan(0.2);
    expect(maximum(tone.final.frequency.bandAttack)).toBeLessThan(0.12);
    expect(tone.eventTriggerCounts.onset).toBe(1);
    expect(tone.maxRhythmOnsets).toBeLessThanOrEqual(1);
  }

  const soft = await runFixture(page, 'softLowImpact');
  const hard = await runFixture(page, 'hardLowImpact');
  const mid = await runFixture(page, 'midBurst');
  const high = await runFixture(page, 'highBurst');
  expect(hard.maxEvents.lowImpact.strength).toBeGreaterThan(soft.maxEvents.lowImpact.strength + 0.08);
  expect(hard.maxEvents.lowImpact.strength).toBeGreaterThan(hard.maxEvents.midHit.strength + 0.1);
  expect(hard.maxEvents.lowImpact.strength).toBeGreaterThan(hard.maxEvents.highSpark.strength + 0.1);
  expect(mid.maxEvents.midHit.strength).toBeGreaterThan(mid.maxEvents.lowImpact.strength + 0.08);
  expect(mid.maxEvents.midHit.strength).toBeGreaterThan(mid.maxEvents.highSpark.strength + 0.05);
  expect(high.maxEvents.highSpark.strength).toBeGreaterThan(high.maxEvents.lowImpact.strength + 0.08);
  expect(high.maxEvents.highSpark.strength).toBeGreaterThan(high.maxEvents.midHit.strength + 0.05);
  expect(Math.min(hard.maxEvents.onset.strength, mid.maxEvents.onset.strength, high.maxEvents.onset.strength)).toBeGreaterThan(0.15);

  const full = await runFixture(page, 'silenceToFull');
  expect(full.maxDynamics.surge).toBeGreaterThan(0.25);
  expect(full.maxEvents.onset.strength).toBeGreaterThan(0.2);
  expect(full.bestRhythm.confidence).toBeLessThan(0.55);
  await attachJson(testInfo, 'expressive-audio-signal-evidence.json', {
    silence: {
      quietness: silence.maxDynamics.quietness,
      silenceSeconds: silence.maxDynamics.silenceSeconds,
      maximumEventStrength: maximum(Object.values(silence.maxEvents).map(event => event.strength)),
    },
    lowNoise: {
      quietness: noise.maxDynamics.quietness,
      maximumLogBand: maximum(noise.maxLogBands),
      maximumEventStrength: maximum(Object.values(noise.maxEvents).map(event => event.strength)),
    },
    sustainedTones: {
      lowPeakBand: maximumIndex(lowTone.maxLogBands),
      midPeakBand: maximumIndex(midTone.maxLogBands),
      highPeakBand: maximumIndex(highTone.maxLogBands),
      entranceBandAttack: [lowTone, midTone, highTone].map(tone => maximum(tone.maxBandAttack)),
      settledBandAttack: [lowTone, midTone, highTone].map(tone => maximum(tone.final.frequency.bandAttack)),
      onsetTriggerCounts: [lowTone, midTone, highTone].map(tone => tone.eventTriggerCounts.onset),
    },
    impacts: {
      softLowStrength: soft.maxEvents.lowImpact.strength,
      hardLowStrength: hard.maxEvents.lowImpact.strength,
      hardRegions: Object.fromEntries(Object.entries(hard.maxEvents).map(([name, event]) => [name, event.strength])),
      midRegions: Object.fromEntries(Object.entries(mid.maxEvents).map(([name, event]) => [name, event.strength])),
      highRegions: Object.fromEntries(Object.entries(high.maxEvents).map(([name, event]) => [name, event.strength])),
    },
    fullEntrance: {
      surge: full.maxDynamics.surge,
      onsetStrength: full.maxEvents.onset.strength,
      rhythmConfidence: full.bestRhythm.confidence,
    },
  });
  expect(providerRequests).toEqual([]);
});

test('native decoded impact trains keep tempo and phase confidence conservative', async ({ page }, testInfo) => {
  test.setTimeout(45000);
  const providerRequests = await installCorpusRoutes(page);
  await openHarness(page);
  const regular = await runFixture(page, 'regular125');
  const irregular = await runFixture(page, 'irregular');

  await attachJson(testInfo, 'expressive-audio-rhythm-evidence.json', {
    regular: {
      ...regular.bestRhythm,
      observedOnsets: regular.maxRhythmOnsets,
      maxSampleGapMs: regular.maxSampleGapMs,
    },
    irregular: {
      ...irregular.bestRhythm,
      observedOnsets: irregular.maxRhythmOnsets,
      maxSampleGapMs: irregular.maxSampleGapMs,
    },
  });

  expect(regular.finite).toBe(true);
  expect(regular.bestRhythm.tempo).toBeGreaterThanOrEqual(120);
  expect(regular.bestRhythm.tempo).toBeLessThanOrEqual(130);
  expect(regular.bestRhythm.confidence).toBeGreaterThanOrEqual(0.5);
  expect(regular.maxRhythmOnsets).toBeGreaterThanOrEqual(7);
  expect(regular.maxSampleGapMs).toBeLessThan(250);
  expect(regular.bestRhythm.phase).toBeGreaterThanOrEqual(0);
  expect(regular.bestRhythm.phase).toBeLessThanOrEqual(1);
  expect(irregular.bestRhythm.confidence).toBeLessThan(0.42);
  expect(irregular.bestRhythm.tempo).toBe(0);
  expect(irregular.maxSampleGapMs).toBeLessThan(250);
  expect(providerRequests).toEqual([]);
});

test('local media, shared-stream, and microphone-stream graphs use the same V2 semantics', async ({ page }, testInfo) => {
  test.setTimeout(30000);
  const providerRequests = await installCorpusRoutes(page);
  await openHarness(page);
  const outputs = [];
  for (const mode of ['local', 'display', 'microphone']) {
    outputs.push(await runFixture(page, 'hardLowImpact', mode));
  }
  for (const output of outputs) {
    expect(output.finite).toBe(true);
    expect(output.shapeValid).toBe(true);
    expect(output.maxEvents.onset.strength).toBeGreaterThan(0.15);
    expect(output.maxEvents.lowImpact.strength).toBeGreaterThan(output.maxEvents.midHit.strength + 0.08);
    expect(output.maxEvents.lowImpact.strength).toBeGreaterThan(output.maxEvents.highSpark.strength + 0.08);
  }
  const dominantRegions = outputs.map(output => ['lowImpact', 'midHit', 'highSpark']
    .sort((left, right) => output.maxEvents[right].strength - output.maxEvents[left].strength)[0]);
  expect(dominantRegions).toEqual(['lowImpact', 'lowImpact', 'lowImpact']);
  await attachJson(testInfo, 'expressive-audio-source-evidence.json', outputs.map(output => ({
    mode: output.mode,
    onsetStrength: output.maxEvents.onset.strength,
    lowImpactStrength: output.maxEvents.lowImpact.strength,
    midHitStrength: output.maxEvents.midHit.strength,
    highSparkStrength: output.maxEvents.highSpark.strength,
  })));
  expect(providerRequests).toEqual([]);
});

test('host-authored V2 reference produces six distinguishable screenshot and pixel signals', async ({ page }, testInfo) => {
  const providerRequests = await installCorpusRoutes(page);
  await openHarness(page);
  const hashes = new Set();
  const evidence = [];
  for (const stimulus of ['quietness', 'lowImpact', 'midHit', 'highSpark', 'logBands', 'beatPhase']) {
    const result = await page.evaluate(({ html, name }) => window.showExpressiveReferenceStimulus(html, name), {
      html: referenceHtml,
      name: stimulus,
    });
    const canvas = result.report.visual.canvases.find(item => item.elementId === 'reference');
    expect(result.boot.audioApiVersion).toBe('visualizer-audio-v2');
    expect(result.report.viz.latestFrame.version).toBe('visualizer-audio-v2');
    expect(canvas.pixel.informative).toBe(true);
    expect(canvas.pixel.uniqueBuckets).toBeGreaterThan(2);
    hashes.add(canvas.pixel.hash);
    evidence.push({ stimulus, pixel: canvas.pixel });
    const screenshotPath = testInfo.outputPath(`expressive-reference-${stimulus}.png`);
    await page.locator('#fixture').screenshot({ path: screenshotPath });
    await testInfo.attach(`expressive-reference-${stimulus}.png`, { path: screenshotPath, contentType: 'image/png' });
  }
  expect(hashes.size).toBe(6);
  await attachJson(testInfo, 'expressive-reference-pixel-evidence.json', evidence);
  await page.evaluate(() => window.clearExpressiveReference());
  expect(providerRequests).toEqual([]);
});
