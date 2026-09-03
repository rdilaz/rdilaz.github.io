import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUDIO_API_VERSION,
  FIXED_RUNTIME_CONTRACT,
  LEGACY_CANONICAL_VISUALIZER_PROMPT,
  PROMPT_STORAGE_KEY,
  PROMPT_VERSION,
  buildGenerationMessages,
  buildRepairMessages,
  customPromptProfile,
  loadPromptProfile,
  promptPreset,
  savePromptProfile,
} from '../public/visualizer/prompt.js';
import {
  PROMPT_LIBRARY_SCHEMA,
  PROMPT_LIBRARY_STORAGE_KEY,
  createPromptLibrary,
} from '../public/visualizer/prompt-library.js';
import { modelFitConfigurationKey } from '../public/visualizer/model-fit-evidence.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => { values.set(String(key), String(value)); },
    removeItem: key => { values.delete(String(key)); },
    json: key => JSON.parse(values.get(key) || 'null'),
  };
}

function deterministicLibrary(storage, start = 1) {
  let id = start;
  let time = 1000 + start;
  return createPromptLibrary({
    storage,
    createEntryId: () => `library-entry-${id++}`,
    now: () => time++,
  });
}

function modelFitInput(profile) {
  return {
    modelId: 'fixture/research-model',
    reasoningChoice: 'default',
    promptProfileId: profile.id,
    promptVersion: PROMPT_VERSION,
    promptHash: profile.briefHash,
    generationEnvelopeMajorVersion: 1,
    audioApiVersion: AUDIO_API_VERSION,
    reliabilityVersion: 'dream-reliability-v3',
    runtimeVersion: 'visualizer-runtime-v3',
  };
}

test('named snapshots persist and use the existing active-profile mechanism exactly', () => {
  const storage = memoryStorage();
  const brief = 'Render a restrained field whose structure follows the music.';
  const library = deterministicLibrary(storage);
  const entry = library.saveAs('Neutral Crisp v1', brief);

  assert.equal(storage.json(PROMPT_LIBRARY_STORAGE_KEY).schema, PROMPT_LIBRARY_SCHEMA);
  assert.equal(entry.entryId, 'library-entry-1');
  assert.equal(entry.name, 'Neutral Crisp v1');
  assert.equal(entry.creativeBrief, brief);
  assert.equal(entry.profileId, `custom-${entry.briefHash}`);
  assert.equal('runtimeContract' in entry, false);

  const reloaded = deterministicLibrary(storage, 10);
  assert.deepEqual(reloaded.saved(), [entry]);
  const activated = savePromptProfile(reloaded.profile(entry.entryId), storage);
  reloaded.setActiveEntry(entry.entryId);
  const loadedActive = loadPromptProfile(storage);

  assert.deepEqual(loadedActive, activated);
  assert.equal(loadedActive.creativeBrief, brief);
  assert.equal(loadedActive.id, entry.profileId);
  assert.equal(loadedActive.briefHash, entry.briefHash);
  assert.equal(loadedActive.name, entry.name);
  assert.equal(reloaded.selected(loadedActive).entryId, entry.entryId);
  assert.equal(storage.json(PROMPT_STORAGE_KEY).schema, 'visualizer-prompt-profile-v1');
});

test('rename and duplicate preserve content identity, request messages, and model-fit identity', () => {
  const storage = memoryStorage();
  const library = deterministicLibrary(storage);
  const original = library.saveAs('Bare Autonomous v1', 'Make a sparse autonomous response to the music.');
  const beforeProfile = library.profile(original.entryId);
  const beforeGeneration = buildGenerationMessages(beforeProfile);
  const beforeRepair = buildRepairMessages('<html>fixture</html>', 'NO_VISIBLE_OUTPUT', beforeProfile);
  const beforeKey = modelFitConfigurationKey(modelFitInput(beforeProfile));

  const renamed = library.rename(original.entryId, 'Bare Autonomous renamed');
  const afterProfile = library.profile(original.entryId);
  const afterKey = modelFitConfigurationKey(modelFitInput(afterProfile));

  assert.equal(renamed.entryId, original.entryId);
  assert.equal(renamed.creativeBrief, original.creativeBrief);
  assert.equal(renamed.profileId, original.profileId);
  assert.equal(renamed.briefHash, original.briefHash);
  assert.equal(afterProfile.id, beforeProfile.id);
  assert.equal(afterProfile.briefHash, beforeProfile.briefHash);
  assert.equal(afterKey, beforeKey);
  assert.deepEqual(buildGenerationMessages(afterProfile), beforeGeneration);
  assert.deepEqual(buildRepairMessages('<html>fixture</html>', 'NO_VISIBLE_OUTPUT', afterProfile), beforeRepair);
  assert.equal(beforeGeneration[1].content, `${original.creativeBrief}\n\n${FIXED_RUNTIME_CONTRACT}`);

  const duplicate = library.duplicate(original.entryId, 'Bare Autonomous branch');
  assert.notEqual(duplicate.entryId, original.entryId);
  assert.equal(duplicate.creativeBrief, original.creativeBrief);
  assert.equal(duplicate.profileId, original.profileId);
  assert.equal(duplicate.briefHash, original.briefHash);
});

test('saved built-in starting points retain exact preset request semantics', () => {
  const storage = memoryStorage();
  const library = deterministicLibrary(storage);
  const baseline = promptPreset('baseline-v1');
  const entry = library.saveAs('Baseline research reference', baseline.creativeBrief, baseline);

  assert.equal(entry.source, 'preset');
  assert.equal(entry.profileId, baseline.id);
  assert.equal(entry.briefHash, baseline.briefHash);
  assert.deepEqual(library.profile(entry.entryId), baseline);
  assert.equal(buildGenerationMessages(library.profile(entry.entryId))[1].content, LEGACY_CANONICAL_VISUALIZER_PROMPT);

  const renamed = library.rename(entry.entryId, 'Renamed baseline reference');
  assert.equal(renamed.profileId, baseline.id);
  assert.equal(buildGenerationMessages(library.profile(entry.entryId))[1].content, LEGACY_CANONICAL_VISUALIZER_PROMPT);
});

test('editing and saving a draft creates a new identity without mutating old snapshots', () => {
  const storage = memoryStorage();
  const library = deterministicLibrary(storage);
  const original = library.saveAs('Study v1', 'Follow only the broad musical structure.');
  const duplicate = library.duplicate(original.entryId, 'Study branch');
  const editedBrief = `${duplicate.creativeBrief} Favor crisp transitions.`;

  assert.equal(library.saved().find(entry => entry.entryId === original.entryId).creativeBrief, original.creativeBrief);
  assert.equal(library.saved().find(entry => entry.entryId === duplicate.entryId).creativeBrief, original.creativeBrief);

  const edited = library.saveAs('Study v2', editedBrief);
  assert.notEqual(edited.profileId, original.profileId);
  assert.notEqual(edited.briefHash, original.briefHash);
  assert.equal(library.saved().find(entry => entry.entryId === original.entryId).creativeBrief, original.creativeBrief);
  assert.equal(library.saved().find(entry => entry.entryId === duplicate.entryId).creativeBrief, original.creativeBrief);
});

test('delete removes only a library entry and built-in presets remain outside mutable storage', () => {
  const storage = memoryStorage({ 'fixture.dream-evidence': '{"kept":true}' });
  const library = deterministicLibrary(storage);
  const entry = library.saveAs('Disposable', 'A prompt snapshot that can be removed from the library.');
  const active = savePromptProfile(library.profile(entry.entryId), storage);
  library.setActiveEntry(entry.entryId);

  const deleted = library.delete(entry.entryId);
  assert.equal(deleted.entryId, entry.entryId);
  assert.deepEqual(library.saved(), []);
  assert.deepEqual(loadPromptProfile(storage), active);
  assert.deepEqual(storage.json('fixture.dream-evidence'), { kept: true });

  assert.deepEqual(library.builtIns().map(preset => preset.id), ['neutral-v1', 'baseline-v1']);
  assert.throws(() => library.rename('neutral-v1', 'Changed'), /not found/);
  assert.throws(() => library.delete('baseline-v1'), /not found/);
});

test('first use imports an existing active custom prompt once without replacing active storage', () => {
  const existing = customPromptProfile('Preserve this pre-library custom brief exactly.');
  const storage = memoryStorage();
  savePromptProfile(existing, storage);
  const activeBefore = storage.getItem(PROMPT_STORAGE_KEY);

  const first = deterministicLibrary(storage);
  assert.equal(first.saved().length, 1);
  assert.equal(first.saved()[0].name, 'Custom prompt');
  assert.equal(first.saved()[0].creativeBrief, existing.creativeBrief);
  assert.equal(first.saved()[0].profileId, existing.id);
  assert.equal(storage.getItem(PROMPT_STORAGE_KEY), activeBefore);

  first.delete(first.saved()[0].entryId);
  const second = deterministicLibrary(storage, 20);
  assert.deepEqual(second.saved(), []);
  assert.equal(storage.getItem(PROMPT_STORAGE_KEY), activeBefore);
});

test('storage failures are explicit and concurrent library instances do not overwrite snapshots', () => {
  const denied = {
    getItem: () => null,
    setItem: () => { throw new Error('fixture denied'); },
  };
  const unavailable = deterministicLibrary(denied);
  assert.throws(
    () => unavailable.saveAs('Not persisted', 'This must not be reported as a saved snapshot.'),
    /No snapshot was saved/,
  );
  assert.deepEqual(unavailable.saved(), []);

  const storage = memoryStorage();
  const first = deterministicLibrary(storage, 30);
  const second = deterministicLibrary(storage, 40);
  first.saveAs('First tab', 'A snapshot written by the first library instance.');
  second.saveAs('Second tab', 'A snapshot written by the second library instance.');
  assert.deepEqual(
    deterministicLibrary(storage, 50).saved().map(entry => entry.name),
    ['Second tab', 'First tab'],
  );
});
