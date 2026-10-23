import { up as reorderSkuIndex } from "../../database/migrations/0087_fix_supplier_sku_refs_sku_foreign_key.js";
import { createSupplierHarness } from "./supplierHttpHarness.js";
import { schemaObjects, tableChecksums } from "./supplierAcceptanceRunner.js";

/**
 * 開機自我檢查嘅情況（DEF-033、HD-121 A；OPS-004）。每個情況：`remove` 拎走一樣嘢、開機一定要拒絕而且訊息要講到
 * 缺咗乜（`refusal`）、DB 唔可以被改、`restore` 還原之後要開到機。`admin` 係對住 `schema` 嘅 admin 連線。
 * 還原用拎走之前讀落嚟嘅原本定義，唔係自己再寫一次，咁先知「修好」係真係同原本一樣。
 */
export function startupCases(admin, schema) {
  const q = (sql, params) => admin.query(sql.replaceAll("$$", `\`${schema}\``), params);
  const saved = {};
  return [
    {
      name: "missing table supplier_contacts",
      refusal: /Missing: supplier_contacts, supplier_contact_purposes/u,
      async remove() {
        saved.contacts = (await q("SHOW CREATE TABLE $$.supplier_contacts"))[0][0]["Create Table"];
        saved.purposes = (await q("SHOW CREATE TABLE $$.supplier_contact_purposes"))[0][0]["Create Table"];
        await q("DROP TABLE $$.supplier_contact_purposes");
        await q("DROP TABLE $$.supplier_contacts");
      },
      async restore() {
        await q(`USE $$; ${saved.contacts}; ${saved.purposes}`);
      }
    },
    {
      name: "missing column suppliers.website",
      refusal: /Incompatible existing Supplier schema: suppliers/u,
      async remove() {
        const ddl = (await q("SHOW CREATE TABLE $$.suppliers"))[0][0]["Create Table"];
        const lines = ddl.split("\n");
        const index = lines.findIndex((line) => line.trim().startsWith("`website` "));
        saved.website = lines[index].trim().replace(/,$/u, "");
        saved.after = lines[index - 1].trim().match(/^`([^`]+)`/u)[1];
        await q("ALTER TABLE $$.suppliers DROP COLUMN website");
      },
      async restore() {
        await q(`ALTER TABLE $$.suppliers ADD COLUMN ${saved.website} AFTER \`${saved.after}\``);
      }
    },
    {
      name: "missing list index suppliers.idx_suppliers_name_id (0080)",
      refusal: /suppliers\.idx_suppliers_name_id must be \(supplier_name,id\)/u,
      async remove() {
        await q("ALTER TABLE $$.suppliers DROP INDEX idx_suppliers_name_id");
      },
      async restore() {
        await q("ALTER TABLE $$.suppliers ADD INDEX idx_suppliers_name_id (supplier_name, id)");
      }
    },
    {
      // 冇咗呢個 index，FK 就由複合 index 撐住，DEF-029 嘅情況返嚟（0087）。還原用 0087 自己嘅 up()。
      name: "missing SKU index serving the foreign key (0087)",
      refusal: /idx_supplier_sku_refs_sku must serve fk_supplier_sku_refs_sku/u,
      async remove() {
        await q("ALTER TABLE $$.supplier_sku_refs DROP INDEX idx_supplier_sku_refs_sku");
      },
      async restore() {
        await q("USE $$");
        await reorderSkuIndex(admin);
      }
    },
    {
      name: "missing supplier_settings singleton row",
      refusal: /supplier_settings row id = 1/u,
      async remove() {
        [[saved.settings]] = await q("SELECT * FROM $$.supplier_settings WHERE id = 1");
        await q("DELETE FROM $$.supplier_settings WHERE id = 1");
      },
      async restore() {
        await q("INSERT INTO $$.supplier_settings SET ?", [saved.settings]);
      }
    },
    {
      name: "missing permission supplier.bank.view",
      refusal: /missing 1 permission\(s\) from the catalogue: supplier\.bank\.view/u,
      async remove() {
        [[saved.permission]] = await q("SELECT * FROM $$.permissions WHERE name = 'supplier.bank.view'");
        [saved.grants] = await q("SELECT * FROM $$.role_permissions WHERE permission_id = ?", [saved.permission.id]);
        await q("DELETE FROM $$.role_permissions WHERE permission_id = ?", [saved.permission.id]);
        await q("DELETE FROM $$.permissions WHERE id = ?", [saved.permission.id]);
      },
      async restore() {
        await q("INSERT INTO $$.permissions SET ?", [saved.permission]);
        for (const grant of saved.grants) await q("INSERT INTO $$.role_permissions SET ?", [grant]);
      }
    }
  ];
}

/** 開機一次；開到就關返。回 `{ started, message }`。 */
export async function tryStart({ database, user, password }) {
  const h = createSupplierHarness("startup", { database: { database, user, password: password ?? "" } });
  try {
    await h.start();
    const health = await fetch(`${h.url}/api/v1/health`);
    return { started: health.status === 200, message: `health ${health.status}` };
  } catch (error) {
    return { started: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    await h.stop().catch(() => {});
  }
}

/** DB 有冇被改：資料 CHECKSUM 同 schema 物件。 */
export async function databaseState(admin, schema) {
  return JSON.stringify([await tableChecksums(admin, schema), await schemaObjects(admin, schema)]);
}

/** 行晒所有情況；回每個情況嘅結果，唔拋。 */
export async function runStartupCases({ admin, schema, user, password }) {
  const results = [];
  for (const scenario of startupCases(admin, schema)) {
    const result = { name: scenario.name };
    try {
      await scenario.remove();
      const before = await databaseState(admin, schema);
      const refused = await tryStart({ database: schema, user, password });
      result.refused = !refused.started && scenario.refusal.test(refused.message);
      result.message = refused.message.slice(0, 300);
      result.unchanged = (await databaseState(admin, schema)) === before;
      await scenario.restore();
      result.startsAfterRestore = (await tryStart({ database: schema, user, password })).started;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    result.passed = Boolean(result.refused && result.unchanged && result.startsAfterRestore && !result.error);
    results.push(result);
  }
  return results;
}
