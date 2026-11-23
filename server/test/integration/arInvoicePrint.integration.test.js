import assert from "node:assert/strict";
import test from "node:test";
import { getArInvoicePrint } from "../../src/modules/ar/getArInvoicePrint.js";
import { normalizeInvoiceCompanyConfig } from "../../src/modules/ar/normalizeInvoiceCompanyConfig.js";
import { readInvoiceShipmentReferences } from "../../src/modules/fulfillment/readInvoiceShipmentReferences.js";
import { arHttpShipmentFixture, failure } from "../ar/arHttpFixture.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("發票列印的來源編號逐張按出貨 ID 回傳，沖銷後仍可讀，缺來源拒絕", async (t) => {
  const { db, shipmentIds } = await arHttpShipmentFixture(t, { includeSecond: true });
  const [first, second] = shipmentIds;
  const [expected] = await db.query(`SELECT s.id, s.shipment_number, o.sales_order_number
    FROM shipments s JOIN sales_orders o ON o.id = s.sales_order_id WHERE s.id IN (?,?) ORDER BY s.id`, [first, second]);
  const references = expected.map((row) => ({
    shipmentId: Number(row.id), shipmentNumber: row.shipment_number, salesOrderNumber: row.sales_order_number
  }));
  // 只在隔離庫變更狀態，驗證唯讀編號查詢其後仍可用。
  await db.query("UPDATE shipments SET status = 'REVERSING', version = version + 1 WHERE id = ?", [first]);
  await db.query("UPDATE shipments SET status = 'REVERSED', version = version + 1 WHERE id = ?", [first]);
  assert.deepEqual(await readInvoiceShipmentReferences(db, [second, first]), references);
  await assert.rejects(readInvoiceShipmentReferences(db, [first, first]), { code: "FULFILLMENT_INPUT_INVALID" });
  await assert.rejects(readInvoiceShipmentReferences(db, [first, Number.MAX_SAFE_INTEGER]), { code: "SHIPMENT_NOT_FOUND" });
});

integrationTest("帳單地址缺失保留草稿，確認取號保存當時名稱及地址，之後重印只讀發票快照", async (t) => {
  const company = { name: "QA Issuer", header: "10 Example Road\ninvoice@example.invalid", paymentInstructions: "QA payment", footer: "QA footer" };
  const f = await arHttpShipmentFixture(t, { withBillingAddress: false, company }), { party } = f;
  const draft = f.ok(await f.invoicePost("", { shipmentIds: f.shipmentIds, dueDate: f.day(20) }));
  const path = `/api/v1/ar-invoices/${draft.id}`;
  const print = (token = f.viewer.token, url = path) => f.send(`${url}/print`, { token });
  const confirm = (version = 1) => f.invoicePost(`/${draft.id}/confirm`, { version });
  assert.deepEqual(failure(await print(null)).slice(0, 1), [401]);
  assert.deepEqual(failure(await print(f.outsider.token)).slice(0, 1), [403]);
  assert.deepEqual(failure(await print()), [409, "AR_INVOICE_NOT_PRINTABLE", undefined]);
  assert.deepEqual(failure(await confirm()), [409, "AR_BILLING_ADDRESS_REQUIRED", undefined]);
  const unchanged = f.ok(await f.send(path, { token: f.viewer.token }));
  assert.deepEqual([unchanged.status, unchanged.version, unchanged.number, unchanged.hasBillingAddressSnapshot], ["DRAFT", 1, null, false]);
  assert.equal(await f.count("ar_document_sequences WHERE document_type='INVOICE'"), 0);

  const now = Date.now();
  const [address] = await f.db.query("INSERT INTO customer_addresses SET ?", [{
    customer_id: party.id, label: "QA bill-to", recipient_company_department: "Accounts", address_line1: "42 Bill Road",
    address_line2: "Room 5", city: "Kowloon", postal_code: "00000", country_code: "HK", phone: "0000-PRIVATE",
    status: "active", version: 1, created_at: now, updated_at: now
  }]);
  await f.db.query("INSERT INTO customer_address_purposes (address_id, customer_id, purpose_code, is_default, created_at, updated_at) VALUES (?,?,'billing',0,?,?)",
    [address.insertId, party.id, now, now]);
  assert.deepEqual(failure(await confirm()), [409, "AR_BILLING_ADDRESS_REQUIRED", undefined]);
  await f.db.query("UPDATE customer_address_purposes SET is_default=1 WHERE address_id=? AND purpose_code='billing'", [address.insertId]);
  await f.db.query("UPDATE customers SET legal_name=?, legal_name_key=?, version=version+1 WHERE id=?", ["At Issue Ltd", "at issue ltd", party.id]);

  const confirmed = f.ok(await confirm());
  assert.match(confirmed.number, /^INV-\d{4}-000001$/u);
  const document = f.ok(await print());
  assert.deepEqual([document.customerName, document.billingAddress, document.issuerName, document.issuerHeader, document.paymentInstructions],
    ["At Issue Ltd", ["Accounts", "42 Bill Road", "Room 5", "Kowloon 00000", "HK"], company.name, company.header, company.paymentInstructions]);
  assert.equal(document.totalAmount, draft.totalAmount);
  assert.match(document.lines[0].shipmentNumber, /^SHP-/u);
  assert.ok(document.lines[0].salesOrderNumber);
  assert.ok(!JSON.stringify(document).includes("PRIVATE"));
  assert.equal(Object.hasOwn(document.lines[0], "shipmentId"), false);

  await f.db.query("UPDATE customers SET legal_name=?, legal_name_key=?, version=version+1 WHERE id=?", ["Post Issue Ltd", "post issue ltd", party.id]);
  await f.db.query("UPDATE customer_addresses SET address_line1='84 New Bill Road', version=version+1 WHERE id=?", [address.insertId]);
  const detail = f.ok(await f.send(path, { token: f.viewer.token }));
  assert.equal(detail.hasBillingAddressSnapshot, true);
  assert.equal(Object.hasOwn(detail, "billingAddress"), false);
  assert.deepEqual(f.ok(await print()), document);
  const printWithCompany = (config) => getArInvoicePrint({ database: f.db, company: normalizeInvoiceCompanyConfig(config), id: draft.id });
  await assert.rejects(printWithCompany(undefined), { code: "AR_INVOICE_PRINT_COMPANY_NAME_MISSING", statusCode: 409 });
  await assert.rejects(printWithCompany({ name: company.name }), { code: "AR_INVOICE_PRINT_PAYMENT_MISSING", statusCode: 409 });
  const changedCompany = await printWithCompany({ ...company, name: "Current QA Issuer", paymentInstructions: "Current QA payment" });
  assert.deepEqual(changedCompany, { ...document, issuerName: "Current QA Issuer", paymentInstructions: "Current QA payment" });

  f.ok(await f.invoicePost(`/${draft.id}/void`, { version: confirmed.version, reason: "QA voided invoice" }));
  assert.deepEqual(failure(await print()), [409, "AR_INVOICE_NOT_PRINTABLE", undefined]);
  const [[saved]] = await f.db.query("SELECT billing_address_snapshot FROM ar_invoices WHERE id=?", [draft.id]);
  assert.equal(saved.billing_address_snapshot, "Accounts\n42 Bill Road\nRoom 5\nKowloon 00000\nHK");
  const legacy = f.ok(await f.invoicePost("", { shipmentIds: f.shipmentIds, dueDate: f.day(20) }));
  f.ok(await f.invoicePost(`/${legacy.id}/confirm`, { version: 1 }));
  await f.db.query("UPDATE ar_invoices SET billing_address_snapshot='' WHERE id=?", [legacy.id]);
  assert.deepEqual(failure(await print(f.viewer.token, `/api/v1/ar-invoices/${legacy.id}`)), [409, "AR_INVOICE_PRINT_SNAPSHOT_MISSING", undefined]);
});
