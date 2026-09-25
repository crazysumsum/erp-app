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
 * 可續跑：條件本身就係進度，做完嘅行唔再帶舊 key id。
 *
 * **呢個工具唔會叫你剷 key。** `supplierRowsDrained` 只係講 `supplier_bank_accounts`
 * 呢一張表掃乾淨未。配置要求 Customer 同 Supplier 兩個 ring 一模一樣，所以同一個
 * key id 亦都保護緊 `customer_bank_accounts` —— 兩張表都報零之前，兩個 ring 邊個都
 * 唔可以剷。Customer 嗰邊係 `scripts/rotateCustomerBankEncryption.js`。（REV-054 H-1）
 */
import process from "node:process";
import { ROTATION_KINDS } from "../src/modules/supplier/bankKeyRotation.js";
import { main } from "./supplierBankRotationCli.js";

process.exitCode = await main(ROTATION_KINDS.ENCRYPTION);
