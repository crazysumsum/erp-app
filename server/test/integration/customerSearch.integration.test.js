import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";

import { CustomerService } from "../../src/modules/customer/CustomerService.js";
import { normalizeCustomerCode, normalizeIdentifierValue, normalizeLegalName, normalizeTradingName } from "../../src/modules/customer/customerNormalization.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("DEF-034001 real MySQL Customer search preserves prefix, ranking, filter and pagination semantics", async (t) => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1", port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root", password: process.env.DB_PASSWORD || "", database: process.env.DB_NAME || "erp_dev"
  });
  const suffix = randomUUID().slice(0, 8);
  const marker = `search-${suffix}`;
  const now = Date.now();
  const customerIds = [];
  let paymentTermId = null;
  t.after(async () => {
    try {
      if (customerIds.length) await db.query(`DELETE FROM customers WHERE id IN (${customerIds.map(() => "?").join(",")})`, customerIds);
      if (paymentTermId) await db.execute("DELETE FROM payment_terms WHERE id = ?", [paymentTermId]);
    } finally { await db.end(); }
  });
  const service = new CustomerService({ database: db, time: { nowMs: () => now }, actorVerifier: async () => ({ username: marker }) });

  async function customer(overrides = {}) {
    const row = {
      customer_code: `${marker}-${customerIds.length}`, legal_name: `${marker} fixture ${customerIds.length}`,
      trading_name: "", created_at: now, updated_at: now, ...overrides
    };
    row.customer_code_key = normalizeCustomerCode(row.customer_code).key;
    row.legal_name_key = normalizeLegalName(row.legal_name).key;
    row.trading_name_key = normalizeTradingName(row.trading_name).key;
    const columns = Object.keys(row);
    const [result] = await db.execute(`INSERT INTO customers (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`, Object.values(row));
    const id = Number(result.insertId);
    customerIds.push(id);
    return id;
  }

  async function child(type, customerId, overrides = {}) {
    const row = {
      customer_id: customerId, created_at: now, updated_at: now,
      ...(type === "contacts" ? { name: "Unrelated contact" } : type === "addresses" ? { label: "Unrelated address", address_line1: "Unrelated street" } : { identifier_type: "other", issuer_country_code: "HK", identifier_value: `${marker}-${customerId}` }),
      ...overrides
    };
    if (type === "identifiers") row.identifier_value_key = normalizeIdentifierValue(row.identifier_value).key;
    const columns = Object.keys(row);
    const [result] = await db.execute(`INSERT INTO customer_${type} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`, Object.values(row));
    return Number(result.insertId);
  }

  async function expectIds(q, options, expected) {
    const result = await service.list({ q, pageSize: 100, ...options });
    assert.equal(result.total, expected.length, JSON.stringify({ q, options }));
    assert.deepEqual(result.items.map((item) => item.id).sort((a, b) => a - b), [...expected].sort((a, b) => a - b));
    return result;
  }

  await t.test("all fourteen fields match prefixes and only active children participate", async () => {
    const fields = [
      [null, "customer_code"], [null, "legal_name"], [null, "trading_name"], [null, "general_phone"], [null, "general_email"],
      ["identifiers", "identifier_value"],
      ...["name", "email", "phone", "mobile"].map((field) => ["contacts", field]),
      ...["label", "address_line1", "city", "postal_code"].map((field) => ["addresses", field])
    ];
    for (const [type, field] of fields) {
      const q = `${marker}-${type || "root"}-${field}`;
      const id = await customer(type ? {} : { [field]: `${q}-tail` });
      const nonPrefixId = await customer(type ? {} : { [field]: `x${q}` });
      if (type) {
        await child(type, id, { [field]: `${q}-tail` });
        await child(type, nonPrefixId, { [field]: `x${q}` });
        const inactiveId = await customer();
        await child(type, inactiveId, { [field]: `${q}-inactive`, status: "inactive" });
      }
      await expectIds(q, {}, [id]);
    }
  });

  await t.test("multiple matching fields and children count once, with exact code then legal name ranking", async () => {
    const q = `${marker}-rank`;
    const codeId = await customer({ customer_code: q, updated_at: now - 2 });
    const legalId = await customer({ legal_name: q, updated_at: now - 1 });
    const manyId = await customer({ legal_name: `${q} prefix`, trading_name: `${q} trading`, general_email: `${q}@test.invalid`, general_phone: q });
    for (const ending of ["one", "two"]) {
      await child("contacts", manyId, { name: `${q} ${ending}`, email: `${q}@${ending}.invalid`, phone: q, mobile: q });
      await child("addresses", manyId, { label: `${q} ${ending}`, address_line1: `${q} street`, city: q, postal_code: q });
      await child("identifiers", manyId, { identifier_value: `${q}-${ending}` });
    }
    const result = await expectIds(q, { sortBy: "updatedAt", sortDirection: "desc" }, [manyId, legalId, codeId]);
    assert.deepEqual(result.items.map((item) => item.id), [codeId, legalId, manyId]);
  });

  await t.test("outer status, archive, missing and credit filters apply to root and every child source", async () => {
    const q = `${marker}-filter`;
    const [term] = await db.execute(
      "INSERT INTO payment_terms (code,code_key,name,calculation_type,status,version,created_at,updated_at) VALUES (?,?,?,'days_from_invoice','ACTIVE',1,?,?)",
      [marker, marker, marker, now, now]
    );
    paymentTermId = Number(term.insertId);
    const fixtures = [];
    for (const source of ["root", "identifiers", "contacts", "addresses"]) {
      for (const status of ["draft", "active", "suspended", "blocked", "archived"]) {
        const id = await customer({ status, ...(source === "root" ? { legal_name: `${q} ${status}` } : {}), ...(status === "active" ? { default_payment_term_id: paymentTermId } : {}) });
        if (source !== "root") await child(source, id, { [source === "identifiers" ? "identifier_value" : source === "contacts" ? "name" : "label"]: `${q}-${source}-${status}` });
        fixtures.push({ id, status });
        if (["active", "suspended"].includes(status)) {
          await db.execute("INSERT INTO customer_credit_profiles (customer_id,credit_status,last_change_reason,created_at,updated_at) VALUES (?,?,?,?,?)", [id, status === "active" ? "normal" : "on_hold", marker, now, now]);
        }
        if (status === "active") {
          const addressId = await child("addresses", id);
          for (const purpose of ["shipping", "billing"]) await db.execute("INSERT INTO customer_address_purposes (address_id,customer_id,purpose_code,is_default,created_at,updated_at) VALUES (?,?,?,1,?,?)", [addressId, id, purpose, now, now]);
          const contactId = await child("contacts", id);
          await db.execute("INSERT INTO customer_contact_purposes (contact_id,customer_id,purpose_code,is_default,created_at,updated_at) VALUES (?,?,'general',1,?,?)", [contactId, id, now, now]);
        }
      }
    }
    const ids = (statuses) => fixtures.filter((row) => statuses.includes(row.status)).map((row) => row.id);
    await expectIds(q, {}, ids(["draft", "active", "suspended", "blocked"]));
    await expectIds(q, { includeArchived: true }, ids(["draft", "active", "suspended", "blocked", "archived"]));
    await expectIds(q, { status: "archived" }, ids(["archived"]));
    await expectIds(q, { status: ["active", "suspended"] }, ids(["active", "suspended"]));
    for (const missing of ["shippingDefault", "billingDefault", "contactDefault", "paymentTerm"]) await expectIds(q, { missing }, ids(["draft", "suspended", "blocked"]));
    await expectIds(q, { missing: "credit" }, ids(["draft", "blocked"]));
    await expectIds(q, { missing: ["credit", "contactDefault"], includeArchived: true }, ids(["draft", "blocked", "archived"]));
    await expectIds(q, { creditStatus: "normal" }, ids(["active"]));
    const held = await expectIds(q, { creditStatus: "on_hold", status: ["active", "suspended"] }, ids(["suspended"]));
    assert.ok(held.items.every((item) => item.creditStatus === "on_hold"));
    await expectIds(q, { creditStatus: "on_hold", missing: "credit" }, []);
  });

  await t.test("equal sort values have stable page boundaries and empty pages retain the total", async () => {
    const q = `${marker}-page`;
    const ids = [];
    for (let index = 0; index < 23; index += 1) ids.push(await customer({ legal_name: `${q} ${index}` }));
    const expected = [...ids].reverse();
    for (const sortDirection of ["asc", "desc"]) {
      const pages = [];
      for (const page of [1, 2, 3]) {
        const result = await service.list({ q, page, pageSize: 10, sortBy: "updatedAt", sortDirection });
        assert.equal(result.total, 23);
        assert.equal(result.page, page);
        assert.equal(result.pageSize, 10);
        assert.deepEqual(result.items.map((item) => item.id), expected.slice((page - 1) * 10, page * 10));
        pages.push(...result.items.map((item) => item.id));
      }
      assert.deepEqual(pages, expected);
    }
    assert.deepEqual(await service.list({ q, page: 4, pageSize: 10 }), { items: [], total: 23, page: 4, pageSize: 10 });
    assert.deepEqual(await service.list({ q: `${marker}-absent`, pageSize: 10 }), { items: [], total: 0, page: 1, pageSize: 10 });
  });

  await t.test("LIKE escape characters stay literal and NFKC normalization retains long name search", async () => {
    for (const character of ["!", "%", "_"]) {
      const q = `${marker}${character}literal`;
      const id = await customer({ legal_name: `${q} name`, trading_name: `${q} trading` });
      await customer({ legal_name: `${marker}xliteral decoy ${character}` });
      await child("contacts", id, { name: `${q} contact` });
      await child("addresses", id, { label: `${q} address` });
      await child("identifiers", id, { identifier_value: `${q} identifier` });
      await expectIds(q, {}, [id]);
    }
    const normalized = await customer({ legal_name: `Normalized ${suffix} Name` });
    await expectIds(`  ＮＯＲＭＡＬＩＺＥＤ   ${suffix}\u3000ＮＡＭＥ  `, {}, [normalized]);
    for (const q of [`${marker}${"x".repeat(65)}`, `${"ﬃ".repeat(22)}${suffix}`]) {
      const exactId = await customer({ legal_name: q, updated_at: now - 1 });
      const prefixId = await customer({ legal_name: `${q} suffix`, updated_at: now });
      const result = await expectIds(q, { sortBy: "updatedAt", sortDirection: "desc" }, [exactId, prefixId]);
      assert.deepEqual(result.items.map((item) => item.id), [prefixId, exactId]);
    }
  });
});
