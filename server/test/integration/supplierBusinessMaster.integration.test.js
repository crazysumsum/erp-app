import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { BusinessMasterProvider } from "../../src/modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../../src/modules/businessMaster/BusinessMasterReadinessService.js";
import { BusinessMasterRepository } from "../../src/modules/businessMaster/BusinessMasterRepository.js";
import { BusinessMasterLookupProvider } from "../../src/modules/supplier/providers/BusinessMasterLookupProvider.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

function poolConfig() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 3
  };
}

integrationTest("Supplier consumes the ready Business Master contract without owning its catalog", async (t) => {
  const pool = mysql.createPool(poolConfig());
  t.after(() => pool.end());
  const provider = new BusinessMasterProvider({ database: pool, repository: new BusinessMasterRepository() });
  const readiness = new BusinessMasterReadinessService({ database: pool, checkerIds: ["supplier"] });
  const lookup = new BusinessMasterLookupProvider({ provider, readiness });

  assert.equal((await lookup.assertReady()).status, "READY");
  assert.ok((await lookup.listCurrencies()).some((currency) => currency.code === "HKD"));

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const defaults = await lookup.assertSupplierDefaultsInTransaction(connection, {
      currencyCode: "HKD",
      currencyVersion: 1,
      paymentTermId: null
    });
    assert.deepEqual(
      { code: defaults.currency.code, status: defaults.currency.status, paymentTerm: defaults.paymentTerm },
      { code: "HKD", status: "ACTIVE", paymentTerm: null }
    );
    await connection.rollback();
  } finally {
    connection.release();
  }
});
