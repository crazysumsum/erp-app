import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { CustomerLookupService } from "../../src/modules/customer/CustomerLookupService.js";
import { CustomerService } from "../../src/modules/customer/CustomerService.js";

const skip = process.env.CUSTOMER_PERFORMANCE_TESTS === "1"
  ? false
  : "set CUSTOMER_PERFORMANCE_TESTS=1 against a fresh, migrated isolated MySQL schema; this 100k release-performance test is not routine CI";
const CUSTOMER_COUNT = Number(process.env.CUSTOMER_PERFORMANCE_CUSTOMER_COUNT || 100_000);
const CHILD_INTERVAL = Number(process.env.CUSTOMER_PERFORMANCE_CHILD_INTERVAL || 10);
const BATCH_SIZE = Number(process.env.CUSTOMER_PERFORMANCE_BATCH_SIZE || 500);
const CONCURRENCY = Number(process.env.CUSTOMER_PERFORMANCE_CONCURRENCY || 50);
const OPS_PER_WORKER = Number(process.env.CUSTOMER_PERFORMANCE_OPS_PER_WORKER || 5);
const P95_BUDGET_MS = 2_000;
const TEST_TIMEOUT_MS = 30 * 60 * 1_000;

function placeholders(rowCount, columnCount) {
  return Array(rowCount).fill(`(${Array(columnCount).fill("?").join(",")})`).join(",");
}

function p95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
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

async function assertIndexedPlan(database, label, sql, params) {
  const [rows] = await database.query(`EXPLAIN ${sql}`, params);
  assert.ok(rows.length > 0, `${label} returned no EXPLAIN rows`);
  for (const row of rows) {
    assert.notEqual(row.type, "ALL", `${label} full-scanned ${row.table}: ${JSON.stringify(row)}`);
  }
  return rows;
}

test(
  "TC-028 100k Customer query plans and 50-user core lookup mix remain indexed and bounded",
  { skip, timeout: TEST_TIMEOUT_MS },
  async (t) => {
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
    await customerService.list({ ...actor, q: fixtures.codePrefix, sortBy: "code", descending: false, page: 1, pageSize: 20 });
    await lookupService.findByCode(fixtures.sampleActiveCustomerCode, { purpose: "new_sale" });
    await lookupService.listAddresses(fixtures.sampleActiveCustomerId, { purpose: "shipping" });
    await lookupService.listContacts(fixtures.sampleActiveCustomerId, { purpose: "shipping" });

    const timings = { list: [], exactLookup: [], addressLookup: [], contactLookup: [] };
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (let index = 0; index < OPS_PER_WORKER; index += 1) {
        timings.list.push(await timeIt(async () => {
          const page = await customerService.list({ ...actor, q: fixtures.codePrefix, sortBy: "code", descending: false, page: 1, pageSize: 20 });
          assert.equal(page.items.length, 20);
        }));
        timings.exactLookup.push(await timeIt(() => lookupService.findByCode(fixtures.sampleActiveCustomerCode, { purpose: "new_sale" })));
        timings.addressLookup.push(await timeIt(() => lookupService.listAddresses(fixtures.sampleActiveCustomerId, { purpose: "shipping" })));
        timings.contactLookup.push(await timeIt(() => lookupService.listContacts(fixtures.sampleActiveCustomerId, { purpose: "shipping" })));
      }
    }));

    const latencyMs = Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, { count: values.length, p95: p95(values) }]));
    for (const [name, metric] of Object.entries(latencyMs)) {
      assert.ok(metric.p95 < P95_BUDGET_MS, `${name} p95 ${metric.p95.toFixed(1)}ms exceeds ${P95_BUDGET_MS}ms`);
    }
    const [[mysql]] = await database.query("SELECT VERSION() AS version");
    console.log(JSON.stringify({
      tc: "TC-028",
      fixtureVersion: "customer-phase001-performance-v1",
      data: { customers: fixtures.customerCount, addresses: fixtures.childCount, contacts: fixtures.childCount },
      load: { concurrency: CONCURRENCY, operationsPerWorker: OPS_PER_WORKER },
      environment: { node: process.version, mysql: mysql.version, logicalCpu: os.cpus().length, memoryBytes: os.totalmem() },
      latencyMs,
      plans
    }));
  }
);
