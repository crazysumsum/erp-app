import os from "node:os";
import path from "node:path";
import process from "node:process";
import { defineConfig } from "@playwright/test";

const runDirectory = path.resolve(process.env.HARNESS_RUN_DIR || path.join(os.tmpdir(), "sales-quote-to-ship-playwright"));
export default defineConfig({
  testDir: ".",
  testMatch: "sales-quote-to-ship.spec.js",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 7000 },
  outputDir: path.join(runDirectory, "playwright-artifacts"),
  reporter: [["list"], ["junit", { outputFile: path.join(runDirectory, "tests.xml") }]],
  use: { headless: true, trace: "off", screenshot: "only-on-failure", video: "off" }
});
