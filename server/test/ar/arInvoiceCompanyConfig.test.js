import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { normalizeInvoiceCompanyConfig } from "../../src/modules/ar/normalizeInvoiceCompanyConfig.js";

test("發票的多行部署設定保存換行，付款資料在序列化設定時遮罩", () => {
  const configUrl = new URL("../../config/company.js", import.meta.url);
  const normalizerUrl = new URL("../../src/modules/ar/normalizeInvoiceCompanyConfig.js", import.meta.url);
  const payment = "QA Account A\nQA Account B";
  const { status, stderr, stdout } = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import config from ${JSON.stringify(configUrl.href)};
    import { normalizeInvoiceCompanyConfig } from ${JSON.stringify(normalizerUrl.href)};
    const company = normalizeInvoiceCompanyConfig(config);
    process.stdout.write(JSON.stringify({ config: company, payment: company.paymentInstructions.reveal() }));
  `], { encoding: "utf8", env: {
    AR_INVOICE_COMPANY_NAME: "QA Issuer", AR_INVOICE_COMPANY_HEADER: "QA Address\nQA Contact",
    AR_INVOICE_PAYMENT_INSTRUCTIONS: payment, AR_INVOICE_FOOTER: "QA Footer"
  } });
  assert.equal(status, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), {
    config: { name: "QA Issuer", header: "QA Address\nQA Contact", paymentInstructions: "[REDACTED]", footer: "QA Footer" }, payment
  });
});

test("公司設定缺省可啟動，名稱不可跨行，多行只接受換行控制字元", () => {
  const empty = normalizeInvoiceCompanyConfig(undefined);
  assert.equal(empty.name, "");
  assert.equal(empty.paymentInstructions.reveal(), "");
  assert.throws(() => normalizeInvoiceCompanyConfig({ name: "QA\nIssuer" }), /AR_INVOICE_COMPANY_NAME/u);
  assert.throws(() => normalizeInvoiceCompanyConfig({ footer: "QA\tFooter" }), /AR_INVOICE_FOOTER/u);
  assert.throws(() => normalizeInvoiceCompanyConfig({ paymentInstructions: "A".repeat(2001) }), /AR_INVOICE_PAYMENT_INSTRUCTIONS/u);
});
