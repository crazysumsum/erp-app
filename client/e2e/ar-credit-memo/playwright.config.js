import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const apiPort = Number(process.env.AR_TEST_API_PORT);
const clientPort = Number(process.env.AR_TEST_CLIENT_PORT);
if (![apiPort, clientPort].every((port) => Number.isInteger(port) && port > 1024 && port < 65536) || apiPort === clientPort) {
  throw new Error("Set distinct AR_TEST_API_PORT and AR_TEST_CLIENT_PORT for the AR credit memo browser tests");
}
const clientOrigin = `http://127.0.0.1:${clientPort}`;
const output = process.env.HARNESS_RUN_DIR || path.join(os.tmpdir(), "ar-credit-memo-playwright");

export default defineConfig({
  testDir: ".",
  testMatch: "ar-credit-memo.spec.js",
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(output, "ar-credit-memo-artifacts"),
  reporter: [["line"], ["junit", { outputFile: path.join(output, "ar-credit-memo-browser.xml") }]],
  use: { baseURL: clientOrigin, actionTimeout: 10_000, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: `npm run dev --workspace client -- --port ${clientPort} --strictPort`,
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    url: `${clientOrigin}/login`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}` }
  }
});
