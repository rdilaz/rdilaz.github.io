import {
  PROMPT_PRESETS,
  customPromptProfile,
  loadPromptProfile,
  promptPreset,
} from './prompt.js';

export const PROMPT_LIBRARY_SCHEMA = 'visualizer-prompt-library-v1';
export const PROMPT_LIBRARY_STORAGE_KEY = 'ai-visualizer.prompt-library.v1';
export const MAX_PROMPT_LIBRARY_ENTRIES = 100;
export const MAX_PROMPT_LIBRARY_NAME_CHARS = 80;

function storageOrNull(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function cleanName(value) {
  const name = String(value ?? '').trim().slice(0, MAX_PROMPT_LIBRARY_NAME_CHARS);
  if (!name) throw new TypeError('Prompt name cannot be empty.');
  return name;
}

function defaultEntryId() {
  return globalThis.crypto?.randomUUID?.()
    || `prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function copyEntry(entry) {
  return Object.freeze({ ...entry });
}

function entryFromContent({ entryId, name, creativeBrief, profileId = '', source = 'custom', createdAt, updatedAt }) {
  const preset = source === 'preset'
    ? PROMPT_PRESETS.find(candidate => candidate.id === profileId && candidate.creativeBrief.trim() === String(creativeBrief || '').trim())
    : null;
  const profile = preset ? promptPreset(preset.id) : customPromptProfile(creativeBrief, name);
  return {
    entryId: String(entryId || '').trim(),
    name: cleanName(name),
    createdAt: Number(createdAt) || Date.now(),
    updatedAt: Number(updatedAt) || Number(createdAt) || Date.now(),
    creativeBrief: profile.creativeBrief,
    profileId: profile.id,
    briefHash: profile.briefHash,
    source: profile.source,
  };
}

function parseDocument(storage) {
  if (!storage?.getItem) return null;
  try {
    const parsed = JSON.parse(storage.getItem(PROMPT_LIBRARY_STORAGE_KEY) || 'null');
    return parsed?.schema === PROMPT_LIBRARY_SCHEMA ? parsed : null;
  } catch {
    return null;
  }
}

function normalizedEntries(document) {
  const entries = [];
  const ids = new Set();
  for (const candidate of Array.isArray(document?.entries) ? document.entries : []) {
    try {
      const entry = entryFromContent(candidate || {});
      if (!entry.entryId || ids.has(entry.entryId)) continue;
      ids.add(entry.entryId);
      entries.push(entry);
    } catch {
      // Ignore only the malformed entry; valid research snapshots remain available.
    }
    if (entries.length >= MAX_PROMPT_LIBRARY_ENTRIES) break;
  }
  return entries;
}

export function readPromptLibraryEntries(storage = null) {
  return Object.freeze(normalizedEntries(parseDocument(storageOrNull(storage))).map(copyEntry));
}

export function createPromptLibrary({
  storage = null,
  activeProfile = null,
  now = () => Date.now(),
  createEntryId = defaultEntryId,
} = {}) {
  const target = storageOrNull(storage);
  const stored = parseDocument(target);
  let entries = normalizedEntries(stored);
  let activeEntryId = entries.some(entry => entry.entryId === stored?.activeEntryId)
    ? stored.activeEntryId
    : null;

  function syncFromStorage() {
    const latest = parseDocument(target);
    if (!latest) return;
    entries = normalizedEntries(latest);
    activeEntryId = entries.some(entry => entry.entryId === latest.activeEntryId)
      ? latest.activeEntryId
      : null;
  }

  function uniqueEntryId() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = String(createEntryId() || '').trim();
      if (candidate && !entries.some(entry => entry.entryId === candidate)) return candidate;
    }
    throw new Error('Could not create a unique saved-prompt identity.');
  }

  function writeDocument(nextEntries, nextActiveEntryId, required = true) {
    if (!target?.setItem) {
      if (required) throw new Error('Prompt Library could not access browser storage. No snapshot was saved.');
      return false;
    }
    try {
      target.setItem(PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify({
        schema: PROMPT_LIBRARY_SCHEMA,
        activeEntryId: nextActiveEntryId,
        entries: nextEntries,
      }));
      return true;
    } catch {
      if (required) throw new Error('Prompt Library could not write browser storage. No snapshot was saved.');
      return false;
    }
  }

  function commit(nextEntries, nextActiveEntryId = activeEntryId) {
    writeDocument(nextEntries, nextActiveEntryId);
    entries = nextEntries;
    activeEntryId = nextActiveEntryId;
  }

  function snapshot() {
    return Object.freeze({
      schema: PROMPT_LIBRARY_SCHEMA,
      activeEntryId,
      entries: Object.freeze(entries.map(copyEntry)),
    });
  }

  function requireEntry(entryId) {
    const entry = entries.find(candidate => candidate.entryId === String(entryId || ''));
    if (!entry) throw new Error('Saved prompt not found.');
    return entry;
  }

  function add(name, creativeBrief, promptProfile = null) {
    syncFromStorage();
    if (entries.length >= MAX_PROMPT_LIBRARY_ENTRIES) {
      throw new RangeError(`Prompt Library can hold up to ${MAX_PROMPT_LIBRARY_ENTRIES} saved prompts.`);
    }
    const timestamp = Number(now()) || Date.now();
    const entry = entryFromContent({
      entryId: uniqueEntryId(),
      name,
      creativeBrief,
      profileId: promptProfile?.id,
      source: promptProfile?.source,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    commit([entry, ...entries]);
    return copyEntry(entry);
  }

  if (!stored) {
    const current = activeProfile || loadPromptProfile(target);
    if (current?.source === 'custom') {
      const timestamp = Number(now()) || Date.now();
      const imported = entryFromContent({
        entryId: uniqueEntryId(),
        name: current.name || 'Custom prompt',
        creativeBrief: current.creativeBrief,
        profileId: current.id,
        source: current.source,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      entries = [imported];
      activeEntryId = imported.entryId;
    }
    writeDocument(entries, activeEntryId, false);
  }

  return Object.freeze({
    storageKey: PROMPT_LIBRARY_STORAGE_KEY,
    schema: PROMPT_LIBRARY_SCHEMA,
    snapshot: () => {
      syncFromStorage();
      return snapshot();
    },
    saved: () => {
      syncFromStorage();
      return snapshot().entries;
    },
    saveAs: (name, creativeBrief, promptProfile = null) => add(name, creativeBrief, promptProfile),
    profile(entryId) {
      syncFromStorage();
      const entry = requireEntry(entryId);
      return entry.source === 'preset'
        ? promptPreset(entry.profileId)
        : customPromptProfile(entry.creativeBrief, entry.name);
    },
    selected(profile = loadPromptProfile(target)) {
      syncFromStorage();
      const exact = entry => entry.creativeBrief === profile?.creativeBrief && entry.profileId === profile?.id;
      const selected = entries.find(entry => entry.entryId === activeEntryId && exact(entry))
        || entries.find(entry => exact(entry) && entry.name === profile.name)
        || entries.find(exact)
        || null;
      return selected ? copyEntry(selected) : null;
    },
    setActiveEntry(entryId = null) {
      syncFromStorage();
      if (entryId !== null) requireEntry(entryId);
      const nextActiveEntryId = entryId === null ? null : String(entryId);
      commit(entries, nextActiveEntryId);
      return nextActiveEntryId;
    },
    rename(entryId, name) {
      syncFromStorage();
      const current = requireEntry(entryId);
      const renamed = entryFromContent({
        ...current,
        name,
        updatedAt: Number(now()) || Date.now(),
      });
      commit(entries.map(entry => entry.entryId === current.entryId ? renamed : entry));
      return copyEntry(renamed);
    },
    duplicate(entryId, newName = '') {
      syncFromStorage();
      const source = requireEntry(entryId);
      return add(newName || `${source.name} copy`, source.creativeBrief, {
        id: source.profileId,
        source: source.source,
      });
    },
    delete(entryId) {
      syncFromStorage();
      const current = requireEntry(entryId);
      const nextActiveEntryId = activeEntryId === current.entryId ? null : activeEntryId;
      commit(entries.filter(entry => entry.entryId !== current.entryId), nextActiveEntryId);
      return copyEntry(current);
    },
    builtIns: () => PROMPT_PRESETS.map(preset => Object.freeze({ ...preset })),
  });
}
