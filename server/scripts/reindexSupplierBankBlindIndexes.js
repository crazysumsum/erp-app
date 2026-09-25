#!/usr/bin/env node
/**
 * 輪替 Bank lookup key，分批重建 blind index（設計 §2.7）。
 *
 *   npm run supplier:bank:reindex-lookup --workspace server -- --from=<oldId> --to=<activeId>
 *
 * 全部旗：`--help` 會印晒出嚟。`--batch-size=<n>`（預設 200）、`--limit=<n>`（今次最多
 * 做幾多行；**唔好寫 `--limit=0` 當試探** —— 0 唔收，想做晒就唔好寫佢）、
 * `--transition-started=<iso>`、`--json`。
 *
 * **呢個工具唔會叫你剷 key。** `supplierRowsDrained` 只係講 `supplier_bank_accounts`
 * 掃乾淨未；同一個 lookup key id 亦都保護緊 `customer_bank_accounts`，兩張表都報零
 * 之前邊個 ring 都唔可以剷。Customer 嗰邊係
 * `scripts/reindexCustomerBankBlindIndexes.js`。（REV-054 H-1）
 *
 * 重建要攞明文，所以呢條命令一樣要 encryption ring 解密 —— 兩條命令都要兩個 ring
 * 齊全。Index 同佢個 key id 同一個 UPDATE 寫，中間唔會有兩者對唔上嘅一刻。
 *
 * 輪替途中新舊 index 並存係預期嘅：`SupplierBankService` 查重會對 ring 入面每條
 * key 計一次 candidate index（設計 §5.8），所以舊 key 嘅行照樣擋得住重覆。
 */
import process from "node:process";
import { ROTATION_KINDS } from "../src/modules/supplier/bankKeyRotation.js";
import { main } from "./supplierBankRotationCli.js";

process.exitCode = await main(ROTATION_KINDS.LOOKUP);
