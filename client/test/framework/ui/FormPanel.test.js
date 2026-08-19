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

  it("onSubmit 拋出帶 body location details 嘅錯誤，會經 fieldError 顯示喺對應欄位", async () => {
    const error = new Error("Request validation failed");
    error.details = [
      { location: "body", path: "/name", keyword: "minLength", message: "must NOT have fewer than 1 characters" }
    ];
    const onSubmit = vi.fn().mockRejectedValue(error);
    const wrapper = mountFormPanel(onSubmit);

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.find(".name-error").text()).toBe("must NOT have fewer than 1 characters");
    expect(wrapper.find(".q-banner").exists()).toBe(false);
    expect(wrapper.emitted("success")).toBeUndefined();
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
