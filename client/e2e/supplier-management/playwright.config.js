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
 * 呢度跟返 item-management 嗰份嘅做法（佢預設寫去 /private/tmp/…），因為咁樣
 * 根本冇嘢落到 working tree，亦都唔使改 .gitignore —— 而 .gitignore 係 manifest
 * 嘅 approval_required_paths。Harness runner 照樣可以用 HARNESS_RUN_DIR 同
 * HARNESS_RESULT_PATH 覆寫去佢自己個 evidence 目錄。
 */
const runDirectory = process.env.HARNESS_RUN_DIR
  || path.resolve(process.cwd(), "/private/tmp/supplier-management-playwright");
const reportOutput = process.env.HARNESS_RESULT_PATH
  || path.join(runDirectory, isUatOnly ? "supplier-uat-browser.xml" : "supplier-browser.xml");

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
