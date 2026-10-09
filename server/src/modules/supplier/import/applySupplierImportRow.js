import { invalidSupplierInput, supplierNotFound } from "../supplierErrors.js";

/**
 * 真正寫 Supplier 嘅 applyRow（T45；設計 §6.9、§8.8；HD-060）。
 *
 * 全部經 UI／API 用緊嘅同一批 connection-taking helper（HD-060 2A，BR-026），喺 processNextRow 嘅
 * transaction 入面寫，所以 Supplier、子資料、audit 同 applied marker 一次 commit。Precheck 只係 snapshot：
 * Code／Identifier 有冇被人用、目標有冇封存、expected version、幣別同付款條款仲啟唔啟用，helper 全部再驗。
 *
 * - 新增列：模式同審批用 confirm 嗰陣嘅 snapshot（AC-013）；子資料喺開審批申請之前寫，申請嘅 snapshot
 *   包括同一次建立嘅 Identifier。審批人而家冇資格就成列失敗（HD-060 3A）。
 * - 更新列：只改 root 一般欄位，唔改狀態；空白 = 保持原值。改幣別要原因，用「CSV 匯入 #job」。
 */
export function createSupplierImportApplier({ suppliers, addresses, contacts, identifiers }) {
  return async function applySupplierImportRow(connection, { job, row, actor }) {
    const payload = typeof row.normalized_payload === "string" ? JSON.parse(row.normalized_payload) : row.normalized_payload;
    const root = payload?.root ?? {};
    const note = `CSV 匯入 #${job.id}`;
    // requestId 指返個 job，audit 查得返係邊次匯入寫嘅（REV-071 I-4）。
    const base = { actorId: actor.id, requestId: `import-${job.id}`, ip: "" };
    const activate = job.activation_mode === "activate";
    const approvalRequired = Number(job.approval_setting_value) === 1;

    if (row.operation === "create") {
      // 審批人個 user 俾人刪咗（FK SET NULL）：同「冇資格」一樣處理，唔好報「未指定」（REV-071 I-2，HD-060 3A）。
      if (activate && approvalRequired && job.approver_user_id === null) {
        throw invalidSupplierInput("APPROVER_NOT_ELIGIBLE", "指定的審批人不是有效使用者", { field: "approverUserId" });
      }
      // 匯入唔做相似名稱搜尋（HD-052；HD-075）：預檢已經警告完全相同嘅名稱，相似搜尋嘅結果冇人用，而且成本隨 Supplier 數目上升。
      const { id } = await suppliers.createSupplierInTransaction(connection, {
        findDuplicates: false,
        actor,
        input: {
          ...base, ...root, activate,
          approverUserId: job.approver_user_id === null ? undefined : Number(job.approver_user_id), requestNote: note
        },
        approvalRequired: async () => approvalRequired,
        addChildren: async (supplierId) => {
          if (payload.address) await addresses.createInTransaction(connection, { actor, input: { ...base, ...payload.address, supplierId } });
          if (payload.contact) await contacts.createInTransaction(connection, { actor, input: { ...base, ...payload.contact, supplierId } });
          if (payload.identifier) {
            await identifiers.createInTransaction(connection, { actor, input: {
              ...base, supplierId, identifierType: payload.identifier.type,
              issuerCountryCode: payload.identifier.issuerCountryCode, identifierValue: payload.identifier.value
            } });
          }
        }
      });
      return id;
    }

    if (row.operation === "update") {
      const id = Number(row.match_supplier_id);
      const [[current]] = await connection.query("SELECT * FROM suppliers WHERE id = ? FOR UPDATE", [id]);
      if (!current) throw supplierNotFound(id);
      const keep = (field, column) => (Object.hasOwn(root, field) ? root[field] : current[column]);
      await suppliers.updateSupplierInTransaction(connection, { actor, findDuplicates: false, input: {
        ...base, id, version: Number(row.expected_supplier_version), reason: note,
        supplierName: keep("supplierName", "supplier_name"),
        displayName: keep("displayName", "display_name"),
        defaultCurrencyCode: keep("defaultCurrencyCode", "default_currency_code"),
        defaultPaymentTermId: keep("defaultPaymentTermId", "default_payment_term_id"),
        website: keep("website", "website"),
        generalPhone: keep("generalPhone", "general_phone"),
        generalEmail: keep("generalEmail", "general_email"),
        notes: keep("notes", "notes")
      } });
      return id;
    }

    throw new TypeError("Supplier import operation is invalid");
  };
}
