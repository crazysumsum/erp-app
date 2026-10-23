import path from "node:path";
import process from "node:process";
import { defineConfig, devices } from "@playwright/test";
import { API_URL, CLIENT_PORT, CLIENT_URL, artifactsDirectory, assertUatEnvironment, repoRoot, runDirectory } from "./uat/uatEnvironment.mjs";

/**
 * Supplier UAT（HD-124 A）：真 server、真 MySQL、新 migrate 嘅 scratch database，冇 network mock。
 * Technical suite（playwright.config.js）照舊 mock network；兩套唔共用 server 同 port。
 * 每個 test 標題只帶一個 UAT ID，harness 嘅 JUnit adapter 靠佢對 required_case_ids。
 */
assertUatEnvironment();
const reportOutput = process.env.HARNESS_RESULT_PATH || path.join(runDirectory, "supplier-uat-browser.xml");

export default defineConfig({
  testDir: "./uat",
  testMatch: "uat-*.spec.js",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["line"], ["junit", { outputFile: reportOutput }]],
  outputDir: artifactsDirectory,
  globalTeardown: "./uat/globalTeardown.mjs",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: CLIENT_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  webServer: [
    {
      command: "node client/e2e/supplier-management/uat/uatServer.mjs",
      cwd: repoRoot,
      url: `${API_URL}/api/v1/health`,
      timeout: 180_000,
      reuseExistingServer: false
    },
    {
      command: `npm run dev --workspace client -- --port ${CLIENT_PORT} --strictPort`,
      cwd: repoRoot,
      url: `${CLIENT_URL}/login`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_API_BASE_URL: API_URL }
    }
  ]
});
