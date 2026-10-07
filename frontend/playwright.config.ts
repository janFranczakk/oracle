import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const python =
  process.env.ORACLE_PYTHON ||
  (process.platform === 'win32' ? resolve(root, '.venv/Scripts/python.exe') : 'python');
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4182',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: [
    {
      command: `"${python}" -m uvicorn oracle.api:app --host 127.0.0.1 --port 8012`,
      cwd: root,
      url: 'http://127.0.0.1:8012/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ORACLE_DATA_ROOT: resolve(root, '.run/e2e'), PYTHONPATH: resolve(root, 'backend') },
    },
    {
      command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4182',
      url: 'http://127.0.0.1:4182',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ORACLE_API_PORT: '8012' },
    },
  ],
});
