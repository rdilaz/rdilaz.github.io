import { readFile } from 'node:fs/promises';

const bridge = await readFile(new URL('../public/visualizer/model-lab-bridge.mjs', import.meta.url), 'utf8');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(bridge.includes("const HOST = '127.0.0.1'"), 'Model Lab bridge must remain loopback-only.');
expect(bridge.includes("const ALLOWED_ORIGIN = 'https://ryo-nd.com'"), 'Model Lab bridge CORS must remain scoped to ryo-nd.com.');
expect(bridge.includes("permission: 'deny'"), 'OpenCode fallback workspace must deny model tools.');
expect(bridge.includes("['run', '--format', 'json', '--model'"), 'Bridge must route generations through non-interactive opencode run.');
expect(bridge.includes("['models', '--verbose']"), 'Bridge model discovery must come from OpenCode runtime metadata.');
expect(bridge.includes("'--variant'"), 'Bridge must preserve model inference/reasoning variants.');
expect(bridge.includes("Access-Control-Allow-Private-Network"), 'Bridge must support Chromium local-network preflight.');
expect(!bridge.includes('.local/share/opencode') && !bridge.includes('auth.json'), 'Bridge must never read OpenCode credential storage directly.');
expect(bridge.includes("spawn('taskkill.exe'"), 'Windows cancellation must terminate the OpenCode child process tree.');

if (failures.length) {
  console.error('Model Lab bridge static contract failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('Model Lab bridge static contract: PASS');
