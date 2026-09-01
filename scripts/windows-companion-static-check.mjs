import { readFile } from 'node:fs/promises';

const [source, ui, css, deploy] = await Promise.all([
  readFile('companion/windows-model-lab/main.go', 'utf8'),
  readFile('public/visualizer/local-cost-label.js', 'utf8'),
  readFile('public/visualizer/opencode-lab.css', 'utf8'),
  readFile('.github/workflows/deploy.yml', 'utf8'),
]);

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(source.includes('host          = "127.0.0.1"'), 'Windows companion must bind loopback only.');
expect(source.includes('allowedOrigin = "https://ryo-nd.com"'), 'Windows companion must restrict browser origin to ryo-nd.com.');
expect(source.includes('"permission": "deny"'), 'Windows companion must deny OpenCode tools in its isolated workspace.');
expect(source.includes('"models", "--verbose"'), 'Windows companion must discover the live OpenCode model catalog.');
expect(source.includes('"run", "--format", "json"') && source.includes('"--variant"'), 'Windows companion must use OpenCode run and preserve model variants.');
expect(source.includes('taskkill.exe') && source.includes('"/T", "/F"'), 'Windows companion cancellation must terminate the process tree.');
expect(!source.includes('auth.json'), 'Windows companion must never read OpenCode credential files directly.');
expect(source.includes('permission\\\": \\\"deny') || source.includes('permission\": \"deny'), 'Companion config must remain tool-denied.');
expect(ui.includes('./AI-Visualizer-Model-Lab.exe') && ui.includes('Download Windows companion'), 'Windows Model Lab UI must offer the one-click companion executable.');
expect(ui.includes('No PowerShell, ports, or terminal window'), 'Windows setup copy must explicitly remove terminal setup from the normal path.');
expect(css.includes('.model-lab__companion-download'), 'Windows companion download must have a first-class UI treatment.');
expect(deploy.includes('GOOS=windows GOARCH=amd64') && deploy.includes('AI-Visualizer-Model-Lab.exe'), 'Production deploy must build and publish the Windows companion.');
expect(deploy.includes('-H=windowsgui'), 'Windows companion must build without a console window.');

if (failures.length) {
  console.error('Windows companion contract failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('Windows companion contract: PASS');
