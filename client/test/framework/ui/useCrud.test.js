import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/framework/ui/confirm.js", () => ({ confirmDelete: vi.fn() }));
vi.mock("@/framework/ui/notify.js", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));

import { confirmDelete } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { useCrud } from "@/framework/ui/useCrud.js";

function fakeResourceApi() {
  return { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
}

describe("useCrud", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("list 直接轉俾 resourceApi.list，原樣回傳結果", async () => {
    const api = fakeResourceApi();
    api.list.mockResolvedValue({ rows: [], rowsNumber: 0 });
    const { list } = useCrud(api);

    const result = await list({ page: 1 });

    expect(api.list).toHaveBeenCalledWith({ page: 1 });
    expect(result).toEqual({ rows: [], rowsNumber: 0 });
  });

  it("create 成功會 notify 並且 reload dataTable", async () => {
    const api = fakeResourceApi();
    api.create.mockResolvedValue({ id: 1 });
    const { create, dataTableRef } = useCrud(api, { resourceLabel: "訂單" });
    dataTableRef.value = { reload: vi.fn() };

    await create({ name: "x" });

    expect(api.create).toHaveBeenCalledWith({ name: "x" });
    expect(notifySuccess).toHaveBeenCalledWith("新增訂單成功");
    expect(dataTableRef.value.reload).toHaveBeenCalledOnce();
  });

  it("create 失敗會原樣拋出，唔會喺呢度截住（等 FormPanel 拆 field errors）", async () => {
    const api = fakeResourceApi();
    api.create.mockRejectedValue(new Error("撞名"));
    const { create } = useCrud(api);

    await expect(create({ name: "x" })).rejects.toThrow("撞名");
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it("update 成功會 notify 並且 reload dataTable", async () => {
    const api = fakeResourceApi();
    api.update.mockResolvedValue({ id: 1 });
    const { update, dataTableRef } = useCrud(api, { resourceLabel: "訂單" });
    dataTableRef.value = { reload: vi.fn() };

    await update(1, { name: "y" });

    expect(api.update).toHaveBeenCalledWith(1, { name: "y" });
    expect(notifySuccess).toHaveBeenCalledWith("更新訂單成功");
    expect(dataTableRef.value.reload).toHaveBeenCalledOnce();
  });

  it("remove：用戶喺確認對話框撳取消，唔會真係刪除", async () => {
    confirmDelete.mockResolvedValue(false);
    const api = fakeResourceApi();
    const { remove } = useCrud(api);

    const result = await remove(1);

    expect(result).toBe(false);
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("remove：確認之後成功刪除，notify 並且 reload", async () => {
    confirmDelete.mockResolvedValue(true);
    const api = fakeResourceApi();
    api.delete.mockResolvedValue();
    const { remove, dataTableRef } = useCrud(api, { resourceLabel: "訂單" });
    dataTableRef.value = { reload: vi.fn() };

    const result = await remove(1, { label: "訂單 #1" });

    expect(confirmDelete).toHaveBeenCalledWith("訂單 #1");
    expect(api.delete).toHaveBeenCalledWith(1);
    expect(notifySuccess).toHaveBeenCalledWith("刪除訂單成功");
    expect(dataTableRef.value.reload).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it("remove：刪除失敗會 notifyError，唔會拋出", async () => {
    confirmDelete.mockResolvedValue(true);
    const api = fakeResourceApi();
    api.delete.mockRejectedValue(new Error("伺服器錯誤"));
    const { remove } = useCrud(api, { resourceLabel: "訂單" });

    const result = await remove(1);

    expect(result).toBe(false);
    expect(notifyError).toHaveBeenCalledWith("伺服器錯誤");
  });
});
