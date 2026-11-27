import { defineConfig } from "@playwright/test";
import foundation from "./p2.playwright.config.js";

// Explicit local validation. The routine P1 and P2 configs keep their own testMatch.
export default defineConfig({ ...foundation, testMatch: "reversal.validation.mjs" });
