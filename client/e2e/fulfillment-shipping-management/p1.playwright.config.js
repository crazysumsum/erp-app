import path from "node:path";
import process from "node:process";
import os from "node:os";
import {defineConfig} from "@playwright/test";
import foundation from "./playwright.config.js";
const output=process.env.HARNESS_RUN_DIR||path.join(os.tmpdir(),"fulfillment-p1-playwright");
export default defineConfig({...foundation,testMatch:["p1.spec.js"],
 reporter:[["line"],["junit",{outputFile:path.join(output,"fulfillment-p1-browser.xml")}]],
 // The spec owns the real API and its UUID schema; retain the strict Vite server.
 webServer:[foundation.webServer[1]]});
