import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/user.js", () => ({
  default: { updateOwnProfile: vi.fn() },
  service: { name: "user" }
}));
vi.mock("@/services/device.js", () => ({
  default: { listMine: vi.fn() },
  service: { name: "device" }
}));
vi.mock("@/framework/auth/deviceKey.js", () => ({
  currentDeviceId: vi.fn().mockResolvedValue("this-device")
}));
vi.mock("@/framework/ui/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn()
}));

import userService from "@/services/user.js";
import deviceService from "@/services/device.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import ProfilePage from "@/pages/ProfilePage.vue";
import { useSessionStore } from "@/stores/session.js";

const DEVICES = [
  {
    id: 1,
    label: "Chrome on Mac",
    status: "approved",
    deviceId: "this-device",
    lastUsedAt: 1735689600000,
    requestedAt: 1735603200000
  }
];

async function mountPage({ displayName = "Sam Wong", email = "sam@example.com", roles = ["system-admin"] } = {}) {
  deviceService.listMine.mockResolvedValue(DEVICES);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/account/profile", name: "profile", component: ProfilePage }]
  });
  await router.push("/account/profile");
  await router.isReady();

  const session = useSessionStore();
  session.user = { id: 1, username: "sam", displayName, email, roles, permissions: [] };

  const wrapper = mount(ProfilePage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, session };
}

describe("pages/ProfilePage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    userService.updateOwnProfile.mockReset();
    deviceService.listMine.mockReset();
    notifySuccess.mockClear();
  });

  it("表單預先填入 session 現有嘅 displayName 同 email，帳號欄唯讀", async () => {
    const { wrapper } = await mountPage();

    const inputs = wrapper.findAll("input");
    expect(inputs[0].element.value).toBe("sam");
    expect(inputs[0].attributes("readonly")).toBeDefined();
    expect(inputs[1].element.value).toBe("Sam Wong");
    expect(inputs[2].element.value).toBe("sam@example.com");
  });

  it("提交會打 updateOwnProfile()，成功之後更新 session.user 並提示", async () => {
    userService.updateOwnProfile.mockResolvedValue({
      id: 1,
      username: "sam",
      displayName: "Sam W.",
      email: "new@example.com"
    });
    const { wrapper, session } = await mountPage();

    const inputs = wrapper.findAll("input");
    await inputs[1].setValue("Sam W.");
    await inputs[2].setValue("new@example.com");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(userService.updateOwnProfile).toHaveBeenCalledWith({
      displayName: "Sam W.",
      email: "new@example.com"
    });
    expect(session.user.displayName).toBe("Sam W.");
    expect(session.user.email).toBe("new@example.com");
    expect(notifySuccess).toHaveBeenCalledWith("個人資料已更新");
  });

  it("顯示 session.user.roles 嘅角色清單", async () => {
    const { wrapper } = await mountPage({ roles: ["system-admin", "staff"] });

    expect(wrapper.text()).toContain("system-admin");
    expect(wrapper.text()).toContain("staff");
  });

  it("冇任何角色就顯示「沒有任何角色」", async () => {
    const { wrapper } = await mountPage({ roles: [] });

    expect(wrapper.text()).toContain("沒有任何角色");
  });

  it("我的設備表格叫 deviceService.listMine() 並顯示裝置", async () => {
    const { wrapper } = await mountPage();

    expect(deviceService.listMine).toHaveBeenCalled();
    expect(wrapper.text()).toContain("Chrome on Mac");
    expect(wrapper.text()).toContain("目前這台");
  });
});
