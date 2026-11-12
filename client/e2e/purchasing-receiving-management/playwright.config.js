import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Real server + Vite dev client against a migrated MySQL named by DB_* (same shape as item-management).
// Ports differ from the other suites so they can run side by side.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runDirectory = path.resolve(process.cwd(), process.env.HARNESS_RUN_DIR || path.join(os.tmpdir(), "purchasing-playwright"));
const resultPath = process.env.HARNESS_RESULT_PATH || path.join(runDirectory, "purchasing-browser.xml");
const apiPort = 3017;
const clientPort = 5217;

export default defineConfig({
  testDir: ".",
  testMatch: "purchasing-*.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(runDirectory, "playwright-artifacts"),
  reporter: [["line"], ["junit", { outputFile: resultPath }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${clientPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  webServer: [
    {
      command: "npm run start --workspace server",
      cwd: root,
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        APP_HOST: "127.0.0.1",
        APP_PORT: String(apiPort),
        CLIENT_URL: `http://127.0.0.1:${clientPort}`,
        DB_HOST: process.env.DB_HOST || "127.0.0.1",
        DB_PORT: process.env.DB_PORT || "3306",
        DB_USER: process.env.DB_USER || "erp_user",
        DB_PASSWORD: process.env.DB_PASSWORD || "",
        DB_NAME: process.env.DB_NAME || "erp_dev",
        JWT_SECRET: randomBytes(48).toString("base64url"),
        NODE_ENV: "test"
      }
    },
    {
      command: `npm run dev --workspace client -- --port ${clientPort} --strictPort`,
      cwd: root,
      url: `http://127.0.0.1:${clientPort}/login`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}` }
    }
  ]
});
