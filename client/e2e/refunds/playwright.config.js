import process from "node:process";

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const apiPort = Number(process.env.REFUNDS_TEST_API_PORT);
const clientPort = Number(process.env.REFUNDS_TEST_CLIENT_PORT);
if (![apiPort, clientPort].every(port => Number.isInteger(port) && port > 0 && port < 65536) || apiPort === clientPort) {
  throw new Error("Set distinct REFUNDS_TEST_API_PORT and REFUNDS_TEST_CLIENT_PORT");
}
const clientOrigin = `http://127.0.0.1:${clientPort}`;
const output = process.env.HARNESS_RUN_DIR || path.join(os.tmpdir(), "refunds-playwright");

export default defineConfig({
  testDir: ".",
  testMatch: "refund-workspace.spec.js",
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(output, "playwright-artifacts"),
  reporter: [["line"], ["junit", { outputFile: path.join(output, "refunds-browser.xml") }]],
  use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, baseURL: clientOrigin,
    trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: `npm run dev --workspace client -- --port ${clientPort} --strictPort`,
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    url: clientOrigin + "/login",
    timeout: 120_000,
    reuseExistingServer: false,
    env: { VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}` }
  }
});
