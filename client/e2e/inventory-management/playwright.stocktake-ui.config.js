import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientOrigin = process.env.INVENTORY_STOCKTAKE_CLIENT_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(clientOrigin ?? "")) throw new Error("An owned Stocktake client origin is required");
const runDirectory = process.env.HARNESS_RUN_DIR || path.join(os.tmpdir(), "inventory-stocktake-playwright");
export default defineConfig({ testDir: here, testMatch: "inventory-stocktakes.spec.js", workers: 1, retries: 0, timeout: 120000,
  expect: { timeout: 10000 }, reporter: [["line"], ["junit", { outputFile: path.join(runDirectory, "inventory-task040-browser.xml") }]],
  outputDir: path.join(runDirectory, "playwright-artifacts"), use: { baseURL: clientOrigin, trace: "off", video: "off", screenshot: "off" },
  webServer: { command: `npm run dev --workspace client -- --host 127.0.0.1 --port ${new URL(clientOrigin).port} --strictPort`, cwd: path.resolve(here, "../../.."),
    url: clientOrigin, reuseExistingServer: false, timeout: 120000 }, projects: [{ name: "stocktake-ui", use: { ...devices["Desktop Chrome"] } }] });
