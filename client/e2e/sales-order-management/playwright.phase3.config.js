import {mkdtempSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {defineConfig} from "@playwright/test";
const runDirectory=path.resolve(process.env.HARNESS_RUN_DIR||mkdtempSync(path.join(os.tmpdir(),"sales-phase3-playwright-")));
export default defineConfig({testDir:".",testMatch:"sales-phase3.spec.js",workers:1,timeout:45000,expect:{timeout:7000},outputDir:path.join(runDirectory,"playwright-artifacts"),reporter:[["list"],["junit",{outputFile:process.env.HARNESS_RESULT_PATH||path.join(runDirectory,"tests.xml")}]],use:{headless:true,trace:"off",screenshot:"only-on-failure",video:"off"}});
