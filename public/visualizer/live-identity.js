export const LIVE_IDENTITY_SCHEMA = 'live-identity-v1';

export const BUILT_IN_LIVE_IDENTITY = Object.freeze({
  kind: 'built-in',
  modelId: 'built-in/calibration-bloom',
  modelName: 'Calibration Bloom',
  generationId: '',
  traceId: '',
  marker: '',
  displayName: 'Calibration Bloom',
  committedAt: null,
});

export const EMPTY_NEXT_IDENTITY = Object.freeze({
  modelId: '',
  modelName: 'Choose a model',
  displayName: 'Choose a model',
  selectedAt: null,
});

const clone = value => structuredClone(value);

function requiredText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} is required.`);
  return text;
}

function hashMarker(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function identityMarker(generationOrTraceId) {
  const source = requiredText(generationOrTraceId, 'A generation or trace ID');
  const compact = source.toLowerCase().replace(/[^a-z0-9]/g, '');
  return compact.length >= 8 ? compact.slice(0, 8) : hashMarker(source);
}

function normalizeNext(model, at) {
  if (model == null || model === '') return clone(EMPTY_NEXT_IDENTITY);
  const modelId = requiredText(model.id ?? model.modelId, 'NEXT model ID');
  const modelName = requiredText(model.name ?? model.modelName ?? modelId, 'NEXT model name');
  return {
    modelId,
    modelName,
    displayName: modelName,
    selectedAt: at,
  };
}

function normalizeLive(identity, at) {
  if (identity == null || identity.kind === 'built-in') {
    return { ...clone(BUILT_IN_LIVE_IDENTITY), committedAt: at ?? null };
  }

  const modelId = requiredText(identity.modelId ?? identity.id, 'LIVE model ID');
  const modelName = requiredText(identity.modelName ?? identity.name ?? modelId, 'LIVE model name');
  const generationId = String(identity.generationId ?? '').trim();
  const traceId = String(identity.traceId ?? '').trim();
  const sourceId = generationId || traceId;
  if (!sourceId) throw new TypeError('A generated LIVE identity requires a generationId or traceId.');
  const marker = identityMarker(sourceId);

  return {
    kind: identity.kind === 'saved' ? 'saved' : 'generated',
    modelId,
    modelName,
    providerId: String(identity.providerId ?? ''),
    upstreamProvider: String(identity.upstreamProvider ?? identity.provider ?? ''),
    resolvedModel: String(identity.resolvedModel ?? ''),
    generationId,
    traceId,
    diagnosticId: String(identity.diagnosticId ?? ''),
    marker,
    displayName: `${modelName} · #${marker}`,
    committedAt: at,
  };
}

function createInitialState() {
  return {
    live: clone(BUILT_IN_LIVE_IDENTITY),
    next: clone(EMPTY_NEXT_IDENTITY),
    candidate: null,
    revision: 0,
  };
}

export function createLiveIdentityController({
  idFactory = () => globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  clock = () => Date.now(),
} = {}) {
  if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function.');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function.');

  let state = createInitialState();
  let rollbackLive = null;
  let tokenSequence = 0;
  const issuedTokens = new Set();

  function snapshot() {
    return clone({
      schema: LIVE_IDENTITY_SCHEMA,
      live: state.live,
      next: state.next,
      candidate: state.candidate,
      revision: state.revision,
    });
  }

  function update(patch) {
    state = { ...state, ...patch, revision: state.revision + 1 };
    return snapshot();
  }

  function issueToken() {
    let token;
    do {
      tokenSequence += 1;
      token = `candidate:${String(idFactory())}:${tokenSequence}`;
    } while (issuedTokens.has(token));
    issuedTokens.add(token);
    return token;
  }

  function setNext(model) {
    return update({ next: normalizeNext(model, clock()) });
  }

  function stageCandidate(identity) {
    const stagedAt = clock();
    const token = issueToken();
    const live = normalizeLive(identity, stagedAt);
    return update({
      candidate: {
        ...live,
        token,
        stagedAt,
        committedAt: null,
      },
    });
  }

  function assertCandidateToken(token) {
    if (!state.candidate || typeof token !== 'string' || token !== state.candidate.token) {
      throw new Error('Candidate promotion token is missing, stale, or does not match.');
    }
  }

  function commitPromotion(token) {
    assertCandidateToken(token);
    const committedAt = clock();
    rollbackLive = clone(state.live);
    const candidate = clone(state.candidate);
    delete candidate.token;
    delete candidate.stagedAt;
    return update({
      live: { ...candidate, committedAt },
      candidate: null,
    });
  }

  function discardCandidate(token) {
    if (!state.candidate) return snapshot();
    assertCandidateToken(token);
    return update({ candidate: null });
  }

  function rollback(expectedGenerationOrTraceId = '') {
    if (!rollbackLive) return snapshot();
    const expected = String(expectedGenerationOrTraceId || '');
    if (expected) {
      const currentId = state.live.generationId || state.live.traceId;
      if (currentId !== expected) throw new Error('Rollback target does not match the current LIVE identity.');
    }
    const restored = clone(rollbackLive);
    rollbackLive = null;
    return update({ live: restored, candidate: null });
  }

  function restore(identity = BUILT_IN_LIVE_IDENTITY) {
    const restored = normalizeLive(identity, clock());
    rollbackLive = null;
    return update({ live: restored, candidate: null });
  }

  function restoreBuiltIn() {
    return restore(BUILT_IN_LIVE_IDENTITY);
  }

  function reset() {
    const revision = state.revision + 1;
    state = { ...createInitialState(), revision };
    rollbackLive = null;
    return snapshot();
  }

  return Object.freeze({
    version: LIVE_IDENTITY_SCHEMA,
    snapshot,
    setNext,
    stageCandidate,
    commitPromotion,
    discardCandidate,
    rollback,
    restore,
    restoreBuiltIn,
    reset,
  });
}
