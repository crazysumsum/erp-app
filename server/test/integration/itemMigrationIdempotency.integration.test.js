import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { up as migration0010 } from "../../database/migrations/0010_seed_item_management_permissions.js";
import { up as migration0011 } from "../../database/migrations/0011_create_item_categories.js";
import { up as migration0012 } from "../../database/migrations/0012_create_item_brands.js";
import { up as migration0013 } from "../../database/migrations/0013_create_item_uoms.js";
import { up as migration0014 } from "../../database/migrations/0014_create_items.js";
import { up as migration0015 } from "../../database/migrations/0015_create_item_skus.js";
import { up as migration0016 } from "../../database/migrations/0016_create_item_sku_uoms.js";
import { up as migration0017 } from "../../database/migrations/0017_create_item_sku_barcodes.js";
import { up as migration0018 } from "../../database/migrations/0018_create_item_attribute_definitions.js";
import { up as migration0019 } from "../../database/migrations/0019_create_item_attribute_options.js";
import { up as migration0020 } from "../../database/migrations/0020_create_item_category_attributes.js";
import { up as migration0021 } from "../../database/migrations/0021_create_item_attribute_values.js";
import { up as migration0022 } from "../../database/migrations/0022_create_item_sku_attribute_values.js";
import { up as migration0023 } from "../../database/migrations/0023_create_item_media.js";
import { up as migration0024 } from "../../database/migrations/0024_create_item_audit_logs.js";
import { up as migration0025 } from "../../database/migrations/0025_create_item_import_jobs.js";
import { up as migration0026 } from "../../database/migrations/0026_create_item_import_rows.js";

const skip =
  process.env.DB_INTEGRATION_TESTS === "1"
    ? false
    : "set DB_INTEGRATION_TESTS=1 against a real, migrated MySQL to run this suite";

const migrations = [
  migration0010,
  migration0011,
  migration0012,
  migration0013,
  migration0014,
  migration0015,
  migration0016,
  migration0017,
  migration0018,
  migration0019,
  migration0020,
  migration0021,
  migration0022,
  migration0023,
  migration0024,
  migration0025,
  migration0026
];

const itemTables = [
  "item_categories",
  "item_brands",
  "item_uoms",
  "items",
  "item_skus",
  "item_sku_uoms",
  "item_sku_barcodes",
  "item_attribute_definitions",
  "item_attribute_options",
  "item_category_attributes",
  "item_attribute_values",
  "item_sku_attribute_values",
  "item_media",
  "item_audit_logs",
  "item_import_jobs",
  "item_import_rows"
];

async function schemaSnapshot(database) {
  const snapshot = {};
  for (const table of itemTables) {
    const [[row]] = await database.query(`SHOW CREATE TABLE \`${table}\``);
    snapshot[table] = row["Create Table"];
  }
  return snapshot;
}

async function itemPermissionSnapshot(database) {
  const [permissions] = await database.query(
    "SELECT name FROM permissions WHERE name IN ('item.view', 'item.mgmt') ORDER BY name"
  );
  const [held] = await database.query(
    `SELECT p.name FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name = 'system-admin' AND p.name IN ('item.view', 'item.mgmt')
      ORDER BY p.name`
  );
  return {
    permissions: permissions.map((row) => row.name),
    systemAdmin: held.map((row) => row.name)
  };
}

test("TC-001 Item migrations 0010-0026 are idempotent without weakening the global permission catalogue", { skip }, async (t) => {
  const source = defaultConfigurationSource();
  const application = await createApplication({
    configurationSource: { ...source, application: { ...source.application, port: 0 } }
  });
  t.after(() => application.shutdown("integration_test_complete"));
  const database = application.services.require("mysqldatabase");

  const schemaBefore = await schemaSnapshot(database);
  const permissionsBefore = await itemPermissionSnapshot(database);
  assert.deepEqual(permissionsBefore, {
    permissions: ["item.mgmt", "item.view"],
    systemAdmin: ["item.mgmt", "item.view"]
  });

  for (const migrate of migrations) await migrate(database);

  assert.deepEqual(await schemaSnapshot(database), schemaBefore);
  assert.deepEqual(await itemPermissionSnapshot(database), permissionsBefore);
});
