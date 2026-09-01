import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const absent = async path => {
  try {
    await access(new URL(path, root));
    return false;
  } catch {
    return true;
  }
};

const [
  index,
  audio,
  sandbox,
  prompt,
  providerRuntime,
  openrouterFacade,
  costGuard,
  modelGuide,
  dreamStatus,
  product,
  providers,
  roadmap,
  security,
  deployWorkflow,
  visualizerWorkflow,
] = await Promise.all([
  read('public/visualizer/index.html'),
  read('public/visualizer/audio-engine.js'),
  read('public/visualizer/sandbox.js'),
  read('public/visualizer/prompt.js'),
  read('public/visualizer/provider-runtime.js'),
  read('public/visualizer/openrouter.js'),
  read('public/visualizer/cost-guard.js'),
  read('public/visualizer/model-guide.js'),
  read('public/visualizer/dream-status.js'),
  read('docs/visualizer/PRODUCT.md'),
  read('docs/visualizer/PROVIDERS.md'),
  read('docs/visualizer/ROADMAP.md'),
  read('docs/visualizer/SECURITY.md'),
  read('.github/workflows/deploy.yml'),
  read('.github/workflows/visualizer-check.yml'),
]);

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

// Generated-code, audio, and prompt invariants.
expect(/sandbox="allow-scripts"/.test(index), 'Generated visualizer iframe must allow scripts inside a sandbox.');
expect(!/sandbox="[^"]*allow-same-origin/.test(index), 'Generated visualizer sandbox must not use allow-same-origin.');
expect(audio.includes('getDisplayMedia'), 'Audio engine must use display/system audio capture.');
expect(!audio.includes('getUserMedia('), 'Microphone capture is forbidden.');
expect(audio.includes("audioSelection:'preferred'"), 'Chromium capture must prefer audio-bearing sources.');
expect(audio.includes("displaySurface:'browser'"), 'Web capture should steer toward browser-tab selection first.');
expect(audio.includes('smoothingTimeConstant=.08'), 'Fast analyser smoothing must stay low-latency.');
expect(audio.includes('Firefox can show the screen-sharing picker'), 'Known Firefox no-audio path must fail before the misleading picker.');
expect(sandbox.includes("connect-src 'none'"), 'Generated visualizer CSP must block network connections.');
expect(
  sandbox.includes("Object.defineProperty(window,'VIZ'") || sandbox.includes("Object.defineProperty(window, 'VIZ'"),
  'Sandbox must inject the read-only VIZ bridge.',
);
expect(prompt.includes('visualizer-prompt-v1'), 'Canonical prompt version is missing.');
expect(prompt.includes('You do not know what music will be played.'), 'Canonical prompt must remain song-agnostic.');
expect(prompt.includes('There are no aesthetic requirements.'), 'Canonical prompt must remain aesthetically unconstrained.');

// Browser-provider contract and OpenRouter reference adapter.
expect(providerRuntime.includes("PROVIDER_CONTRACT_VERSION = 'visualizer-provider-v1'"), 'Provider contract version is missing.');
for (const method of ['getCredential', 'isConnected', 'connect', 'consumeCallback', 'disconnect', 'listModels', 'generate', 'repair']) {
  expect(providerRuntime.includes(`'${method}'`), `Provider contract must require ${method}().`);
}
expect(providerRuntime.includes('registerProvider(openRouterAdapter)'), 'OpenRouter must register through the provider contract.');
expect(providerRuntime.includes('browserOnly: true'), 'Active provider must declare the browser-only boundary.');
expect(providerRuntime.includes("billing: 'user'"), 'Active provider must use the user\'s connected billing source.');
expect(providerRuntime.includes("transport: 'browser-direct'"), 'OpenRouter must be identified as browser-direct.');
expect(providerRuntime.includes('sessionStorage'), 'OpenRouter delegated key must remain session-scoped.');
expect(providerRuntime.includes("code_challenge_method', 'S256'"), 'OpenRouter connection must use PKCE S256.');
expect(providerRuntime.includes('https://openrouter.ai/api/v1/models'), 'Provider runtime must load the live OpenRouter catalog.');
expect(providerRuntime.includes('https://openrouter.ai/api/v1/chat/completions'), 'Provider runtime must use OpenRouter completions.');
expect(providerRuntime.includes('stream: false'), 'Reference adapter must declare its non-streaming response mode truthfully.');
expect(providerRuntime.includes('response.status === 402'), 'OpenRouter insufficient-funds errors must be explicit.');
expect(providerRuntime.includes('response.status === 429'), 'OpenRouter rate-limit errors must be explicit.');
expect(providerRuntime.includes('No automatic retry was sent'), 'Uncertain provider execution must not trigger a hidden retry.');
expect(providerRuntime.includes("response.headers.get('x-request-id')"), 'Provider result should retain request identity when available.');
expect(openrouterFacade.includes("from './provider-runtime.js'"), 'Legacy OpenRouter UI imports must delegate to provider-runtime.js.');
expect(openrouterFacade.includes('generateProviderVisualizer as generateVisualizer'), 'Generation must flow through the provider contract.');
expect(openrouterFacade.includes('repairProviderVisualizer as repairVisualizer'), 'Repair must flow through the provider contract.');

// OpenRouter spend protection.
expect(index.includes('./cost-guard.js'), 'Spend guard must be loaded.');
expect(index.indexOf('./dream-status.js') < index.indexOf('./cost-guard.js'), 'Dream lifecycle must wrap requests before the spend guard.');
expect(index.indexOf('./cost-guard.js') < index.indexOf('./app.js'), 'Spend guard must load before the visualizer app module.');
expect(costGuard.includes('perDream: 0.75'), 'Default per-Dream spend guard must remain $0.75.');
expect(costGuard.includes('session: 5'), 'Default session spend guard must remain $5.');
expect(costGuard.includes('daily: 10'), 'Default local-day spend guard must remain $10.');
expect(costGuard.includes('body.max_tokens = allowedMax'), 'Spend guard must constrain model output tokens.');
expect(costGuard.includes('include: true'), 'OpenRouter requests must request exact usage accounting.');
expect(costGuard.includes('https://openrouter.ai/api/v1/key'), 'Spend guard must inspect the current OpenRouter key limit.');
expect(costGuard.includes('currentDreamSpent'), 'Automatic repair must share the same Dream budget.');

// Guided model selection and truthful lifecycle.
expect(index.includes('./model-guide.js') && index.includes('./model-guide.css'), 'Guided model-picker assets must be loaded.');
expect(index.includes('Four easy choices.') && index.includes('Browse every model'), 'Model picker must default to a small guided choice while preserving the full catalog.');
expect(
  modelGuide.includes("label:'Best shot at wow'") &&
  modelGuide.includes("label:'Fast + great'") &&
  modelGuide.includes("label:'Cheap + strong'") &&
  modelGuide.includes("label:'Free experiment'"),
  'Simple picker must preserve the four human-facing recommendation lanes.',
);
expect(modelGuide.includes('design_arena') && modelGuide.includes('coding_index'), 'Recommendations must use live visual/coding benchmark signals.');
expect(modelGuide.includes("MODEL_ENDPOINT='https://openrouter.ai/api/v1/models'"), 'Recommendations must update from the live OpenRouter catalog.');
expect(index.includes('./dream-status.js') && index.includes('./dream-status.css'), 'Dream lifecycle assets must be loaded.');
expect(index.includes('data-dream-step') && index.includes('dreamCancelButton'), 'Dream UI must expose pipeline steps and cancellation.');
expect(dreamStatus.includes('DREAM_TIMEOUT_MS = 360000'), 'Dream lifecycle must allow slow coding models up to six minutes.');
expect(dreamStatus.includes('waiting >= 300000') && dreamStatus.includes('waiting >= 180000'), 'Slow-model lifecycle must keep giving proof of life.');
expect(dreamStatus.includes('AbortController'), 'Dream lifecycle must support cancelling the in-flight request.');
expect(dreamStatus.includes('Request sent ✓') && dreamStatus.includes('full response body received'), 'Dream lifecycle must distinguish sent, response-started, and body-complete states.');
expect(dreamStatus.includes('OpenRouter may still bill work completed before cancellation'), 'Cancellation must not promise zero provider cost.');

// Browser-only cleanup: the normal product must contain no local/native setup.
const forbiddenPublicText = ['Local Model Lab', 'opencode', '127.0.0.1', 'localhost', '.exe', 'PowerShell'];
for (const text of forbiddenPublicText) {
  expect(!index.toLowerCase().includes(text.toLowerCase()), `Browser UI must not contain local/native setup reference: ${text}`);
}
for (const text of ['opencode', '127.0.0.1', 'localhost', 'auth.json']) {
  expect(!providerRuntime.toLowerCase().includes(text.toLowerCase()), `Provider runtime must not depend on local software: ${text}`);
}
expect(!deployWorkflow.includes('setup-go'), 'Production deploy must not build a native companion.');
expect(!deployWorkflow.includes('GOOS=windows'), 'Production deploy must not cross-compile Windows software.');
expect(!deployWorkflow.includes('AI-Visualizer-Model-Lab.exe'), 'Production deploy must not publish an executable.');
expect(!visualizerWorkflow.includes('setup-go'), 'Visualizer CI must remain web-only.');

const forbiddenPaths = [
  'companion/windows-model-lab/go.mod',
  'companion/windows-model-lab/main.go',
  'public/visualizer/AI-Visualizer-Model-Lab.exe',
  'public/visualizer/local-cost-label.js',
  'public/visualizer/local-model-unlock.js',
  'public/visualizer/model-lab-bridge.mjs',
  'public/visualizer/model-lab-launcher.ps1',
  'public/visualizer/opencode-lab.css',
  'public/visualizer/opencode-lab.js',
  'scripts/model-lab-bridge-static-check.mjs',
  'scripts/windows-companion-static-check.mjs',
];
for (const path of forbiddenPaths) {
  expect(await absent(path), `Desktop/local detour file must be removed: ${path}`);
}

// Product and security documentation must preserve the approved boundary.
expect(product.includes('No terminal, localhost service, desktop companion'), 'Product constitution must lock the no-install browser boundary.');
expect(product.includes("funded entirely by the user's connected provider account"), 'Product constitution must lock user-funded inference.');
expect(providers.includes('visualizer-provider-v1'), 'Provider contract documentation is missing.');
expect(providers.includes('No adapter may require a terminal, localhost service, native companion'), 'Provider contract must forbid local setup.');
expect(roadmap.includes('Explicitly outside the current roadmap'), 'Roadmap must explicitly exclude desktop/local work.');
expect(security.includes('requires no local server, desktop companion, executable, terminal'), 'Security boundary must describe the browser-only architecture.');

if (failures.length) {
  console.error('Visualizer static contract failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('Visualizer static contract: PASS');
