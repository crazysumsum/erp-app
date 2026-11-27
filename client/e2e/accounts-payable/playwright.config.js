import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const apiPort = Number(process.env.AP_TEST_API_PORT);
const clientPort = Number(process.env.AP_TEST_CLIENT_PORT);
if (![apiPort, clientPort].every((port) => Number.isInteger(port) && port > 0 && port < 65536) || apiPort === clientPort) {
  throw new Error("Set separate AP_TEST_API_PORT and AP_TEST_CLIENT_PORT");
}
const baseURL = `http://127.0.0.1:${clientPort}`;
const output = process.env.HARNESS_RUN_DIR || path.join(os.tmpdir(), "erp-ap-playwright");
export default defineConfig({
  testDir: ".",
  testMatch: "ap-flow.spec.js",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(output, "ap-browser"),
  reporter: [["line"], ["junit", { outputFile: path.join(output, "ap-browser.xml") }]],
  use: { ...devices["Desktop Chrome"], baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: `npm run dev --workspace client -- --port ${clientPort} --strictPort`,
    cwd: root, url: baseURL + "/login", timeout: 90_000, reuseExistingServer: false,
    env: { VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}` }
  }
});
