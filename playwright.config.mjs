export default {
  testDir: './tests',
  testMatch: ['**/*.spec.mjs'],
  testIgnore: ['**/model-eligibility.spec.mjs'],
  timeout: 45000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: false,
    timeout: 30000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
};
