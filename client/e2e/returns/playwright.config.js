import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const apiPort = Number(process.env.RETURNS_TEST_API_PORT);
const clientPort = Number(process.env.RETURNS_TEST_CLIENT_PORT);
if (![apiPort, clientPort].every(port => Number.isInteger(port) && port > 0 && port < 65536) || apiPort === clientPort) {
  throw new Error("Set distinct RETURNS_TEST_API_PORT and RETURNS_TEST_CLIENT_PORT");
}

const output = process.env.HARNESS_RUN_DIR || path.join(os.tmpdir(), "returns-playwright");
const clientOrigin = `http://127.0.0.1:${clientPort}`;

export default defineConfig({
  testDir: ".",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(output, "playwright-artifacts"),
  reporter: [["line"], ["junit", { outputFile: path.join(output, "returns-browser.xml") }]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 390, height: 844 },
    baseURL: clientOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: `npm run dev --workspace client -- --port ${clientPort} --strictPort`,
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    url: clientOrigin + "/login",
    timeout: 120_000,
    reuseExistingServer: false,
    env: { VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}` }
  }
});
