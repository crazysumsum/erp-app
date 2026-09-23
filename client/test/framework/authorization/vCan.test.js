import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { vCan } from "@/framework/authorization/vCan.js";
import { useSessionStore } from "@/stores/session.js";

function mountWithDirective(requires) {
  return mount(
    { template: `<button v-can="requires">刪除</button>`, data: () => ({ requires }) },
    { global: { directives: { can: vCan } } }
  );
}

describe("v-can", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("權限唔夠就隱藏元素", () => {
    const wrapper = mountWithDirective({ permissions: ["order.delete"] });

    expect(wrapper.find("button").element.style.display).toBe("none");
  });

  it("權限夠就顯示元素", () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", roles: [], permissions: ["order.delete"] };

    const wrapper = mountWithDirective({ permissions: ["order.delete"] });

    expect(wrapper.find("button").element.style.display).toBe("");
  });

  it("冇 requires 就當已登入即顯示", () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", roles: [], permissions: [] };

    const wrapper = mountWithDirective(undefined);

    expect(wrapper.find("button").element.style.display).toBe("");
  });

  // session.refresh() 換走成個 user object 而唔係改佢（見 stores/session.js），
  // 所以 isAuthenticated 一路係 true。呢個 case 釘住「撤權之後按鈕真係會收返」
  // ——路由守衛嗰邊嘅修法（framework/routing/router.js）假設咗呢件事成立。
  it("續期撤走權限之後，已經 mount 咗嘅元素會自己收埋", async () => {
    const session = useSessionStore();
    session.user = { id: 1, username: "sam", roles: [], permissions: ["order.delete"] };
    const wrapper = mountWithDirective({ permissions: ["order.delete"] });
    expect(wrapper.find("button").element.style.display).toBe("");

    session.user = { id: 1, username: "sam", roles: [], permissions: [] };
    await nextTick();

    expect(wrapper.find("button").element.style.display).toBe("none");
  });
});
