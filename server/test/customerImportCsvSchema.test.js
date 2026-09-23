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
  assert.match(template, /\r\n[^\r\n]+\r\n$/u);
  assert.doesNotMatch(template.toLowerCase(), /bankaccount|iban|swift|attachment|creditnotes|password|secret/u);
});
