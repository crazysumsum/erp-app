#!/usr/bin/env node
/**
 * 線上輪替 Bank encryption key（設計 §2.7）。
 *
 *   npm run supplier:bank:rotate-encryption --workspace server -- --from=<oldId> --to=<activeId>
 *
 * 全部旗：`--help` 會印晒出嚟。`--batch-size=<n>`（預設 200）、`--limit=<n>`（今次最多
 * 做幾多行；**唔好寫 `--limit=0` 當試探** —— 0 唔收，想做晒就唔好寫佢）、
 * `--transition-started=<iso>`、`--json`。
 *
 * 可續跑：條件本身就係進度，做完嘅行唔再帶舊 key id。舊 key 只有喺 row count 為 0
 * 而且今次 run 冇失敗行之後先可以由 ring 度剷走 —— report 個 `safeToRemoveFromKey`
 * 就係嗰個判斷。
 */
import process from "node:process";
import { ROTATION_KINDS } from "../src/modules/supplier/bankKeyRotation.js";
import { main } from "./supplierBankRotationCli.js";

process.exitCode = await main(ROTATION_KINDS.ENCRYPTION);
