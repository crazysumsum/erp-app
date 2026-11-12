import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Same shape as fulfillment p1: the spec starts the real API in-process against the migrated database named by DB_*
// (DB_SOCKET_PATH in CI); this config only starts the Vite client. Ports are separate from Fulfillment's 53001/53002.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const apiPort = Number(process.env.PURCHASING_TEST_API_PORT);
const clientPort = Number(process.env.PURCHASING_TEST_CLIENT_PORT);
if (![apiPort, clientPort].every((port) => Number.isInteger(port) && port > 0 && port < 65536) || apiPort === clientPort) {
  throw new Error("Set separate PURCHASING_TEST_API_PORT and PURCHASING_TEST_CLIENT_PORT");
}
const output = process.env.HARNESS_RUN_DIR || path.join(os.tmpdir(), "purchasing-playwright");

export default defineConfig({
  testDir: ".",
  testMatch: "purchasing-*.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(output, "playwright-artifacts"),
  reporter: [["line"], ["junit", { outputFile: path.join(output, "purchasing-approval-browser.xml") }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${clientPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  webServer: [{
    command: `npm run dev --workspace client -- --port ${clientPort} --strictPort`,
    cwd: root,
    url: `http://127.0.0.1:${clientPort}/login`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}` }
  }]
});
