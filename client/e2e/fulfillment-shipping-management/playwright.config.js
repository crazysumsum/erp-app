import process from "node:process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const apiPort = Number(process.env.FULFILLMENT_TEST_API_PORT);
const clientPort = Number(process.env.FULFILLMENT_TEST_CLIENT_PORT);
if (![apiPort, clientPort].every(port => Number.isInteger(port) && port > 0 && port < 65536) || apiPort === clientPort) {
  throw new Error("Allocate separate owned Fulfillment test API/client ports");
}
const output = process.env.HARNESS_RUN_DIR || path.join(os.tmpdir(), "fulfillment-p0-playwright");
export default defineConfig({
  testDir: ".", testMatch: "foundation.spec.js", workers: 1, fullyParallel: false,
  timeout: 60000, expect: { timeout: 10000 }, outputDir: path.join(output, "artifacts"),
  reporter: [["line"], ["junit", { outputFile: path.join(output, "foundation.xml") }]],
  use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${clientPort}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    { command: "npm run start --workspace server", cwd: root, reuseExistingServer: false,
      url: `http://127.0.0.1:${apiPort}/api/v1/health`, timeout: 120000,
      env: { APP_HOST: "127.0.0.1", APP_PORT: String(apiPort), CLIENT_URL: `http://127.0.0.1:${clientPort}` } },
    { command: `npm run dev --workspace client -- --port ${clientPort} --strictPort`, cwd: root, reuseExistingServer: false,
      url: `http://127.0.0.1:${clientPort}/login`, timeout: 120000,
      env: { VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}` } }
  ]
});
