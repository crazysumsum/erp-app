import { expect, test } from "@playwright/test";
import { closeDb, db, loginAs, unique, watchProblems } from "./uatSupport.js";

/**
 * Supplier UAT PHASE-001（07_uat_test_cases.md §4；HD-124 A）。真 server、真 MySQL scratch database，冇 mock。
 * 每個 test 標題只帶一個 UAT ID；證據係畫面、Audit 頁同 Correlation ID（request ID），截圖掛喺 test 報告。
 */
test.afterAll(closeDb);

const evidence = async (page, testInfo, name) => testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

test("@uat UAT-001 a CLERK creates a Draft from code, name and currency, finds it, opens it and traces the create in Audit", async ({ page }, testInfo) => {
  await loginAs(page, "CLERK");
  const problems = watchProblems(page);
  const code = unique("UAT001");
  const name = `UAT-001 Evergreen ${code}`;

  await page.goto("/suppliers/new");
  await page.getByLabel("Supplier Code *").fill(code);
  await page.getByLabel("Supplier Name *").fill(name);
  await page.getByRole("combobox", { name: "Default Currency *" }).click();
  await page.getByRole("option", { name: /^HKD/u }).click();
  await page.getByRole("button", { name: "儲存 Draft" }).click();
  await expect(page.getByText(`供應商 ${code} 已建立`)).toBeVisible();
  await expect(page.getByText("狀態：草稿")).toBeVisible();
  await evidence(page, testInfo, "created");

  await page.goto("/suppliers");
  await page.getByPlaceholder("搜尋 Code、名稱、電話或電郵").fill(code);
  const row = page.locator("tbody tr", { hasText: code });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(name);
  await expect(row).toContainText("草稿");
  await row.getByRole("link", { name: `查看 ${code} 詳情` }).click();

  await expect(page.getByText(code).first()).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();
  await expect(page.getByText("HKD").first()).toBeVisible();
  await evidence(page, testInfo, "detail");

  await page.getByRole("tab", { name: "變更紀錄" }).click();
  const created = page.locator("tbody tr", { hasText: "新增供應商" });
  await expect(created).toHaveCount(1);
  const [[audit]] = await (await db()).query(
    "SELECT request_id FROM supplier_audit_logs WHERE action = 'supplier.create' AND target_label = ?", [code]);
  await expect(created).toContainText(audit.request_id);
  await expect(created).toContainText("uat-clerk");
  await evidence(page, testInfo, "audit");
  expect(problems).toEqual([]);
});
