/**
 * 相似名稱搜尋嘅召回率同延遲（TASK-050；HD-084；REV-083 L-2）。只讀，唔寫任何嘢。
 *
 *   node scripts/measureSupplierDuplicateRecall.js --database=<DB_NAME> --output <report.json> [--queries=200] [--seed=50]
 *
 * 由資料庫揀 `--queries` 個名稱（固定 seed，可重現），每個隨機改 0–2 個字元當做用戶輸入，然後同「逐個 Supplier
 * 計 Dice」嘅真實答案（頭 10 個，同產品一樣排序）比較：產品設定（上限 3,000 個候選）同冇上限各一次。
 */
import fs from "node:fs";
import mysql from "mysql2/promise";

import { bigramDiceScore, SupplierDuplicateCandidates } from "../src/modules/supplier/supplierDuplicateCandidates.js";

const arg = (name, fallback) => {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (found) return found.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? process.argv[index + 1] : fallback;
};
const QUERIES = Number(arg("queries", 200));
const SEED = Number(arg("seed", 50));
const OUTPUT = arg("output", null);
if (!Number.isSafeInteger(QUERIES) || QUERIES < 1 || !Number.isSafeInteger(SEED) || typeof OUTPUT !== "string") {
  throw new Error("usage: node scripts/measureSupplierDuplicateRecall.js --database=<DB_NAME> --output <report.json> [--queries=200] [--seed=50]");
}
const missing = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"]
  .filter((key) => (key === "DB_PASSWORD" ? process.env[key] === undefined : !process.env[key]));
if (missing.length > 0) throw new Error(`set ${missing.join(", ")} explicitly`);
if (arg("database", null) !== process.env.DB_NAME) throw new Error(`--database must repeat DB_NAME (${process.env.DB_NAME})`);

// mulberry32：細、可重現，唔使加 dependency。
let state = SEED >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let value = state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
};
const pick = (length) => Math.floor(random() * length);
const perturb = (name) => {
  const characters = Array.from(name);
  for (let edit = pick(3); edit > 0; edit -= 1) {
    const at = pick(characters.length);
    const kind = pick(3);
    if (kind === 0) characters.splice(at, 1);
    else if (kind === 1) characters.splice(at, 0, "xzqk"[pick(4)]);
    else characters[at] = "aeio"[pick(4)];
  }
  return characters.join("");
};
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];

const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, socketPath: process.env.DB_SOCKET_PATH || undefined });
try {
  const [everyone] = await connection.query("SELECT id, supplier_name_key FROM suppliers ORDER BY id");
  const variants = { capped: new SupplierDuplicateCandidates(), uncapped: new SupplierDuplicateCandidates({ candidateCap: Number.MAX_SAFE_INTEGER }) };
  const results = Object.fromEntries(Object.keys(variants).map((name) => [name, { found: 0, missed: 0, queriesMissing: 0, ms: [] }]));
  const misses = [];
  let truthTotal = 0;
  for (let query = 0; query < QUERIES; query += 1) {
    const nameKey = perturb(everyone[pick(everyone.length)].supplier_name_key);
    const truth = everyone
      .map((row) => ({ id: Number(row.id), exact: row.supplier_name_key === nameKey, score: bigramDiceScore(nameKey, row.supplier_name_key) }))
      .filter((row) => row.exact || row.score >= 0.85)
      .sort((left, right) => Number(right.exact) - Number(left.exact) || right.score - left.score || left.id - right.id)
      .slice(0, 10);
    truthTotal += truth.length;
    for (const [name, finder] of Object.entries(variants)) {
      const started = performance.now();
      const got = new Set((await finder.find(connection, { nameKey })).map((row) => row.supplierId));
      results[name].ms.push(performance.now() - started);
      const lost = truth.filter((row) => !got.has(row.id));
      results[name].found += truth.length - lost.length;
      results[name].missed += lost.length;
      if (lost.length > 0) {
        results[name].queriesMissing += 1;
        if (name === "capped" && misses.length < 10) misses.push({ query: nameKey, truthSize: truth.length, missedScores: lost.map((row) => row.score) });
      }
    }
  }
  const report = {
    command: process.argv.slice(1).join(" "), database: process.env.DB_NAME, suppliers: everyone.length, queries: QUERIES, seed: SEED,
    truthCandidates: truthTotal,
    variants: Object.fromEntries(Object.entries(results).map(([name, value]) => [name, {
      candidateCap: variants[name].candidateCap, recall: Math.round((value.found / truthTotal) * 10_000) / 10_000, missed: value.missed,
      queriesMissing: value.queriesMissing, p50Ms: Math.round(percentile(value.ms, 0.5)), p95Ms: Math.round(percentile(value.ms, 0.95))
    }])),
    cappedMissExamples: misses,
    note: "single connection, one query at a time, no other load"
  };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.variants, null, 2));
} finally {
  await connection.end();
}
