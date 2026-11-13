import { describe, expect, it, vi } from "vitest";
import { buildMenu } from "@/framework/discovery/buildMenu.js";
import { validatePages } from "@/framework/discovery/validatePages.js";
import { HttpClient } from "@/framework/http/HttpClient.js";
import { ERROR_CODE_MESSAGES } from "@/framework/http/errorMessages.js";
import { PURCHASING_ERROR_STATUS } from "../../../../server/src/modules/purchasing/purchasingErrors.js";
import menuConfig from "@config/menu.js";

const pages = Object.values(import.meta.glob(["/src/pages/purchasing/*.vue", "/src/pages/receiving/*.vue"], { eager: true }));
const session = (permissions) => ({ isAuthenticated: true, roles: [], permissions });
const group = (permissions) => buildMenu(pages, session(permissions)).find(({ name }) => name === "purchasingReceiving");

describe("TASK-021 採購導航", () => {
  it("有 purchasing.view 先見到群組，入面只有採購單", () => {
    const shown = group(["purchasing.view"]);
    expect(shown).toMatchObject({ label: "採購與收貨" });
    expect(shown.items.map(({ name, path, title }) => ({ name, path, title }))).toEqual([{ name: "purchase-orders", path: "/purchasing/purchase-orders", title: "採購單" }]);
  });
  it.each([[[]], [["purchasing.mgmt"]], [["sales.view"]]])("權限 %j 唔見群組", (permissions) => {
    expect(group(permissions)).toBeUndefined();
  });
  it("TASK-024：待我審批要 view＋approval、採購設定要 settings 先入選單；收貨頁未有入口；詳情、新增、編輯、列印唔入選單", () => {
    const full = group(["purchasing.view", "purchasing.mgmt", "purchasing.approval", "purchasing.settings", "receiving.operation"]);
    expect(full.items.map(({ name }) => name)).toEqual(["purchase-orders", "my-purchase-order-approvals", "purchasing-settings"]);
    expect(group(["purchasing.view", "purchasing.mgmt"]).items.map(({ name }) => name)).toEqual(["purchase-orders"]);
    expect(group(["purchasing.approval"])).toBeUndefined();
    expect(group(["purchasing.settings"]).items.map(({ name }) => name)).toEqual(["purchasing-settings"]);
    expect(pages.filter(({ page }) => page.menu).map(({ page }) => page.name).sort()).toEqual(["my-purchase-order-approvals", "purchase-orders", "purchasing-settings"]);
    expect(pages.map(({ page }) => page.name).sort()).toEqual(["my-purchase-order-approvals", "purchase-order-create", "purchase-order-detail", "purchase-order-edit", "purchase-order-print", "purchase-orders", "purchasing-settings"]);
  });
  it("群組已登記，排喺供應商同客戶之間，頁面通過啟動驗證", () => {
    const names = [...menuConfig.groups].sort((a, b) => a.order - b.order).map(({ name }) => name);
    expect(names.slice(names.indexOf("suppliers"), names.indexOf("customers") + 1)).toEqual(["suppliers", "purchasingReceiving", "customers"]);
    expect(() => validatePages(pages)).not.toThrow();
  });
});

describe("TASK-021 採購錯誤訊息", () => {
  it("server 每個採購錯誤碼都有繁中訊息，唔係原文代碼", () => {
    for (const code of Object.keys(PURCHASING_ERROR_STATUS)) {
      const message = ERROR_CODE_MESSAGES[code];
      expect(message, code).toMatch(/\p{Script=Han}/u);
      expect(message, code).not.toMatch(/[A-Z]{2,}_[A-Z]/u);
    }
  });
  it("多個模組共用嘅訊息要啱採購：唔可以只講庫存，換算問題要叫用戶先檢查數量", () => {
    expect(ERROR_CODE_MESSAGES.CONCURRENT_OPERATION).not.toContain("庫存");
    expect(ERROR_CODE_MESSAGES.UOM_CONVERSION_INVALID).toContain("檢查數量");
  });
  const reject = (body, status = 409) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    return new HttpClient({ fetchImpl, getToken: () => null }).get("/api/v1/purchase-orders").catch((error) => error);
  };
  it("HttpClient 用繁中訊息取代 server 文字，code 同 status 保留", async () => {
    const error = await reject({ success: false, error: { code: "PO_MASTER_CHANGED", message: "server text" } });
    expect(error).toMatchObject({ code: "PO_MASTER_CHANGED", status: 409, message: ERROR_CODE_MESSAGES.PO_MASTER_CHANGED });
  });
  it("未知 code 沿用 server 嘅公開訊息；冇訊息先用安全 fallback", async () => {
    expect((await reject({ success: false, error: { code: "SOMETHING_NEW", message: "伺服器訊息" } })).message).toBe("伺服器訊息");
    const blank = await reject({ success: false, error: { code: "SOMETHING_NEW" } });
    expect(blank.message).toBeTruthy();
    expect(blank.message).not.toContain("SOMETHING_NEW");
  });
});
