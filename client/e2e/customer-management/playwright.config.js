import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const runDirectory = path.resolve(process.cwd(), process.env.HARNESS_RUN_DIR || "/private/tmp/customer-management-playwright");

export default defineConfig({
  testDir: here,
  testMatch: "customer-*.spec.js",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: 1,
  reporter: [["line"], ["junit", { outputFile: process.env.HARNESS_RESULT_PATH || path.join(runDirectory, "customer-browser.xml") }]],
  outputDir: path.join(runDirectory, "playwright-artifacts"),
  use: { baseURL: "http://127.0.0.1:5204", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "npx vite --config client/e2e/customer-management/vite.config.js --host 127.0.0.1 --port 5204", cwd: path.resolve(here, "../../.."), url: "http://127.0.0.1:5204", reuseExistingServer: true, timeout: 120_000 },
  projects: [{ name: "technical", grep: /@technical/, use: { ...devices["Desktop Chrome"] } }]
});
