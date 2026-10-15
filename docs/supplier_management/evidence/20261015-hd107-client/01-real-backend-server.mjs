/* global process, console */
// 本機真後端：用 erp_t51p（100k）起 app 喺 3000，建一個有密碼嘅測試用戶，畀一個 Supplier 加到 105 個聯絡人。
// 收到 SIGTERM／SIGINT 就清走自己加嘅嘢。只寫拋棄式 DB。
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const W = "/Users/sam/Documents/workspace/erp-supplier-hd107c/server/";
const require = createRequire(W + "package.json");
const mysql = (await import(pathToFileURL(require.resolve("mysql2/promise")).href)).default;
const imp = (p) => import(pathToFileURL(W + p).href);
const { createApplication } = await imp("src/framework/application/createApplication.js");
const { defaultConfigurationSource } = await imp("src/framework/configuration/applicationConfiguration.js");
const { hashPassword } = await imp("src/modules/user/passwordHash.js");

const OUT = process.argv[2];
const RUN = Date.now().toString(36);
const admin = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  user: process.env.DB_ADMIN_USER, password: process.env.DB_ADMIN_PASSWORD, database: process.env.DB_NAME });
const now = Date.now();
const created = {};
async function cleanup() {
  if (created.supplierId) await admin.query("DELETE FROM supplier_contacts WHERE supplier_id = ? AND name LIKE 'HD107C %'", [created.supplierId]);
  if (created.userId) {
    await admin.query("DELETE FROM user_roles WHERE user_id = ?", [created.userId]);
    await admin.query("DELETE FROM fr_token_versions WHERE subject = ?", [String(created.userId)]).catch(() => {});
    await admin.query("DELETE FROM users WHERE id = ?", [created.userId]);
  }
  if (created.roleId) {
    await admin.query("DELETE FROM role_permissions WHERE role_id = ?", [created.roleId]);
    await admin.query("DELETE FROM roles WHERE id = ?", [created.roleId]);
  }
}
const permissions = ["supplier.view", "supplier.mgmt", "business_master.view"];
const [role] = await admin.execute("INSERT INTO roles (name, created_at) VALUES (?, ?)", [`hd107c-${RUN}`, now]);
created.roleId = Number(role.insertId);
await admin.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name IN (?)", [created.roleId, permissions]);
const password = `hd107c-${RUN}-pw`;
const [user] = await admin.execute("INSERT INTO users (username, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'HD107 Check', ?, ?)",
  [`hd107c-${RUN}`, await hashPassword(password), now, now]);
created.userId = Number(user.insertId);
await admin.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [created.userId, created.roleId]);

// 一個 active Supplier，加 105 個聯絡人；第 105 個（按名排最尾）先係主要訂單聯絡人。
const [[target]] = await admin.query(`SELECT s.id, s.supplier_code FROM suppliers s WHERE s.status = 'active'
  ORDER BY s.id LIMIT 1`);
created.supplierId = Number(target.id);
for (let index = 1; index <= 105; index += 1) {
  const [contact] = await admin.execute(`INSERT INTO supplier_contacts (supplier_id, name, status, version, created_at, updated_at, created_by, updated_by)
    VALUES (?, ?, 'active', 1, ?, ?, ?, ?)`, [created.supplierId, `HD107C ${String(index).padStart(3, "0")}`, now, now, created.userId, created.userId]);
  if (index === 105) {
    await admin.execute(`INSERT INTO supplier_contact_purposes (supplier_id, contact_id, purpose_code, is_primary, created_at, updated_at)
      VALUES (?, ?, 'orders', 1, ?, ?)`, [created.supplierId, contact.insertId, now, now]).catch(async (error) => { console.error("purpose", error.message); });
  }
}

const source = defaultConfigurationSource();
const application = await createApplication({ configurationSource: { ...source,
  application: { ...source.application, port: 3000 },
  requestLimiter: { ...source.requestLimiter, maxRequestsPerIpPerWindow: 100_000 } },
  serviceDiscoveryOptions: { additionalModuleUrls: [
    pathToFileURL(W + "src/modules/businessMaster/BusinessMasterService.js").href,
    pathToFileURL(W + "src/modules/supplier/SupplierProviderServices.js").href] } });
const { url } = await application.start();
const version = await application.services.require("tokenRevocation").currentVersion(String(created.userId));
const token = await application.services.require("jwt").issue({ roles: [`hd107c-${RUN}`], permissions },
  { subject: String(created.userId), version, authTime: Math.floor(Date.now() / 1000) });
fs.writeFileSync(OUT, JSON.stringify({ url, token, password, supplierId: created.supplierId, supplierCode: target.supplier_code }));
console.log("READY", url, created);
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, async () => {
  await application.stop?.().catch(() => {});
  await cleanup();
  await admin.end();
  console.log("CLEANED");
  process.exit(0);
});
