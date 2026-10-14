/**
 * Supplier 效能驗收用嘅資料（TASK-050；設計 §11.5；NFR-003；HD-082 A）。
 *
 *   node scripts/seedSupplierPerformanceFixtures.js --database=<DB_NAME> [--suppliers=100000] [--heavy-percent=1]
 *
 * **只可以對用完即棄、啱啱 migrate 完嘅資料庫跑**：`suppliers` 表要係空，`--database` 要同 `DB_NAME` 一樣，
 * 五個 DB_* 都要明確設定。資料直接用 SQL 批量寫入（唔經 API，否則 100k 要幾個鐘），但所有 key、name gram 同
 * Bank 密文都用產品本身嘅函式計，同經 API 寫入嘅一樣。
 *
 * 形狀（設計 §11.5）：每個 Supplier 5 個地址、10 個聯絡人、2 個識別號、2 個 Bank 戶口；`--heavy-percent` 嘅
 * Supplier 用 NFR-003 嘅上限（20 地址、50 聯絡人、10 Bank）。名稱七成英文、三成中文，用常見字同後綴組合，
 * 令 name gram 嘅分佈似真實資料（「Trading」「有限公司」呢類熱門 gram 好多 Supplier 共用）。
 *
 * Supplier–SKU 關係（設計 §11.5「其中 20% 有 SKU relations」；NFR-005；TASK-050 for-SKU 部分）：
 * - 有關係嘅都係 id 為 5 嘅倍數嗰 20% Supplier（REV-089 L-1：之前用咗兩組，變咗 40%）；
 * - `PERF-SKU-HOT`：嗰 20% 每個都有一條（20,000 條，最差情況），`PERF-SKU-COLD`：冇關係；
 * - 1,000 隻 `PERF-SKU-0001…`：嗰 20% 每個再關聯 5 隻，每隻平均約 100 條；
 * - 關係狀態 preferred 10%、stopped 5%、其餘 alternative，約 2/3 有最近供貨時間；熱門 SKU 嘅 Supplier Item Code 係 `SIC-<id>`。
 */
import { randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createApplication } from "../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../src/framework/configuration/applicationConfiguration.js";
import { SupplierBankCrypto } from "../src/modules/supplier/SupplierBankCrypto.js";
import { hashNameBigrams } from "../src/modules/supplier/supplierDuplicateCandidates.js";
import { normalizeIdentifier, normalizeSupplierCode, normalizeSupplierName } from "../src/modules/supplier/supplierNormalization.js";

const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const SUPPLIERS = Number(arg("suppliers", 100_000));
const HEAVY_PERCENT = Number(arg("heavy-percent", 1));
if (!Number.isSafeInteger(SUPPLIERS) || SUPPLIERS < 1 || SUPPLIERS > 200_000 || !(HEAVY_PERCENT >= 0 && HEAVY_PERCENT <= 100)) {
  throw new Error("usage: node scripts/seedSupplierPerformanceFixtures.js --database=<DB_NAME> [--suppliers=1..200000] [--heavy-percent=0..100]");
}
const missing = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"]
  .filter((key) => (key === "DB_PASSWORD" ? process.env[key] === undefined : !process.env[key]));
if (missing.length > 0) throw new Error(`set ${missing.join(", ")} explicitly to a throwaway database`);
if (arg("database", null) !== process.env.DB_NAME) {
  throw new Error(`--database must repeat DB_NAME (${process.env.DB_NAME}) to confirm it is a throwaway database`);
}

const EN_A = ["Golden", "Pacific", "Harbour", "Dragon", "Oriental", "Victoria", "Kowloon", "Silver", "Eastern", "Global", "Union", "Prime",
  "Sunrise", "Lucky", "Grand", "Royal", "Asia", "Pearl", "Jade", "Ocean", "Summit", "Star", "Wing", "Kwong", "Hing", "Fook", "Tai", "Shun",
  "Wah", "Lee", "Chan", "Wong", "Cheung", "Lam", "Ho", "Ng", "Yip", "Tsang", "Leung", "Kam"];
const EN_B = ["Trading", "Industrial", "Electronics", "Textile", "Food", "Packaging", "Logistics", "Hardware", "Plastics", "Chemical",
  "Garment", "Paper", "Metal", "Machinery", "Printing", "Optical", "Toys", "Furniture", "Lighting", "Medical", "Supplies", "Import & Export",
  "Engineering", "Technology", "Materials"];
const EN_SUFFIX = ["Co., Ltd.", "Limited", "Company Limited", "Holdings Limited", "Enterprises Ltd.", "(HK) Limited", "International Ltd.", "Group Ltd."];
const ZH_A = ["華", "興", "昌", "利", "泰", "豐", "隆", "信", "寶", "富", "金", "永", "恒", "德", "盛", "安", "華南", "東方", "大中華", "環球",
  "新世紀", "嘉", "億", "達", "聯"];
const ZH_B = ["貿易", "實業", "電子", "紡織", "食品", "包裝", "物流", "五金", "塑膠", "化工", "製衣", "紙品", "機械", "印刷", "科技", "建材"];
const ZH_SUFFIX = ["有限公司", "(香港)有限公司", "集團有限公司", "國際有限公司", "企業有限公司"];
const pick = (list) => list[randomInt(list.length)];
const STATUS_MIX = [["active", 80], ["draft", 8], ["pending_approval", 2], ["suspended", 4], ["blocked", 3], ["archived", 3]];
const CURRENCY_MIX = [["HKD", 60], ["USD", 25], ["CNY", 10], ["EUR", 5]];
const weighted = (mix) => {
  let roll = randomInt(100);
  for (const [value, weight] of mix) { if (roll < weight) return value; roll -= weight; }
  return mix[0][0];
};
const supplierName = () => (randomInt(10) < 7
  ? `${pick(EN_A)} ${pick(EN_A)} ${pick(EN_B)} ${pick(EN_SUFFIX)}`
  : `${pick(ZH_A)}${pick(ZH_A)}${pick(ZH_B)}${pick(ZH_SUFFIX)}`);

async function insert(connection, table, columns, rows) {
  for (let start = 0; start < rows.length; start += 2_000) {
    const chunk = rows.slice(start, start + 2_000);
    const row = `(${columns.map(() => "?").join(", ")})`;
    await connection.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${chunk.map(() => row).join(", ")}`, chunk.flat());
  }
}

// Log 寫入臨時目錄，唔留低 server/logs。
const work = fs.mkdtempSync(path.join(os.tmpdir(), "supplier-seed-"));
const source = defaultConfigurationSource();
const application = await createApplication({ configurationSource: { ...source, logging: { loggers: {
  request: { ...source.logging.loggers.request, directory: path.join(work, "requests") },
  system: { ...source.logging.loggers.system, directory: path.join(work, "system") } } } } });
const db = application.services.require("mysqldatabase");
try {
  const [[{ existing }]] = await db.query("SELECT COUNT(*) AS existing FROM suppliers");
  if (Number(existing) > 0) throw new Error(`refusing to seed: ${process.env.DB_NAME} already has ${existing} Supplier(s); use a freshly migrated database`);
  const supplierConfig = application.services.config.supplier;
  const crypto = new SupplierBankCrypto({ encryption: supplierConfig.bankEncryption, lookup: supplierConfig.bankLookup });
  const now = Date.now();

  // Business Master：測試用嘅幣別同付款條款（只喺呢個用完即棄嘅資料庫）。
  for (const [code, name] of [["USD", "US Dollar"], ["CNY", "Renminbi"], ["EUR", "Euro"]]) {
    await db.query(`INSERT IGNORE INTO currencies (code, name, decimal_places, status, version, created_at, updated_at)
      VALUES (?, ?, 2, 'ACTIVE', 1, ?, ?)`, [code, name, now, now]);
  }
  for (const [code, type, days] of [["PERF-COD", "IMMEDIATE", null], ["PERF-NET30", "NET_DAYS", 30], ["PERF-NET60", "NET_DAYS", 60]]) {
    await db.query(`INSERT IGNORE INTO payment_terms (code, code_key, name, calculation_type, due_days, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?)`, [code, code.toLowerCase(), code, type, days, now, now]);
  }
  const [terms] = await db.query("SELECT id FROM payment_terms WHERE status = 'ACTIVE'");
  const termIds = terms.map((row) => Number(row.id));

  const started = Date.now();
  const ids = { address: 0, contact: 0, identifier: 0, bank: 0 };
  const totals = { suppliers: 0, heavy: 0, addresses: 0, contacts: 0, identifiers: 0, bankAccounts: 0, nameGrams: 0 };
  for (let first = 1; first <= SUPPLIERS; first += 500) {
    const batch = { suppliers: [], grams: [], addresses: [], addressPurposes: [], contacts: [], contactPurposes: [], identifiers: [], banks: [] };
    for (let id = first; id < Math.min(first + 500, SUPPLIERS + 1); id += 1) {
      const heavy = randomInt(10_000) < HEAVY_PERCENT * 100;
      const code = normalizeSupplierCode(`P50-${String(id).padStart(6, "0")}`);
      const name = normalizeSupplierName(supplierName());
      const updatedAt = now - randomInt(3 * 365 * 86_400_000);
      batch.suppliers.push([id, code.value, code.key, name.value, name.key, "", weighted(CURRENCY_MIX),
        randomInt(5) === 0 ? null : pick(termIds), `+852 2${String(randomInt(10_000_000)).padStart(7, "0")}`,
        `ap${id}@supplier${id}.example.com`, weighted(STATUS_MIX), updatedAt - 86_400_000, updatedAt]);
      for (const hash of hashNameBigrams(name.key)) batch.grams.push([id, hash]);

      const addressCount = heavy ? 20 : 5;
      const contactCount = heavy ? 50 : 10;
      const bankCount = heavy ? 10 : 2;
      for (let n = 0; n < addressCount; n += 1) {
        ids.address += 1;
        batch.addresses.push([ids.address, id, n === 0 ? "Registered office" : `Site ${n}`, `${randomInt(1, 999)} Perf Road`, "Hong Kong", "HK", now, now]);
        // 頭兩個地址做 registered／office 嘅 primary，其餘一個非 primary 用途。
        const purpose = n === 0 ? "registered" : n === 1 ? "office" : pick(["ordering", "return", "remittance", "other"]);
        batch.addressPurposes.push([ids.address, id, purpose, n < 2 ? 1 : 0, now, now]);
      }
      for (let n = 0; n < contactCount; n += 1) {
        ids.contact += 1;
        batch.contacts.push([ids.contact, id, `Contact ${id}-${n}`, `c${n}.s${id}@example.com`, now, now]);
        const purpose = n === 0 ? "general" : n === 1 ? "orders" : pick(["sales", "accounts_payable", "returns", "emergency"]);
        batch.contactPurposes.push([ids.contact, id, purpose, n < 2 ? 1 : 0, now, now]);
      }
      for (const [type, country, value] of [["business_registration", "HK", `BR${id}`], ["tax", "CN", `TX-${id}`]]) {
        ids.identifier += 1;
        const identifier = normalizeIdentifier({ type, issuerCountryCode: country, value });
        batch.identifiers.push([ids.identifier, id, identifier.type, identifier.issuerCountryCode, identifier.value, identifier.key, now, now]);
      }
      for (let n = 0; n < bankCount; n += 1) {
        ids.bank += 1;
        const cryptoContext = crypto.newCryptoContext();
        const accountNumber = `${String(id).padStart(6, "0")}${String(n).padStart(2, "0")}${randomInt(1_000, 9_999)}`;
        const sealed = crypto.encryptAccountNumber({ supplierId: id, cryptoContext, accountNumber });
        const { index, keyId } = crypto.blindIndex(accountNumber);
        batch.banks.push([ids.bank, id, cryptoContext, `Holder ${id}`, "Perf Bank", "HK", "HKD", sealed.ciphertext, sealed.iv, sealed.authTag,
          sealed.encryptionKeyId, index, keyId, sealed.lastFour, sealed.accountLength, n === 0 ? 1 : 0, now, now]);
      }
      totals.suppliers += 1;
      totals.heavy += heavy ? 1 : 0;
    }
    await db.withTransaction(async (connection) => {
      await insert(connection, "suppliers", ["id", "supplier_code", "supplier_code_key", "supplier_name", "supplier_name_key", "display_name",
        "default_currency_code", "default_payment_term_id", "general_phone", "general_email", "status", "created_at", "updated_at"], batch.suppliers);
      await insert(connection, "supplier_name_grams", ["supplier_id", "gram_hash"], batch.grams);
      await insert(connection, "supplier_addresses", ["id", "supplier_id", "label", "address_line1", "city", "country_code", "created_at", "updated_at"],
        batch.addresses);
      await insert(connection, "supplier_address_purposes", ["address_id", "supplier_id", "purpose_code", "is_primary", "created_at", "updated_at"],
        batch.addressPurposes);
      await insert(connection, "supplier_contacts", ["id", "supplier_id", "name", "email", "created_at", "updated_at"], batch.contacts);
      await insert(connection, "supplier_contact_purposes", ["contact_id", "supplier_id", "purpose_code", "is_primary", "created_at", "updated_at"],
        batch.contactPurposes);
      await insert(connection, "supplier_identifiers", ["id", "supplier_id", "identifier_type", "issuer_country_code", "identifier_value",
        "identifier_value_key", "created_at", "updated_at"], batch.identifiers);
      await insert(connection, "supplier_bank_accounts", ["id", "supplier_id", "crypto_context", "account_holder_name", "bank_name",
        "bank_country_code", "account_currency_code", "account_ciphertext", "account_iv", "account_auth_tag", "encryption_key_id",
        "account_blind_index", "blind_index_key_id", "last_four", "account_length", "is_default", "created_at", "updated_at"], batch.banks);
    });
    totals.addresses += batch.addresses.length;
    totals.contacts += batch.contacts.length;
    totals.identifiers += batch.identifiers.length;
    totals.bankAccounts += batch.banks.length;
    totals.nameGrams += batch.grams.length;
    if (first % 10_000 === 1) process.stderr.write(`${totals.suppliers} suppliers, ${Math.round((Date.now() - started) / 1000)} s\n`);
  }
  // Supplier–SKU 關係：Item 資料都係直接用 SQL 寫（呢個資料庫用完即棄），一個 Item、一個 EA 單位。
  const [item] = await db.query("INSERT INTO items (name, status, created_at, updated_at) VALUES ('PERF-T50 Item', 'active', ?, ?)", [now, now]);
  const [uom] = await db.query("INSERT INTO item_uoms (code, name, status, created_at, updated_at) VALUES ('PERF-EA', 'Each', 'active', ?, ?)", [now, now]);
  const skuCodes = ["PERF-SKU-HOT", "PERF-SKU-COLD", ...Array.from({ length: 1_000 }, (_, index) => `PERF-SKU-${String(index + 1).padStart(4, "0")}`)];
  await insert(db, "item_skus", ["item_id", "sku_code", "sku_name", "status", "purchasable", "created_at", "updated_at"],
    skuCodes.map((code) => [item.insertId, code, code, "active", 1, now, now]));
  const [skus] = await db.query("SELECT id, sku_code FROM item_skus WHERE item_id = ? ORDER BY id", [item.insertId]);
  await insert(db, "item_sku_uoms", ["sku_id", "uom_id", "to_base_factor", "is_base", "is_default_purchase", "created_at", "updated_at"],
    skus.map((sku) => [sku.id, uom.insertId, 1, 1, 1, now, now]));
  const skuId = Object.fromEntries(skus.map((sku) => [sku.sku_code, Number(sku.id)]));
  const spread = skus.filter((sku) => /^PERF-SKU-\d{4}$/u.test(sku.sku_code)).map((sku) => Number(sku.id));
  const relationStatus = () => { const roll = randomInt(100); return roll < 10 ? "preferred" : roll < 15 ? "stopped" : "alternative"; };
  const lastSupplied = () => (randomInt(3) === 0 ? null : now - randomInt(365 * 86_400_000));
  const relations = [];
  for (let id = 1; id <= SUPPLIERS; id += 1) {
    if (id % 5 !== 0) continue;
    relations.push([id, skuId["PERF-SKU-HOT"], `SIC-${id}`, `sic-${id}`, relationStatus(), lastSupplied(), now, now]);
    const chosen = new Set();
    while (chosen.size < 5) chosen.add(pick(spread));
    for (const sku of chosen) relations.push([id, sku, "", null, relationStatus(), lastSupplied(), now, now]);
  }
  await insert(db, "supplier_sku_refs", ["supplier_id", "sku_id", "supplier_item_code", "supplier_item_code_key", "relationship_status",
    "last_supplied_at", "created_at", "updated_at"], relations);
  totals.skuRelations = relations.length;
  await db.query(`ANALYZE TABLE suppliers, supplier_name_grams, supplier_addresses, supplier_contacts, supplier_identifiers, supplier_bank_accounts,
    item_skus, supplier_sku_refs`);
  console.log(JSON.stringify({ database: process.env.DB_NAME, ...totals, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
} finally {
  await application.shutdown("seed");
  fs.rmSync(work, { recursive: true, force: true });
}
