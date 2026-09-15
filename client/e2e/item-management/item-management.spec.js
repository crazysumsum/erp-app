import { randomUUID } from "node:crypto";
import process from "node:process";
import { expect, test } from "@playwright/test";
import mysql from "mysql2/promise";
import { computeVariantSignature } from "../../../server/src/modules/item/variantSignature.js";
import { hashPassword } from "../../../server/src/modules/user/passwordHash.js";

test.describe.serial("Item Management executable UAT", () => {
  let context;
  let page;
  let database;
  let userId;
  let roleId;
  let variantItemId;
  let variantAttributeId;
  let variantUomId;
  let variantCategoryId;
  const marker = `e2e-item-${randomUUID().slice(0, 8)}`;
  const username = marker;
  const password = `E2e-${randomUUID()}-Aa1!`;
  const variantAttributeName = `${marker}-colour`;
  const existingOptionLabel = `${marker}-red`;
  const newOptionLabel = `${marker}-blue`;
  const newOptionValue = `E2E-BLUE-${marker.slice(-8)}`;
  const generatedSkuCode = newOptionValue.toUpperCase();
  const variantUomCode = `V${marker.slice(-8).toUpperCase()}`;
  const variantUomName = `${marker}-variant-unit`;
  const unexpectedConsoleErrors = [];
  const failedRequests = [];
  const serverErrors = [];

  test.beforeAll(async ({ browser }) => {
    database = await mysql.createConnection({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "erp_user",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "erp_dev"
    });

    const now = Date.now();
    const [role] = await database.execute(
      "INSERT INTO roles (name, description, created_at) VALUES (?, ?, ?)",
      [marker, "Item Management Playwright UAT", now]
    );
    roleId = Number(role.insertId);
    const [[permission]] = await database.execute(
      "SELECT id FROM permissions WHERE name = 'item.mgmt'"
    );
    await database.execute(
      "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
      [roleId, permission.id]
    );

    const [user] = await database.execute(
      `INSERT INTO users (username, password_hash, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [username, await hashPassword(password), "Item UAT Manager", now, now]
    );
    userId = Number(user.insertId);
    await database.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
    await database.execute(
      `INSERT INTO item_audit_logs
         (occurred_at, actor_user_id, actor_username, action, target_type, target_id,
          target_label, reason, detail, request_id, ip)
       VALUES (?, ?, ?, 'brand.create', 'brand', NULL, ?, 'UAT fixture', ?, ?, '127.0.0.1')`,
      [now, userId, username, marker, JSON.stringify({ fixture: true }), marker]
    );

    const [category] = await database.execute(
      "INSERT INTO item_categories (name, status, created_at, updated_at, created_by, updated_by) VALUES (?, 'active', ?, ?, ?, ?)",
      [`${marker}-category`, now, now, userId, userId]
    );
    variantCategoryId = Number(category.insertId);
    const [uom] = await database.execute(
      "INSERT INTO item_uoms (code, name, symbol, status, created_at, updated_at, created_by, updated_by) VALUES (?, ?, 'ea', 'active', ?, ?, ?, ?)",
      [variantUomCode, variantUomName, now, now, userId, userId]
    );
    variantUomId = Number(uom.insertId);
    const [attribute] = await database.execute(
      `INSERT INTO item_attribute_definitions
         (code, name, data_type, is_variant, is_filterable, status, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, 'single_option', 1, 0, 'active', ?, ?, ?, ?)`,
      [`e2e-colour-${marker.slice(-8)}`, variantAttributeName, now, now, userId, userId]
    );
    variantAttributeId = Number(attribute.insertId);
    const [existingOption] = await database.execute(
      `INSERT INTO item_attribute_options
         (attribute_id, value, label, sort_order, status, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, 0, 'active', ?, ?, ?, ?)`,
      [variantAttributeId, `E2E-RED-${marker.slice(-8)}`, existingOptionLabel, now, now, userId, userId]
    );
    await database.execute(
      `INSERT INTO item_attribute_options
         (attribute_id, value, label, sort_order, status, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, 1, 'active', ?, ?, ?, ?)`,
      [variantAttributeId, newOptionValue, newOptionLabel, now, now, userId, userId]
    );
    const [item] = await database.execute(
      `INSERT INTO items
         (name, category_id, product_type, status, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, 'variant', 'draft', ?, ?, ?, ?)`,
      [`${marker}-variant-item`, variantCategoryId, now, now, userId, userId]
    );
    variantItemId = Number(item.insertId);
    const existingOptionId = Number(existingOption.insertId);
    const [sku] = await database.execute(
      `INSERT INTO item_skus
         (item_id, sku_code, sku_name, variant_signature, status, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [
        variantItemId,
        `E2E-RED-${marker.slice(-8)}`,
        existingOptionLabel,
        computeVariantSignature([{ attributeId: variantAttributeId, typedValue: String(existingOptionId) }]),
        now,
        now,
        userId,
        userId
      ]
    );
    const existingSkuId = Number(sku.insertId);
    await database.execute(
      `INSERT INTO item_sku_uoms
         (sku_id, uom_id, to_base_factor, is_base, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, 1, 1, ?, ?, ?, ?)`,
      [existingSkuId, variantUomId, now, now, userId, userId]
    );
    await database.execute(
      `INSERT INTO item_sku_attribute_values
         (sku_id, attribute_id, option_id, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?)`,
      [existingSkuId, variantAttributeId, existingOptionId, now, userId]
    );

    context = await browser.newContext();
    page = await context.newPage();
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.text().includes("400 (Bad Request)") &&
        !message.text().includes("409 (Conflict)")
      ) {
        unexpectedConsoleErrors.push(message.text());
      }
    });
    page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}`));
    page.on("response", (response) => {
      if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
    });

    await page.goto("/login");
    await page.getByLabel("帳號").fill(username);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/device\/pending/);

    const [[device]] = await database.execute(
      "SELECT id FROM user_devices WHERE user_id = ? ORDER BY id DESC LIMIT 1",
      [userId]
    );
    await database.execute(
      "UPDATE user_devices SET status = 'approved', reviewed_at = ?, review_note = ? WHERE id = ?",
      [Date.now(), "Automated local UAT fixture", device.id]
    );

    await page.goto("/login");
    await page.getByLabel("帳號").fill(username);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL("/");
    unexpectedConsoleErrors.length = 0;
    failedRequests.length = 0;
    serverErrors.length = 0;
  });

  test.afterAll(async () => {
    await context?.close();
    if (!database) return;

    try {
      await database.execute("DELETE FROM item_audit_logs WHERE actor_user_id = ? OR request_id = ?", [userId ?? null, marker]);
      if (variantItemId) await database.execute("DELETE FROM items WHERE id = ?", [variantItemId]);
      if (variantAttributeId) {
        await database.execute("DELETE FROM item_attribute_options WHERE attribute_id = ?", [variantAttributeId]);
        await database.execute("DELETE FROM item_attribute_definitions WHERE id = ?", [variantAttributeId]);
      }
      if (variantUomId) await database.execute("DELETE FROM item_uoms WHERE id = ?", [variantUomId]);
      if (variantCategoryId) await database.execute("DELETE FROM item_categories WHERE id = ?", [variantCategoryId]);
      await database.execute("DELETE FROM item_brands WHERE name LIKE ?", [`${marker}%`]);
      await database.execute("DELETE FROM item_uoms WHERE code LIKE ?", [`E2E${marker.slice(-4)}%`]);
      if (userId) {
        await database.execute("DELETE FROM user_audit_logs WHERE actor_user_id = ? OR target_id = ?", [userId, userId]);
        await database.execute("DELETE FROM fr_token_versions WHERE subject = ?", [String(userId)]);
        await database.execute("DELETE FROM users WHERE id = ?", [userId]);
      }
      if (roleId) {
        await database.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
        await database.execute("DELETE FROM roles WHERE id = ?", [roleId]);
      }
    } finally {
      await database.end();
    }
  });

  test("UAT-001 search state survives refresh and empty results remain usable", async () => {
    await page.goto("/items");
    const search = page.getByPlaceholder("搜尋 SKU Code、條碼或名稱");
    await search.fill(`${marker}-missing`);
    await expect(page).toHaveURL(new RegExp(`q=${marker}-missing`));
    await expect(page.getByText("冇資料")).toBeVisible();
    await page.reload();
    await expect(search).toHaveValue(`${marker}-missing`);
  });

  test("UAT-002 audit history shows actor, target, reason and change detail", async () => {
    await page.goto("/items/audit");
    await expect(page.getByRole("heading", { name: "商品變更紀錄" })).toBeVisible();
    await page.getByLabel("操作者").fill(username);
    await expect(page.getByText(marker, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("UAT fixture")).toBeVisible();
  });

  test("UAT-003 invalid Standard Item create is rejected with focused actionable errors", async () => {
    await page.goto("/items/new");
    const response = page.waitForResponse(
      (candidate) => candidate.url().endsWith("/api/v1/items/create") && candidate.request().method() === "POST"
    );
    await page.getByRole("button", { name: "儲存草稿" }).click();
    expect((await response).status()).toBe(400);
    const alert = page.getByRole("alert").first();
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
  });

  test("UAT-004 existing Variant Item can add one unique SKU and reject duplicates", async () => {
    async function selectVariantAndUom() {
      await page.getByLabel(variantAttributeName, { exact: true }).check();
      await page.getByLabel(newOptionLabel, { exact: true }).check();
      await page.getByRole("button", { name: "產生組合" }).click();
      const row = page.getByRole("row").filter({ hasText: newOptionLabel });
      await expect(row).toBeVisible();
      await expect(row.getByRole("textbox").nth(0)).toHaveValue(generatedSkuCode);
      await page.getByRole("button", { name: "新增單位" }).click();
      await page.getByLabel("單位 *").click();
      await page.getByRole("option", { name: `${variantUomName}（${variantUomCode}）` }).click();
      return row;
    }

    await page.goto(`/items/${variantItemId}`);
    await page.getByRole("button", { name: "新增 SKU" }).click();
    await expect(page).toHaveURL(`/items/${variantItemId}/skus/new`);
    await selectVariantAndUom();

    const createdResponse = page.waitForResponse(
      (candidate) => candidate.url().endsWith("/api/v1/skus/create") && candidate.request().method() === "POST"
    );
    await page.getByRole("button", { name: "新增 SKU" }).last().click();
    expect((await createdResponse).status()).toBe(201);
    await expect(page).toHaveURL(new RegExp(`/items/${variantItemId}/skus/\\d+$`));
    await expect(page.getByText(generatedSkuCode, { exact: true }).first()).toBeVisible();

    await page.goto(`/items/${variantItemId}/skus/new`);
    const duplicateRow = await selectVariantAndUom();
    await duplicateRow.getByRole("textbox").nth(0).fill(`E2E-DUP-${marker.slice(-8)}`);
    const duplicateResponse = page.waitForResponse(
      (candidate) => candidate.url().endsWith("/api/v1/skus/create") && candidate.request().method() === "POST"
    );
    await page.getByRole("button", { name: "新增 SKU" }).last().click();
    expect((await duplicateResponse).status()).toBe(409);
    await expect(page.getByRole("alert").first()).toContainText("規格組合");
    await expect(page).toHaveURL(`/items/${variantItemId}/skus/new`);
  });

  test.skip("UAT-005 concurrent editors and real downstream SKU references protect history", async () => {
    // TASK-043 intentionally remains pending until a real downstream consumer owns the reference contract.
  });

  test("UAT-006 unreferenced Brand can be created and permanently deleted with audit reason", async () => {
    const brandName = `${marker}-brand`;
    await page.goto("/items/brands");
    await page.getByRole("button", { name: "新增品牌" }).click();
    await page.getByLabel("品牌名稱").fill(brandName);
    await page.getByRole("dialog").getByRole("button", { name: "新增" }).click();
    await expect(page.getByText(brandName, { exact: true })).toBeVisible();

    await page.getByLabel(`「${brandName}」的操作`).click();
    await page.getByText("刪除", { exact: true }).last().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("原因").fill("Automated UAT cleanup");
    await dialog.getByLabel("你的密碼").fill(password);
    await dialog.getByRole("button", { name: "刪除" }).click();
    await expect(page.getByText(brandName, { exact: true })).toHaveCount(0);
  });

  test("UAT-007 UOM entry enforces code, name and symbol fields in a usable catalogue flow", async () => {
    const suffix = marker.slice(-4).toUpperCase();
    const code = `E2E${suffix}`;
    const name = `${marker}-unit`;
    await page.goto("/items/uoms");
    await page.getByRole("button", { name: "新增單位" }).click();
    await page.getByLabel("代碼").fill(code);
    await page.getByLabel("名稱").fill(name);
    await page.getByLabel("簡寫").fill("ea");
    await page.getByRole("dialog").getByRole("button", { name: "新增" }).click();
    await expect(page.getByText(code, { exact: true })).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  });

  test("UAT-008 price entry communicates fixed HKD and tax-not-applicable semantics", async () => {
    await page.goto("/items/new");
    const price = page.getByLabel("建議零售價");
    await expect(price).toBeVisible();
    await price.fill("123.4500");
    await expect(price).toHaveValue("123.4500");
    await expect(page.getByText("HK$")).toBeVisible();
    await expect(page.getByText("（未稅）")).toBeVisible();
  });

  test("UAT-009 template and filtered SKU export complete as browser downloads", async () => {
    await page.goto("/items/imports");
    const templateDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "下載範本" }).click();
    await expect((await templateDownload).suggestedFilename()).toMatch(/item-import-template/);

    const exportDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "匯出 CSV" }).click();
    await expect((await exportDownload).suggestedFilename()).toMatch(/^sku-export-\d+\.csv$/);
  });

  test("UAT-010 audit search exposes the Item manager's catalog changes", async () => {
    await page.goto("/items/audit");
    await page.getByLabel("操作者").fill(username);
    await expect(page.getByText("新增品牌").first()).toBeVisible();
    await expect(page.getByText("刪除品牌").first()).toBeVisible();
    await expect(page.getByText("Automated UAT cleanup")).toBeVisible();
  });

  test("UAT-011 item.mgmt-only role can reach every Item surface and no User Management surface", async () => {
    for (const label of ["商品與 SKU", "分類", "品牌", "計量單位", "商品屬性", "匯入／匯出", "商品變更紀錄"]) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "使用者" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "角色" })).toHaveCount(0);
  });

  test("UAT-012 keyboard focus, dirty-state protection, console and network remain usable", async () => {
    await page.goto("/items/new");
    const name = page.getByLabel("商品名稱 *");
    await name.focus();
    await expect(name).toBeFocused();
    await name.fill(`${marker}-dirty`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("link", { name: "商品與 SKU" }).click();
    await expect(page).toHaveURL(/\/items(?:\?|$)/);
    expect(failedRequests).toEqual([]);
    expect(serverErrors).toEqual([]);
    expect(unexpectedConsoleErrors).toEqual([]);
  });

  test.skip("UAT-015 staging release journey and owner sign-off", async () => {
    // Local MySQL is not the approved staging-like DR/release environment, and automation cannot grant business sign-off.
  });
});
