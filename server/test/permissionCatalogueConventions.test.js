import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PERMISSION_CATALOGUE,
  PERMISSION_NAMES
} from "../src/modules/authorization/permissionCatalogue.js";

/**
 * 這幾條約定防的是同一類東西：**程式碼與程式碼之間安靜地對不上**。
 *
 * 啟動自檢（PermissionCatalogueService）比對的是目錄與資料庫，抓不到這一半——
 * handler 上把 `user.mgmt` 打成 `uesr.mgmt`，資料庫那邊完全正常，而那條 route
 * 會變成沒有人通得過。沒有任何東西會出聲，直到有人回報「我明明有權限」。
 */

const handlersDirectory = fileURLToPath(new URL("../src/handlers/", import.meta.url));

async function handlerFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await handlerFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push({ name: entry.name, url: pathToFileURL(entryPath).href });
    }
  }

  return files;
}

/** 所有 handler 的 [檔名, 授權政策] 對。沒宣告政策的 handler 也要回，見下面。 */
async function handlerPolicies() {
  const files = await handlerFiles(handlersDirectory);

  // 一個空的清單會讓下面每個測試都永遠通過。
  assert.ok(files.length > 0, "no handlers were found");

  const found = [];

  for (const file of files) {
    const module = await import(file.url);

    for (const HandlerClass of Object.values(module)) {
      if (typeof HandlerClass !== "function" || !Object.hasOwn(HandlerClass, "api")) {
        continue;
      }

      found.push({
        file: file.name,
        name: HandlerClass.name,
        policies: HandlerClass.api.authorizationPolicies ?? []
      });
    }
  }

  return found;
}

test("every permission a handler demands exists in the catalogue", async () => {
  const handlers = await handlerPolicies();

  for (const handler of handlers) {
    for (const policy of handler.policies) {
      if (policy.name !== "hasPermission") {
        continue;
      }

      for (const permission of policy.options?.permissions ?? []) {
        assert.ok(
          PERMISSION_NAMES.includes(permission),
          `${handler.name} (${handler.file}) demands "${permission}", which is not in ` +
            `PERMISSION_CATALOGUE [${PERMISSION_NAMES.join(", ")}]. ` +
            "Either it is a typo, or the catalogue and a migration are missing it."
        );
      }
    }
  }
});

/**
 * 角色名是管理員改得動的資料（角色管理頁就是幹這個的），而 hasRole 會讓角色名
 * 變成授權判準——兩者合起來等於「改個名字就能改變授權結果」，而且不會有任何
 * 東西報錯，只會安靜地開始比對失敗。
 *
 * 這個專案目前零使用，所以現在把門鎖上的成本是零；等到有人某天順手用了它，
 * 成本就變成一次事故。策略本身留在框架裡不動——那是框架的通用能力，這條規則
 * 只約束這個專案。
 */
test("no route authorizes by role name", async () => {
  const handlers = await handlerPolicies();

  for (const handler of handlers) {
    for (const policy of handler.policies) {
      assert.notEqual(
        policy.name,
        "hasRole",
        `${handler.name} (${handler.file}) authorizes with hasRole. Role names are ` +
          "editable data, so this makes a rename change who gets in. Use hasPermission."
      );
    }
  }
});

/**
 * 種子 migration 刻意抄了一份目錄而不是 import 它（理由見那個檔案的開頭：
 * migration 是歷史紀錄，不該跟著現在的程式一起變）。抄一份的代價由這裡接住——
 * 兩份分岔會在測試就紅，而不是等到某個環境啟動失敗。
 *
 * 讀原始碼字串而不是 import 那支 migration：import 會執行它的 module scope，
 * 而且要拿到那個常數就得把它 export 出去——那會讓一支 migration 為了測試而
 * 多一個對外介面。
 */
/**
 * 每個業務模組種自己的權限，用自己的 migration 檔——0008 種 user／role／device，
 * 0010 種 item。這裡不再假設「未來所有權限都在 0008 裡」，而是掃描全部已知的
 * permission seed migration 檔案，確認目錄裡每一項恰好被其中一支種到，且
 * description 沒有漂移。新增一支 seed migration 時，把檔名加進這個清單。
 */
const PERMISSION_SEED_MIGRATIONS = [
  "../database/migrations/0008_seed_user_management_permissions.js",
  "../database/migrations/0010_seed_item_management_permissions.js",
  "../database/migrations/0027_create_business_master.js",
  "../database/migrations/0028_seed_supplier_management_permissions.js",
  "../database/migrations/0038_seed_customer_permissions.js"
];

test("every seed migration only lists permissions that exist in the catalogue, with a matching description", async () => {
  for (const migrationPath of PERMISSION_SEED_MIGRATIONS) {
    const source = await readFile(new URL(migrationPath, import.meta.url), "utf8");
    const seededNames = [...source.matchAll(/name:\s*"([a-z][a-z.]*)"/g)].map(
      (match) => match[1]
    );

    for (const name of seededNames) {
      const permission = PERMISSION_CATALOGUE.find((entry) => entry.name === name);
      assert.ok(
        permission,
        `${migrationPath} seeds "${name}", which is not in PERMISSION_CATALOGUE. ` +
          "Either it is a typo, or the catalogue is missing it."
      );
      assert.ok(
        source.includes(permission.description),
        `${migrationPath} seeds "${name}" with a description that differs from the ` +
          "catalogue; startup will warn about the drift on every boot."
      );
    }
  }
});

test("every catalogue permission is seeded by exactly one migration", async () => {
  const sources = await Promise.all(
    PERMISSION_SEED_MIGRATIONS.map((migrationPath) =>
      readFile(new URL(migrationPath, import.meta.url), "utf8")
    )
  );

  for (const permission of PERMISSION_CATALOGUE) {
    const pattern = new RegExp(`name:\\s*"${permission.name.replace(".", "\\.")}"`);
    const seededBy = sources.filter((source) => pattern.test(source));

    assert.ok(
      seededBy.length > 0,
      `no migration in PERMISSION_SEED_MIGRATIONS seeds "${permission.name}". A ` +
        "permission in the catalogue that no migration seeds will make the " +
        "application refuse to start."
    );
    assert.equal(
      seededBy.length,
      1,
      `"${permission.name}" is seeded by ${seededBy.length} migrations; it should be ` +
        "exactly one, or which migration owns it becomes ambiguous."
    );
  }
});
