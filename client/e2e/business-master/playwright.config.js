import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const isUatOnly = process.argv.includes("uat");
const reportOutput = process.env.HARNESS_RESULT_PATH
  || path.resolve(process.cwd(), isUatOnly ? "business-master-uat-browser.xml" : "business-master-browser.xml");

export default defineConfig({
  testDir: here,
  testMatch: "*.spec.js",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["line"],
    ["junit", { outputFile: reportOutput }]
  ],
  outputDir: process.env.HARNESS_RESULT_PATH
    ? path.join(path.dirname(reportOutput), "playwright-artifacts")
    : path.resolve(here, "../../test-results/business-master"),
  use: {
    baseURL: "http://127.0.0.1:5202",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "npm run dev --workspace client -- --port 5202",
    cwd: path.resolve(here, "../../.."),
    url: "http://127.0.0.1:5202",
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    { name: "technical", grep: /@technical/, use: { ...devices["Desktop Chrome"] } },
    { name: "uat", grep: /@uat/, use: { ...devices["Desktop Chrome"] } }
  ]
});
