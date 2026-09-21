import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { normalizeCustomerCode, normalizeLegalName } from "../../src/modules/customer/customerNormalization.js";

const skip =
  process.env.DB_INTEGRATION_TESTS === "1"
    ? false
    : "set DB_INTEGRATION_TESTS=1 against a real, migrated MySQL to run this suite (see README's CI section)";

async function startApplication() {
  const source = defaultConfigurationSource();
  return createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });
}

async function insertCustomer(db, { code, legalName }) {
  const nowMs = Date.now();
  const normalizedCode = normalizeCustomerCode(code);
  const normalizedLegalName = normalizeLegalName(legalName);
  return db.execute(
    `INSERT INTO customers (customer_code, customer_code_key, legal_name, legal_name_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      normalizedCode.value,
      normalizedCode.key,
      normalizedLegalName.value,
      normalizedLegalName.key,
      nowMs,
      nowMs
    ]
  );
}

function rejectsWithMysqlCode(promiseFactory, expectedCode) {
  return assert.rejects(promiseFactory, (error) => {
    assert.equal(error?.cause?.code ?? error?.code, expectedCode);
    return true;
  });
}

test("customers equality keys are binary-collated and preserve the application's canonical equality matrix", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const suffix = randomUUID().slice(0, 8);
  const insertedIds = [];
  t.after(async () => {
    if (insertedIds.length > 0) {
      await db.execute(`DELETE FROM customers WHERE id IN (${insertedIds.map(() => "?").join(", ")})`, insertedIds);
    }
    await application.shutdown("integration_test_complete");
  });

  const [columns] = await db.query(
    `SELECT column_name AS keyColumnName,
            character_set_name AS characterSetName,
            collation_name AS collationName
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'customers'
        AND column_name IN ('customer_code_key', 'legal_name_key')`
  );
  assert.deepEqual(
    columns.map((column) => [column.keyColumnName, column.characterSetName, column.collationName]).sort(),
    [
      ["customer_code_key", "utf8mb4", "utf8mb4_bin"],
      ["legal_name_key", "utf8mb4", "utf8mb4_bin"]
    ]
  );

  const [first] = await insertCustomer(db, {
    code: `CUS-${suffix}-Ａ`,
    legalName: `Café, Ltd. ${suffix}`
  });
  insertedIds.push(first.insertId);

  await rejectsWithMysqlCode(
    () => insertCustomer(db, { code: `cus-${suffix}-a`, legalName: `Another Legal Name ${suffix}` }),
    "ER_DUP_ENTRY"
  );
  await rejectsWithMysqlCode(
    () => insertCustomer(db, { code: `CUS-${suffix}-B`, legalName: `café, ltd. ${suffix}` }),
    "ER_DUP_ENTRY"
  );

  const [accentDistinct] = await insertCustomer(db, {
    code: `CUS-${suffix}-C`,
    legalName: `Cafe, Ltd. ${suffix}`
  });
  insertedIds.push(accentDistinct.insertId);
});

test("concurrent Customer inserts with the same canonical code have exactly one winner", { skip }, async (t) => {
  const application = await startApplication();
  const db = application.services.require("mysqldatabase");
  const suffix = randomUUID().slice(0, 8);
  const canonicalCode = `CUS-RACE-${suffix}`;
  let winnerId = null;
  t.after(async () => {
    if (winnerId) await db.execute("DELETE FROM customers WHERE id = ?", [winnerId]);
    await application.shutdown("integration_test_complete");
  });

  const results = await Promise.allSettled([
    insertCustomer(db, { code: canonicalCode, legalName: `Race One ${suffix}` }),
    insertCustomer(db, { code: canonicalCode.toLowerCase(), legalName: `Race Two ${suffix}` })
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason?.cause?.code ?? rejected[0].reason?.code, "ER_DUP_ENTRY");
  winnerId = fulfilled[0].value[0].insertId;

  const [[count]] = await db.query("SELECT COUNT(*) AS count FROM customers WHERE customer_code_key = ?", [
    normalizeCustomerCode(canonicalCode).key
  ]);
  assert.equal(Number(count.count), 1);
});
