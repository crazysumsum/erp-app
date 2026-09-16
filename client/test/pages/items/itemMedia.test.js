import { flushPromises, mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/itemMedia.js", () => ({
  default: {
    uploadItemMedia: vi.fn(),
    uploadSkuMedia: vi.fn(),
    downloadMedia: vi.fn(),
    updateMedia: vi.fn(),
    deleteMedia: vi.fn()
  },
  service: { name: "itemMedia" }
}));
vi.mock("@/framework/ui/confirm.js", () => ({
  promptPassword: vi.fn()
}));
vi.mock("@/framework/ui/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn()
}));

import itemMediaService from "@/services/itemMedia.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import ItemMediaPanel from "@/components/items/ItemMediaPanel.vue";

const IMAGE_MEDIA = {
  id: 1,
  itemId: 5,
  skuId: null,
  mediaKind: "image",
  originalName: "logo.png",
  mimeType: "image/png",
  byteSize: 2048,
  isPrimary: false,
  sortOrder: 0,
  createdAt: 1700000000000
};
const ATTACHMENT_MEDIA = {
  id: 2,
  itemId: 5,
  skuId: null,
  mediaKind: "attachment",
  originalName: "spec.pdf",
  mimeType: "application/pdf",
  byteSize: 4096,
  isPrimary: false,
  sortOrder: 1,
  createdAt: 1700000000000
};

function mountPanel(props = {}) {
  return mount(ItemMediaPanel, {
    props: {
      targetType: "item",
      targetId: 5,
      version: 3,
      mediaList: [],
      canManage: true,
      ...props
    },
    global: { plugins: [Quasar] },
    attachTo: document.body
  });
}

describe("ItemMediaPanel.vue", () => {
  beforeEach(() => {
    itemMediaService.uploadItemMedia.mockReset();
    itemMediaService.uploadSkuMedia.mockReset();
    itemMediaService.downloadMedia.mockReset().mockResolvedValue({ blob: new Blob(["x"]), contentType: "image/png" });
    itemMediaService.updateMedia.mockReset();
    itemMediaService.deleteMedia.mockReset();
    promptPassword.mockReset();
    notifySuccess.mockReset();
    notifyError.mockReset();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:fake-url");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it("冇任何 media 顯示「未有上傳任何檔案」", () => {
    const wrapper = mountPanel({ mediaList: [] });

    expect(wrapper.text()).toContain("未有上傳任何檔案");
  });

  it("canManage=false 唔顯示上傳、primary、刪除控制項，但仍然顯示 PDF 下載", () => {
    const wrapper = mountPanel({ mediaList: [ATTACHMENT_MEDIA], canManage: false });

    expect(wrapper.findComponent({ name: "QFile" }).exists()).toBe(false);
    expect(wrapper.find('[aria-label*="刪除"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("下載");
  });

  it("圖片 media 會經 downloadMedia() 攞 blob 再用 createObjectURL 顯示，唔會直接用下載端點嘅 URL", async () => {
    mountPanel({ mediaList: [IMAGE_MEDIA] });
    await flushPromises();

    expect(itemMediaService.downloadMedia).toHaveBeenCalledWith(1);
    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
  });

  it("上傳圖片：揀檔之後打 uploadItemMedia()，sortOrder 用現有 media 數量，version 用目前 prop", async () => {
    itemMediaService.uploadItemMedia.mockResolvedValue({ id: 9 });
    const wrapper = mountPanel({ mediaList: [IMAGE_MEDIA], version: 7 });
    await flushPromises();

    const file = new File(["bytes"], "new.png", { type: "image/png" });
    const [imageFile] = wrapper.findAllComponents({ name: "QFile" });
    await imageFile.vm.$emit("update:model-value", file);
    await flushPromises();

    expect(itemMediaService.uploadItemMedia).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 5, kind: "image", sortOrder: 1, version: 7, file })
    );
    expect(notifySuccess).toHaveBeenCalled();
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });

  it("上傳失敗（例如 kind mismatch）顯示錯誤訊息，唔會 emit refresh", async () => {
    itemMediaService.uploadItemMedia.mockRejectedValue(new Error("上傳的檔案類型與宣告的種類不符"));
    const wrapper = mountPanel({ mediaList: [] });

    const file = new File(["bytes"], "not-image.pdf", { type: "application/pdf" });
    const [imageFile] = wrapper.findAllComponents({ name: "QFile" });
    await imageFile.vm.$emit("update:model-value", file);
    await flushPromises();

    expect(notifyError).toHaveBeenCalledWith("上傳的檔案類型與宣告的種類不符");
    expect(wrapper.text()).toContain("上傳的檔案類型與宣告的種類不符");
    expect(wrapper.emitted("refresh")).toBeUndefined();
  });

  it("SKU 層級面板上傳時打 uploadSkuMedia()，唔係 uploadItemMedia()", async () => {
    itemMediaService.uploadSkuMedia.mockResolvedValue({ id: 9 });
    const wrapper = mountPanel({ targetType: "sku", targetId: 42, mediaList: [] });

    const file = new File(["bytes"], "spec.pdf", { type: "application/pdf" });
    const [, attachmentFile] = wrapper.findAllComponents({ name: "QFile" });
    await attachmentFile.vm.$emit("update:model-value", file);
    await flushPromises();

    expect(itemMediaService.uploadSkuMedia).toHaveBeenCalledWith(
      expect.objectContaining({ skuId: 42, kind: "attachment" })
    );
    expect(itemMediaService.uploadItemMedia).not.toHaveBeenCalled();
  });

  it("設為主要：打 updateMedia({isPrimary:true}) 並 emit refresh", async () => {
    itemMediaService.updateMedia.mockResolvedValue({});
    const wrapper = mountPanel({ mediaList: [IMAGE_MEDIA] });
    await flushPromises();

    await wrapper.find('button:has(.q-icon)').exists(); // sanity: buttons rendered
    const setPrimaryBtn = wrapper.findAll("button").find((btn) => btn.text().includes("設為主要"));
    await setPrimaryBtn.trigger("click");
    await flushPromises();

    expect(itemMediaService.updateMedia).toHaveBeenCalledWith(1, { isPrimary: true });
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });

  it("已經係 primary 嘅圖片唔顯示「設為主要」，改顯示「主要圖片」badge", async () => {
    const wrapper = mountPanel({ mediaList: [{ ...IMAGE_MEDIA, isPrimary: true }] });
    await flushPromises();

    expect(wrapper.text()).not.toContain("設為主要");
    expect(wrapper.text()).toContain("主要圖片");
  });

  it("刪除：撳刪除掣叫 promptPassword，取消就唔會打 deleteMedia", async () => {
    promptPassword.mockResolvedValue(null);
    const wrapper = mountPanel({ mediaList: [ATTACHMENT_MEDIA] });

    await wrapper.find('[aria-label*="刪除"]').trigger("click");
    await flushPromises();

    expect(promptPassword).toHaveBeenCalledWith(
      expect.objectContaining({ title: "刪除檔案", requireReason: true })
    );
    expect(itemMediaService.deleteMedia).not.toHaveBeenCalled();
  });

  it("刪除：確認之後帶 reason／password 打 deleteMedia，成功就 emit refresh", async () => {
    promptPassword.mockResolvedValue({ reason: "唔要喇", password: "pw123" });
    itemMediaService.deleteMedia.mockResolvedValue({ id: 2 });
    const wrapper = mountPanel({ mediaList: [ATTACHMENT_MEDIA] });

    await wrapper.find('[aria-label*="刪除"]').trigger("click");
    await flushPromises();

    expect(itemMediaService.deleteMedia).toHaveBeenCalledWith(2, { reason: "唔要喇", password: "pw123" });
    expect(notifySuccess).toHaveBeenCalled();
    expect(wrapper.emitted("refresh")).toHaveLength(1);
  });

  it("TC-011 delete unlink 失敗（後端仍然 200，但屬於已知失敗場景）一樣顯示可理解錯誤", async () => {
    promptPassword.mockResolvedValue({ reason: "唔要喇", password: "pw123" });
    itemMediaService.deleteMedia.mockRejectedValue(new Error("找不到這個檔案"));
    const wrapper = mountPanel({ mediaList: [ATTACHMENT_MEDIA] });

    await wrapper.find('[aria-label*="刪除"]').trigger("click");
    await flushPromises();

    expect(notifyError).toHaveBeenCalledWith("找不到這個檔案");
    expect(wrapper.emitted("refresh")).toBeUndefined();
  });

  it("排序：確認掣打 updateMedia({sortOrder})，數值冇變就唔打", async () => {
    itemMediaService.updateMedia.mockResolvedValue({});
    const wrapper = mountPanel({ mediaList: [IMAGE_MEDIA] });
    await flushPromises();

    const sortInput = wrapper.find("input[type=number]");
    const confirmBtn = wrapper.find('[aria-label*="確認"][aria-label*="排序"]');

    await sortInput.setValue(0);
    await confirmBtn.trigger("click");
    await flushPromises();
    expect(itemMediaService.updateMedia).not.toHaveBeenCalled();

    await sortInput.setValue(5);
    await confirmBtn.trigger("click");
    await flushPromises();
    expect(itemMediaService.updateMedia).toHaveBeenCalledWith(1, { sortOrder: 5 });
  });

  it("下載附件：打 downloadMedia() 攞 blob，用暫時嘅 <a download> 觸發儲存", async () => {
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const element = originalCreateElement(tag);
      if (tag === "a") {
        element.click = clickSpy;
      }
      return element;
    });

    const wrapper = mountPanel({ mediaList: [ATTACHMENT_MEDIA] });
    const downloadBtn = wrapper.findAll("button").find((btn) => btn.text().includes("下載"));
    await downloadBtn.trigger("click");
    await flushPromises();

    expect(itemMediaService.downloadMedia).toHaveBeenCalledWith(2);
    expect(clickSpy).toHaveBeenCalled();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");

    document.createElement.mockRestore();
  });
});
