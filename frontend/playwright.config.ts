import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real UI against the real API in demo mode.
// Run `make reset` first so the demo starts at Oct 1, 2026, then `npm run e2e`.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      // Uses the installed Google Chrome; set PLAYWRIGHT_CHANNEL="" to use Playwright's own Chromium.
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" },
    },
  ],
  webServer: {
    // `make dev` starts the API on :8000 (demo mode) and Vite on :5173. The readiness URL goes through
    // Vite's proxy to the API, so tests start only once both are up.
    command: "make dev",
    cwd: "..",
    url: "http://localhost:5174/api/summary",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
