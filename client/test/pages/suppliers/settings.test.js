import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/supplierSettings.js", () => ({
  default: { get: vi.fn(), update: vi.fn(), businessMasterReadiness: vi.fn() },
  service: { name: "supplierSettings" }
}));
vi.mock("@/framework/ui/notify.js", () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock("@/framework/ui/confirm.js", () => ({ promptPassword: vi.fn() }));

import supplierSettingsService from "@/services/supplierSettings.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import SupplierSettingsPage, { page } from "@/pages/suppliers/SupplierSettingsPage.vue";
import { useSessionStore } from "@/stores/session.js";

const SETTINGS_OFF = { requireActivationApproval: false, version: 4, updatedAt: 1700000000000, updatedBy: 1 };
const READY = {
  status: "READY", providerContract: "business-master-currency-payment-term-provider/v1",
  schemaReady: true, hkdReady: true, permissionsReady: true,
  activeCurrencyCount: 3, activePaymentTermCount: 2
};

async function mountPage({
  permissions = ["supplier.settings", "business_master.view"],
  settings = SETTINGS_OFF,
  readiness = READY,
  readinessError = null,
  settingsError = null
} = {}) {
  if (settingsError) supplierSettingsService.get.mockRejectedValue(settingsError);
  else supplierSettingsService.get.mockResolvedValue(settings);
  if (readinessError) supplierSettingsService.businessMasterReadiness.mockRejectedValue(readinessError);
  else supplierSettingsService.businessMasterReadiness.mockResolvedValue(readiness);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: page.path, component: SupplierSettingsPage },
      { path: "/system/business-master/currencies", component: { template: "<div>currencies</div>" } },
      { path: "/system/business-master/payment-terms", component: { template: "<div>terms</div>" } }
    ]
  });
  await router.push(page.path);
  await router.isReady();
  useSessionStore().user = { id: 1, permissions, roles: [] };
  const wrapper = mount(SupplierSettingsPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, router, body: new DOMWrapper(document.body) };
}

function toggle(wrapper) {
  return wrapper.find(".q-toggle");
}

describe("pages/suppliers/SupplierSettingsPage.vue", () => {
  beforeEach(() => { setActivePinia(createPinia()); document.body.innerHTML = ""; vi.clearAllMocks(); });

  it("is gated on supplier.settings alone and sits in the supplier menu", () => {
    // AC：只有 supplier.settings 睇到／入到。router guard 用嘅就係呢個 metadata。
    expect(page.requires.permissions).toEqual(["supplier.settings"]);
    expect(page.menu.group).toBe("suppliers");
    expect(page.path).toBe("/suppliers/settings");
  });

  it("shows the stored value, the default and the non-retroactive wording", async () => {
    const { body } = await mountPage();
    expect(body.text()).toContain("預設為關閉");
    expect(body.text()).toContain("目前為");
    expect(body.text()).toContain("關閉");
    expect(body.text()).toContain("不追溯處理已在審批中的申請");
  });

  it("saving the toggle demands a reason and a password, and sends the loaded version", async () => {
    promptPassword.mockResolvedValue({ reason: "公司開始要求覆核", password: "pw" });
    supplierSettingsService.update.mockResolvedValue({ ...SETTINGS_OFF, requireActivationApproval: true, version: 5 });
    const { wrapper, body } = await mountPage();

    await toggle(wrapper).trigger("click");
    await flushPromises();

    expect(promptPassword).toHaveBeenCalledWith(expect.objectContaining({ requireReason: true }));
    expect(supplierSettingsService.update).toHaveBeenCalledWith({
      requireActivationApproval: true, version: 4, reason: "公司開始要求覆核", password: "pw"
    });
    expect(notifySuccess).toHaveBeenCalled();
    expect(body.text()).toContain("開啟");
  });

  it("cancelling the confirmation writes nothing", async () => {
    promptPassword.mockResolvedValue(null);
    const { wrapper } = await mountPage();
    await toggle(wrapper).trigger("click");
    await flushPromises();
    expect(supplierSettingsService.update).not.toHaveBeenCalled();
  });

  it("a version conflict shows the server's value, not the one the user just clicked", async () => {
    // AC：conflict 唔自動重試，重載之後要反映**服務器**嘅值。
    //
    // REV-028 H-2：呢個 case 本來由 OFF 開始、使用者㩒去 ON、而服務器嘅值又係 ON，
    // 三個值一樣，所以 aria-checked === "true" 分唔開「服務器嘅值」同「使用者㩒嗰
    // 個」。喺 loadSettings() 之後加返 `requireActivationApproval: target` —— 即係
    // AC 明文禁止嗰種錯 —— 個 mutant 生還晒。而家起手係 ON、使用者㩒去 OFF、服務器
    // 去咗 ON，兩個值唔同，斷言先至有鑑別力。
    promptPassword.mockResolvedValue({ reason: "公司開始要求覆核", password: "pw" });
    const conflict = Object.assign(new Error("設定已被其他人修改"), { code: "VERSION_CONFLICT" });
    supplierSettingsService.update.mockRejectedValue(conflict);
    const { wrapper, body } = await mountPage({ settings: { ...SETTINGS_OFF, requireActivationApproval: true } });
    expect(toggle(wrapper).attributes("aria-checked")).toBe("true");
    supplierSettingsService.get.mockResolvedValue({ ...SETTINGS_OFF, requireActivationApproval: true, version: 9 });

    await toggle(wrapper).trigger("click");
    await flushPromises();

    expect(supplierSettingsService.update).toHaveBeenCalledWith(
      expect.objectContaining({ requireActivationApproval: false })
    );
    expect(supplierSettingsService.get).toHaveBeenCalledTimes(2);
    expect(notifyError).toHaveBeenCalledWith(expect.stringContaining("重新載入"));
    // 使用者㩒嘅係 OFF，服務器揸住 ON。顯示 OFF 就係顯示緊一個服務器冇嘅值。
    expect(toggle(wrapper).attributes("aria-checked")).toBe("true");
    expect(body.text()).toContain("目前為");
  });

  it("a failed settings read renders an error and a retry, not a crash", async () => {
    // REV-028 H-1：settings 留喺 null 而 loading 又收咗掣，template 就會 dereference
    // 佢，使用者見到嘅係一句 raw TypeError。
    const { wrapper, body } = await mountPage({ settingsError: new Error("網路錯誤，請檢查連線") });
    expect(body.text()).toContain("網路錯誤");
    expect(body.text()).not.toMatch(/Cannot read propert/u);
    expect(toggle(wrapper).exists()).toBe(false);
    expect(notifyError).toHaveBeenCalled();

    supplierSettingsService.get.mockResolvedValue(SETTINGS_OFF);
    await body.findAll("button").find((button) => button.text().includes("重新載入")).trigger("click");
    await flushPromises();
    expect(toggle(wrapper).exists()).toBe(true);
  });

  it("shows Business Master readiness read-only, with no catalog write control", async () => {
    // AC：只顯示 provider readiness 同唯讀連結；冇 create／update／deactivate。
    //
    // 呢度刻意**唔**用「文字入面唔可以出現『新增』」嚟斷言：解釋文案本身就有一句
    // 「不在這裡新增或修改」，所以嗰種寫法會因為一句講明冇寫入功能嘅說明而紅，
    // 亦都攔唔住一個叫做「建立」嘅掣。要守嘅係結構——呢張卡入面唯一嘅互動元素
    // 只可以係導向 Business Master 嘅連結，而且唔可以有任何輸入欄位。
    const { wrapper, body } = await mountPage();
    expect(body.text()).toContain("可用貨幣 3 項");
    expect(body.text()).toContain("可用付款條款 2 項");

    const card = wrapper.findAll(".q-card").at(1);
    expect(card.text()).toContain("貨幣與付款條款");
    for (const control of card.findAll("button, a")) {
      expect(control.attributes("href")).toMatch(/^\/system\/business-master\//u);
    }
    expect(card.findAll("input, textarea, select")).toHaveLength(0);
    expect(supplierSettingsService.update).not.toHaveBeenCalled();
  });

  it("names what is missing when the provider is not ready", async () => {
    const { body } = await mountPage({
      readiness: { ...READY, status: "NOT_READY", hkdReady: false, permissionsReady: false, activeCurrencyCount: 0 }
    });
    expect(body.text()).toContain("未就緒");
    expect(body.text()).toContain("HKD 基準貨幣尚未就緒");
    expect(body.text()).toContain("Business Master 權限尚未種入");
    expect(body.text()).not.toContain("資料表尚未建立");
  });

  it("links to Business Master only when the actor may open it", async () => {
    const allowed = await mountPage();
    expect(allowed.body.text()).toContain("前往管理貨幣");
    expect(allowed.body.text()).toContain("前往管理付款條款");
    allowed.wrapper.unmount();
    document.body.innerHTML = "";

    const denied = await mountPage({ permissions: ["supplier.settings"] });
    expect(denied.body.text()).not.toContain("前往管理貨幣");
    expect(denied.body.text()).toContain("需要 Business Master 檢視權限");
  });

  it("a readiness failure does not take the toggle down with it", async () => {
    // 開關本身同 Business Master 無關；依賴狀態讀唔到唔應該令成頁用唔到。
    const { wrapper, body } = await mountPage({ readinessError: new Error("網路錯誤，請檢查連線") });
    expect(body.text()).toContain("網路錯誤");
    expect(toggle(wrapper).exists()).toBe(true);
    expect(body.text()).toContain("啟用供應商前需要另一名使用者審批");
  });
});
