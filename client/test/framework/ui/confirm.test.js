import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("quasar", () => ({ Dialog: { create: vi.fn() } }));

import { Dialog } from "quasar";
import { confirm, confirmDelete, promptPassword } from "@/framework/ui/confirm.js";

function mockDialogOutcome(outcome, value) {
  Dialog.create.mockImplementation(() => {
    const chain = {
      onOk: (cb) => {
        if (outcome === "ok") cb(value);
        return chain;
      },
      onCancel: (cb) => {
        if (outcome === "cancel") cb();
        return chain;
      }
    };
    return chain;
  });
}

describe("confirm", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("撳確認會 resolve true", async () => {
    mockDialogOutcome("ok");

    await expect(confirm({ message: "刪除呢筆資料？" })).resolves.toBe(true);
  });

  it("撳取消會 resolve false", async () => {
    mockDialogOutcome("cancel");

    await expect(confirm({ message: "刪除呢筆資料？" })).resolves.toBe(false);
  });

  it("persistent: true，唔可以撳背景／ESC 關閉", async () => {
    mockDialogOutcome("ok");

    await confirm({ message: "test" });

    expect(Dialog.create).toHaveBeenCalledWith(expect.objectContaining({ persistent: true }));
  });
});

describe("confirmDelete", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("用統一嘅刪除確認文案，帶埋主體名", async () => {
    mockDialogOutcome("ok");

    await confirmDelete("訂單 #1");

    expect(Dialog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "刪除確認",
        message: "確定要刪除「訂單 #1」？呢個操作唔可以復原。",
        ok: expect.objectContaining({ label: "刪除" })
      })
    );
  });
});

describe("promptPassword", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("撳確認會 resolve 輸入咗嘅密碼", async () => {
    mockDialogOutcome("ok", "hunter2");

    await expect(promptPassword({ message: "請輸入密碼" })).resolves.toBe("hunter2");
  });

  it("撳取消會 resolve null，唔係 false——同 confirm() 分得出嚟", async () => {
    mockDialogOutcome("cancel");

    await expect(promptPassword({ message: "請輸入密碼" })).resolves.toBe(null);
  });

  it("prompt 型別係 password，唔係普通 text", async () => {
    mockDialogOutcome("ok", "hunter2");

    await promptPassword({ message: "test" });

    expect(Dialog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        persistent: true,
        prompt: expect.objectContaining({ type: "password" })
      })
    );
  });

  it("空密碼過唔到 isValid", async () => {
    mockDialogOutcome("ok", "hunter2");

    await promptPassword({ message: "test" });

    const { isValid } = Dialog.create.mock.calls[0][0].prompt;
    expect(isValid("")).toBe(false);
    expect(isValid("hunter2")).toBe(true);
  });
});
