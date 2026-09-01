import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { afterEach, describe, expect, it, vi } from "vitest";
import PasswordReasonDialog from "@/framework/ui/PasswordReasonDialog.vue";

// QDialog 用 <teleport> 將內容掛去 document.body 底下獨立嘅一個 portal div，
// 唔係掛喺 wrapper 自己個 root element 度（wrapper.html() 淨係見到
// teleport 嘅頭尾註解）。所以要用 DOMWrapper(document.body) 先搵到啲欄位同
// 按鈕；wrapper 本身仍然係接 emitted() 事件嗰個。
//
// useDialogPluginComponent 淨係喺 Dialog.create() 真正 show() 咗個 dialog
// 之後先會 render 個 slot 內容（QDialog 係 v-model 控制開關），單獨 mount
// 唔會自動開，所以自己叫一次 `vm.show()`——嗰個方法係
// useDialogPluginComponent 掛喺 proxy 度嘅（見 node_modules/quasar 嘅
// use-dialog-plugin-component.js），等 Dialog.create 唔使知道個 component
// 內部點實作就叫得郁佢。
async function mountAndOpen(props = {}) {
  const wrapper = mount(PasswordReasonDialog, {
    props: { title: "配置角色", ...props },
    global: { plugins: [Quasar] },
    attachTo: document.body
  });

  await wrapper.vm.show();
  await flushPromises();

  return { wrapper, body: new DOMWrapper(document.body) };
}

async function fill(body, { reason, password }) {
  const inputs = body.findAll("input");
  if (reason !== undefined) await inputs[0].setValue(reason);
  if (password !== undefined) await inputs[1].setValue(password);
}

function findButtonByLabel(body, label) {
  return body.findAll(".q-btn").find((btn) => btn.text() === label);
}

describe("PasswordReasonDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("撳確認前兩欄都合格，emit ok 帶埋 { reason, password }", async () => {
    const { wrapper, body } = await mountAndOpen();

    await fill(body, { reason: "轉組安排理由", password: "hunter2" });
    await findButtonByLabel(body, "確認").trigger("click");
    await flushPromises();

    expect(wrapper.emitted("ok")).toBeTruthy();
    expect(wrapper.emitted("ok")[0]).toEqual([{ reason: "轉組安排理由", password: "hunter2" }]);
  });

  it("原因少於 5 字元唔會 emit ok", async () => {
    const { wrapper, body } = await mountAndOpen();

    await fill(body, { reason: "短", password: "hunter2" });
    await findButtonByLabel(body, "確認").trigger("click");
    await flushPromises();

    expect(wrapper.emitted("ok")).toBeUndefined();
  });

  it("密碼留空唔會 emit ok", async () => {
    const { wrapper, body } = await mountAndOpen();

    await fill(body, { reason: "轉組安排理由", password: "" });
    await findButtonByLabel(body, "確認").trigger("click");
    await flushPromises();

    expect(wrapper.emitted("ok")).toBeUndefined();
  });

  it("撳取消 emit hide，唔 emit ok", async () => {
    // QDialog 嘅 hide() 唔係即刻 emit：佢等 transitionDuration（預設 300ms）
    // 個 setTimeout 完咗先 emit('hide')，等離場動畫有時間行完（見
    // node_modules/quasar 嘅 QDialog.js handleHide）。flushPromises() 淨係
    // 沖走 microtask，沖唔走呢個 macrotask，所以呢一條要用 fake timer。
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { wrapper, body } = await mountAndOpen();

      await findButtonByLabel(body, "取消").trigger("click");
      await vi.advanceTimersByTimeAsync(500);

      expect(wrapper.emitted("ok")).toBeUndefined();
      expect(wrapper.emitted("hide")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("顯示傳入嘅 title／message／okLabel", async () => {
    const { body } = await mountAndOpen({ message: "這會立即把你自己登出", okLabel: "停用" });

    expect(body.text()).toContain("配置角色");
    expect(body.text()).toContain("這會立即把你自己登出");
    expect(findButtonByLabel(body, "停用")).toBeTruthy();
  });
});
