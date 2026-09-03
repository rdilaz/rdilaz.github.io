import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

const [
  index,
  app,
  liveIdentity,
  dreamTrace,
  traceBridge,
  traceViewer,
  audio,
  sandbox,
  reliability,
  diagnostics,
  storage,
  prompt,
  providerRuntime,
  openrouter,
  costGuard,
  modelGuide,
  dreamStatus,
  reliabilityCss,
  productShellCss,
  playbackState,
  dreamJob,
  dreamSwitcher,
  featuredDreams,
  featuredManifest,
  featuredHtml,
  workflow,
  deploy,
  development,
  transparencyContract,
  transparencyBrowser,
  aetheriaFixture,
  productShellContract,
  productShellBrowser,
] = await Promise.all([
  read('public/visualizer/index.html'),
  read('public/visualizer/app.js'),
  read('public/visualizer/live-identity.js'),
  read('public/visualizer/dream-trace.js'),
  read('public/visualizer/trace-bridge.js'),
  read('public/visualizer/trace-viewer.js'),
  read('public/visualizer/audio-engine.js'),
  read('public/visualizer/sandbox.js'),
  read('public/visualizer/reliability.js'),
  read('public/visualizer/diagnostics.js'),
  read('public/visualizer/storage.js'),
  read('public/visualizer/prompt.js'),
  read('public/visualizer/provider-runtime.js'),
  read('public/visualizer/openrouter.js'),
  read('public/visualizer/cost-guard.js'),
  read('public/visualizer/model-guide.js'),
  read('public/visualizer/dream-status.js'),
  read('public/visualizer/reliability.css'),
  read('public/visualizer/product-shell.css'),
  read('public/visualizer/playback-state.js'),
  read('public/visualizer/dream-job.js'),
  read('public/visualizer/dream-switcher.js'),
  read('public/visualizer/featured-dreams.js'),
  read('public/visualizer/featured/manifest.js'),
  read('public/visualizer/featured/calibration-bloom.html'),
  read('.github/workflows/visualizer-check.yml'),
  read('.github/workflows/deploy.yml'),
  read('docs/visualizer/DEVELOPMENT.md'),
  read('tests/dream-transparency.contract.mjs'),
  read('tests/dream-transparency.spec.mjs'),
  read('tests/fixtures/aetheria-gemini-3.7-flash.html'),
  read('tests/product-shell.contract.mjs'),
  read('tests/product-shell.spec.mjs'),
]);

const [
  reasoningSettings,
  generationEnvelope,
  generationFailure,
  modelFitEvidence,
  modelProductCatalog,
  keyboardTransport,
  audioSensitivity,
  modelEligibility,
  reasoningSettingsContract,
  generationEnvelopeContract,
  providerQualityContract,
  modelFitEvidenceContract,
  keyboardTransportContract,
  audioSensitivityContract,
  qualityFirstBrowser,
  openRouterSse,
  dreamTransport,
  renderQuality,
  immersiveUi,
  streamingTransportContract,
  renderQualityContract,
  immersiveUiContract,
  streamingImmersiveQualityBrowser,
  runtimeVersion,
  modelSearch,
  dogfoodRuntimeContract,
  fixedInsetCanvasFixture,
  playwrightConfig,
] = await Promise.all([
  read('public/visualizer/reasoning-settings.js'),
  read('public/visualizer/generation-envelope.js'),
  read('public/visualizer/generation-failure.js'),
  read('public/visualizer/model-fit-evidence.js'),
  read('public/visualizer/model-product-catalog.js'),
  read('public/visualizer/keyboard-transport.js'),
  read('public/visualizer/audio-sensitivity.js'),
  read('public/visualizer/model-eligibility.js'),
  read('tests/reasoning-settings.contract.mjs'),
  read('tests/generation-envelope.contract.mjs'),
  read('tests/provider-quality.contract.mjs'),
  read('tests/model-fit-evidence.contract.mjs'),
  read('tests/keyboard-transport.contract.mjs'),
  read('tests/audio-sensitivity.contract.mjs'),
  read('tests/quality-first-controls.spec.mjs'),
  read('public/visualizer/openrouter-sse.js'),
  read('public/visualizer/dream-transport.js'),
  read('public/visualizer/render-quality.js'),
  read('public/visualizer/immersive-ui.js'),
  read('tests/streaming-transport.contract.mjs'),
  read('tests/render-quality.contract.mjs'),
  read('tests/immersive-ui.contract.mjs'),
  read('tests/streaming-immersive-quality.spec.mjs'),
  read('public/visualizer/runtime-version.js'),
  read('public/visualizer/model-search.js'),
  read('tests/dogfood-runtime.contract.mjs'),
  read('tests/fixtures/fixed-inset-auto-canvas.html'),
  read('playwright.config.mjs'),
]);

const failures = [];
let assertionCount = 0;
const expect = (condition, message) => {
  assertionCount += 1;
  if (!condition) failures.push(message);
};
const ordered = (...positions) => positions.every((position, index) => (
  position >= 0 && (index === 0 || positions[index - 1] < position)
));

// Sandbox, audio, prompt and credential invariants.
expect(/sandbox="allow-scripts"/.test(index), 'Generated visualizer iframes must allow scripts inside a sandbox.');
expect(!/sandbox="[^"]*allow-same-origin/.test(index), 'Generated visualizer sandbox must never use allow-same-origin.');
expect(audio.includes('getDisplayMedia'), 'Audio engine must use display/system audio capture.');
expect(!audio.includes('getUserMedia('), 'Microphone capture is forbidden.');
expect(audio.includes("audioSelection:'preferred'"), 'Chromium capture must prefer audio-bearing sources.');
expect(audio.includes('smoothingTimeConstant=.08'), 'Fast analyser smoothing must stay low-latency.');
expect(prompt.includes("PROMPT_VERSION = 'visualizer-prompt-v2'") && prompt.includes('There are no aesthetic requirements.'), 'Versioned legacy baseline prompt must remain aesthetically unconstrained.');
expect(
  prompt.includes("DEFAULT_PROMPT_PRESET_ID = 'neutral-v1'")
    && /export const NEUTRAL_CREATIVE_BRIEF = `Create a real-time visual interpretation of arbitrary music\.\r?\n\r?\nYou have complete artistic freedom\. Decide what music looks like\.`;/.test(prompt)
    && prompt.includes('creativeBrief: NEUTRAL_CREATIVE_BRIEF'),
  'Neutral must remain the unchanged minimal default creative brief.',
);
expect(prompt.includes('WebGL/WebGL2') && prompt.includes('WebGPU when available') && prompt.includes('SVG'), 'Prompt must preserve broad browser-native creative capability.');
expect(sandbox.includes("connect-src 'none'"), 'Generated visualizer CSP must block network connections.');
expect(providerRuntime.includes("billing: 'user'") && providerRuntime.includes('browserOnly: true'), 'Current provider contract must remain browser-only and user-funded.');
expect(providerRuntime.includes('sessionStorage') && providerRuntime.includes('code_challenge_method'), 'OpenRouter connection must remain session-scoped PKCE.');
expect(!providerRuntime.includes('127.0.0.1') && !app.includes('127.0.0.1'), 'Localhost provider routing must not return.');
expect(!index.includes('.exe') && !index.includes('Local Model Lab') && !index.includes('PowerShell'), 'Normal product UI must not require native/local setup.');
expect(!workflow.includes('windows companion') && !deploy.includes('GOOS=windows'), 'CI/deploy must not build a desktop companion.');

// Spend and guided model selection remain intact.
expect(index.includes('./cost-guard.js') && index.indexOf('./cost-guard.js') < index.indexOf('./app.js'), 'Spend guard must load before the app module.');
expect(costGuard.includes('perDream: 0.75') && costGuard.includes('session: 5') && costGuard.includes('daily: 10'), 'Default OpenRouter spend caps changed unexpectedly.');
expect(costGuard.includes('body[maxTokenParameter] = envelope.finalMaxTokens') && costGuard.includes('include: true'), 'Spend guard must apply the calculated model-supported output envelope and request exact usage accounting.');
expect(costGuard.includes('reserveCost({') && costGuard.includes('reconcileReservedCost') && costGuard.includes('uncertain: true'), 'Dispatched requests must reserve spend before cancellation or uncertain transport can occur.');
expect(index.includes('Recommended AIs') && index.includes('Explore experimental models') && modelGuide.includes("els.heading.textContent = 'Recommended AIs'"), 'Model guidance must truthfully separate grounded recommendations from experimental exploration.');
expect(modelGuide.includes("MODEL_ENDPOINT='https://openrouter.ai/api/v1/models'"), 'Model guide must use the live OpenRouter catalog.');

// Quality-first reasoning and generation envelope contracts.
expect(!/\b14_?000\b/.test(providerRuntime) && !/\b14_?000\b/.test(costGuard), 'Provider runtime and spend guard must not restore a universal 14,000-token default or clamp.');
expect(
  reasoningSettings.includes("REASONING_SELECTION_VERSION = 'visualizer-reasoning-selection-v1'")
    && reasoningSettings.includes("REASONING_SELECTION_STORAGE_PREFIX = 'ai-visualizer.reasoning-selection.v1.'"),
  'Reasoning selection and per-model persistence must remain explicitly versioned.',
);
expect(
  reasoningSettings.includes('const allGatewayEfforts = supportedField.present && supportedField.value === null;')
    && reasoningSettings.includes('} else if (Array.isArray(supportedField.value)) {')
    && reasoningSettings.includes("if (mandatory) supportedEfforts = supportedEfforts.filter(effort => effort !== 'none');"),
  'Reasoning choices must come from exact catalog metadata, with None removed for mandatory-reasoning models.',
);
expect(
  reasoningSettings.includes("const options = [{ value: 'default', label: 'Default', mode: 'default', effort: null }];")
    && reasoningSettings.includes('for (const effort of metadata.supportedEfforts)')
    && reasoningSettings.includes('metadata.supportedEfforts.includes(effort)'),
  'Reasoning UI and validation must expose only Default plus exact supported efforts.',
);
const reasoningRequestStart = reasoningSettings.indexOf('export function createReasoningRequestConfiguration');
const reasoningRequestEnd = reasoningSettings.indexOf('export function reasoningSelectionStorageKey', reasoningRequestStart);
const reasoningRequestFlow = reasoningRequestStart >= 0 && reasoningRequestEnd > reasoningRequestStart
  ? reasoningSettings.slice(reasoningRequestStart, reasoningRequestEnd)
  : '';
expect(
  reasoningRequestFlow.includes("if (normalized.mode !== 'explicit') return undefined;")
    && reasoningRequestFlow.includes('return deepFreeze({ effort: normalized.effort });'),
  'Default must be native omission while explicit reasoning uses only the unified effort shape.',
);
const requestBuilderStart = providerRuntime.indexOf('export function buildOpenRouterCompletionRequest');
const requestBuilderEnd = providerRuntime.indexOf('let browserReasoningSelectionStore', requestBuilderStart);
const requestBuilderFlow = requestBuilderStart >= 0 && requestBuilderEnd > requestBuilderStart
  ? providerRuntime.slice(requestBuilderStart, requestBuilderEnd)
  : '';
expect(
  requestBuilderFlow.includes('...(dispatchedReasoning === undefined ? {} : {')
    && requestBuilderFlow.includes('reasoning: dispatchedReasoning')
    && requestBuilderFlow.includes('provider: { require_parameters: true }'),
  'OpenRouter requests must omit native Default and enforce explicit reasoning with require_parameters.',
);
expect(
  modelEligibility.includes("reason: 'OUTPUT_LIMIT_UNENFORCEABLE'")
    && providerRuntime.includes("? 'max_tokens'")
    && providerRuntime.includes("? 'max_completion_tokens'")
    && providerRuntime.includes("supportedParameters.has('temperature')"),
  'Eligible requests must use a model-advertised output limit and omit unsupported temperature.',
);
expect(
  requestBuilderFlow.includes('nativeDefaultUsed: dispatchedReasoning === undefined')
    && requestBuilderFlow.includes('dispatchedReasoning: dispatchedReasoning ?? null')
    && requestBuilderFlow.includes('modelReasoningFacts: reasoningFacts'),
  'Request policy must preserve native-default, dispatched-reasoning and exact metadata facts.',
);
const qualityDispatchSources = `${providerRuntime}\n${costGuard}\n${generationEnvelope}`;
expect(
  !/(?:reasoningSelection|dispatchedReasoning)\s*\.\s*(?:effort|mode)\s*=/.test(qualityDispatchSources)
    && !requestBuilderFlow.includes("effort: 'low'")
    && !requestBuilderFlow.includes("effort: 'high'"),
  'Provider and spend policy must never invent or silently mutate a Low/High reasoning selection.',
);

expect(
  generationEnvelope.includes("GENERATION_ENVELOPE_VERSION = 'visualizer-generation-envelope-v1'")
    && generationEnvelope.includes('minimumPracticalCompletionTokens = 4500')
    && generationEnvelope.includes("policy: 'quality-first'"),
  'Generation envelope version, quality-first policy and practical completion floor must remain explicit.',
);
expect(
  generationEnvelope.includes("if (!entry.present) return { present: false, valid: true, value: null };")
    && generationEnvelope.includes('if (calculationReady && rootCeiling.present) physicalCeilings.push(rootCeiling.value);'),
  'Root max_tokens must be an optional explicit ceiling, never a fallback default.',
);
expect(
  generationEnvelope.includes('model.top_provider?.max_completion_tokens')
    && generationEnvelope.includes('Math.max(0, contextCapacityTokens - promptTokens)')
    && generationEnvelope.includes('Math.min(...physicalCeilings)'),
  'The final generation maximum must respect live model and prompt-adjusted context bounds.',
);
expect(
  generationEnvelope.includes('Math.min(budgets.perDream, budgets.session, budgets.daily, budgets.provider)')
    && generationEnvelope.includes('strictRemainingBudget * safetyFactor')
    && generationEnvelope.includes("['perDream', 'session', 'daily', 'provider']"),
  'Affordability must use the strict Dream, session, daily and provider spend remainder.',
);
expect(
  generationEnvelope.includes('contentBytes + messages.length * 32 + 128')
    && generationEnvelope.includes('requestFeeReserve + promptCostReserve')
    && generationEnvelope.includes('pricing.completion + pricing.internalReasoning'),
  'Envelope cost must reserve conservative prompt, request, completion and reasoning bounds.',
);
expect(
  generationEnvelope.includes('fixedCostReserve + finalMaxTokens * completionPriceCeiling')
    && generationEnvelope.includes('finalRequestCostCeiling > effectiveSpendCeiling')
    && generationEnvelope.includes('finalMaxTokens = Math.max(0, finalMaxTokens - 1)'),
  'Final request cost must be calculated from and corrected against the enforced maximum.',
);
expect(
  generationEnvelope.includes('reasoningSelection: options.reasoningSelection')
    && generationEnvelope.includes('qualityDowngradeApplied: false')
    && generationEnvelope.includes('canDispatch: !configurationBlocked && !insufficientPracticalEnvelope'),
  'Insufficient spend must block dispatch without silently downgrading requested quality.',
);
expect(
  generationEnvelope.includes('minimumPracticalTokensForReasoning')
    && generationEnvelope.includes('high: 80')
    && generationEnvelope.includes('xhigh: 95')
    && generationEnvelope.includes('minimumPracticalCompletionTokensForRequest'),
  'Reasoning-heavy choices must reserve separate artifact room without changing effort.',
);

const guardedCompletionStart = costGuard.indexOf('async function executeGuardedCompletion');
const guardedCompletionEnd = costGuard.indexOf('async function guardedCompletion', guardedCompletionStart);
const guardedCompletionFlow = guardedCompletionStart >= 0 && guardedCompletionEnd > guardedCompletionStart
  ? costGuard.slice(guardedCompletionStart, guardedCompletionEnd)
  : '';
expect(ordered(
  guardedCompletionFlow.indexOf('const envelope = calculateCostGuardEnvelope({'),
  guardedCompletionFlow.indexOf('if (!envelope.canDispatch)'),
  guardedCompletionFlow.indexOf('const requestCeiling = envelope.finalRequestCostCeiling;'),
  guardedCompletionFlow.indexOf('await askCostConfirmation({'),
  guardedCompletionFlow.indexOf('body[maxTokenParameter] = envelope.finalMaxTokens;'),
  guardedCompletionFlow.indexOf('body.usage ='),
  guardedCompletionFlow.indexOf('enforceProviderPriceCeiling(body, envelope);'),
  guardedCompletionFlow.indexOf('const serializedBody = JSON.stringify(body);'),
  guardedCompletionFlow.indexOf('captureFinalRequest(traceContext'),
  guardedCompletionFlow.indexOf('const reservationId = reserveCost({'),
  guardedCompletionFlow.indexOf('captureRequestDispatched(traceContext);'),
  guardedCompletionFlow.indexOf('nativeFetch(input, nextInit)'),
), 'Guarded dispatch must calculate, authorize, finalize, reserve and trace cost before native transport in that order.');
expect(
  guardedCompletionFlow.includes('maximum: dreamCeiling')
    && guardedCompletionFlow.includes('requestMaximum: requestCeiling')
    && costGuard.includes('Maximum for this Dream, including one possible repair: ${maximumMoney(maximum)}')
    && costGuard.includes('Dream up to ${maximumMoney(maximum)}'),
  'Expensive-Dream confirmation must name and authorize the envelope-enforced maximum.',
);
expect(
  guardedCompletionFlow.includes('${reasoning} reasoning is still selected, and no request was sent.')
    && guardedCompletionFlow.includes("budgetLimited ? 'INSUFFICIENT_PRACTICAL_ENVELOPE' : 'MODEL_GENERATION_ENVELOPE_TOO_SMALL'"),
  'A too-small quality envelope must preserve reasoning and block before dispatch.',
);
expect(
  costGuard.includes('pricing.overrides')
    && costGuard.includes('max_price: maxPrice')
    && costGuard.includes('filterLiveDreamModels(list)'),
  'Spend enforcement must use conservative catalog overrides, cap route prices, and exclude ineligible rows.',
);
expect(
  costGuard.includes("SPEND_LOCK_NAME = 'ai-visualizer-spend-guard-v1'")
    && costGuard.includes('locks.request(SPEND_LOCK_NAME')
    && costGuard.includes('Math.ceil(number * 100 - 1e-10)'),
  'Cross-tab spend must serialize where supported and displayed maxima must round upward.',
);

// Stable evidence-based failure and trace semantics.
expect(
  generationFailure.includes("OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT: 'OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT'")
    && generationFailure.includes('This model ran out of generation room before it finished the visual. Your current Dream is still here.'),
  'Output-budget exhaustion must retain its stable category and consumer-safe copy.',
);
const exhaustedClassification = generationFailure.indexOf('if (httpSuccess && lengthExhausted)');
const emptyClassification = generationFailure.indexOf('if (httpSuccess && contentWasReported');
expect(ordered(exhaustedClassification, emptyClassification) && !/deepseek/i.test(generationFailure), 'Length exhaustion must be classified before generic empty output and without model-specific logic.');
expect(
  generationFailure.includes('choice?.error')
    && generationFailure.includes("['error', 'content_filter'].includes")
    && generationFailure.includes('[408, 504, 524]'),
  'Choice-level provider failures and all known timeout statuses must remain terminal provider categories.',
);
const providerCompletionStart = providerRuntime.indexOf('async function requestOpenRouterCompletion');
const providerCompletionEnd = providerRuntime.indexOf('async function generateOpenRouterVisualizer', providerCompletionStart);
const providerCompletionFlow = providerCompletionStart >= 0 && providerCompletionEnd > providerCompletionStart
  ? providerRuntime.slice(providerCompletionStart, providerCompletionEnd)
  : '';
const completedProviderFailureClassification = providerCompletionFlow.indexOf('const failureCategory = classifyGenerationFailure({');
expect(
  completedProviderFailureClassification >= 0
    && providerCompletionFlow.indexOf('if (failureCategory)', completedProviderFailureClassification) > completedProviderFailureClassification
    && providerCompletionFlow.indexOf('throw error;', completedProviderFailureClassification) > completedProviderFailureClassification,
  'Successful HTTP responses with terminal failure evidence must throw before artifact validation or repair.',
);
expect(
  traceBridge.includes("REQUEST_POLICY_SCHEMA = 'visualizer-request-policy-v1'")
    && traceBridge.includes("if (!record || record.claims.has('request-dispatched')) return false;")
    && traceBridge.includes('schema: REQUEST_POLICY_SCHEMA'),
  'Trace request policy must be versioned, merged and immutable after dispatch.',
);
expect(
  traceBridge.includes('parameters: parametersFromBody(safeBody)')
    && traceBridge.includes('policy: sanitizeTraceValue(detail.policy ?? record.requestPolicy)')
    && traceBridge.includes('serializedBody'),
  'Trace capture must retain the sanitized final request parameters, policy and serialized body.',
);
expect(
  traceBridge.includes('detail.nativeFinishReason')
    && traceBridge.includes('parsedPayload?.choices?.[0]?.native_finish_reason')
    && traceBridge.includes('native_finish_reason: nativeFinishReason'),
  'Trace response evidence must retain the provider-native finish reason in both compatibility fields.',
);

// Bounded local fit evidence and truthful model discovery.
expect(
  modelFitEvidence.includes("MODEL_FIT_EVIDENCE_SCHEMA = 'visualizer-model-fit-v1'")
    && modelFitEvidence.includes("MODEL_FIT_MATRIX_SCHEMA = 'visualizer-model-fit-matrix-v1'")
    && ['UNTESTED', 'TESTED', 'PROVEN', 'KNOWN_INCOMPATIBLE'].every(status => modelFitEvidence.includes(`${status}: '${status}'`)),
  'Model-fit evidence and its four truthful statuses must remain explicitly versioned.',
);
expect(
  [
    'modelId',
    'reasoningChoice',
    'promptProfileId',
    'promptVersion',
    'promptHash',
    'generationEnvelopeMajorVersion',
    'audioApiVersion',
    'reliabilityVersion',
    'runtimeVersion',
  ].every(field => modelFitEvidence.includes(field)),
  'Model-fit configuration identity must retain every compatibility dimension.',
);
expect(
  modelFitEvidence.includes('MAX_MODEL_FIT_CONFIGURATIONS = 96')
    && modelFitEvidence.includes('MAX_RECENT_MODEL_FIT_EVIDENCE = 80')
    && modelFitEvidence.includes('MAX_RECENT_EVIDENCE_PER_CONFIGURATION = 12')
    && modelFitEvidence.includes('MAX_MODEL_FIT_METRIC_SAMPLES = 31')
    && modelFitEvidence.includes('document.configurations = document.configurations.slice(0, this.limits.configurations)'),
  'Persisted model-fit configurations, evidence and metric samples must stay bounded.',
);
expect(
  modelFitEvidence.includes('if (known) return MODEL_FIT_STATUSES.KNOWN_INCOMPATIBLE;')
    && modelFitEvidence.includes('if (ready > 0 || live > 0) return MODEL_FIT_STATUSES.PROVEN;')
    && modelFitEvidence.includes('return attempts > 0 ? MODEL_FIT_STATUSES.TESTED : MODEL_FIT_STATUSES.UNTESTED;'),
  'Model-fit status must derive only from deterministic incompatibility, qualifying proof or actual attempts.',
);
expect(
  modelFitEvidence.includes('MODEL_FIT_RESULT_CATEGORIES.OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT')
    && modelFitEvidence.includes('throw new TypeError(`${code} is observational evidence, not a deterministic incompatibility.`)')
    && modelFitEvidence.includes("KNOWN_INCOMPATIBLE: 'An explicit deterministic incompatibility mark; never inferred from an ordinary failure.'"),
  'Output exhaustion and ordinary failures must remain evidence, never inferred incompatibility.',
);
expect(
  modelFitEvidence.includes('export function sanitizeModelFitMatrixValue')
    && modelFitEvidence.includes('/waveform|spectrum|rawaudio|audiosamples|audioframe|audiodata/')
    && modelFitEvidence.includes('/song|nowplaying|trackname|tracktitle|artistname|albumname/')
    && modelFitEvidence.includes('return deepFreeze(sanitizeModelFitMatrixValue(bundle));'),
  'Model-fit matrix exports must recursively remove secrets, media and song identity before freezing.',
);
expect(
  modelProductCatalog.includes("MODEL_PRODUCT_CATALOG_SCHEMA = 'visualizer-model-product-catalog-v1'")
    && modelProductCatalog.includes('MODEL_PRODUCT_CATALOG = Object.freeze([])')
    && modelProductCatalog.includes('OPERATOR_APPROVED_MODEL_ENTRIES = MODEL_PRODUCT_CATALOG'),
  'The operator-approved product catalog must remain versioned and empty until exact IDs are approved.',
);
expect(
  modelGuide.includes('MODEL_PRODUCT_CATALOG.map(catalogEntryId)')
    && modelGuide.includes('row.status === MODEL_FIT_STATUSES.PROVEN')
    && modelGuide.includes('Nothing is promoted automatically. Experimental models remain available when you choose to explore.'),
  'Recommended models must be grounded in operator catalog entries or successful exact local evidence.',
);
expect(
  modelGuide.includes('let appCatalogReceived = false')
    && modelGuide.includes('appCatalogReceived = true')
    && modelGuide.includes('if (!appCatalogReceived)'),
  'The app-authoritative catalog must not be replaced by a late duplicate discovery response.',
);
const experimentalScoreStart = modelGuide.indexOf('function experimentalScore');
const experimentalScoreEnd = modelGuide.indexOf('function isFastFamily', experimentalScoreStart);
const experimentalScoreFlow = experimentalScoreStart >= 0 && experimentalScoreEnd > experimentalScoreStart
  ? modelGuide.slice(experimentalScoreStart, experimentalScoreEnd)
  : '';
expect(
  experimentalScoreFlow.includes('design * 2 + coding * 5 + intelligence * 1.5')
    && !/reasoning/i.test(experimentalScoreFlow),
  'Experimental discovery scoring must not award a reasoning-capability bonus.',
);
expect(
  modelGuide.includes('let consumerDisclosed = false;')
    && modelGuide.includes('return developerMode || consumerDisclosed;')
    && modelGuide.includes("supplemental.heading.textContent = developerMode ? 'Experimental catalog signals' : 'Experimental starting points';")
    && modelGuide.includes('It is discovery, not verification.'),
  'Normal catalog exploration must be progressively disclosed while developer mode opens truthful experimental signals.',
);
expect(
  app.includes('const evidenceSnapshot = devMode ? modelFitEvidenceStore.snapshot() : null;')
    && app.includes("const modelMeta = [priceLabel(model), devMode ? fitState : ''].filter(Boolean).join(")
    && app.includes('if (devMode) button.dataset.modelFitState = fitState;'),
  'Technical model-fit statuses must stay out of normal model rows and appear only in developer mode.',
);

// Global Favorite transport and post-normalization sensitivity controls.
expect(
  keyboardTransport.includes("KEYBOARD_TRANSPORT_VERSION = 'visualizer-keyboard-transport-v1'")
    && keyboardTransport.includes("ArrowLeft: 'favorite-previous'")
    && keyboardTransport.includes("ArrowRight: 'favorite-next'")
    && keyboardTransport.includes("ArrowUp: 'sensitivity-increase'")
    && keyboardTransport.includes("ArrowDown: 'sensitivity-decrease'"),
  'The four global arrow commands must retain their exact Favorite and sensitivity mapping.',
);
expect(
  keyboardTransport.includes('if (!Array.isArray(favorites) || favorites.length === 0) return null;')
    && keyboardTransport.includes('return direction > 0 ? favorites[0] : favorites[favorites.length - 1];')
    && keyboardTransport.includes('(currentIndex + direction + favorites.length) % favorites.length'),
  'Favorite transport must safely handle zero entries, non-Favorite LIVE art and wraparound.',
);
expect(
  keyboardTransport.includes('event.defaultPrevented')
    && keyboardTransport.includes('event.isComposing')
    && keyboardTransport.includes('event.altKey')
    && keyboardTransport.includes('candidates.some(elementOrAncestorOwnsArrows)')
    && keyboardTransport.includes('documentHasOpenSemanticOwner(documentRef)'),
  'Global arrows must yield to consumed events, modifiers, editors, controls and open overlays.',
);
const favoriteKeyboardStart = app.indexOf('async function openFavoriteFromKeyboard');
const favoriteKeyboardEnd = app.indexOf('async function toggleReadyJobFavorite', favoriteKeyboardStart);
const favoriteKeyboardFlow = favoriteKeyboardStart >= 0 && favoriteKeyboardEnd > favoriteKeyboardStart
  ? app.slice(favoriteKeyboardStart, favoriteKeyboardEnd)
  : '';
expect(
  favoriteKeyboardFlow.includes('if (recovering || reopening || deletingGeneration || promotion) return false;')
    && favoriteKeyboardFlow.includes('groups.favorites')
    && favoriteKeyboardFlow.includes('return openGeneration(target.generation, { close: false, quiet: true });'),
  'Favorite arrows must honor operation guards and route through the safe saved-Dream Open path.',
);
const openGenerationStart = app.indexOf('async function openGeneration');
const openGenerationEnd = app.indexOf('function featuredArtifact', openGenerationStart);
const openGenerationFlow = openGenerationStart >= 0 && openGenerationEnd > openGenerationStart
  ? app.slice(openGenerationStart, openGenerationEnd)
  : '';
expect(
  openGenerationFlow.includes('withCandidateSlot(async () => {')
    && openGenerationFlow.includes('const candidateSandbox = standbySlot.sandbox;')
    && openGenerationFlow.includes('identityToken = stageLiveCandidate(')
    && openGenerationFlow.includes('const watchdog = await promoteCandidate({')
    && openGenerationFlow.includes('commitLiveCandidate(identityToken);'),
  'Favorite and saved-Dream Open must validate in the standby slot and commit LIVE only during promotion.',
);
expect(
  app.includes('openingStatusTimer = setTimeout(() => {')
    && app.includes('revision !== openingStatusRevision || !reopening')
    && app.includes('}, 150);')
    && app.includes('endOpeningStatus(openingRevision);'),
  'Favorite opening feedback must appear only after 150ms and be cancelled on terminal Open paths.',
);

expect(
  audioSensitivity.includes("AUDIO_SENSITIVITY_SCHEMA = 'visualizer-audio-sensitivity-v1'")
    && audioSensitivity.includes('DEFAULT_AUDIO_SENSITIVITY_PERCENT = 100')
    && audioSensitivity.includes('MIN_AUDIO_SENSITIVITY_PERCENT = 50')
    && audioSensitivity.includes('MAX_AUDIO_SENSITIVITY_PERCENT = 200')
    && audioSensitivity.includes('AUDIO_SENSITIVITY_STEP_PERCENT = 10'),
  'Audio sensitivity must remain a versioned 50-200% range in 10% steps with a 100% default.',
);
expect(
  audioSensitivity.includes("AUDIO_SENSITIVITY_STORAGE_KEY = 'ai-visualizer.audio-sensitivity.v1'")
    && audioSensitivity.includes('persisted.schema !== AUDIO_SENSITIVITY_SCHEMA')
    && audioSensitivity.includes('storage.setItem(AUDIO_SENSITIVITY_STORAGE_KEY, JSON.stringify(state))'),
  'Sensitivity persistence must reject stale schemas and save only the versioned controller state.',
);
expect(
  audioSensitivity.includes("INTENSITY_FIELDS = Object.freeze(['volume', 'peak', 'transient', 'beat', 'spectralFlux'])")
    && audioSensitivity.includes("BAND_FIELDS = Object.freeze(['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'treble'])")
    && audioSensitivity.includes('scaleWaveform(value, scale)')
    && audioSensitivity.includes('const transformed = { ...sample };'),
  'Sensitivity must transform all reactive fields with bounded waveform symmetry without mutating engine samples.',
);
expect(
  app.includes('applyAudioSensitivity(audio.sample(timestamp), sensitivityPercent)')
    && !/audio-sensitivity|sensitivityPercent/.test(providerRuntime)
    && !/audio-sensitivity|sensitivityPercent/.test(costGuard),
  'Sensitivity must run after host audio normalization and remain isolated from provider requests and spend policy.',
);
expect(
  index.includes('id="sensitivityInput" type="range" min="50" max="200" step="10" value="100"')
    && app.includes('sensitivityPercent,')
    && app.includes('showSensitivityHud(sensitivityController.increase())')
    && app.includes('showSensitivityHud(sensitivityController.decrease())'),
  'Normal sensitivity controls and developer state exposure must stay wired to the same bounded controller.',
);

// Truthful inference lifecycle remains intact.
expect(index.includes('./dream-status.js') && index.includes('dreamCancelButton'), 'Dream request lifecycle and cancellation UI must remain loaded.');
expect(
  dreamTransport.includes('DREAM_STREAM_IDLE_TIMEOUT_MS = 180000')
    && dreamTransport.includes('DREAM_STREAM_HARD_TIMEOUT_MS = 1800000')
    && dreamTransport.includes('activity(at = clock())'),
  'Generation transport must use a resettable idle deadline and a secondary hard ceiling.',
);
expect(
  providerRuntime.includes('stream: true')
    && openRouterSse.includes("event.data.trim() === '[DONE]'")
    && openRouterSse.includes('onEvent(event) === false')
    && openRouterSse.includes('PROVIDER_GENERATION_ID_MISMATCH')
    && openRouterSse.includes("payload?.error || choice?.error")
    && openRouterSse.includes('usageReceived'),
  'OpenRouter Dream generation must consume SSE through [DONE], final usage, and top-level provider errors.',
);
expect(
  providerRuntime.includes('settleUsageWithoutBlocking')
    && providerRuntime.includes('.then(result =>')
    && costGuard.includes('metadata-generation-id-mismatch')
    && costGuard.includes('metadata-cost-unavailable'),
  'Accounting settlement must not block Ready and metadata must match the generation with a real cost.',
);
expect(dreamStatus.includes('ReadableStream') && dreamStatus.includes('markActivity(transaction'), 'Request lifecycle must reset idle timing on streamed body activity.');
expect(app.includes('activeDreamController') && dreamJob.includes("els.cancel?.addEventListener('click'") && app.includes('activeDreamController?.abort()'), 'Cancellation must continue through artifact checks as well as provider inference.');

// Generic, medium-agnostic reliability harness.
expect(index.includes('./reliability.css') && app.includes("from './reliability.js'"), 'Dream reliability harness assets must be loaded.');
expect(sandbox.includes("BRIDGE_INIT_CHANNEL = 'visualizer-private-bridge-v1'") && sandbox.includes('new MessageChannel()') && sandbox.includes('this.bridgePort'), 'Sandbox communication must use a closure-private MessageChannel.');
expect(sandbox.includes('new DOMParser()') && sandbox.includes('document.head.prepend(meta, baseStyle, bridge)'), 'CSP and the trusted bridge must be inserted into the structural document head.');
expect(sandbox.includes("replaceFunction(console, 'error'") && sandbox.includes('CONSOLE_ERROR'), 'Sandbox must capture generated console errors.');
expect(sandbox.includes("'compileShader'") && sandbox.includes('SHADER_COMPILE_FAILED'), 'Sandbox must capture WebGL shader compiler failures.');
expect(sandbox.includes("'linkProgram'") && sandbox.includes('PROGRAM_LINK_FAILED'), 'Sandbox must capture WebGL linker failures.');
expect(sandbox.includes('webglcontextlost') && sandbox.includes('WEBGL_CONTEXT_LOST'), 'Sandbox must capture WebGL context loss.');
expect(sandbox.includes("'webgpu'") && sandbox.includes('GPUCanvasContext') && sandbox.includes('GPUQueue'), 'Sandbox must preserve and observe WebGPU when available.');
expect(sandbox.includes('sampleCanvas') && sandbox.includes('inspectDom') && sandbox.includes('visibleProof'), 'Proof-of-life must support canvas plus DOM/SVG/CSS output.');
expect(sandbox.includes('collectDomElements') && sandbox.includes('document.documentElement') && sandbox.includes('document.body'), 'CSS-only art on html/body and shadow-root descendants must be observable.');
expect(sandbox.includes("['::before', '::after']") && sandbox.includes('inspectPseudo'), 'CSS pseudo-element art must remain observable.');
expect(sandbox.includes('dataset.visualizerHostStyle') && sandbox.includes('background:transparent'), 'The host fallback background must not masquerade as generated artwork.');
expect(sandbox.includes('dynamicRootSurface') && sandbox.includes('rootSurfaceEverChanged'), 'VIZ-driven flat root-surface art must be accepted only after observable activity.');
expect(sandbox.includes("dominantCanvas.coverage >= 0.45") || sandbox.includes("dominantCanvas && dominantCanvas.coverage >= 0.45"), 'A tiny HUD must not hide failure of a dominant canvas.');
expect(sandbox.includes("state.mode = 'passive'") && sandbox.includes('intensiveRestores'), 'High-frequency instrumentation must be removed after the rollback window.');
expect(reliability.includes('createSyntheticFrame') && reliability.includes('after-synthetic-music'), 'Every candidate must receive deterministic synthetic music during preflight.');
expect(reliability.includes('actual-viewport-canary'), 'Candidate must be tested at the real viewport before promotion.');
expect(reliability.includes('VIZ_NOT_CONSUMED') && reliability.includes('NO_VISIBLE_OUTPUT'), 'Harness must separately prove VIZ consumption and visible output.');
expect(reliability.includes('NO_OBVIOUS_STIMULUS_DELTA') && reliability.includes('diagnostic only; subtle interpretations are allowed'), 'Subtle visual response must remain a warning rather than an aesthetic rejection.');
expect(reliability.includes('HEAVY_RENDERER') && !reliability.includes("failure: makeFailure(FAILURE_CODES.PERFORMANCE_COLLAPSE"), 'Heavy but functioning art must be observed, not automatically censored.');
expect(app.includes("setPresentation('promoting')") && app.includes("setPresentation('retiring')") && app.includes('swapSlots()'), 'Promotion must be atomic across two live iframe slots.');
expect(app.includes('promotion:rolled-back') && app.includes('harness.watchdog') && app.includes('activeSlot.sandbox.setPresentation'), 'Post-launch rollback must be explicit and diagnostic.');
expect(app.includes('for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1)'), 'A Dream must permit at most one same-model repair.');
expect(app.includes('if (attemptNumber === 2 || diagnostic.repairUsed)'), 'A second repair must be impossible.');
expect(app.includes('audioAnalysisGate = createCadenceGate(60)'), 'Host audio analysis must retain an independent 60 Hz target.');
expect(
  app.includes('heartbeat: activeSlot.sandbox.heartbeatSnapshot()')
    && app.includes('confirmActiveRuntimeLiveness')
    && app.includes('activeStallConfirmationDecision')
    && app.includes('recheckAt: performance.now() + 30000')
    && reliability.includes('confirmSandboxLiveness')
    && reliability.includes("this.stage('runtime-stall-confirmed'")
    && reliability.includes("'heartbeat-recovered' : 'transient-stall-recovered'"),
  'Long-lived visualizers must confirm inferred heartbeat stalls while retaining deterministic automatic recovery.',
);
expect(
  runtimeVersion.includes("VISUALIZER_RUNTIME_VERSION = 'visualizer-runtime-v3'")
    && reliability.includes("RELIABILITY_SCHEMA = 'dream-reliability-v3'")
    && costGuard.includes("from './runtime-version.js'")
    && modelGuide.includes("from './runtime-version.js'"),
  'Runtime and reliability v3 must isolate materially changed model-fit evidence through one shared runtime identity.',
);
expect(
  sandbox.includes("post('frame-delivered'")
    && sandbox.includes('coalescedFrames')
    && sandbox.includes('pendingFrames: delivery?.pending ? 1 : 0')
    && sandbox.includes('latestFrame:')
    && sandbox.includes('waitForFrameDelivery')
    && sandbox.includes("message.type === 'host-frame-stats'")
    && reliability.includes('sandbox.renderQuality?.maxFps')
    && reliability.includes("name: 'viewport-stimulation'"),
  'Real-time VIZ delivery must keep newest-frame work bounded and qualification must honor render-quality cadence.',
);
expect(
  sandbox.includes('data-visualizer-host-viewport-canvas')
    && sandbox.includes('computedStyleMap')
    && sandbox.includes("canvas.removeAttribute('data-visualizer-host-viewport-canvas')")
    && sandbox.includes("style.position !== 'fixed'")
    && fixedInsetCanvasFixture.includes('#scene { position: fixed; inset: 0; display: block; }'),
  'Only verified fixed/all-edge auto-sized canvases may receive host viewport geometry stabilization.',
);
expect(
  app.includes('dreamJobOwnsReliabilityStage')
    && app.includes('jobOwner: reliabilityOwner')
    && app.includes('configurationEvidence.get(configuration ? modelFitConfigurationKey(configuration)')
    && app.includes('reliabilityVersion: RELIABILITY_SCHEMA')
    && modelSearch.includes('normalizeModelSearch')
    && app.includes('modelSearchMatches(model, query)')
    && modelGuide.includes('modelSearchMatches(candidate, query'),
  'Reliability stages must be job/trace-owned and both model-picker paths must share normalized search.',
);

// Product Shell/Core UX v1: trusted pause, background jobs, explicit Open and fast switching.
expect(index.includes('id="playbackButton"') && index.includes('aria-pressed="false"') && index.includes('id="pauseOverlay"'), 'Normal product chrome must expose an accessible visual Play/Pause control.');
expect(playbackState.includes("PLAYBACK_STATE_SCHEMA = 'visualizer-playback-v1'") && playbackState.includes('music source still controlled externally'), 'Playback state must preserve the external-music control boundary.');
expect(!/music (?:is |was )?paused/i.test(playbackState), 'Product pause copy must never claim externally captured music was paused.');
expect(sandbox.includes("type: next ? 'host-pause' : 'host-resume'") && sandbox.includes('pauseGeneratedPlayback') && sandbox.includes('resumeGeneratedPlayback'), 'Trusted sandbox pause/resume protocol is missing.');
expect(sandbox.includes('pendingAnimationFrames') && sandbox.includes('hostPausedAnimations') && sandbox.includes('totalPausedMs'), 'Trusted pause must queue RAF, preserve virtual time and track only host-paused animations.');
expect(sandbox.includes("Element.prototype, 'animate'") && sandbox.includes("['play', 'reverse']"), 'Web Animations created or replayed during pause must remain host-paused.');
expect(!/intensiveRestores\.push\([\s\S]{0,180}requestAnimationFrame/.test(sandbox), 'Persistent pause scheduling must not be removed with intensive reliability instrumentation.');
expect(/function hostLoop\(timestamp\)[\s\S]{0,240}if \(visualPaused\) return;[\s\S]{0,700}sendFrame/.test(app), 'Active host VIZ frame delivery must stop before sampling or sending while paused.');
expect(app.includes('visualPaused || recovering') && sandbox.includes('paused: state.paused'), 'Heartbeat recovery and diagnostics must understand explicit pause.');

expect(dreamJob.includes("DREAM_JOB_SCHEMA = 'visualizer-dream-job-v1'") && dreamJob.includes("READY: 'ready'") && dreamJob.includes("OPENING: 'opening'"), 'Background Dream job needs explicit ready-before-opening state.');
expect(index.includes('id="dreamJobPill"') && index.includes('id="dreamJobCollapse"') && index.includes('id="dreamJobOpen"'), 'Background job pill, collapse and explicit Open actions must remain in normal UI.');
expect(app.includes("healthStatus: 'ready'") && app.includes("openStatus: 'ready-to-open'") && app.includes("openStatus: 'verified-live'"), 'Persisted artifacts must distinguish ready-to-open from verified-live.');
const dreamStart = app.indexOf('async function dream()');
const openStart = app.indexOf('async function openGeneration');
const dreamFlow = app.slice(dreamStart, openStart);
expect(dreamStart >= 0 && openStart > dreamStart && !dreamFlow.includes('stageLiveCandidate(') && !dreamFlow.includes('promoteCandidate({'), 'Successful background generation must not stage identity or auto-promote LIVE.');
expect(dreamFlow.indexOf('await store.put(generation)') < dreamFlow.indexOf('DREAM_JOB_PHASES.READY'), 'Ready UI must be published only after durable local artifact persistence.');
expect(ordered(
  dreamFlow.indexOf('result = await generateVisualizer({'),
  dreamFlow.indexOf('throw error;', dreamFlow.indexOf('result = await generateVisualizer({')),
  dreamFlow.indexOf('for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1)'),
), 'Provider-terminal failures must leave the Dream before the artifact-only repair loop.');
const openFlow = app.slice(openStart, app.indexOf('async function renderLibrary'));
expect(openFlow.includes('stageLiveCandidate(') && openFlow.includes('promoteCandidate({') && openFlow.includes("DREAM_JOB_PHASES.OPENING"), 'Explicit user Open must own staging, watchdog promotion and opening state.');
expect(providerRuntime.includes('promptProfile') && providerRuntime.includes('buildGenerationMessages(promptProfile)') && providerRuntime.includes('buildRepairMessages(String(raw || \'\').slice(0, 180000), problem, promptProfile)'), 'Background jobs must snapshot and reuse the exact prompt profile for generation and repair.');
expect(app.includes('for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1)') && !app.includes('attemptNumber <= 3'), 'Background job may make at most one same-model repair.');

expect(index.includes('id="dreamSwitcherPanel"') && index.includes('id="switcherButton"') && index.includes('Full Library'), 'Fast Dream switcher must be first-class while the full Library stays secondary.');
expect(dreamSwitcher.includes('featured:') && dreamSwitcher.includes('favorites:') && dreamSwitcher.includes('recent:'), 'Switcher must expose Featured, Favorites and Recent selectors.');
expect(dreamSwitcher.includes('RECENT_DREAM_LIMIT = 8') && dreamSwitcher.includes('b.createdAt - a.createdAt'), 'Recent must remain bounded and deterministic newest-first.');
expect(app.includes('withCandidateSlot') && app.includes('candidateSessionId') && reliability.includes('async reopen('), 'Stored Dream switching must keep a serialized sandbox lease and lighter safe-reopen path.');
expect((app.match(/withCandidateSlot\(/g) || []).length >= 5, 'Every candidate-slot user, including developer retests, must serialize access.');
expect(index.includes('sandbox="allow-scripts"') && !dreamSwitcher.includes('innerHTML'), 'Switcher must never execute stored HTML in the trusted parent.');

expect(featuredManifest.includes("id: 'calibration-bloom'") && featuredManifest.includes("kind: 'host-created'") && featuredManifest.includes('generatedByModel: false'), 'Featured manifest must truthfully identify Calibration Bloom as host-created.');
expect(!featuredManifest.includes('tests/fixtures') && !featuredManifest.includes('aetheria'), 'Regression fixtures must never enter the Featured manifest.');
expect(featuredHtml.includes('<canvas') && featuredHtml.includes('VIZ.frame') && !/https?:\/\//.test(featuredHtml), 'Featured startup art must be self-contained, audio-reactive HTML without external assets.');
expect(featuredDreams.includes('validateFeaturedEntry') && featuredDreams.includes('contentDigest') && featuredDreams.includes("curationStatus !== 'operator-approved'"), 'Featured loading must enforce digest, reliability and operator approval provenance.');
expect(featuredDreams.includes('pending-operator-review') && featuredDreams.includes('operatorApprovalRecord: null'), 'Featured export must remain pending operator review rather than fabricate approval.');

expect(index.includes('id="promptLabButton"') && index.includes('id="audioButton"') && index.includes('id="fullscreenButton"'), 'Primary product dock must retain Prompt, audio source and fullscreen.');
expect(!/<div class="top-actions">[\s\S]{0,400}id="spendButton"/.test(index), 'Spend details must not remain primary top chrome.');
expect(index.includes('class="model-spend-link"') && index.includes('id="spendButton"'), 'Spend protection must remain active and discoverable through progressive disclosure.');
expect(productShellCss.includes('grid-template-areas:') && productShellCss.includes('max-width: 820px') && productShellBrowser.includes('mobileOverlayGap') && productShellBrowser.includes('desktopOverlayGap'), 'Product shell must provide a compact mobile/tablet dock with browser-verified non-overlapping overlays.');
expect(app.includes('if (!store.persistent)') && productShellBrowser.includes('unavailable durable storage blocks paid generation'), 'Paid generation must not promise reload persistence when IndexedDB is unavailable.');

// Local flight recorder and hidden developer backdoor.
expect(storage.includes("DIAGNOSTIC_STORE = 'diagnostics'") && storage.includes('DB_VERSION = 2'), 'Diagnostics need their own durable IndexedDB store.');
expect(storage.includes('MAX_DIAGNOSTICS = 60'), 'Diagnostics store must remain bounded.');
expect(diagnostics.includes("DIAGNOSTIC_SCHEMA = 'dream-diagnostic-v1'"), 'Diagnostic schema must be versioned.');
expect(diagnostics.includes('sanitizeTraceValue') && dreamTrace.includes('authorization') && dreamTrace.includes('waveform') && dreamTrace.includes('spectrum'), 'Diagnostic export must redact credentials and audio arrays defensively.');
expect(app.includes("params.get('dev') === '1'") && app.includes("event.key.toLowerCase() === 'd'"), 'Developer mode must be available through ?dev=1 and Ctrl+Shift+D.');
expect(app.includes("Object.defineProperty(window, 'VIZ_DEV'") && index.includes('Dream diagnostics.'), 'VIZ_DEV API and diagnostic drawer must be available without public UI clutter.');
expect(app.includes('copyCurrentHtml') && app.includes('retestCurrentVisualizer') && app.includes('exportAll'), 'Dev mode must support HTML copy, deterministic retest and JSON export.');
expect(app.includes('frameDelivery: activeSlot.sandbox.frameDeliverySnapshot()'), 'Runtime debug state must expose the active sandbox frame-delivery authority.');
expect(!app.includes('waveform: sample.waveform') || dreamTrace.includes("REDACTED = '[redacted]'"), 'Diagnostic export must never preserve captured waveform/spectrum values.');

// Dream Transparency v1: independent identity, exact request boundary and inert local traces.
expect(index.includes('id="liveIdentityName"') && index.includes('id="nextModelLabel">NEXT<'), 'Normal UI must expose separate LIVE and NEXT identities.');
expect(liveIdentity.includes('Calibration Bloom') && liveIdentity.includes('Choose a model'), 'Identity state must begin with truthful built-in LIVE and empty NEXT values.');
expect(liveIdentity.includes('stage') && liveIdentity.includes('commit') && liveIdentity.includes('candidate'), 'LIVE promotion must be an explicit staged identity transition.');
expect(!/function updateAudioState[\s\S]{0,500}liveIdentityName/.test(app), 'Audio state must never write the persistent LIVE identity.');
expect(app.includes('deletingGeneration') && app.includes('before deleting a saved visualizer'), 'Library deletion must not overlap candidate generation or promotion.');
expect(app.includes('fallbackGeneration?.id === generation.id'), 'Deleting a rollback target must prevent the deleted Dream from being resurrected.');
expect(dreamTrace.includes("DREAM_TRACE_SCHEMA = 'dream-trace-v1'") || dreamTrace.includes('DREAM_TRACE_SCHEMA = "dream-trace-v1"'), 'Dream trace schema must be explicitly versioned.');
expect(dreamTrace.includes('Not captured by this app version.'), 'Legacy missing request data must be labeled without reconstruction.');
expect(dreamTrace.includes('Reasoning not exposed by provider.') && dreamTrace.includes('Reasoning text not exposed by provider.'), 'Reasoning absence and token-only accounting must be distinguished truthfully.');
expect(dreamTrace.includes('reasoning_details') && dreamTrace.includes('reasoning_tokens'), 'Provider-exposed reasoning fields and reasoning accounting must be preserved separately.');
expect(dreamTrace.includes('rawBody') && dreamTrace.includes('rawOutput') && dreamTrace.includes('extractedHtml'), 'Raw provider body, model output and extracted HTML must remain distinct.');
expect(dreamTrace.includes('recordDreamTraceRollback') && dreamTrace.includes('runtime:rolled-back'), 'Late runtime rollback must remain durable trace aftercare.');
expect(traceBridge.includes('Symbol') && traceBridge.includes('Map') && traceBridge.includes('correlation'), 'Provider attempts need per-request correlation rather than a global latest request.');
expect(traceBridge.includes('stripTraceContext') && traceBridge.includes('authorization'), 'Trace metadata must be removed before native fetch and authorization values sanitized.');
const finalMaxTokenMutation = guardedCompletionFlow.indexOf('body[maxTokenParameter] = envelope.finalMaxTokens;');
const finalUsageMutation = guardedCompletionFlow.indexOf('body.usage =');
const finalPriceMutation = guardedCompletionFlow.indexOf('enforceProviderPriceCeiling(body, envelope);');
const finalRequestSerialization = guardedCompletionFlow.indexOf('const serializedBody = JSON.stringify(body);');
const finalRequestCapture = guardedCompletionFlow.indexOf('captureFinalRequest(traceContext');
expect(ordered(finalMaxTokenMutation, finalUsageMutation, finalPriceMutation, finalRequestSerialization, finalRequestCapture), 'Final request capture must follow envelope max, usage-accounting, route-price and serialization mutations.');
expect(
  providerRuntime.includes('consumeOpenRouterChatStream(response')
    && openRouterSse.includes('rawBodyText')
    && openRouterSse.includes('streamAggregate')
    && !guardedCompletionFlow.includes('response.clone()'),
  'Provider runtime must use one SSE reader while keeping exact transcript and normalized aggregate distinct.',
);
expect(
  dreamTransport.includes("DREAM_IDLE_TIMEOUT")
    && dreamTransport.includes("DREAM_HARD_TIMEOUT")
    && app.includes("['DREAM_TIMEOUT', 'DREAM_IDLE_TIMEOUT', 'DREAM_HARD_TIMEOUT']"),
  'Idle and hard timeout evidence must not be mislabeled as user cancellation.',
);
expect(
  !index.includes('uiRevealSurface')
    && sandbox.includes('event.isTrusted')
    && sandbox.includes("post('user-activity'")
    && app.includes("showUi('iframe-pointer', mode)")
    && immersiveUi.includes('visualizer-immersive-ui-v1'),
  'Immersive wake must preserve the first iframe gesture and accept only trusted bridged activity.',
);
expect(
  sandbox.includes('initialPaused')
    && sandbox.includes('this.desiredPaused')
    && sandbox.includes("type: this.desiredPaused ? 'host-pause' : 'host-resume'"),
  'Pause intent must survive iframe loading and be replayed when the private bridge connects.',
);
expect(
  renderQuality.includes("full: Object.freeze({ mode: 'full', label: 'Full', maxFps: 60, maxDpr: 2 })")
    && renderQuality.includes("balanced: Object.freeze({ mode: 'balanced', label: 'Balanced', maxFps: 45, maxDpr: 1.5 })")
    && renderQuality.includes("saver: Object.freeze({ mode: 'saver', label: 'Saver', maxFps: 30, maxDpr: 1 })")
    && sandbox.includes("message.type === 'host-render-quality'")
    && app.includes('audioAnalysisGate')
    && app.includes('vizDeliveryGate'),
  'Render quality must cap effective DPR, generated RAF, and VIZ delivery without changing audio analysis cadence.',
);
expect(
  renderQuality.includes('Math.floor(Math.max(0, now - nextDueAt) / interval)')
    && sandbox.includes('Math.floor(Math.max(0, timestamp - nextGeneratedFrameAt) / interval)')
    && app.includes('wakeLockRevision')
    && app.includes('event.isTrusted'),
  'Long suspension recovery, wake-lock ownership, and host activity trust must remain bounded.',
);
expect(!traceViewer.includes('.innerHTML') && !traceViewer.includes('srcdoc') && traceViewer.includes('.textContent'), 'Trace viewer must render provider output and HTML as inert text only.');
expect(index.includes('id="traceViewer"') && index.includes('id="transparencySelfTest"'), 'Developer mode must include the hidden Trace viewer and no-cost fixture action.');
expect(app.includes('runTransparencySelfTest') && app.includes('latestTrace') && app.includes('identity()'), 'VIZ_DEV must expose identity, traces and the no-cost transparency self-test.');
expect(development.includes('npm.cmd run dev') && development.includes('LIVE') && development.includes('NEXT') && development.includes('runTransparencySelfTest'), 'VS Code development guide must document setup and Dream Transparency operation.');
expect(workflow.includes('node --test --test-concurrency=1 tests/dream-transparency.contract.mjs'), 'CI must execute the pure Dream Transparency contract.');
expect(workflow.includes('node --test --test-concurrency=1 tests/product-shell.contract.mjs'), 'CI must execute the pure Product Shell contract.');
for (const contractPath of [
  'tests/reasoning-settings.contract.mjs',
  'tests/generation-envelope.contract.mjs',
  'tests/provider-quality.contract.mjs',
  'tests/model-fit-evidence.contract.mjs',
  'tests/keyboard-transport.contract.mjs',
  'tests/audio-sensitivity.contract.mjs',
  'tests/streaming-transport.contract.mjs',
  'tests/render-quality.contract.mjs',
  'tests/immersive-ui.contract.mjs',
]) {
  expect(workflow.includes(`node --test --test-concurrency=1 ${contractPath}`), `CI must explicitly execute ${contractPath}.`);
}
expect(transparencyContract.includes('DREAM_TRACE_SCHEMA') && transparencyBrowser.includes('runTransparencySelfTest'), 'Deterministic trace contract and real-host browser coverage must remain present.');
expect(productShellContract.includes('ready is distinct from opening and LIVE') && productShellBrowser.includes('slow background job collapses'), 'Product Shell needs deterministic state contracts and real-host browser coverage.');

expect(
  reasoningSettingsContract.includes('Default is native omission, never an implicit Low or High')
    && reasoningSettingsContract.includes('options use only metadata values and preserve provider order')
    && reasoningSettingsContract.includes('mandatory reasoning filters None'),
  'Reasoning contract must cover native omission, exact metadata order and mandatory-None filtering.',
);
expect(
  generationEnvelopeContract.includes('no universal ceiling; an affordable cheap model receives more than 14k')
    && generationEnvelopeContract.includes('exact DeepSeek HTTP-200 empty length fixture is output-budget exhaustion')
    && generationEnvelopeContract.includes('specific evidence must not collapse categories'),
  'Generation-envelope contract must cover unbounded quality, the exact DeepSeek fixture and distinct failures.',
);
expect(
  providerQualityContract.includes('Default omits reasoning while explicit effort uses the exact enforceable OpenRouter shape')
    && providerQualityContract.includes('final trace captures policy, exact post-envelope body, sanitization, and native finish reason')
    && providerQualityContract.includes('finalRequestCostCeiling'),
  'Provider-quality contract must cover reasoning shape and final request/cost/finish trace evidence.',
);
expect(
  modelFitEvidenceContract.includes('output-budget exhaustion is TESTED and never inferred incompatible')
    && modelFitEvidenceContract.includes('global, per-configuration, metric, and configuration evidence remain bounded')
    && modelFitEvidenceContract.includes('recursively remove secrets and media'),
  'Model-fit contract must cover truthful status, all bounds and recursive export sanitization.',
);
expect(
  keyboardTransportContract.includes('Left selects the previous Favorite')
    && keyboardTransportContract.includes('zero Favorites is safe')
    && keyboardTransportContract.includes('dialog, drawer, and open popover state prevent global shortcuts'),
  'Keyboard contract must cover Favorite direction, empty safety and global shortcut guards.',
);
expect(
  audioSensitivityContract.includes('post-engine transform scales and clamps all reactive fields')
    && audioSensitivityContract.includes('injected local storage persists a versioned value')
    && audioSensitivityContract.includes('non-reactive audio truth is unchanged'),
  'Audio-sensitivity contract must cover post-engine scaling, persistence and unchanged non-reactive truth.',
);

// Real regression corpus and browser verification.
expect(aetheriaFixture.includes('AETHERIA :: Resonant Topology') && aetheriaFixture.includes('gl.compileShader'), 'Real Gemini blank-screen output must remain a regression fixture.');
expect(workflow.includes('@playwright/test') && workflow.includes('playwright install --with-deps chromium') && workflow.includes('playwright test --config=playwright.config.mjs'), 'CI must execute the browser reliability corpus in Chromium.');
const browserTests = await read('tests/visualizer-reliability.spec.mjs');
expect(browserTests.includes('hostile head comments') && browserTests.includes('cannot forge bridge resume'), 'Browser coverage must protect CSP placement and private bridge authority.');
expect(browserTests.includes('valid-black-webgl'), 'CI must protect intentionally black but functioning artwork.');
expect(browserTests.includes('webgl-dom-fallback'), 'CI must protect resilient DOM fallbacks when an advanced renderer fails.');
expect(browserTests.includes('valid-css-only'), 'CI must protect CSS-only root-surface visualizers.');
expect(browserTests.includes('trusted pause suspends generated RAF') && browserTests.includes('Calibration Bloom Featured art'), 'Browser corpus must protect trusted pause and shipped Featured art.');
expect(
  playwrightConfig.includes("testMatch: ['**/*.spec.mjs']")
    && !/testIgnore:[^\n]*quality-first-controls/.test(playwrightConfig)
    && qualityFirstBrowser.includes("test('exact reasoning metadata snapshots High into one quality-first request'")
    && qualityFirstBrowser.includes("test('390x844 exposes consumer controls without overflow or developer evidence leakage'"),
  'Playwright must auto-discover the quality-first browser contract, including mobile disclosure coverage.',
);
expect(
  qualityFirstBrowser.includes('completionRequests).toBe(1)')
    && qualityFirstBrowser.includes('trace.repairUsed).toBe(false)')
    && qualityFirstBrowser.includes("failureCode).toBe('OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT')")
    && /Opening \u00b7 Favorite First/.test(qualityFirstBrowser)
    && /Sensitivity \u00b7 110%/.test(qualityFirstBrowser),
  'Browser coverage must protect no-retry exhaustion, Favorite standby feedback and sensitivity transport.',
);
expect(
  streamingTransportContract.includes('a complete-looking partial artifact stays private until [DONE]')
    && streamingTransportContract.includes('stream activity repeatedly extends idle time beyond the former absolute boundary')
    && streamingTransportContract.includes('HTTP-200 provider-declared timeouts retain a distinct stream outcome')
    && streamingImmersiveQualityBrowser.includes('mid-stream provider error keeps partial HTML diagnostic-only'),
  'Streaming contracts must cover private assembly, active-stream survival, and explicit provider errors.',
);
expect(
  renderQualityContract.includes('render quality persists locally')
    && renderQualityContract.includes('cadence gates bound Full, Balanced, and Saver')
    && immersiveUiContract.includes('continuous activity invalidates stale timers')
    && immersiveUiContract.includes('pointer-created focus'),
  'Playback contracts must cover quality persistence/cadence and immersive activity/focus behavior.',
);
expect(
  streamingImmersiveQualityBrowser.includes('stream stays private until DONE')
    && streamingImmersiveQualityBrowser.includes('mid-stream provider error keeps partial HTML diagnostic-only')
    && streamingImmersiveQualityBrowser.includes('active job chrome hides')
    && streamingImmersiveQualityBrowser.includes('quality persists and changes DPR plus generated cadence')
    && streamingImmersiveQualityBrowser.includes('390x844 keeps Visual Performance controls usable')
    && streamingImmersiveQualityBrowser.includes('768px compact dock keeps the fullscreen target fully visible')
    && streamingImmersiveQualityBrowser.includes('late fullscreen wake-lock grant is released')
    && streamingImmersiveQualityBrowser.includes('cancel during fresh catalog verification'),
  'Playwright must cover streamed promotion safety, immersive wake, quality switching, and the mobile disclosure layout.',
);
expect(
  dogfoodRuntimeContract.includes('reliability stage ownership requires the active executing job and exact trace')
    && dogfoodRuntimeContract.includes('model search ignores human punctuation and spacing')
    && dogfoodRuntimeContract.includes('permanent heartbeat and probe stall')
    && browserTests.includes('fixed inset auto canvas keeps CSS geometry')
    && browserTests.includes('fatal runtime event still fails before heartbeat confirmation grace')
    && productShellBrowser.includes("toHaveText('Model working')")
    && qualityFirstBrowser.includes('model search matches human punctuation and spacing'),
  'Dogfood hardening must retain deterministic contracts and browser regressions for all four observed issues.',
);

if (failures.length) {
  console.error(`Visualizer reliability contract: FAIL (${failures.length} of ${assertionCount} assertions failed)\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`Visualizer reliability contract: PASS (${assertionCount} assertions)`);
