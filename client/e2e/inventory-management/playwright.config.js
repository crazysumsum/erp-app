import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const runDirectory = path.resolve(process.cwd(), process.env.HARNESS_RUN_DIR || path.join(os.tmpdir(), "inventory-management-playwright"));

export default defineConfig({
  testDir: here,
  testMatch: "inventory-warehouses.spec.js",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: 1,
  reporter: [["line"], ["junit", { outputFile: process.env.HARNESS_RESULT_PATH || path.join(runDirectory, "inventory-browser.xml") }]],
  outputDir: path.join(runDirectory, "playwright-artifacts"),
  use: { baseURL: "http://127.0.0.1:5205", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "npm run dev --workspace client -- --port 5205",
    cwd: path.resolve(here, "../../.."),
    url: "http://127.0.0.1:5205",
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [{ name: "technical", grep: /@technical/, use: { ...devices["Desktop Chrome"] } }]
});
