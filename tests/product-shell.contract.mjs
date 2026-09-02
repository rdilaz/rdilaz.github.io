import assert from 'node:assert/strict';
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
  FEATURED_MANIFEST_SCHEMA,
  createFeaturedExportPackage,
  loadFeaturedDreams,
  validateFeaturedEntry,
} from '../public/visualizer/featured-dreams.js';
import { createLiveIdentityController } from '../public/visualizer/live-identity.js';

const MODEL = Object.freeze({ id: 'moonshotai/kimi-k3', name: 'Kimi K3', provider: 'moonshotai' });
const PROMPT = Object.freeze({ id: 'neutral-v1', name: 'Neutral blank canvas', creativeBrief: 'Create what you think music looks like.' });
const HTML = '<!doctype html><html><body><canvas></canvas><script>VIZ.onFrame(()=>{});</script></body></html>';

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
    readyAt: 150,
    favorite: true,
  });
  assert.equal(restored.phase, DREAM_JOB_PHASES.READY);
  assert.equal(restored.artifact.generationId, 'saved-ready');
  assert.equal(restored.artifact.favorite, true);
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
  assert.deepEqual(groups.featured.map(item => item.id), ['calibration-bloom']);
  assert.deepEqual(groups.favorites.map(item => item.id), ['middle', 'old']);
  assert.deepEqual(groups.recent.map(item => item.id), ['new', 'middle']);
  assert.equal(groups.recent.some(item => item.id === 'broken'), false);
  assert.equal(groups.favorites.find(item => item.id === 'old').active, true);
});

test('Featured manifest is deterministic and truthfully labels the sole shipped art', async () => {
  assert.ok(FEATURED_DREAM_MANIFEST.length >= 1 && FEATURED_DREAM_MANIFEST.length <= 3);
  FEATURED_DREAM_MANIFEST.forEach(validateFeaturedEntry);
  const [entry] = FEATURED_DREAM_MANIFEST;
  assert.equal(entry.schema, FEATURED_MANIFEST_SCHEMA);
  assert.equal(entry.id, 'calibration-bloom');
  assert.equal(entry.startup, true);
  assert.equal(entry.provenance.kind, 'host-created');
  assert.equal(entry.provenance.generatedByModel, false);
  assert.equal(entry.provenance.operatorApprovalRecord.kind, 'existing-shipped-artifact');
  assert.match(entry.contentDigest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(entry.htmlPath, /tests[\\/]fixtures/i);
  const html = await readFile(new URL('../public/visualizer/featured/calibration-bloom.html', import.meta.url), 'utf8');
  assert.match(html, /<canvas/i);
  assert.match(html, /\bVIZ\.frame\b/);
  assert.doesNotMatch(html, /https?:\/\/|openrouter|authorization|api[_-]?key/i);
  const loaded = await loadFeaturedDreams({ fetchImpl: null });
  assert.equal(loaded[0].source, 'featured');
  assert.match(loaded[0].html, /Calibration Bloom/);
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
