import process from "node:process";
import path from "node:path";
import {defineConfig} from "@playwright/test";
import foundation from "./playwright.config.js";
const output=process.env.HARNESS_RUN_DIR,api=Number(process.env.FULFILLMENT_TEST_API_PORT),client=Number(process.env.FULFILLMENT_TEST_CLIENT_PORT);
if(!output||![api,client].every(value=>Number.isSafeInteger(value)&&value>1024&&value<65536)||api===client)throw new Error("Explicit owned browser ports/output required");
export default defineConfig({...foundation,testMatch:["p2.spec.js"],workers:1,fullyParallel:false,retries:0,maxFailures:1,
 timeout:120000,expect:{timeout:10000},outputDir:path.join(output,"p2-artifacts"),
 reporter:[["line"],["junit",{outputFile:path.join(output,"fulfillment-p2-browser.xml")}]],
 // Each spec fixture owns its real API/schema; retain the existing strict Vite server.
 webServer:[{...foundation.webServer[1],timeout:60000}]});
