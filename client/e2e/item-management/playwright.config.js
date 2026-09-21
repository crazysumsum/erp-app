import { randomBytes } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const runDirectory = path.resolve(process.cwd(), process.env.HARNESS_RUN_DIR || "/private/tmp/item-management-playwright");
const resultPath = path.resolve(
  process.cwd(),
  process.env.HARNESS_RESULT_PATH || `${runDirectory}/item-uat-browser.xml`
);
const jwtSecret = randomBytes(48).toString("base64url");

export default defineConfig({
  testDir: ".",
  testMatch: "item-management.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: `${runDirectory}/playwright-artifacts`,
  reporter: [["junit", { outputFile: resultPath }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    ...devices["Desktop Chrome"]
  },
  webServer: [
    {
      command: "npm run start --workspace server",
      cwd: "../../..",
      url: "http://127.0.0.1:3000/api/v1/health",
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        APP_HOST: "127.0.0.1",
        APP_PORT: "3000",
        CLIENT_URL: "http://127.0.0.1:4173",
        DB_HOST: process.env.DB_HOST || "127.0.0.1",
        DB_PORT: process.env.DB_PORT || "3306",
        DB_USER: process.env.DB_USER || "erp_user",
        DB_PASSWORD: process.env.DB_PASSWORD || "",
        DB_NAME: process.env.DB_NAME || "erp_dev",
        JWT_SECRET: jwtSecret,
        NODE_ENV: "test"
      }
    },
    {
      command: "npm run dev --workspace client -- --port 4173",
      cwd: "../../..",
      url: "http://127.0.0.1:4173/login",
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_API_BASE_URL: "http://127.0.0.1:3000" }
    }
  ]
});
