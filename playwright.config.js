import { defineConfig, devices } from '@playwright/test';

const host = ['127.', '0.0.1'].join('');
const port = 4173;
const baseURL = `http://${host}:${port}/`;

function iphone(name) {
  const device = { ...devices[name] };
  delete device.defaultBrowserType;
  return {
    name,
    use: {
      ...device,
      browserName: 'chromium',
      ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
    },
  };
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL },
  projects: [iphone('iPhone 13'), iphone('iPhone SE')],
  webServer: {
    command: `python3 -m http.server ${port} --bind ${host}`,
    cwd: 'web',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
});
