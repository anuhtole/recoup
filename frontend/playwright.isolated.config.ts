import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// The same e2e path as playwright.config.ts, against its own throwaway world: an API on :8002 over
// .pipeline/e2e/e2e.db and a Vite on :5175 pointed at it. `npm run e2e:isolated` builds the database first.
// reuseExistingServer is off, so a busy port fails the run instead of touching a shared demo server.
const frontend = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(frontend, "../backend");
const db = path.resolve(frontend, "../.pipeline/e2e/e2e.db");
const API_PORT = 8002;
const UI_PORT = 5175;

export default defineConfig({
  // RECOUP_E2E_DIR=scripts/shots runs the review screenshots against the same throwaway world.
  testDir: process.env.RECOUP_E2E_DIR ?? "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  outputDir: "../.pipeline/e2e/results",
  use: {
    baseURL: `http://localhost:${UI_PORT}`,
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
  webServer: [
    {
      command: `uv run recoup serve --port ${API_PORT}`,
      cwd: backend,
      env: {
        RECOUP_DATABASE_URL: `sqlite:///${db}`,
        RECOUP_DEMO_MODE: "true",
        RECOUP_LLM: "off",
        PYTHONPATH: path.join(backend, "src"),
      },
      url: `http://127.0.0.1:${API_PORT}/api/summary`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npx vite",
      cwd: frontend,
      env: { RECOUP_UI_PORT: String(UI_PORT), RECOUP_API_TARGET: `http://127.0.0.1:${API_PORT}` },
      // Through Vite's proxy, so tests start only once both servers answer.
      url: `http://localhost:${UI_PORT}/api/summary`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
