import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { CustomerLookupService } from "../../src/modules/customer/CustomerLookupService.js";
import { CustomerService } from "../../src/modules/customer/CustomerService.js";
import { normalizeIdentifierValue } from "../../src/modules/customer/customerNormalization.js";

const skip = process.env.CUSTOMER_PERFORMANCE_TESTS === "1"
  ? false
  : "set CUSTOMER_PERFORMANCE_TESTS=1 against a fresh, migrated isolated MySQL schema; this 50k release-performance test is not routine CI";
const CUSTOMER_COUNT = Number(process.env.CUSTOMER_PERFORMANCE_CUSTOMER_COUNT || 50_000);
const CHILD_INTERVAL = Number(process.env.CUSTOMER_PERFORMANCE_CHILD_INTERVAL || 10);
const BATCH_SIZE = Number(process.env.CUSTOMER_PERFORMANCE_BATCH_SIZE || 500);
const CONCURRENCY = Number(process.env.CUSTOMER_PERFORMANCE_CONCURRENCY || 20);
const DURATION_MS = Number(process.env.CUSTOMER_PERFORMANCE_DURATION_MS || 30_000);
const P95_BUDGET_MS = 5_000;
const TEST_TIMEOUT_MS = 30 * 60 * 1_000;
const withinLatencyBudget = (latencyMs) => latencyMs <= P95_BUDGET_MS;

test("Customer capacity latency budget includes exactly 5000ms and rejects anything above", () => {
  assert.equal(withinLatencyBudget(4999.99), true);
  assert.equal(withinLatencyBudget(5000), true);
  assert.equal(withinLatencyBudget(5000.01), false);
});

for (const [name, override, expected] of [
  ["smaller dataset", { CUSTOMER_PERFORMANCE_CUSTOMER_COUNT: "49999" }, /approved 50k dataset/u],
  ["fewer workers", { CUSTOMER_PERFORMANCE_CONCURRENCY: "19" }, /20 concurrent workers/u],
  ["different child ratio", { CUSTOMER_PERFORMANCE_CHILD_INTERVAL: "9" }, /5k address\/contact fixtures/u],
  ["shorter duration", { CUSTOMER_PERFORMANCE_DURATION_MS: "29999" }, /30-second admission window/u]
]) {
  test(`Customer capacity profile rejects ${name} before connecting`, () => {
    const env = { ...process.env, CUSTOMER_PERFORMANCE_TESTS: "1",
      CUSTOMER_PERFORMANCE_CUSTOMER_COUNT: "50000", CUSTOMER_PERFORMANCE_CONCURRENCY: "20",
      CUSTOMER_PERFORMANCE_CHILD_INTERVAL: "10", CUSTOMER_PERFORMANCE_DURATION_MS: "30000", ...override };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", "--test-name-pattern=^TC-028", import.meta.filename], {
      env, encoding: "utf8", timeout: 10_000
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, expected);
    assert.doesNotMatch(result.stdout + result.stderr, /ECONNREFUSED|Access denied/u);
  });
}

function placeholders(rowCount, columnCount) {
  return Array(rowCount).fill(`(${Array(columnCount).fill("?").join(",")})`).join(",");
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

async function timeIt(work) {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

async function seedCustomerPerformanceFixtures(database) {
  const marker = randomUUID().slice(0, 8);
  const nowMs = Date.now();
  const childCustomerIds = [];
  let sampleActiveCustomerId = null;
  let sampleActiveCustomerCode = null;

  for (let start = 0; start < CUSTOMER_COUNT; start += BATCH_SIZE) {
    const count = Math.min(BATCH_SIZE, CUSTOMER_COUNT - start);
    const values = [];
    for (let offset = 0; offset < count; offset += 1) {
      const index = start + offset;
      const sequence = String(index).padStart(5, "0");
      const code = `PERF-CUS-${marker}-${sequence}`;
      const legalName = `Performance Customer ${marker} ${sequence}`;
      const status = index % 10 === 0 ? "draft" : "active";
      values.push(code, code.toLowerCase(), legalName, legalName.toLowerCase(), status, 1, nowMs, nowMs);
    }
    const [inserted] = await database.query(
      `INSERT INTO customers
         (customer_code, customer_code_key, legal_name, legal_name_key, status, version, created_at, updated_at)
       VALUES ${placeholders(count, 8)}`,
      values
    );
    const firstCustomerId = Number(inserted.insertId);
    for (let offset = 0; offset < count; offset += 1) {
      const index = start + offset;
      const customerId = firstCustomerId + offset;
      if (index === 1) {
        sampleActiveCustomerId = customerId;
        sampleActiveCustomerCode = `PERF-CUS-${marker}-${String(index).padStart(5, "0")}`;
      }
      if (index % CHILD_INTERVAL === 1) childCustomerIds.push(customerId);
    }
  }

  for (let start = 0; start < childCustomerIds.length; start += BATCH_SIZE) {
    const customerIds = childCustomerIds.slice(start, start + BATCH_SIZE);
    const addressValues = [];
    const contactValues = [];
    for (const customerId of customerIds) {
      addressValues.push(customerId, "Performance shipping", "1 Test Road", "HK", nowMs, nowMs);
      contactValues.push(customerId, "Performance Contact", `customer-${customerId}@example.test`, nowMs, nowMs);
    }
    const [addresses] = await database.query(
      `INSERT INTO customer_addresses
         (customer_id, label, address_line1, country_code, created_at, updated_at)
       VALUES ${placeholders(customerIds.length, 6)}`,
      addressValues
    );
    const [contacts] = await database.query(
      `INSERT INTO customer_contacts
         (customer_id, name, email, created_at, updated_at)
       VALUES ${placeholders(customerIds.length, 5)}`,
      contactValues
    );
    const addressPurposeValues = [];
    const contactPurposeValues = [];
    for (let offset = 0; offset < customerIds.length; offset += 1) {
      addressPurposeValues.push(Number(addresses.insertId) + offset, customerIds[offset], "shipping", nowMs, nowMs);
      contactPurposeValues.push(Number(contacts.insertId) + offset, customerIds[offset], "shipping", nowMs, nowMs);
    }
    await database.query(
      `INSERT INTO customer_address_purposes
         (address_id, customer_id, purpose_code, is_default, created_at, updated_at)
       VALUES ${placeholders(customerIds.length, 5).replaceAll("(?,?,?,?,?)", "(?,?,?,1,?,?)")}`,
      addressPurposeValues
    );
    await database.query(
      `INSERT INTO customer_contact_purposes
         (contact_id, customer_id, purpose_code, is_default, created_at, updated_at)
       VALUES ${placeholders(customerIds.length, 5).replaceAll("(?,?,?,?,?)", "(?,?,?,1,?,?)")}`,
      contactPurposeValues
    );
  }

  return {
    marker,
    customerCount: CUSTOMER_COUNT,
    childCount: childCustomerIds.length,
    sampleActiveCustomerId,
    sampleActiveCustomerCode,
    codePrefix: `perf-cus-${marker}-000`,
    legalNamePrefix: `performance customer ${marker} 000`
  };
}

function queryPlanFailures(rows, label) {
  if (rows.length === 0) return [`${label} returned no EXPLAIN rows`];
  return rows.flatMap((row) => {
    // HD-011: scanning materialized candidate IDs is not scanning a physical table.
    if (/^<(?:derived[1-9]\d*|union[1-9]\d*(?:,[1-9]\d*)+)>$/u.test(row.table)) return [];
    if (typeof row.table !== "string" || !row.table || row.table.startsWith("<")) return [`${label} unknown EXPLAIN table ${row.table}`];
    if (typeof row.type !== "string") return [`${label} missing access type for ${row.table}`];
    return row.type === "ALL" ? [`${label} full-scanned ${row.table}`] : [];
  });
}

function selectivePrefixFailures(row, expectedKeys, label) {
  return row?.type === "range" && expectedKeys.includes(row.key)
    ? [] : [`${label} positive prefix must range over ${expectedKeys.join(" or ")}`];
}

test("Customer prefix proof rejects a wrong range index, a full index scan and absent plans", () => {
  const keys = ["idx_customers_search_phone"];
  assert.deepEqual(selectivePrefixFailures({ type: "range", key: keys[0] }, keys, "phone"), []);
  for (const row of [{ type: "range", key: "PRIMARY" }, { type: "index", key: keys[0] }, { type: "ALL", key: null }, undefined]) {
    assert.equal(selectivePrefixFailures(row, keys, "phone").length, 1);
  }
});

async function assertIndexedPlan(database, label, sql, params) {
  const [rows] = await database.query(`EXPLAIN FORMAT=TRADITIONAL ${sql}`, params);
  assert.deepEqual(queryPlanFailures(rows, label), [], `${label} must keep every physical table indexed`);
  return rows;
}

test("Customer plans allow only exact materialized result forms alongside indexed physical rows", async () => {
  const rows = [
    { table: "<derived2>", type: "ALL" },
    { table: "<union2,3>", type: null },
    { table: "customers", type: "eq_ref" },
    { table: "cc", type: "range" }
  ];
  assert.deepEqual(await assertIndexedPlan({ query: async () => [rows] }, "candidate", "SELECT", []), rows);
});

for (const table of ["customers", "ci", "cc", "ca"]) {
  test(`Customer plans reject physical ${table} scans even beside materialized results`, async () => {
    await assert.rejects(() => assertIndexedPlan({ query: async () => [[
      { table: "<derived2>", type: "ALL" }, { table, type: "ALL" }
    ]] }, "candidate", "SELECT", []), new RegExp(`full-scanned ${table}`));
    await assert.rejects(() => assertIndexedPlan({ query: async () => [[{ table, type: null }]] }, "candidate", "SELECT", []), /access type/);
  });
}

for (const table of ["<derived2oops>", "<union2,3oops>", "<subquery2>", null]) {
  test(`Customer plans reject unknown or malformed pseudo table ${table}`, async () => {
    await assert.rejects(() => assertIndexedPlan({ query: async () => [[{ table, type: "ref" }]] }, "candidate", "SELECT", []), /unknown/);
  });
}

test(
  "TC-028 50k Customer query plans and 20-worker core lookup mix remain indexed and bounded",
  { skip, timeout: TEST_TIMEOUT_MS },
  async (t) => {
    assert.equal(CUSTOMER_COUNT, 50_000, "capacity evidence requires the approved 50k dataset");
    assert.equal(CONCURRENCY, 20, "capacity evidence requires 20 concurrent workers");
    assert.equal(CHILD_INTERVAL, 10, "capacity evidence requires 5k address/contact fixtures");
    assert.equal(DURATION_MS, 30_000, "capacity evidence requires a 30-second admission window");
    const source = defaultConfigurationSource();
    const application = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
    const database = application.services.require("mysqldatabase");
    let fixtures = null;

    t.after(async () => {
      if (fixtures) {
        await database.execute("DELETE FROM customers WHERE customer_code_key LIKE ?", [`perf-cus-${fixtures.marker}-%`]);
        const [[remaining]] = await database.query("SELECT COUNT(*) AS total FROM customers WHERE customer_code_key LIKE ?", [`perf-cus-${fixtures.marker}-%`]);
        assert.equal(Number(remaining.total), 0, "Customer performance fixtures must be fully removed");
      }
      await application.shutdown("customer_phase001_performance_complete");
    });
    fixtures = await seedCustomerPerformanceFixtures(database);
    await database.query("ANALYZE TABLE customers, customer_addresses, customer_contacts, customer_address_purposes, customer_contact_purposes, customer_identifiers");

    const plans = {
      exactCode: await assertIndexedPlan(
        database,
        "exact Customer code",
        "SELECT id FROM customers WHERE customer_code_key = ?",
        [fixtures.sampleActiveCustomerCode.toLowerCase()]
      ),
      codePrefix: await assertIndexedPlan(
        database,
        "Customer code prefix",
        "SELECT id FROM customers WHERE customer_code_key LIKE ? ORDER BY customer_code_key ASC, id ASC LIMIT 20",
        [`${fixtures.codePrefix}%`]
      ),
      legalNamePrefix: await assertIndexedPlan(
        database,
        "Customer legal-name prefix",
        "SELECT id FROM customers WHERE legal_name_key LIKE ? ORDER BY legal_name_key ASC, id ASC LIMIT 20",
        [`${fixtures.legalNamePrefix}%`]
      ),
      shippingExists: await assertIndexedPlan(
        database,
        "Customer shipping EXISTS",
        `SELECT c.id FROM customers c
          WHERE c.id = ? AND EXISTS (
            SELECT 1 FROM customer_addresses a
              JOIN customer_address_purposes p ON p.address_id = a.id AND p.customer_id = a.customer_id
             WHERE a.customer_id = c.id AND a.status = 'active' AND p.purpose_code = 'shipping'
          )`,
        [fixtures.sampleActiveCustomerId]
      )
    };

    const actor = { actorId: 1, claimedRoles: [], claimedPermissions: [] };
    const customerService = new CustomerService({
      database,
      time: { nowMs: () => Date.now() },
      actorVerifier: async () => ({ username: "customer-performance" })
    });
    const lookupService = new CustomerLookupService({ database });
    const actualListQueries = [];
    const warmListMs = await timeIt(() => customerService.list({ ...actor, q: fixtures.codePrefix, sortBy: "code", descending: false, page: 1, pageSize: 20 }, {
      async query(sql, params) { actualListQueries.push({ sql, params }); return database.query(sql, params); }
    }));
    plans.actualList = [];
    for (const { sql, params } of actualListQueries) {
      assert.doesNotMatch(sql, /\b(?:FORCE|USE|IGNORE)\s+(?:INDEX|KEY)\b|\/\*\+/iu, "actual Customer queries must not force a plan");
      plans.actualList.push((await database.query(`EXPLAIN FORMAT=TRADITIONAL ${sql}`, params))[0]);
    }
    await lookupService.findByCode(fixtures.sampleActiveCustomerCode, { purpose: "new_sale" });
    await lookupService.listAddresses(fixtures.sampleActiveCustomerId, { purpose: "shipping" });
    await lookupService.listContacts(fixtures.sampleActiveCustomerId, { purpose: "shipping" });

    const timings = { list: [], exactLookup: [], addressLookup: [], contactLookup: [] };
    const [statusBefore] = await database.query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Innodb_row_lock_waits','Innodb_row_lock_current_waits','Threads_connected')");
    const cpuBefore = process.cpuUsage();
    let heapPeakBytes = process.memoryUsage().heapUsed;
    const sampleHeap = setInterval(() => { heapPeakBytes = Math.max(heapPeakBytes, process.memoryUsage().heapUsed); }, 25);
    t.after(() => clearInterval(sampleHeap));
    const loadStarted = performance.now();
    const deadline = loadStarted + DURATION_MS;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (performance.now() < deadline) {
        timings.list.push(await timeIt(async () => {
          const page = await customerService.list({ ...actor, q: fixtures.codePrefix, sortBy: "code", descending: false, page: 1, pageSize: 20 });
          assert.equal(page.items.length, 20);
        }));
        timings.exactLookup.push(await timeIt(async () => {
          assert.equal((await lookupService.findByCode(fixtures.sampleActiveCustomerCode, { purpose: "new_sale" })).customerId, fixtures.sampleActiveCustomerId);
        }));
        timings.addressLookup.push(await timeIt(async () => {
          assert.equal((await lookupService.listAddresses(fixtures.sampleActiveCustomerId, { purpose: "shipping" })).length, 1);
        }));
        timings.contactLookup.push(await timeIt(async () => {
          assert.equal((await lookupService.listContacts(fixtures.sampleActiveCustomerId, { purpose: "shipping" })).length, 1);
        }));
      }
    }));
    const elapsedMs = performance.now() - loadStarted;
    clearInterval(sampleHeap);
    const [statusAfter] = await database.query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Innodb_row_lock_waits','Innodb_row_lock_current_waits','Threads_connected')");
    const [[remaining]] = await database.query("SELECT COUNT(*) AS total FROM customers WHERE customer_code_key LIKE ?", [`perf-cus-${fixtures.marker}-%`]);
    assert.equal(Number(remaining.total), CUSTOMER_COUNT);
    const latencyMs = Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, {
      count: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99)
    }]));
    const [[mysql]] = await database.query("SELECT VERSION() AS version");
    const gateFailures = [];
    for (const [name, metric] of Object.entries(latencyMs)) {
      if (!withinLatencyBudget(metric.p95)) gateFailures.push(`${name} p95 ${metric.p95.toFixed(1)}ms exceeds ${P95_BUDGET_MS}ms`);
    }
    for (const plan of plans.actualList) gateFailures.push(...queryPlanFailures(plan, "actual list"));
    console.log(JSON.stringify({
      tc: "TC-028",
      fixtureVersion: "customer-hd011-indexed-search-50k-20-v3",
      data: { customers: fixtures.customerCount, addresses: fixtures.childCount, contacts: fixtures.childCount },
      load: { concurrency: CONCURRENCY, warmListMs, p95BudgetMs: P95_BUDGET_MS,
        requestedDurationMs: DURATION_MS, elapsedMs, errors: 0,
        operationsPerSecond: Object.values(timings).reduce((sum, values) => sum + values.length, 0) * 1000 / elapsedMs },
      environment: { node: process.version, mysql: mysql.version, logicalCpu: os.cpus().length, memoryBytes: os.totalmem() },
      resources: { heapPeakBytes, rssBytes: process.memoryUsage().rss, cpuMicroseconds: process.cpuUsage(cpuBefore),
        mysqlBefore: Object.fromEntries(statusBefore.map((row) => [row.Variable_name, Number(row.Value)])),
        mysqlAfter: Object.fromEntries(statusAfter.map((row) => [row.Variable_name, Number(row.Value)])) },
      latencyMs,
      plans,
      gateFailures
    }));
    assert.deepEqual(gateFailures, [], "Customer latency and query-plan gates must all pass");

    const [storage] = await database.query(
      "SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('customers','customer_contacts','customer_addresses','customer_identifiers') ORDER BY TABLE_NAME"
    );
    console.log(JSON.stringify({ tc: "TC-028-storage", phase: "POST_LOAD_NOT_LATENCY_MEASUREMENT", storage }));

    await t.test("every selective search field uses its actual candidate range after the measured load", async () => {
      const probes = [
        ["code", fixtures.sampleActiveCustomerCode, "customers", ["uq_customers_code_key"]],
        ["legalName", `Performance Customer ${fixtures.marker} 00001`, "customers", ["uq_customers_legal_name_key", "idx_customers_legal_name"]],
        ...["trading", "phone", "email"].map((field) => [field, `probe-${fixtures.marker}-${field}`, "customers",
          [field === "trading" ? "idx_customers_trading_name" : `idx_customers_search_${field}`]]),
        ["identifier", `probe-${fixtures.marker}-identifier-${String(fixtures.sampleActiveCustomerId).padStart(8, "0")}`, "customer_identifiers", ["idx_customer_identifiers_search_value"]],
        ...["name", "email", "phone", "mobile"].map((field) => [`contact.${field}`, `probe-${fixtures.marker}-contact-${field}`, "customer_contacts",
          [field === "email" ? "idx_customer_contacts_email" : `idx_customer_contacts_search_${field}`]]),
        ...["label", "address_line1", "city", "postal_code"].map((field) => [`address.${field}`, `probe-${fixtures.marker}-address-${field}`, "customer_addresses", [`idx_customer_addresses_search_${field}`]])
      ];
      // Only this post-load phase changes probe fields; the measured fixture/mix is unchanged.
      await database.execute(
        "UPDATE customers SET trading_name = ?, trading_name_key = ?, general_phone = ?, general_email = ? WHERE id = ?",
        [probes[2][1], probes[2][1], probes[3][1], probes[4][1], fixtures.sampleActiveCustomerId]
      );
      await database.execute(
        `INSERT INTO customer_identifiers (customer_id,identifier_type,issuer_country_code,identifier_value,identifier_value_key,created_at,updated_at)
         SELECT id,'other','HK',CONCAT(?,LPAD(id,8,'0')),CONCAT(?,LPAD(id,8,'0')),?,?
           FROM customers WHERE customer_code_key LIKE ? ORDER BY id LIMIT 5000`,
        [`probe-${fixtures.marker}-identifier-`, normalizeIdentifierValue(`probe-${fixtures.marker}-identifier-`).key,
          Date.now(), Date.now(), `perf-cus-${fixtures.marker}-%`]
      );
      await database.execute(
        "INSERT INTO customer_credit_profiles (customer_id,credit_status,last_change_reason,created_at,updated_at) VALUES (?,'normal','synthetic plan probe',?,?)",
        [fixtures.sampleActiveCustomerId, Date.now(), Date.now()]
      );
      for (const [table, fields, offset] of [
        ["customer_contacts", ["name", "email", "phone", "mobile"], 6],
        ["customer_addresses", ["label", "address_line1", "city", "postal_code"], 10]
      ]) {
        await database.execute(`UPDATE ${table} SET ${fields.map((field) => `${field} = ?`).join(",")} WHERE customer_id = ?`,
          [...fields.map((_, index) => probes[offset + index][1]), fixtures.sampleActiveCustomerId]);
      }
      await database.query("ANALYZE TABLE customers, customer_contacts, customer_addresses, customer_identifiers, customer_credit_profiles");
      const failures = [];
      for (const [index, [field, q, table, expectedKeys]] of probes.entries()) {
        const queries = [];
        const page = await customerService.list({ ...actor, q, sortBy: "code", descending: false }, {
          async query(sql, params) { queries.push({ sql, params }); return database.query(sql, params); }
        });
        assert.equal(page.total, 1, field);
        assert.deepEqual(page.items.map((item) => item.id), [fixtures.sampleActiveCustomerId], field);
        const actual = [];
        for (const { sql, params } of queries) {
          assert.doesNotMatch(sql, /\b(?:FORCE|USE|IGNORE)\s+(?:INDEX|KEY)\b|\/\*\+/iu, field);
          const [rows] = await database.query(`EXPLAIN FORMAT=TRADITIONAL ${sql}`, params);
          actual.push(rows);
          failures.push(...queryPlanFailures(rows, field));
        }
        const positiveBranch = actual[0].find((row) => Number(row.id) === index + 2 && row.table === table);
        failures.push(...selectivePrefixFailures(positiveBranch, expectedKeys, field));
        console.log(JSON.stringify({ tc: "TC-028-search-branch", phase: "POST_LOAD_NOT_LATENCY_MEASUREMENT", field, expectedKeys, positiveBranch, actual }));
      }
      console.log(JSON.stringify({ tc: "TC-028-search-branches", phase: "POST_LOAD_NOT_LATENCY_MEASUREMENT", fields: probes.length,
        diagnosticData: { identifiers: 5000, creditProfiles: 1 }, failures }));
      assert.deepEqual(failures, [], "all actual search branches must remain indexed");
    });
  }
);
