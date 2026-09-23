import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const isUatOnly = process.argv.includes("uat");

/**
 * REV-028 L-4：報告同 artifact 預設寫喺 repo 外面。
 *
 * 原本跟 business-master 嗰份，佢寫 client/test-results/ 同一個喺 repo 根嘅 .xml，
 * 兩個都唔喺 .gitignore，所以每次跑完 git status 都會多兩項 —— 而 CLAUDE.md §9
 * 要求每個前端改動都跑瀏覽器驗證，即係每個 supplier task 都會撞到。
 *
 * 所以預設寫去系統 temp 目錄：咁樣根本冇嘢落到 working tree，亦都唔使改忽略
 * 清單 —— 而嗰個檔案係 manifest 嘅 approval_required_paths。Harness runner 照樣
 * 可以用 HARNESS_RUN_DIR 同 HARNESS_RESULT_PATH 覆寫去佢自己個 evidence 目錄。
 *
 * 用 os.tmpdir() 而唔係寫死 /private/tmp：後者係 macOS 專有，Linux 上面 /private
 * 唔存在，Playwright 會喺根目錄 mkdir 然後 EACCES 收場。呢一點一直冇人發現，因為
 * 呢啲 suite 從來冇喺 CI 跑過；加咗 Browser tests job 之後第一次跑就即刻爆。
 */
const runDirectory = path.resolve(process.cwd(), process.env.HARNESS_RUN_DIR || path.join(os.tmpdir(), "supplier-management-playwright"));
const reportOutput = process.env.HARNESS_RESULT_PATH
  || path.join(runDirectory, isUatOnly ? "supplier-uat-browser.xml" : "supplier-browser.xml");

export default defineConfig({
  testDir: here,
  // 唔用 "*.spec.js"：任何跌低咗喺呢個目錄嘅 spec 都會被當成呢個模組嘅正式
  // evidence。REV-029 嗰輪就真係發生過一次（一個 probe 被我 git add -A 掃咗入
  // commit），所以收窄到本模組自己嘅命名。
  testMatch: "supplier-*.spec.js",
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
    // 5202 係 Business Master 嗰套嘅 port；兩套唔可以爭同一個 dev server。
    baseURL: "http://127.0.0.1:5203",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "npm run dev --workspace client -- --port 5203",
    cwd: path.resolve(here, "../../.."),
    url: "http://127.0.0.1:5203",
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    { name: "technical", grep: /@technical/, use: { ...devices["Desktop Chrome"] } },
    { name: "uat", grep: /@uat/, use: { ...devices["Desktop Chrome"] } }
  ]
});
