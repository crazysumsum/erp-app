import { flushPromises, mount } from "@vue/test-utils";
import { QSelect, Quasar } from "quasar";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/purchasing.js", () => ({ default: Object.fromEntries(["lookupSuppliers", "getSupplierDefaults", "lookupSkus", "lookupCurrencies", "lookupPaymentTerms", "lookupWarehouses", "lookupBuyers", "createPurchaseOrder", "updatePurchaseOrder", "submitPurchaseOrder"].map((name) => [name, vi.fn()])) }));
import purchasing from "@/services/purchasing.js";
import Form from "@/components/purchasing/PurchaseOrderForm.vue";
import { previewBaseQuantity, previewLineAmount, previewTotal } from "@/components/purchasing/purchasingEditorMath.js";
import { documentTotal, lineAmount } from "../../../../server/src/modules/purchasing/moneyMath.js";
import { toBaseQuantity } from "../../../../server/src/modules/purchasing/quantityMath.js";

const actor = { id: 7, label: "Alice" };
const supplierA = { supplierId: 2, supplierCode: "S2", displayName: "供應商二" }, supplierB = { supplierId: 3, supplierCode: "S3", displayName: "供應商三" };
const defaults = (id, currency = "HKD") => ({ supplierId: id, currency: { code: currency, name: currency, decimalPlaces: currency === "JPY" ? 0 : 2 }, paymentTerm: { id: 40 + id, code: `T${id}`, name: "條款" },
  orderingAddress: { id: 90 + id, addressLine1: `${id} Road`, city: "Hong Kong", countryCode: "HK" } });
const sku = { skuId: 5, skuCode: "SKU5", skuName: "貨品五", itemName: "貨品", trackingPolicy: "batch", inventoryTracked: true, minimumReceiptLifeDays: 30, baseUomCode: "EA",
  uoms: [{ skuUomId: 50, uomCode: "EA", uomName: "件", toBaseFactor: 1, isBase: true, isDefaultPurchase: false }, { skuUomId: 51, uomCode: "CTN", uomName: "箱", toBaseFactor: 12, isBase: false, isDefaultPurchase: true }] };
const draft = { id: 8, number: "PO-202611-000008", status: "DRAFT", version: 2, supplierId: 2, supplierCode: "S2", supplierName: "供應商二", orderingAddressId: 92, orderingAddress: { addressLine1: "2 Road", city: "Hong Kong", countryCode: "HK" },
  currencyCode: "HKD", currencyName: "港元", currencyDecimalPlaces: 2, paymentTermId: 42, paymentTerm: { code: "T2", name: "條款", calculationType: "NET_DAYS", dueDays: 30 }, orderDate: "2026-11-04", expectedDeliveryDate: null,
  defaultReceivingWarehouseId: 6, defaultWarehouseCode: "W6", buyerId: 9, buyerLabel: "Bob", supplierReference: "REF", notes: "", totalAmount: "2.50", allowedActions: ["edit", "submit", "copy"],
  lines: [{ id: 11, skuId: 5, skuCode: "SKU5", skuName: "貨品五", trackingPolicy: "batch", baseUomCode: "EA", purchaseSkuUomId: 50, purchaseUomCode: "EA", uomToBaseFactor: 1, orderedQuantity: "2.000000", unitPrice: "1.2500", zeroPriceReason: "", expectedDeliveryDate: null, lineNote: "" }] };
const saved = { id: 8, number: draft.number, status: "DRAFT", version: 3, warnings: [], replayed: false };
const apiError = (message, fields) => Object.assign(new Error(message), fields);

let wrapper;
async function mountForm(props = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/edit", component: { render: () => h(Form, { actor, ...props }) } }, { path: "/other", component: { template: "<div>other</div>" } }] });
  await router.push("/edit"); await router.isReady();
  wrapper = mount({ render: () => h(RouterView) }, { global: { plugins: [Quasar, router] }, attachTo: window.document.body });
  await flushPromises();
  return { form: wrapper.findComponent(Form), router };
}
const input = (label) => wrapper.findAll(".q-field").find((field) => field.find(".q-field__label").text().startsWith(label)).find("input, textarea");
const select = (label) => wrapper.findAllComponents(QSelect).find((field) => field.props("label") === label);
const button = (label) => wrapper.findAll("button").find((b) => b.text() === label || b.attributes("aria-label") === label);
const pick = async (label, value) => { select(label).vm.$emit("update:modelValue", value); await flushPromises(); };
const submit = async () => { await wrapper.find("form").trigger("submit"); await flushPromises(); };
async function addLine() { await pick("搜尋貨品", sku); await button("新增明細").trigger("click"); await flushPromises(); }

beforeEach(() => {
  vi.clearAllMocks();
  purchasing.lookupCurrencies.mockResolvedValue([{ code: "HKD", name: "港元", decimalPlaces: 2 }, { code: "JPY", name: "日圓", decimalPlaces: 0 }, { code: "USD", name: "美元", decimalPlaces: 2 }]);
  purchasing.lookupPaymentTerms.mockResolvedValue([{ id: 42, code: "T2", name: "條款" }, { id: 43, code: "T3", name: "條款" }, { id: 44, code: "T4", name: "手動" }]);
  purchasing.getSupplierDefaults.mockImplementation((id) => Promise.resolve(defaults(id)));
});
afterEach(() => { wrapper?.unmount(); wrapper = null; vi.restoreAllMocks(); window.document.body.innerHTML = ""; });

describe("預覽同 server 一致（§7.3）", () => {
  // 同一組輸入經 client helper 同真 server module，唔係抄低預期值。
  const cases = [["2", "1.25", 2], ["0.000001", "0.0001", 4], ["1.5", "0.005", 2], ["1.5", "0.0049", 2], ["3", "0.5", 0], ["2.5", "1", 0], ["12345678.123456", "1234567.1234", 4], ["1", "0", 2], ["00012.500000", "007.1000", 3]];
  it.each(cases)("數量 %s × 單價 %s（%i 位）", (quantity, price, places) => {
    expect(previewLineAmount(quantity, price, places)).toBe(lineAmount(quantity, price, places));
  });
  it("Total 係已 round Line Amount 之和；factor 換算同 server 一樣，唔整除就回 null", () => {
    const amounts = [["1.005", "1"], ["1.005", "1"]].map(([q, p]) => lineAmount(q, p, 2));
    expect(previewTotal(amounts, 2)).toBe(documentTotal(amounts, 2));
    expect(previewTotal([lineAmount("3", "1", 0), lineAmount("4", "2", 0)], 0)).toBe(documentTotal(["3", "8"], 0));
    expect(previewTotal([null], 2)).toBeNull();
    expect(previewBaseQuantity("1.5", 12)).toBe(String(toBaseQuantity("1.5", 12)));
    expect(() => toBaseQuantity("1.5", 1)).toThrow();
    expect(previewBaseQuantity("1.5", 1)).toBeNull();
    expect(previewLineAmount("0", "1", 2)).toBeNull();
    expect(previewLineAmount("1", "1", null)).toBeNull();
  });
});

describe("TC-003 PO form", () => {
  it("建立：帶入 Supplier 預設、預設 Buyer 係自己，只送可編輯欄位", async () => {
    purchasing.createPurchaseOrder.mockResolvedValue(saved);
    const { form } = await mountForm();
    await pick("供應商 *", supplierA);
    expect(purchasing.getSupplierDefaults).toHaveBeenCalledWith(2, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(select("貨幣 *").props("modelValue")).toBe("HKD");
    expect(select("付款條款（選填）").props("modelValue")).toBe(42);
    expect(wrapper.find('[data-testid="ordering-address"]').text()).toContain("2 Road");
    await addLine();
    expect(wrapper.find('[data-testid="po-line"]').text()).toContain("CTN");
    await input("單價 1").setValue("3.5");
    await input("數量 1").setValue("2");
    expect(wrapper.find('[data-testid="po-line-amount"]').text()).toBe("7.00");
    expect(wrapper.find('[data-testid="po-total"]').text()).toBe("HKD 7.00");
    expect(wrapper.find('[data-testid="po-line"]').text()).toContain("24 EA");
    await submit();
    const [body] = purchasing.createPurchaseOrder.mock.calls[0];
    expect(body).toEqual({ eventId: expect.any(String), supplierId: 2, orderingAddressId: 92, currencyCode: "HKD", paymentTermId: 42, orderDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expectedDeliveryDate: null, defaultReceivingWarehouseId: null, buyerId: 7, supplierReference: "", notes: "",
      lines: [{ skuId: 5, purchaseSkuUomId: 51, orderedQuantity: "2", unitPrice: "3.5", expectedDeliveryDate: null, lineNote: "" }] });
    expect(form.emitted("saved")).toEqual([[saved]]);
  });

  it("用戶改過嘅貨幣同條款，換 Supplier 都唔蓋；未改過嘅照帶；地址一定跟新 Supplier", async () => {
    await mountForm();
    await pick("供應商 *", supplierA);
    await pick("貨幣 *", "USD");
    await pick("供應商 *", supplierB);
    expect(select("貨幣 *").props("modelValue")).toBe("USD");
    expect(select("付款條款（選填）").props("modelValue")).toBe(43);
    expect(wrapper.find('[data-testid="ordering-address"]').text()).toContain("3 Road");
    expect(wrapper.text()).toContain("與供應商預設（HKD）不同");
    await pick("付款條款（選填）", 44);
    await pick("供應商 *", supplierA);
    expect(select("付款條款（選填）").props("modelValue")).toBe(44);
  });

  it("舊 Supplier 嘅預設遲返嚟唔會蓋住新 Supplier", async () => {
    let finishOld;
    purchasing.getSupplierDefaults.mockImplementationOnce((_id, { signal }) => new Promise((resolve) => { finishOld = () => resolve(defaults(2, "JPY")); signal.addEventListener("abort", () => {}); }));
    await mountForm();
    select("供應商 *").vm.$emit("update:modelValue", supplierA);
    await pick("供應商 *", supplierB);
    finishOld();
    await flushPromises();
    expect(select("貨幣 *").props("modelValue")).toBe("HKD");
    expect(select("付款條款（選填）").props("modelValue")).toBe(43);
  });

  it("預設值失效只係提示，用戶可以手動揀；Supplier 冇地址就唔送舊地址 ID", async () => {
    purchasing.getSupplierDefaults.mockResolvedValueOnce(defaults(2)).mockRejectedValueOnce(apiError("付款條款目前不可用", { code: "PAYMENT_TERM_NOT_ACTIVE", status: 409 }));
    await mountForm();
    await pick("供應商 *", supplierA);
    await pick("供應商 *", supplierB);
    expect(wrapper.text()).toContain("付款條款目前不可用；請手動選擇貨幣及付款條款。");
    expect(wrapper.find('[data-testid="ordering-address"]').text()).toContain("沒有主要訂購地址");
    await addLine();
    await input("單價 1").setValue("1");
    purchasing.createPurchaseOrder.mockResolvedValue(saved);
    await submit();
    expect(purchasing.createPurchaseOrder.mock.calls[0][0].orderingAddressId).toBeNull();
  });

  it("關閉主要地址之後唔送地址，再開返就送", async () => {
    purchasing.createPurchaseOrder.mockResolvedValue(saved);
    await mountForm();
    await pick("供應商 *", supplierA);
    await addLine();
    await input("單價 1").setValue("1");
    wrapper.findComponent({ name: "QToggle" }).vm.$emit("update:modelValue", false);
    await flushPromises();
    await submit();
    expect(purchasing.createPurchaseOrder.mock.calls[0][0].orderingAddressId).toBeNull();
  });

  it("修改：保留 Line ID 同 version，唔帶 Supplier 預設；Buyer 保持原本嗰位", async () => {
    purchasing.updatePurchaseOrder.mockResolvedValue(saved);
    await mountForm({ document: draft });
    expect(purchasing.getSupplierDefaults).not.toHaveBeenCalled();
    await input("明細備註 1").setValue("改咗");
    await submit();
    expect(purchasing.updatePurchaseOrder).toHaveBeenCalledWith(8, expect.objectContaining({ version: 2, buyerId: 9, orderingAddressId: 92, defaultReceivingWarehouseId: 6,
      lines: [{ id: 11, skuId: 5, purchaseSkuUomId: 50, orderedQuantity: "2.000000", unitPrice: "1.2500", expectedDeliveryDate: null, lineNote: "改咗" }] }));
    expect(purchasing.createPurchaseOrder).not.toHaveBeenCalled();
  });

  it("零價要原因先送得；有價就唔送原因", async () => {
    purchasing.updatePurchaseOrder.mockResolvedValue(saved);
    await mountForm({ document: draft });
    await input("單價 1").setValue("0");
    await flushPromises();
    await submit();
    expect(purchasing.updatePurchaseOrder).not.toHaveBeenCalled();
    await input("零價原因 1").setValue("樣品不收費");
    await submit();
    expect(purchasing.updatePurchaseOrder.mock.calls[0][1].lines[0]).toMatchObject({ unitPrice: "0", zeroPriceReason: "樣品不收費" });
    expect(wrapper.text()).toContain("1 行為零價");
  });

  it("新增、排序、刪除都係按鈕；同 SKU 重複加都係新一行", async () => {
    await mountForm({ document: draft });
    await addLine();
    expect(wrapper.findAll('[data-testid="po-line"]')).toHaveLength(2);
    expect(button("上移明細 1").attributes("disabled")).toBeDefined();
    await button("下移明細 1").trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="po-line"]')[0].text()).toContain("CTN");
    await button("刪除明細 1").trigger("click");
    await flushPromises();
    expect(wrapper.findAll('[data-testid="po-line"]')).toHaveLength(1);
  });

  it("條碼：搵到就揀，搵唔到提示；SKU 摘要顯示 Base UOM、tracking、效期", async () => {
    purchasing.lookupSkus.mockResolvedValueOnce([sku]).mockResolvedValueOnce([]);
    await mountForm();
    await input("條碼").setValue("B-1");
    await button("搜尋條碼").trigger("click");
    await flushPromises();
    expect(purchasing.lookupSkus).toHaveBeenCalledWith(expect.objectContaining({ barcode: "B-1" }));
    expect(wrapper.find('[data-testid="sku-summary"]').text()).toBe("可採購；基本單位 EA；追蹤：批次；最短收貨效期 30 天");
    expect(select("採購單位").props("modelValue")).toBe(51);
    await input("條碼").setValue("NONE");
    await button("搜尋條碼").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("找不到可採購的貨品");
    expect(select("搜尋貨品").props("modelValue")).toBeNull();
  });

  it("結果未確定：鎖住輸入，重試送一模一樣嘅 eventId 同內容", async () => {
    purchasing.updatePurchaseOrder.mockRejectedValueOnce(apiError("逾時", { code: "TIMEOUT" })).mockResolvedValue(saved);
    await mountForm({ document: draft });
    await input("備註").setValue("第一次");
    await submit();
    expect(wrapper.text()).toContain("結果尚未確認");
    expect(input("數量 1").element.matches(":disabled")).toBe(true);
    await submit();
    expect(purchasing.updatePurchaseOrder.mock.calls[1][1]).toEqual(purchasing.updatePurchaseOrder.mock.calls[0][1]);
    expect(wrapper.text()).not.toContain("結果尚未確認");
  });

  it("欄位錯誤對返去欄位，輸入保留；下一次係新 eventId", async () => {
    purchasing.updatePurchaseOrder.mockRejectedValueOnce(apiError("貨品目前不可用於新採購", { code: "SKU_NOT_PURCHASABLE", status: 409, details: { field: "lines.0.orderedQuantity" } })).mockResolvedValue(saved);
    await mountForm({ document: draft });
    await input("備註").setValue("保留");
    await submit();
    expect(wrapper.text()).toContain("lines.0.orderedQuantity");
    expect(input("備註").element.value).toBe("保留");
    await submit();
    const [first, second] = purchasing.updatePurchaseOrder.mock.calls;
    expect(second[1].eventId).not.toBe(first[1].eventId);
  });

  it("Version conflict：顯示最新版本、保留輸入、可以複製；載入要確認", async () => {
    purchasing.updatePurchaseOrder.mockRejectedValue(apiError("版本已更改", { code: "VERSION_CONFLICT", status: 409, details: { currentVersion: 5 } }));
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { form } = await mountForm({ document: draft });
    await input("備註").setValue("保留輸入");
    await submit();
    expect(wrapper.text()).toContain("最新版本 5");
    expect(input("備註").element.value).toBe("保留輸入");
    await button("複製我的輸入").trigger("click");
    await flushPromises();
    expect(JSON.parse(writeText.mock.calls[0][0]).notes).toBe("保留輸入");
    expect(wrapper.text()).toContain("已複製你的輸入");
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await button("載入最新資料").trigger("click");
    expect(form.emitted("reload")).toBeUndefined();
    await button("載入最新資料").trigger("click");
    expect(form.emitted("reload")).toHaveLength(1);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("Dirty 離開要確認（route 切換、同 route 換 query、瀏覽器關閉）；儲存之後唔再問", async () => {
    purchasing.updatePurchaseOrder.mockResolvedValue(saved);
    const { router } = await mountForm({ document: draft, onSaved: () => router.push("/other") });
    await input("備註").setValue("未儲存");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await router.push("/other");
    expect(router.currentRoute.value.path).toBe("/edit");
    await router.push("/edit?other=1");
    expect(router.currentRoute.value.query).toEqual({});
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const calls = confirm.mock.calls.length;
    await submit();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/other");
    expect(confirm).toHaveBeenCalledTimes(calls);
  });

  it("客戶端驗證擋住：零數量、超精度、唔整除 Base、交期早過訂單日期、冇明細", async () => {
    await mountForm();
    await pick("供應商 *", supplierA);
    await submit();
    expect(wrapper.text()).toContain("請新增至少一項明細");
    await mountFormWithDraft();
    for (const value of ["0", "1.0000001", "1.5"]) { await input("數量 1").setValue(value); await submit(); expect(purchasing.updatePurchaseOrder).not.toHaveBeenCalled(); }
    expect(wrapper.text()).toContain("換算後不是整數 EA");
    await input("數量 1").setValue("1");
    await input("交期 1").setValue("2026-11-03");
    await submit();
    expect(purchasing.updatePurchaseOrder).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("交期不可早於訂單日期");
  });

  it("提交：未儲存唔准，摘要顯示「確認後可收貨」，送 version 同 eventId；結果未確定用同一 eventId 重試", async () => {
    purchasing.submitPurchaseOrder.mockRejectedValueOnce(apiError("逾時", { code: "TIMEOUT" })).mockResolvedValue({ ...saved, status: "CONFIRMED" });
    const { form } = await mountForm({ document: draft });
    await input("備註").setValue("改咗");
    expect(button("提交").attributes("disabled")).toBeDefined();
    await input("備註").setValue("");
    expect(button("提交").attributes("disabled")).toBeUndefined();
    await button("提交").trigger("click");
    await flushPromises();
    const dialog = window.document.body.querySelector('[data-testid="po-submit-summary"]');
    expect(dialog.textContent).toContain("S2 — 供應商二");
    expect(dialog.textContent).toContain("HKD 2.50");
    expect(window.document.body.textContent).toContain("確認後可收貨");
    const dialogButton = (label) => [...window.document.body.querySelectorAll(".q-dialog button")].find((b) => b.textContent.trim() === label);
    dialogButton("確認提交").click();
    await flushPromises();
    expect(window.document.body.textContent).toContain("結果尚未確認");
    dialogButton("重試確認結果").click();
    await flushPromises();
    const [first, second] = purchasing.submitPurchaseOrder.mock.calls;
    expect(first).toEqual([8, { version: 2, eventId: expect.any(String) }]);
    expect(second).toEqual(first);
    expect(form.emitted("submitted")).toHaveLength(1);
  });

  it("提交被拒顯示行號；Version conflict 關 dialog 走 stale 路徑", async () => {
    purchasing.submitPurchaseOrder.mockRejectedValueOnce(apiError("主檔已更改", { code: "PO_MASTER_CHANGED", status: 409, details: { field: "lines.0.purchaseSkuUomId" } }))
      .mockRejectedValueOnce(apiError("版本已更改", { code: "VERSION_CONFLICT", status: 409, details: { currentVersion: 9 } }));
    await mountForm({ document: draft });
    await button("提交").trigger("click");
    await flushPromises();
    const confirmSubmit = () => [...window.document.body.querySelectorAll(".q-dialog button")].find((b) => b.textContent.trim() === "確認提交").click();
    confirmSubmit();
    await flushPromises();
    expect(window.document.body.textContent).toContain("主檔已更改（第 1 行）");
    confirmSubmit();
    await flushPromises();
    expect(wrapper.text()).toContain("最新版本 9");
    expect(button("提交").attributes("disabled")).toBeDefined();
  });

  it("選項載入失敗有重試；搜尋失敗有提示", async () => {
    purchasing.lookupCurrencies.mockRejectedValueOnce(apiError("未能連線", { code: "NETWORK_ERROR" }));
    purchasing.lookupSuppliers.mockRejectedValueOnce(apiError("搜尋失敗", { status: 500 }));
    await mountForm();
    expect(wrapper.text()).toContain("未能連線");
    await button("重試").trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("未能連線");
    select("供應商 *").vm.$emit("filter", "x", (fn) => fn(), () => {});
    await flushPromises();
    expect(wrapper.text()).toContain("搜尋失敗；請重新搜尋");
  });
});

async function mountFormWithDraft() {
  wrapper.unmount();
  await mountForm({ document: { ...draft, lines: [draft.lines[0]] } });
}
