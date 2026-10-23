import process from "node:process";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import mysql from "mysql2/promise";
import { hashPassword } from "../../../server/src/modules/user/passwordHash.js";

test("P0 permissions remain independent in the real role UI and new public errors are localized", async ({ page }) => {
  if (!process.env.DB_SOCKET_PATH?.includes("erp-fulfillment-p0-mysql-") || !/^fulfillment_p0_/.test(process.env.DB_NAME ?? "")) {
    throw new Error("P0 browser check requires its owned native database");
  }
  const db = await mysql.createConnection({ socketPath: process.env.DB_SOCKET_PATH,
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  const marker = "p0-ui-" + randomUUID().slice(0, 8), password = "Synthetic-" + randomUUID() + "-Aa1!";
  const now = Date.now(), roles = [], failures = [], consoles = [], errors = [], errorResponses = [];
  let userId;
  page.on("response", response => { if (response.status() >= 400) errorResponses.push({ status: response.status(), path: new URL(response.url()).pathname }); });
  page.on("pageerror", error => errors.push(error.message));
  page.on("requestfailed", request => failures.push(request.url()));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().includes("400 (Bad Request)")) consoles.push(message.text());
  });
  try {
    for (const suffix of ["manager", "target"]) {
      const [row] = await db.execute("INSERT INTO roles(name,description,created_at) VALUES (?, 'Synthetic P0 browser fixture', ?)", [marker + "-" + suffix, now]);
      roles.push(Number(row.insertId));
    }
    await db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name IN ('role.mgmt','fulfillment.view','fulfillment.operation','fulfillment.reverse')", [roles[0]]);
    await db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name='fulfillment.view'", [roles[1]]);
    const [user] = await db.execute("INSERT INTO users(username,password_hash,display_name,created_at,updated_at) VALUES (?,?,'Synthetic P0 Manager',?,?)", [marker, await hashPassword(password), now, now]);
    userId = Number(user.insertId);
    await db.execute("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)", [userId, roles[0]]);
    const login = async () => {
      await page.goto("/login"); await page.getByLabel("帳號").fill(marker); await page.getByLabel("密碼", { exact: true }).fill(password);
      await page.getByRole("button", { name: "登入", exact: true }).click();
    };
    await login(); await expect(page).toHaveURL(/\/device\/pending/);
    await db.execute("UPDATE user_devices SET status='approved',reviewed_at=?,review_note='Synthetic owned fixture approval' WHERE user_id=?", [Date.now(), userId]);
    await login(); await expect(page).toHaveURL(/\/$/);
    expect(consoles).toHaveLength(1); expect(consoles[0]).toContain("403 (Forbidden)"); consoles.length = 0;
    await page.goto("/system/roles");
    await page.getByRole("button", { name: new RegExp(marker + "-target.*的操作") }).click();
    await page.getByText("配置權限", { exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("checkbox", { name: /fulfillment.view/ })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: /fulfillment.operation/ })).not.toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: /fulfillment.reverse/ })).not.toBeChecked();
    await dialog.getByRole("checkbox", { name: /fulfillment.reverse/ }).check();
    await dialog.getByLabel("原因", { exact: true }).fill("Synthetic P0 permission proof");
    await dialog.getByLabel("你的密碼").fill(password);
    await dialog.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const granted = async () => (await db.execute("SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? ORDER BY p.name", [roles[1]]))[0].map(row => row.name);
    await expect.poll(granted).toEqual(["fulfillment.reverse", "fulfillment.view"]);
    await page.reload(); await expect(page.getByRole("button", { name: new RegExp(marker + "-target.*的操作") })).toBeVisible();
    await page.route("**/api/v1/roles/create", route => route.fulfill({ status: 400, contentType: "application/json",
      body: JSON.stringify({ success: false, error: { code: "FULFILLMENT_INPUT_INVALID", message: "synthetic-debug-should-not-display" } }) }));
    await page.getByRole("button", { name: "新增角色" }).click();
    const create = page.getByRole("dialog");
    await create.getByLabel("角色名").fill(marker + "-error");
    await create.getByRole("button", { name: "新增", exact: true }).click();
    await expect(create.getByText("履約輸入資料不正確，請檢查後再試", { exact: true })).toBeVisible();
    await expect(page.getByText("synthetic-debug-should-not-display", { exact: true })).toHaveCount(0);
    await create.getByRole("button", { name: "取消", exact: true }).click();
    await expect(create).not.toBeVisible();
    expect(errorResponses).toEqual([{ status: 403, path: "/api/v1/user/login" }, { status: 400, path: "/api/v1/roles/create" }]);
    expect(failures).toEqual([]); expect(consoles).toEqual([]); expect(errors).toEqual([]);
  } finally {
    if (userId) await db.execute("DELETE FROM users WHERE id=?", [userId]);
    for (const roleId of roles.reverse()) await db.execute("DELETE FROM roles WHERE id=?", [roleId]);
    await db.end();
  }
});
