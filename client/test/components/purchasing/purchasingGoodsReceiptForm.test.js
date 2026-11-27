import { flushPromises, mount } from "@vue/test-utils";
import { QSelect, Quasar } from "quasar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/framework/ui/confirm.js", () => ({ confirm: vi.fn() }));
import { confirm } from "@/framework/ui/confirm.js";
vi.mock("@/services/purchasing.js", () => ({ default: { lookupReceivingWarehouses: vi.fn(), lookupReceivingBins: vi.fn() } }));
import purchasing from "@/services/purchasing.js";
import GoodsReceiptForm from "@/components/purchasing/GoodsReceiptForm.vue";
import { toPayload } from "@/components/purchasing/receiptForm.js";

const poLine = (id, fields = {}) => ({ id, lineNumber: id - 10, skuCode: `SKU${id}`, skuName: `貨品${id}`, trackingPolicy: "none", baseUomId: 1, baseUomCode: "EA",
  purchaseSkuUomId: 50, purchaseUomId: 2, purchaseUomCode: "BOX", uomToBaseFactor: 12, orderedBaseQuantity: "24", netReceivedBaseQuantity: "0",
  outstandingBaseQuantity: "24", closedRemainingBaseQuantity: "0", ...fields });
const purchaseOrder = { id: 5, defaultReceivingWarehouseId: 3, lines: [poLine(11), poLine(12, { trackingPolicy: "batch_expiry", purchaseUomId: 1, purchaseUomCode: "EA", uomToBaseFactor: 1,
  orderedBaseQuantity: "10", outstandingBaseQuantity: "10" }), poLine(13, { outstandingBaseQuantity: "0" })] };
const draft = { id: 8, version: 2, businessReceiptDate: "2026-11-20", supplierDeliveryNote: "", notes: "", supplierExceptionReason: "", lines: [] };

let wrapper;
async function mountForm(props = {}) {
  const onSave = vi.fn().mockResolvedValue({ status: "DRAFT" }), onConfirm = vi.fn().mockResolvedValue({ status: "CONFIRMED" });
  wrapper = mount(GoodsReceiptForm, { props: { document: draft, purchaseOrder, onSave, onConfirm, ...props }, global: { plugins: [Quasar] }, attachTo: document.body });
  await flushPromises();
  return { onSave, onConfirm };
}
const select = (label) => wrapper.findAllComponents(QSelect).filter((field) => field.props("label") === label);
const button = (label) => wrapper.findAll("button").find((b) => b.text().includes(label));
const pick = async (field, value) => { field.vm.$emit("update:modelValue", value); await flushPromises(); };
const type = async (label, value, at = 0) => {
  const fields = wrapper.findAll(".q-field").filter((field) => field.find(".q-field__label").exists() && field.find(".q-field__label").text().startsWith(label));
  await fields[at].find("input, textarea").setValue(value); await flushPromises();
};

describe("GoodsReceiptForm（TASK-030）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    purchasing.lookupReceivingWarehouses.mockResolvedValue([{ id: 3, code: "W3", name: "主倉" }, { id: 4, code: "W4", name: "副倉" }]);
    confirm.mockResolvedValue(true);
    purchasing.lookupReceivingBins.mockImplementation(async (id) => (id === 3 ? [{ id: 31, code: "A1" }] : [{ id: 41, code: "B1" }]));
  });
  afterEach(() => wrapper?.unmount());

  it("只可加入有未收數量的行；預設 Purchase UOM 及 PO 預設倉；可分拆兩個明細；換倉清走庫位；儲存送完整 replace body", async () => {
    const { onSave } = await mountForm();
    const [adder] = select("加入採購單行");
    expect(adder.props("options").map((line) => line.id)).toEqual([11, 12]);
    await pick(adder, purchaseOrder.lines[0]);
    expect(purchasing.lookupReceivingBins).toHaveBeenCalledWith(3);
    await type("數量", "1");
    await pick(select("庫位 *")[0], 31);
    await button("新增明細").trigger("click"); await flushPromises();
    await type("數量", "6", 1);
    await pick(select("單位 *")[1], 1);
    await pick(select("倉庫 *")[1], 4);
    expect(purchasing.lookupReceivingBins).toHaveBeenLastCalledWith(4);
    await pick(select("庫位 *")[1], 41);
    await pick(select("倉庫 *")[0], 4);
    expect(wrapper.vm.$.setupState.form.lines[0].details[0].binId).toBeNull();
    await pick(select("庫位 *")[0], 41);
    await pick(select("庫存狀態 *")[0], "QUARANTINED");
    await button("儲存草稿").trigger("click"); await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(onSave).toHaveBeenCalledWith({ version: 2, businessReceiptDate: "2026-11-20", lines: [{ purchaseOrderLineId: 11, details: [
      { inputUomId: 2, receivedQuantity: "1", warehouseId: 4, binId: 41, stockStatus: "QUARANTINED" },
      { inputUomId: 1, receivedQuantity: "6", warehouseId: 4, binId: 41, stockStatus: "AVAILABLE" }] }] });
  });

  it("批次效期行顯示批號及到期日；超收顯示原因欄；確認送同一 body；伺服器 details.field 映射到對應欄位", async () => {
    const failure = Object.assign(new Error("這個貨品必須填寫批號"), { code: "LOT_REQUIRED", details: { field: "lines.0.details.0.lotNumber" } });
    await mountForm({ onConfirm: vi.fn().mockRejectedValueOnce(failure).mockResolvedValue({ status: "CONFIRMED" }) });
    await pick(select("加入採購單行")[0], purchaseOrder.lines[1]);
    expect(wrapper.text()).toContain("到期日 *");
    await type("數量", "12");
    expect(wrapper.text()).toContain("預計超收 2");
    await type("超收原因", "整箱多送");
    await pick(select("庫位 *")[0], 31);
    await button("確認收貨並入庫").trigger("click"); await wrapper.find("form").trigger("submit"); await flushPromises();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("日後如需更正，請另開沖銷單") }));
    expect(wrapper.vm.$.props.onConfirm).toHaveBeenCalledTimes(1);
    const lot = wrapper.findAll(".q-field").find((field) => field.find(".q-field__label").text().startsWith("批號"));
    expect(lot.text()).toContain("這個貨品必須填寫批號");
    expect(wrapper.find("[role=alert]").exists()).toBe(true);
  });

  it("確認前彈出更正方式提示；取消就唔送", async () => {
    const { onConfirm, onSave } = await mountForm();
    await pick(select("加入採購單行")[0], purchaseOrder.lines[0]);
    await type("數量", "1");
    await pick(select("庫位 *")[0], 31);
    confirm.mockResolvedValueOnce(false);
    await button("確認收貨並入庫").trigger("click"); await wrapper.find("form").trigger("submit"); await flushPromises();
    expect([onConfirm.mock.calls.length, onSave.mock.calls.length]).toEqual([0, 0]);
  });

  it("toPayload 去走空白選填欄位，保留原因及批次資料", () => {
    expect(toPayload({ businessReceiptDate: "2026-11-20", supplierDeliveryNote: " ", notes: "", supplierExceptionReason: "封鎖原因原因",
      lines: [{ purchaseOrderLineId: 12, overReceiptReason: "", skuExceptionReason: "改了追蹤", details: [{ inputUomId: 1, receivedQuantity: " 3 ", warehouseId: 3, binId: 31,
        lotNumber: "L1", expiryDate: "2027-01-01", manufactureDate: null, stockStatus: "QUARANTINED", expiryOverrideReason: "" }] }] }, 4)).toEqual({
      version: 4, businessReceiptDate: "2026-11-20", supplierDeliveryNote: " ", supplierExceptionReason: "封鎖原因原因",
      lines: [{ purchaseOrderLineId: 12, skuExceptionReason: "改了追蹤", details: [{ inputUomId: 1, receivedQuantity: "3", warehouseId: 3, binId: 31, lotNumber: "L1",
        expiryDate: "2027-01-01", stockStatus: "QUARANTINED" }] }] });
  });
});
