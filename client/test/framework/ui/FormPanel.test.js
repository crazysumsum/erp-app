import { flushPromises, mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { describe, expect, it, vi } from "vitest";
import FormPanel from "@/framework/ui/FormPanel.vue";

/**
 * @vue/test-utils 對字串形式嘅 scoped slot：slot props 會自動喺樣板入面
 * 用一個叫 `params` 嘅變數攞到，唔使自己再包一層 <template #default>。
 */
function mountFormPanel(onSubmit) {
  return mount(FormPanel, {
    props: { onSubmit },
    slots: {
      default: `
        <div>
          <div class="name-error">{{ params.fieldError('name') }}</div>
          <div class="submitting">{{ params.submitting }}</div>
          <button type="submit">提交</button>
        </div>
      `
    },
    global: { plugins: [Quasar] }
  });
}

describe("FormPanel", () => {
  it("submit 成功會 emit success，帶埋 onSubmit 嘅回傳值", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ id: 1 });
    const wrapper = mountFormPanel(onSubmit);

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(wrapper.emitted("success")[0]).toEqual([{ id: 1 }]);
  });

  it("submit 期間 submitting 係 true，完成之後返回 false", async () => {
    let resolveSubmit;
    const onSubmit = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        })
    );
    const wrapper = mountFormPanel(onSubmit);

    wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find(".submitting").text()).toBe("true");

    resolveSubmit();
    await flushPromises();
    expect(wrapper.find(".submitting").text()).toBe("false");
  });

  it("submit 未完成之前再 submit 一次，唔會再次呼叫 onSubmit（防止雙擊／重複提交）", async () => {
    let resolveSubmit;
    const onSubmit = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        })
    );
    const wrapper = mountFormPanel(onSubmit);

    wrapper.find("form").trigger("submit");
    await flushPromises();
    wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(onSubmit).toHaveBeenCalledOnce();

    resolveSubmit();
    await flushPromises();
  });

  it("onSubmit 拋出帶 body location details 嘅錯誤，會經 fieldError 顯示喺對應欄位，同埋喺總覽 banner 度列多次", async () => {
    const error = new Error("Request validation failed");
    error.details = [
      { location: "body", path: "/name", keyword: "minLength", message: "must NOT have fewer than 1 characters" }
    ];
    const onSubmit = vi.fn().mockRejectedValue(error);
    const wrapper = mountFormPanel(onSubmit);

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find(".name-error").text()).toBe("must NOT have fewer than 1 characters");
    // 呢個 banner 而家兼埋做 error summary（見 role="alert" 嗰段）：淨係得
    // inline 錯誤嘅話，screen reader 用戶完全唔會知道個 submit 失敗咗——
    // 冇跳頁、冇宣讀，畫面淨係靜靜哋喺原地。
    expect(wrapper.find(".q-banner").exists()).toBe(true);
    expect(wrapper.find(".q-banner").text()).toContain("must NOT have fewer than 1 characters");
    expect(wrapper.emitted("success")).toBeUndefined();
  });

  it("提交失敗之後，焦點會移去 error summary（role=alert），screen reader 用戶先會知道出咗事", async () => {
    const error = new Error("Request validation failed");
    error.details = [{ location: "body", path: "/name", keyword: "minLength", message: "太短" }];
    const onSubmit = vi.fn().mockRejectedValue(error);
    // document.activeElement 淨係反映真正掛喺 document 度嘅元素——mount()
    // 預設整嘅係一棵未 attach 嘅 DOM tree，唔 attachTo 嘅話 .focus() 永遠
    // 揸唔到 activeElement，同個功能本身有冇做啱冇關係。
    const wrapper = mountFormPanel(onSubmit);
    document.body.appendChild(wrapper.element);

    try {
      await wrapper.find("form").trigger("submit");
      await flushPromises();

      const summary = wrapper.find('[role="alert"]');
      expect(summary.exists()).toBe(true);
      expect(summary.attributes("tabindex")).toBe("-1");
      expect(document.activeElement).toBe(summary.element);
    } finally {
      wrapper.element.remove();
    }
  });

  it("巢狀 path（/address/city）會轉做 dot notation 嘅 field key", async () => {
    const error = new Error("Request validation failed");
    error.details = [{ location: "body", path: "/address/city", keyword: "required", message: "is required" }];
    const onSubmit = vi.fn().mockRejectedValue(error);
    const wrapper = mount(FormPanel, {
      props: { onSubmit },
      slots: { default: `<div class="err">{{ params.fieldError('address.city') }}</div>` },
      global: { plugins: [Quasar] }
    });

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find(".err").text()).toBe("is required");
  });

  it("錯誤冇 details 就顯示總體錯誤訊息，唔會靜靜哋吞咗", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("網路錯誤"));
    const wrapper = mountFormPanel(onSubmit);

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find(".q-banner").text()).toContain("網路錯誤");
  });

  it("details 全部都唔係 body location（例如 query），都會顯示總體錯誤訊息", async () => {
    const error = new Error("Query 錯咗");
    error.details = [{ location: "query", path: "/page", keyword: "type", message: "must be integer" }];
    const onSubmit = vi.fn().mockRejectedValue(error);
    const wrapper = mountFormPanel(onSubmit);

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find(".q-banner").text()).toContain("Query 錯咗");
    expect(wrapper.find(".name-error").text()).toBe("");
  });
});
