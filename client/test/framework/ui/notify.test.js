import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("quasar", () => ({ Notify: { create: vi.fn() } }));

import { Notify } from "quasar";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";

describe("notify", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("notifySuccess 用 positive type，浮喺頂部", () => {
    notifySuccess("新增成功");

    expect(Notify.create).toHaveBeenCalledWith({ type: "positive", message: "新增成功", position: "top" });
  });

  it("notifyError 用 negative type", () => {
    notifyError("刪除失敗");

    expect(Notify.create).toHaveBeenCalledWith({ type: "negative", message: "刪除失敗", position: "top" });
  });

  it("冇傳訊息就用預設文案", () => {
    notifySuccess();
    notifyError();

    expect(Notify.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ message: "操作成功" }));
    expect(Notify.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ message: "操作失敗" }));
  });
});
