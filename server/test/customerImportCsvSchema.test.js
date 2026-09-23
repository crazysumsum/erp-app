import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_IMPORT_COLUMNS, CUSTOMER_IMPORT_COLUMN_NAMES,
  CUSTOMER_IMPORT_TEMPLATE_VERSION, buildCustomerImportTemplate
} from "../src/modules/customer/import/customerCsvSchema.js";

test("Customer import v1 template is versioned, documented and excludes sensitive fields", () => {
  assert.equal(CUSTOMER_IMPORT_TEMPLATE_VERSION, "v1");
  assert.ok(CUSTOMER_IMPORT_COLUMNS.every(({ name, description }) => name && description));
  assert.equal(new Set(CUSTOMER_IMPORT_COLUMN_NAMES).size, CUSTOMER_IMPORT_COLUMN_NAMES.length);
  const template = buildCustomerImportTemplate();
  assert.ok(template.startsWith("\uFEFFcustomerId,customerCode,"));
  const lines = template.slice(1).trimEnd().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[1], /CUSTOMER_IMPORT_TEMPLATE_V1_DESCRIPTION/u);
  assert.match(lines[2], /CUSTOMER_IMPORT_TEMPLATE_V1_EXAMPLE/u);
  for (const { name, description } of CUSTOMER_IMPORT_COLUMNS) {
    assert.ok(lines[1].includes(`${name}: ${description}`));
  }
  assert.doesNotMatch(template.toLowerCase(), /bankaccount|iban|swift|attachment|creditnotes|password|secret/u);
});
