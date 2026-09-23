import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const isUatOnly = process.argv.includes("uat");
/**
 * 報告同 artifact 預設寫喺 repo 外面，跟 supplier 同 item-management 嗰兩份。
 *
 * 之前呢度預設寫 repo 根目錄嘅 .xml 同 client/test-results/，兩個都唔喺版本控制
 * 忽略清單入面，所以每跑一次呢組 browser test，working tree 就會多兩項——而
 * CLAUDE.md §9 要求每個前端改動都做瀏覽器驗證，即係次次都會撞到。supplier 嗰份
 * 喺 REV-028 已經行咗呢條路，呢度係補返最後一個未對齊嘅模組。
 *
 * Harness runner 照舊用 HARNESS_RUN_DIR / HARNESS_RESULT_PATH 覆寫去自己個
 * evidence 目錄，行為冇變。
 */
const runDirectory = path.resolve(process.cwd(), process.env.HARNESS_RUN_DIR || path.join(os.tmpdir(), "business-master-playwright"));
const reportOutput = process.env.HARNESS_RESULT_PATH
  || path.join(runDirectory, isUatOnly ? "business-master-uat-browser.xml" : "business-master-browser.xml");

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
  outputDir: path.join(path.dirname(reportOutput), "playwright-artifacts"),
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
