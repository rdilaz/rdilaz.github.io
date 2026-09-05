import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  EXTERNAL_CAPTURE_PAUSE_COPY,
  PLAYBACK_STATE_SCHEMA,
  createPlaybackController,
} from '../public/visualizer/playback-state.js';
import {
  DREAM_JOB_PHASES,
  DREAM_JOB_SCHEMA,
  createDreamJobController,
  isExecutingDreamJob,
} from '../public/visualizer/dream-job.js';
import {
  DREAM_SWITCHER_SCHEMA,
  buildDreamSwitcherGroups,
  localDreamKey,
} from '../public/visualizer/dream-switcher.js';
import {
  FEATURED_DREAM_MANIFEST,
  FEATURED_LOAD_FAILURES,
  FEATURED_MANIFEST_SCHEMA,
  createFeaturedExportPackage,
  loadFeaturedDreams,
  validateFeaturedEntry,
} from '../public/visualizer/featured-dreams.js';
import { createLiveIdentityController } from '../public/visualizer/live-identity.js';
import {
  dreamDisplayTitle,
  dreamPromptLabel,
  editableDreamDisplayTitle,
  htmlDocumentTitle,
} from '../public/visualizer/dream-metadata.js';
import { createDiagnosticDetailsState } from '../public/visualizer/diagnostic-details-state.js';
import { GenerationStore } from '../public/visualizer/storage.js';
import {
  FIRST_SESSION_COMPLETE_VALUE,
  FIRST_SESSION_SCHEMA,
  FIRST_SESSION_STORAGE_KEY,
  createFirstSessionController,
} from '../public/visualizer/first-session.js';
import {
  FEATURED_DREAM_GUIDE_SCHEMA,
  featuredDreamGuide,
  listFeaturedDreamGuides,
} from '../public/visualizer/featured-dream-guide.js';

const MODEL = Object.freeze({ id: 'moonshotai/kimi-k3', name: 'Kimi K3', provider: 'moonshotai' });
const PROMPT = Object.freeze({ id: 'neutral-v1', name: 'Neutral blank canvas', creativeBrief: 'Create what you think music looks like.' });
const HTML = '<!doctype html><html><body><canvas></canvas><script>VIZ.onFrame(()=>{});</script></body></html>';
const indexHtml = await readFile(new URL('../public/visualizer/index.html', import.meta.url), 'utf8');
const featuredHtml = Object.fromEntries(await Promise.all(FEATURED_DREAM_MANIFEST.map(async entry => [
  entry.id,
  await readFile(new URL(`../public/visualizer/${entry.htmlPath.replace(/^\.\//, '')}`, import.meta.url), 'utf8'),
])));
const featuredFetch = async url => ({
  ok: true,
  text: async () => featuredHtml[String(url).match(/\/([^/]+)\.html$/)?.[1]],
});

test('playback starts playing and idempotent pause/resume publishes only real changes', () => {
  let now = 100;
  const controller = createPlaybackController({ clock: () => ++now });
  const snapshots = [];
  controller.subscribe(snapshot => snapshots.push(snapshot));
  assert.equal(controller.version, PLAYBACK_STATE_SCHEMA);
  assert.equal(controller.snapshot().status, 'playing');
  const paused = controller.pause();
  const repeatedPause = controller.pause();
  assert.equal(paused.status, 'paused');
  assert.equal(repeatedPause.revision, paused.revision);
  const playing = controller.play();
  const repeatedPlay = controller.play();
  assert.equal(playing.status, 'playing');
  assert.equal(repeatedPlay.revision, playing.revision);
  assert.equal(snapshots.length, 3);
});

test('external capture pause copy never claims external music was paused', () => {
  assert.equal(EXTERNAL_CAPTURE_PAUSE_COPY, 'Visual paused · music source still controlled externally');
  assert.doesNotMatch(EXTERNAL_CAPTURE_PAUSE_COPY, /music (?:is |was )?paused/i);
});

test('first-session preference is versioned, dismissible, reopenable, and storage-denial safe', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const controller = createFirstSessionController({ storage });
  assert.equal(controller.version, FIRST_SESSION_SCHEMA);
  assert.equal(controller.freshVisit(), true);
  assert.equal(controller.snapshot().visible, true);
  controller.dismiss();
  assert.equal(controller.snapshot().visible, false);
  assert.equal(values.get(FIRST_SESSION_STORAGE_KEY), FIRST_SESSION_COMPLETE_VALUE);
  controller.reopen();
  assert.equal(controller.snapshot().visible, true);

  const returning = createFirstSessionController({ storage });
  assert.equal(returning.freshVisit(), false);
  assert.equal(returning.snapshot().visible, false);

  const denied = createFirstSessionController({
    storage: {
      getItem() { throw new DOMException('denied', 'SecurityError'); },
      setItem() { throw new DOMException('denied', 'SecurityError'); },
    },
  });
  assert.equal(denied.snapshot().visible, true);
  assert.doesNotThrow(() => denied.complete());
  assert.equal(denied.snapshot().visible, false);
});

test('host privacy copy says only the generated browser instrument receives normalized local signals', () => {
  assert.match(indexHtml, /AI creates the visual instrument\. Your music stays on this device\./);
  assert.match(indexHtml, /The model never receives your song or its live audio analysis\./);
  assert.match(indexHtml, /once it runs in your browser, the host feeds that instrument the same normalized local visualizer signals used for every Dream\./);
  assert.doesNotMatch(indexHtml, /every (?:other )?model receives/i);
  assert.doesNotMatch(indexHtml, /(?:the )?(?:model|provider) receives (?:your |the )?(?:song|audio|signals)/i);
});

test('Featured guide metadata is editorial, artifact-specific, and absent for unknown Dreams', () => {
  const guides = listFeaturedDreamGuides();
  assert.deepEqual(guides.map(guide => guide.id), ['klangfiguren', 'nexus-beam', 'calibration-bloom']);
  assert.ok(guides.every(guide => guide.schema === FEATURED_DREAM_GUIDE_SCHEMA));
  const klangGuide = featuredDreamGuide('klangfiguren');
  assert.match(`${klangGuide.description} ${klangGuide.explanation}`, /artistic.*not.*scientifically exact.*pitch detector/i);
  assert.match(featuredDreamGuide('nexus-beam').explanation, /Kinetic Harmonic Astrolabe/);
  assert.match(featuredDreamGuide('calibration-bloom').explanation, /host-created, not AI-generated/i);
  assert.equal(featuredDreamGuide('unknown-local-dream'), null);
  assert.match(featuredHtml.klangfiguren, /pointerdown[\s\S]*S\.strike[\s\S]*S\.bassS/);
  assert.match(featuredHtml.klangfiguren, /S\.centroidS[\s\S]*pickMode/);
  assert.match(featuredHtml['nexus-beam'], /drawSpectralRing[\s\S]*drawWaveformRibbon[\s\S]*drawHarmonicCore/);
  assert.match(featuredHtml['nexus-beam'], /isDragging[\s\S]*targetRotY/);
  assert.match(featuredHtml['calibration-bloom'], /a\.waveform[\s\S]*a\.transient[\s\S]*bass \* \.12/);
});

test('Dream job snapshots exact inputs and cannot create a second executing job', () => {
  let id = 0;
  let now = 1000;
  const controller = createDreamJobController({ idFactory: () => `job-${++id}`, clock: () => ++now });
  const model = structuredClone(MODEL);
  const promptProfile = structuredClone(PROMPT);
  const reasoningSelection = { modelId: MODEL.id, mode: 'explicit', effort: 'high', selectedAt: 10 };
  const generationConfiguration = { modelId: MODEL.id, reasoningChoice: 'high' };
  const started = controller.start({ model, promptProfile, reasoningSelection, generationConfiguration });
  model.name = 'Changed later';
  promptProfile.creativeBrief = 'Changed later';
  reasoningSelection.effort = 'low';
  generationConfiguration.reasoningChoice = 'low';
  assert.equal(controller.version, DREAM_JOB_SCHEMA);
  assert.equal(started.phase, DREAM_JOB_PHASES.PREPARING);
  assert.equal(started.input.model.name, MODEL.name);
  assert.equal(started.input.promptProfile.creativeBrief, PROMPT.creativeBrief);
  assert.equal(started.input.reasoningSelection.effort, 'high');
  assert.equal(started.input.generationConfiguration.reasoningChoice, 'high');
  assert.equal(isExecutingDreamJob(started), true);
  assert.throws(() => controller.start({ model: MODEL, promptProfile: PROMPT }), /one Dream job/i);
});

test('Dream job collapse changes presentation without aborting lifecycle state', () => {
  const controller = createDreamJobController({ idFactory: () => 'job-collapse', clock: () => 100 });
  const job = controller.start({ model: MODEL, promptProfile: PROMPT });
  controller.transition(job.id, DREAM_JOB_PHASES.SENDING);
  const collapsed = controller.collapse();
  assert.equal(collapsed.phase, DREAM_JOB_PHASES.SENDING);
  assert.equal(collapsed.expanded, false);
  assert.equal(collapsed.cancellable, true);
  assert.equal(isExecutingDreamJob(collapsed), true);
});

test('ready is distinct from opening and LIVE, and stale job events are ignored', () => {
  const controller = createDreamJobController({ idFactory: () => 'job-ready', clock: () => 100 });
  const job = controller.start({ model: MODEL, promptProfile: PROMPT });
  controller.transition(job.id, DREAM_JOB_PHASES.SENDING);
  controller.transition(job.id, DREAM_JOB_PHASES.WORKING);
  controller.transition(job.id, DREAM_JOB_PHASES.RECEIVING);
  controller.transition(job.id, DREAM_JOB_PHASES.CHECKING);
  const ready = controller.transition(job.id, DREAM_JOB_PHASES.READY, {
    artifact: { generationId: 'generation-ready', favorite: false },
  });
  assert.equal(ready.phase, DREAM_JOB_PHASES.READY);
  assert.equal(ready.cancellable, false);
  assert.equal(controller.transition('stale-job', DREAM_JOB_PHASES.OPENING).phase, DREAM_JOB_PHASES.READY);
  assert.equal(controller.transition(job.id, DREAM_JOB_PHASES.OPENING).phase, DREAM_JOB_PHASES.OPENING);
  assert.equal(controller.transition(job.id, DREAM_JOB_PHASES.LIVE).phase, DREAM_JOB_PHASES.LIVE);
});

test('persisted ready artifact restores an actionable non-executing job', () => {
  const controller = createDreamJobController({ clock: () => 200 });
  const restored = controller.restoreReady({
    id: 'saved-ready',
    jobId: 'saved-job',
    modelId: MODEL.id,
    modelName: MODEL.name,
    artifactTitle: 'Ready artifact title',
    promptProfileId: 'neutral-v1',
    readyAt: 150,
    favorite: true,
  });
  assert.equal(restored.phase, DREAM_JOB_PHASES.READY);
  assert.equal(restored.artifact.generationId, 'saved-ready');
  assert.equal(restored.artifact.favorite, true);
  assert.equal(restored.artifact.displayTitle, 'Ready artifact title');
  assert.equal(restored.artifact.promptLabel, 'Neutral blank canvas');
  assert.equal(isExecutingDreamJob(restored), false);
});

test('switcher groups Featured, Favorites and bounded newest-first Recent deterministically', () => {
  const featured = FEATURED_DREAM_MANIFEST.map(entry => ({ ...entry, key: `featured:${entry.id}` }));
  const generations = [
    { id: 'old', modelId: 'a/old', modelName: 'Old Dream', html: HTML, createdAt: 10, favorite: true, healthStatus: 'verified', openStatus: 'verified-live' },
    { id: 'new', modelId: 'b/new', modelName: 'New Dream', html: HTML, createdAt: 30, favorite: false, healthStatus: 'ready', openStatus: 'ready-to-open' },
    { id: 'middle', modelId: 'c/middle', modelName: 'Middle Dream', html: HTML, createdAt: 20, favorite: true, healthStatus: 'verified', openStatus: 'verified-live' },
    { id: 'broken', modelId: 'd/broken', modelName: 'Broken', html: HTML, createdAt: 40, favorite: true, healthStatus: 'failed-on-device' },
  ];
  const groups = buildDreamSwitcherGroups({ featured, generations, activeKey: localDreamKey(generations[0]), recentLimit: 2 });
  assert.equal(groups.schema, DREAM_SWITCHER_SCHEMA);
  assert.deepEqual(groups.featured.map(item => item.id), ['klangfiguren', 'nexus-beam', 'calibration-bloom']);
  assert.equal(groups.featured.find(item => item.id === 'nexus-beam').title, 'Nexus Beam');
  assert.equal(groups.featured.find(item => item.id === 'nexus-beam').promptLabel, 'Neutral Crisp V1');
  assert.equal(groups.featured.find(item => item.id === 'nexus-beam').guide.id, 'nexus-beam');
  assert.deepEqual(groups.favorites.map(item => item.id), ['middle', 'old']);
  assert.deepEqual(groups.recent.map(item => item.id), ['new', 'middle']);
  assert.equal(groups.recent.some(item => item.id === 'broken'), false);
  assert.equal(groups.favorites.find(item => item.id === 'old').active, true);
});

test('Featured launch manifest preserves exact order, provenance, content and one startup', async () => {
  assert.equal(FEATURED_DREAM_MANIFEST.length, 3);
  FEATURED_DREAM_MANIFEST.forEach(validateFeaturedEntry);
  assert.deepEqual(FEATURED_DREAM_MANIFEST.map(entry => entry.id), [
    'klangfiguren',
    'nexus-beam',
    'calibration-bloom',
  ]);
  assert.deepEqual(FEATURED_DREAM_MANIFEST.map(entry => entry.order), [1, 2, 3]);
  assert.deepEqual(FEATURED_DREAM_MANIFEST.filter(entry => entry.startup).map(entry => entry.id), ['calibration-bloom']);
  const expected = {
    klangfiguren: {
      title: 'Klangfiguren',
      modelId: 'z-ai/glm-5.3-flash',
      providerGenerationId: 'gen-1788390975-8pCRpNg4jGDQAMxCjV60',
      localGenerationId: 'c4fa9760-0439-4c79-9f5e-af69bb12b18d',
      traceId: 'e2c0c6ad-80cb-4da8-945f-8cccda6fdbed',
      digest: '176bc18463d8f379ba5877dbe0f20333fb5c9bb0f579d340227d8048ee110700',
      htmlTitle: 'Klangfiguren — sand on a sounding plate',
      bytes: 27857,
      promptProfileId: 'neutral-v1',
      promptProfileName: 'Neutral blank canvas',
      approvalSource: 'Featured Launch Set v1',
    },
    'nexus-beam': {
      title: 'Nexus Beam',
      modelId: 'google/gemini-3.8-flash',
      providerGenerationId: 'gen-1788487061-Hz2FaGMJFxrfVhjEIWOF',
      localGenerationId: 'dbeb41d5-411e-4964-af34-70ea48c8ddc6',
      traceId: 'f5240f15-ccf9-4f16-9f8a-84d35efea8cf',
      digest: 'dd6ffcfe40fc2db07773144c55523db99d30521906bf08949b01663caf09d140',
      htmlTitle: 'Kinetic Harmonic Astrolabe',
      bytes: 32445,
      promptProfileId: 'custom-784707e6',
      promptProfileName: 'Neutral Crisp V1',
      approvalSource: 'Featured naming follow-up',
    },
  };
  for (const entry of FEATURED_DREAM_MANIFEST) {
    assert.equal(entry.schema, FEATURED_MANIFEST_SCHEMA);
    assert.match(entry.contentDigest, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(entry.htmlPath, /tests[\\/]fixtures/i);
    const html = featuredHtml[entry.id];
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<\/html>\s*$/i);
    assert.match(html, /\bVIZ\.(?:frame|onFrame)\b/);
    assert.doesNotMatch(html, /https?:\/\/|openrouter|authorization|api[_-]?key|<script[^>]+src=|<link[^>]+href=/i);
    const canonicalHtml = html.replace(/\r\n/g, '\n');
    assert.doesNotMatch(canonicalHtml, /\r/, 'Featured HTML may use LF or checkout-filtered CRLF, never bare CR bytes.');
    const digest = createHash('sha256').update(canonicalHtml).digest('hex');
    assert.equal(digest, entry.contentDigest);
    if (!entry.provenance.generatedByModel) continue;
    const truth = expected[entry.id];
    assert.equal(entry.title, truth.title);
    assert.equal(entry.modelId, truth.modelId);
    assert.equal(entry.resolvedModel, truth.modelId);
    assert.equal(entry.providerGenerationId, truth.providerGenerationId);
    assert.equal(entry.provenance.localGenerationId, truth.localGenerationId);
    assert.equal(entry.provenance.generationTraceId, truth.traceId);
    assert.equal(entry.contentDigest, truth.digest);
    assert.equal(Buffer.byteLength(canonicalHtml, 'utf8'), truth.bytes);
    assert.equal(canonicalHtml.endsWith('\n'), false);
    assert.ok(html.includes(`<title>${truth.htmlTitle}</title>`));
    assert.equal(entry.promptProfileId, truth.promptProfileId);
    assert.equal(entry.promptProfileName, truth.promptProfileName);
    assert.equal(entry.promptVersion, 'visualizer-prompt-v2');
    assert.equal(entry.audioApiVersion, 'visualizer-audio-v1');
    assert.equal(entry.reliability.contract, 'dream-reliability-v3');
    assert.equal(entry.provenance.operatorApprovalRecord.kind, 'operator-curation-approval');
    assert.equal(entry.provenance.operatorApprovalRecord.source, truth.approvalSource);
  }
  const loaded = await loadFeaturedDreams({ fetchImpl: featuredFetch });
  assert.deepEqual(loaded.map(entry => entry.id), FEATURED_DREAM_MANIFEST.map(entry => entry.id));
  assert.ok(loaded.every(entry => entry.source === 'featured' && entry.contentDigestVerified));
});

test('Featured loading quarantines unavailable, malformed, and digest-mismatched entries', async () => {
  const runFault = async (faultId, response, expectedCode) => {
    const failures = [];
    const loaded = await loadFeaturedDreams({
      fetchImpl: async url => {
        const id = String(url).match(/\/([^/]+)\.html$/)?.[1];
        return id === faultId ? response : featuredFetch(url);
      },
      onFailure: failure => failures.push(failure),
    });
    assert.equal(loaded.some(entry => entry.id === faultId), faultId === 'calibration-bloom');
    assert.ok(loaded.some(entry => entry.id === 'calibration-bloom'));
    assert.deepEqual(failures, [{ id: faultId, code: expectedCode }]);
    return loaded;
  };

  const withoutKlang = await runFault('klangfiguren', { ok: false }, FEATURED_LOAD_FAILURES.UNAVAILABLE);
  assert.deepEqual(withoutKlang.map(entry => entry.id), ['nexus-beam', 'calibration-bloom']);
  assert.deepEqual(withoutKlang.filter(entry => entry.startup).map(entry => entry.id), ['calibration-bloom']);
  await runFault('klangfiguren', {
    ok: true,
    text: async () => `${featuredHtml.klangfiguren} `,
  }, FEATURED_LOAD_FAILURES.DIGEST_MISMATCH);
  await runFault('klangfiguren', {
    ok: true,
    text: async () => '<!doctype html><html><body>incomplete',
  }, FEATURED_LOAD_FAILURES.MALFORMED);
  const withoutNexus = await runFault('nexus-beam', { ok: false }, FEATURED_LOAD_FAILURES.UNAVAILABLE);
  assert.deepEqual(withoutNexus.map(entry => entry.id), ['klangfiguren', 'calibration-bloom']);
  await runFault('nexus-beam', {
    ok: true,
    text: async () => `${featuredHtml['nexus-beam']} `,
  }, FEATURED_LOAD_FAILURES.DIGEST_MISMATCH);
});

test('Featured no-network mode preserves embedded Calibration without admitting unverified model bytes', async () => {
  const failures = [];
  const loaded = await loadFeaturedDreams({ fetchImpl: null, onFailure: failure => failures.push(failure) });
  assert.deepEqual(loaded.map(entry => entry.id), ['calibration-bloom']);
  assert.equal(loaded[0].contentDigestVerified, false);
  assert.match(loaded[0].html, /Calibration Bloom/);
  assert.deepEqual(failures, [
    { id: 'klangfiguren', code: FEATURED_LOAD_FAILURES.UNAVAILABLE },
    { id: 'nexus-beam', code: FEATURED_LOAD_FAILURES.UNAVAILABLE },
    { id: 'calibration-bloom', code: FEATURED_LOAD_FAILURES.UNAVAILABLE },
  ]);
});

test('Dream display-title precedence is deterministic and editable metadata remains separate', async () => {
  const dream = {
    id: 'generation-12345678',
    modelId: MODEL.id,
    modelName: MODEL.name,
    displayTitle: 'User title',
    curatedDisplayTitle: 'Operator title',
    artifactTitle: 'Artifact title',
    title: 'Legacy title',
    html: '<!doctype html><title>HTML title</title>',
    traceId: 'trace-immutable',
    contentDigest: 'digest-immutable',
    modelFitConfiguration: { key: 'immutable-fit' },
  };
  assert.equal(dreamDisplayTitle(dream), 'User title');
  assert.equal(dreamDisplayTitle({ ...dream, displayTitle: '' }), 'Operator title');
  assert.equal(dreamDisplayTitle({ ...dream, displayTitle: '', curatedDisplayTitle: '' }), 'Artifact title');
  assert.equal(dreamDisplayTitle({ ...dream, displayTitle: '', curatedDisplayTitle: '', artifactTitle: '' }), 'Legacy title');
  assert.match(dreamDisplayTitle({ ...dream, displayTitle: '', curatedDisplayTitle: '', artifactTitle: '', title: '' }), /^Kimi K3 · #[a-z0-9]{8}$/);
  assert.equal(htmlDocumentTitle(dream.html), 'HTML title');
  assert.match(dreamDisplayTitle({ id: dream.id, modelName: MODEL.name }), /^Kimi K3 · #[a-z0-9]{8}$/);
  assert.equal(editableDreamDisplayTitle('  My\nDream  '), 'My Dream');
  assert.equal(editableDreamDisplayTitle('   '), '');

  const store = new GenerationStore();
  await store.put(dream);
  const renamed = await store.setDisplayTitle(dream.id, 'Persisted user title');
  assert.equal(dreamDisplayTitle(renamed), 'Persisted user title');
  assert.equal((await store.get(dream.id)).displayTitle, 'Persisted user title');
  assert.equal(renamed.id, dream.id);
  assert.equal(renamed.traceId, dream.traceId);
  assert.equal(renamed.contentDigest, dream.contentDigest);
  assert.deepEqual(renamed.modelFitConfiguration, dream.modelFitConfiguration);
  assert.equal(renamed.html, dream.html);
});

test('Dream prompt labels prefer saved names, known presets, captured names, then truthful fallback', () => {
  const savedPrompts = [{ profileId: 'custom-abc12345', briefHash: 'same-hash', name: 'Saved experiment' }];
  assert.equal(dreamPromptLabel({
    promptProfileId: 'custom-abc12345',
    promptProfileName: 'Captured old name',
    promptProfile: { briefHash: 'same-hash' },
  }, { savedPrompts }), 'Saved experiment');
  const aliases = [
    ...savedPrompts.map(entry => ({ ...entry, entryId: 'saved-one' })),
    { ...savedPrompts[0], entryId: 'saved-two', name: 'Second alias' },
  ];
  assert.equal(dreamPromptLabel({
    promptProfileId: 'custom-abc12345',
    promptProfileName: 'Captured old name',
    promptProfile: { briefHash: 'same-hash' },
  }, { savedPrompts: aliases }), 'Captured old name');
  assert.equal(dreamPromptLabel({
    promptProfileId: 'custom-abc12345',
    promptProfileName: 'Captured old name',
    promptLibraryEntryId: 'saved-two',
    promptProfile: { briefHash: 'same-hash' },
  }, { savedPrompts: aliases }), 'Second alias');
  assert.equal(dreamPromptLabel({ promptProfileId: 'neutral-v1', promptProfileName: 'opaque' }), 'Neutral blank canvas');
  assert.equal(dreamPromptLabel({ promptProfileId: 'custom-784707e6', promptProfileName: 'Neutral Crisp V1' }), 'Neutral Crisp V1');
  assert.equal(dreamPromptLabel({ promptProfileId: 'custom-deadbeef' }), 'Custom prompt · #deadbeef');
  assert.equal(dreamPromptLabel({}), 'Prompt not captured');
});

test('raw diagnostic disclosure state survives same-trace rerenders and resets across traces', () => {
  const state = createDiagnosticDetailsState();
  state.open('trace-a');
  assert.equal(state.isOpen('trace-a'), true);
  state.reconcile(['trace-a', 'trace-b']);
  state.select('trace-a');
  assert.equal(state.snapshot(), 'trace-a');
  state.select('trace-b');
  assert.equal(state.snapshot(), '');
  state.open('trace-b');
  state.reconcile(['trace-a']);
  assert.equal(state.snapshot(), '');
});

test('Featured identity uses stable title and never changes NEXT model truth', () => {
  const controller = createLiveIdentityController({ idFactory: () => 'identity-token', clock: () => 10 });
  controller.setNext(MODEL);
  const token = controller.stageCandidate({
    kind: 'featured',
    artifactId: 'operator-art-one',
    generationId: 'featured:operator-art-one',
    title: 'Operator Art One',
    modelId: 'model/exact',
    modelName: 'Exact Model',
  }).candidate.token;
  const committed = controller.commitPromotion(token);
  assert.equal(committed.live.kind, 'featured');
  assert.equal(committed.live.displayName, 'Operator Art One');
  assert.equal(committed.next.modelId, MODEL.id);
  const renamed = controller.setLiveDisplayName('featured:operator-art-one', 'Edited display title');
  assert.equal(renamed.live.displayName, 'Edited display title');
  assert.equal(renamed.live.generationId, committed.live.generationId);
  assert.equal(renamed.live.artifactId, committed.live.artifactId);
  assert.equal(renamed.live.traceId, committed.live.traceId);
  assert.throws(() => controller.setLiveDisplayName('different-artifact', 'Wrong target'), /does not match/);
});

test('curation export requires complete evidence and remains unloadable before operator review', async () => {
  await assert.rejects(
    createFeaturedExportPackage({ id: 'missing-evidence', modelId: MODEL.id, html: HTML }),
    /exact model, request, prompt, trace, and preflight evidence/i,
  );
  const exported = await createFeaturedExportPackage({
    id: 'abcdef12-generation',
    modelId: MODEL.id,
    modelName: MODEL.name,
    resolvedModel: `${MODEL.id}:exact`,
    promptProfileId: PROMPT.id,
    promptVersion: 'visualizer-prompt-v2',
    audioApiVersion: 'visualizer-audio-v1',
    traceId: 'trace-local',
    requestId: 'request-local',
    healthStatus: 'ready',
    preflightEvidence: { passed: true },
    html: HTML,
  });
  assert.equal(exported.reviewStatus, 'pending-operator-review');
  assert.equal(exported.manifestEntry.provenance.curationStatus, 'pending-operator-review');
  assert.equal(exported.manifestEntry.provenance.operatorApprovalRecord, null);
  assert.match(exported.manifestEntry.contentDigest, /^[a-f0-9]{64}$/);
  assert.throws(() => validateFeaturedEntry(exported.manifestEntry), /positive integer|accepted curation|verified reliability/i);
  assert.equal(exported.html, HTML);
});
