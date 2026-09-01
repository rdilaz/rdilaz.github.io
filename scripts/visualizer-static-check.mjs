import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

const [
  index,
  app,
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
  workflow,
  deploy,
  aetheriaFixture,
] = await Promise.all([
  read('public/visualizer/index.html'),
  read('public/visualizer/app.js'),
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
  read('.github/workflows/visualizer-check.yml'),
  read('.github/workflows/deploy.yml'),
  read('tests/fixtures/aetheria-gemini-3.7-flash.html'),
]);

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

// Sandbox, audio, prompt and credential invariants.
expect(/sandbox="allow-scripts"/.test(index), 'Generated visualizer iframes must allow scripts inside a sandbox.');
expect(!/sandbox="[^"]*allow-same-origin/.test(index), 'Generated visualizer sandbox must never use allow-same-origin.');
expect(audio.includes('getDisplayMedia'), 'Audio engine must use display/system audio capture.');
expect(!audio.includes('getUserMedia('), 'Microphone capture is forbidden.');
expect(audio.includes("audioSelection:'preferred'"), 'Chromium capture must prefer audio-bearing sources.');
expect(audio.includes('smoothingTimeConstant=.08'), 'Fast analyser smoothing must stay low-latency.');
expect(prompt.includes('visualizer-prompt-v1') && prompt.includes('There are no aesthetic requirements.'), 'Canonical prompt must remain versioned and aesthetically unconstrained.');
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
expect(costGuard.includes('body.max_tokens = allowedMax') && costGuard.includes('include: true'), 'Spend guard must constrain output and request exact usage accounting.');
expect(index.includes('Four easy choices.') && modelGuide.includes("label:'Fast + great'"), 'Simple guided model selection must remain available.');
expect(modelGuide.includes("MODEL_ENDPOINT='https://openrouter.ai/api/v1/models'"), 'Model guide must use the live OpenRouter catalog.');

// Truthful inference lifecycle remains intact.
expect(index.includes('./dream-status.js') && index.includes('dreamCancelButton'), 'Dream request lifecycle and cancellation UI must remain loaded.');
expect(dreamStatus.includes('DREAM_TIMEOUT_MS = 360000'), 'Slow model requests must retain the six-minute inference timeout.');
expect(dreamStatus.includes('full response body received'), 'Request lifecycle must distinguish response start from complete response body.');
expect(app.includes('activeDreamController') && app.includes("dreamCancelButton?.addEventListener"), 'Cancellation must continue through artifact checks as well as provider inference.');

// Generic, medium-agnostic reliability harness.
expect(index.includes('./reliability.css') && app.includes("from './reliability.js'"), 'Dream reliability harness assets must be loaded.');
expect(sandbox.includes("SANDBOX_CHANNEL = 'visualizer-sandbox-v2'"), 'Instrumented sandbox protocol version is missing.');
expect(sandbox.includes("replaceFunction(console, 'error'") && sandbox.includes('CONSOLE_ERROR'), 'Sandbox must capture generated console errors.');
expect(sandbox.includes("'compileShader'") && sandbox.includes('SHADER_COMPILE_FAILED'), 'Sandbox must capture WebGL shader compiler failures.');
expect(sandbox.includes("'linkProgram'") && sandbox.includes('PROGRAM_LINK_FAILED'), 'Sandbox must capture WebGL linker failures.');
expect(sandbox.includes('webglcontextlost') && sandbox.includes('WEBGL_CONTEXT_LOST'), 'Sandbox must capture WebGL context loss.');
expect(sandbox.includes("'webgpu'") && sandbox.includes('GPUCanvasContext') && sandbox.includes('GPUQueue'), 'Sandbox must preserve and observe WebGPU when available.');
expect(sandbox.includes('sampleCanvas') && sandbox.includes('inspectDom') && sandbox.includes('visibleProof'), 'Proof-of-life must support canvas plus DOM/SVG/CSS output.');
expect(sandbox.includes("dominantCanvas.coverage >= 0.45") || sandbox.includes("dominantCanvas && dominantCanvas.coverage >= 0.45"), 'A tiny HUD must not hide failure of a dominant canvas.');
expect(sandbox.includes("state.mode = 'passive'") && sandbox.includes('intensiveRestores'), 'High-frequency instrumentation must be removed after the rollback window.');
expect(reliability.includes('createSyntheticFrame') && reliability.includes('after-synthetic-music'), 'Every candidate must receive deterministic synthetic music during preflight.');
expect(reliability.includes('actual-viewport-canary'), 'Candidate must be tested at the real viewport before promotion.');
expect(reliability.includes('VIZ_NOT_CONSUMED') && reliability.includes('NO_VISIBLE_OUTPUT'), 'Harness must separately prove VIZ consumption and visible output.');
expect(reliability.includes('NO_OBVIOUS_STIMULUS_DELTA') && reliability.includes('diagnostic only; subtle interpretations are allowed'), 'Subtle visual response must remain a warning rather than an aesthetic rejection.');
expect(reliability.includes('HEAVY_RENDERER') && !reliability.includes("failure: makeFailure(FAILURE_CODES.PERFORMANCE_COLLAPSE"), 'Heavy but functioning art must be observed, not automatically censored.');
expect(app.includes("setPresentation('promoting')") && app.includes("setPresentation('retiring')") && app.includes('swapSlots()'), 'Promotion must be atomic across two live iframe slots.');
expect(app.includes('rollback armed') && app.includes('promotion:rolled-back'), 'Post-launch rollback must be explicit and diagnostic.');
expect(app.includes('for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1)'), 'A Dream must permit at most one same-model repair.');
expect(app.includes('if (attemptNumber === 2 || diagnostic.repairUsed)'), 'A second repair must be impossible.');
expect(app.includes('1000 / 60'), 'Host audio frames must run at a 60 Hz target instead of the old 30 Hz gate.');
expect(app.includes('heartbeatAgeMs() > 8000') && app.includes('recoverFromRuntimeFailure'), 'Long-lived visualizers must retain heartbeat-based automatic recovery.');

// Local flight recorder and hidden developer backdoor.
expect(storage.includes("DIAGNOSTIC_STORE = 'diagnostics'") && storage.includes('DB_VERSION = 2'), 'Diagnostics need their own durable IndexedDB store.');
expect(storage.includes('MAX_DIAGNOSTICS = 60'), 'Diagnostics store must remain bounded.');
expect(diagnostics.includes("DIAGNOSTIC_SCHEMA = 'dream-diagnostic-v1'"), 'Diagnostic schema must be versioned.');
expect(diagnostics.includes("'authorization'") && diagnostics.includes("'waveform'") && diagnostics.includes("'spectrum'"), 'Diagnostic export must redact credentials and audio arrays defensively.');
expect(app.includes("params.get('dev') === '1'") && app.includes("event.key.toLowerCase() === 'd'"), 'Developer mode must be available through ?dev=1 and Ctrl+Shift+D.');
expect(app.includes("Object.defineProperty(window, 'VIZ_DEV'") && index.includes('Dream diagnostics.'), 'VIZ_DEV API and diagnostic drawer must be available without public UI clutter.');
expect(app.includes('copyCurrentHtml') && app.includes('retestCurrentVisualizer') && app.includes('exportAll'), 'Dev mode must support HTML copy, deterministic retest and JSON export.');
expect(!app.includes('waveform: sample.waveform') || diagnostics.includes("output[key] = '[redacted]'"), 'Diagnostic export must never preserve captured waveform/spectrum values.');

// Real regression corpus and browser verification.
expect(aetheriaFixture.includes('AETHERIA :: Resonant Topology') && aetheriaFixture.includes('gl.compileShader'), 'Real Gemini blank-screen output must remain a regression fixture.');
expect(workflow.includes('@playwright/test') && workflow.includes('playwright install --with-deps chromium') && workflow.includes('playwright test --config=playwright.config.mjs'), 'CI must execute the browser reliability corpus in Chromium.');
const browserTests = await read('tests/visualizer-reliability.spec.mjs');
expect(browserTests.includes('valid-black-webgl'), 'CI must protect intentionally black but functioning artwork.');
expect(browserTests.includes('webgl-dom-fallback'), 'CI must protect resilient DOM fallbacks when an advanced renderer fails.');

if (failures.length) {
  console.error('Visualizer reliability contract failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('Visualizer reliability contract: PASS');
