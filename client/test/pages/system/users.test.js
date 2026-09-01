import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/user.js", () => ({
  default: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    assignRoles: vi.fn(),
    resetPassword: vi.fn(),
    changeOwnPassword: vi.fn()
  },
  service: { name: "user" }
}));
vi.mock("@/services/role.js", () => ({
  default: {
    list: vi.fn(),
    listPermissions: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    assignPermissions: vi.fn()
  },
  service: { name: "role" }
}));
vi.mock("@/framework/ui/confirm.js", () => ({
  confirm: vi.fn(),
  confirmDelete: vi.fn(),
  promptPassword: vi.fn()
}));
// notifySuccess／notifyError 底層用嘅 Quasar Notify 係一個真正嘅單例：一裝好
// 就一路留喺 document.body，唔會跟住每個測試嘅 wrapper unmount 走。前一個
// 測試留低嘅 DOM 唔會自動清（見 afterEach 冇 wipe body 嘅原因），mock 走呢
// 個模組令呢個檔案唔使理呢層 DOM 細節，淨係斷言「有冇叫啱嘅 message」。
vi.mock("@/framework/ui/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn()
}));

import userService from "@/services/user.js";
import roleService from "@/services/role.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError } from "@/framework/ui/notify.js";
import UsersPage from "@/pages/system/UsersPage.vue";
import { useSessionStore } from "@/stores/session.js";

const ROWS = [
  { id: 1, username: "sam", displayName: "Sam Wong", status: "active", createdAt: 1735689600000 },
  { id: 2, username: "amy", displayName: "Amy Chan", status: "active", createdAt: 1735689600000 }
];

const ROLES = [
  { id: 10, name: "system-admin", description: "System Admin", userCount: 1, permissions: ["user.mgmt", "role.mgmt", "device.mgmt"] },
  { id: 11, name: "staff", description: "一般同事", userCount: 5, permissions: [] }
];

async function mountUsersPage({ permissions = ["user.mgmt"], selfId = 1 } = {}) {
  userService.list.mockResolvedValue({ rows: ROWS, rowsNumber: ROWS.length });
  roleService.list.mockResolvedValue(ROLES);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: "home", component: UsersPage }]
  });
  await router.push("/");
  await router.isReady();

  const session = useSessionStore();
  session.user = { id: selfId, username: "sam", displayName: "Sam Wong", permissions, roles: [] };

  const wrapper = mount(UsersPage, {
    global: { plugins: [Quasar, router] },
    attachTo: document.body
  });
  await flushPromises();

  return { wrapper, session, body: new DOMWrapper(document.body) };
}

function findMenuButton(wrapper, username) {
  const row = wrapper.findAll("tbody tr").find((tr) => tr.text().includes(username));
  return row.find('button[aria-label*="的操作"]');
}

async function openRowMenu(wrapper, body, username) {
  await findMenuButton(wrapper, username).trigger("click");
  await flushPromises();
  return body;
}

function findMenuItem(body, label) {
  return body.findAll(".q-item").find((el) => el.text().includes(label));
}

async function submitDialog(body, okLabel) {
  const button = body.findAll(".q-btn").find((btn) => btn.text() === okLabel);
  await button.trigger("click");
  await flushPromises();
}

describe("pages/system/UsersPage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("開機攞用戶清單同角色目錄，將用戶顯示喺表入面", async () => {
    const { wrapper } = await mountUsersPage();

    expect(userService.list).toHaveBeenCalled();
    expect(roleService.list).toHaveBeenCalled();
    expect(wrapper.text()).toContain("Sam Wong");
    expect(wrapper.text()).toContain("Amy Chan");
  });

  it("搜尋框改變會帶埋新嘅 filter 再打一次 list()", async () => {
    const { wrapper } = await mountUsersPage();
    userService.list.mockClear();

    const input = wrapper.find('input[placeholder="搜尋帳號或顯示名稱"]');
    await input.setValue("amy");
    // debounce="300"：等夠時間先會真正 emit update:model-value。
    await new Promise((resolve) => {
      setTimeout(resolve, 350);
    });
    await flushPromises();

    expect(userService.list).toHaveBeenCalledWith(
      expect.objectContaining({ filter: "amy" })
    );
  });

  describe("新增用戶", () => {
    it("提交新增表單會打 create()，成功之後顯示可複製嘅初始密碼", async () => {
      userService.create.mockResolvedValue({ id: 3, username: "bob" });
      const { wrapper, body } = await mountUsersPage();

      await wrapper.find('button[aria-label]:not([aria-label*="的操作"])').exists();
      const addButton = wrapper.findAll(".q-btn").find((btn) => btn.text().includes("新增用戶"));
      await addButton.trigger("click");
      await flushPromises();

      // 帳號、顯示名稱、初始密碼、確認初始密碼、（角色 checkbox 唔算 input[type=text/password]）、你的密碼
      const byLabel = (label) =>
        body.findAll(".q-field").find((f) => f.text().includes(label))?.find("input");

      await byLabel("帳號").setValue("bob");
      await byLabel("顯示名稱").setValue("Bob Lee");
      await byLabel("初始密碼").setValue("Passw0rdPassw0rd");
      await byLabel("確認初始密碼").setValue("Passw0rdPassw0rd");
      await byLabel("你的密碼").setValue("hunter2");

      await submitDialog(body, "新增");

      expect(userService.create).toHaveBeenCalledWith({
        username: "bob",
        displayName: "Bob Lee",
        newUserPassword: "Passw0rdPassw0rd",
        roleIds: [],
        password: "hunter2"
      });

      expect(body.text()).toContain("帳號");
      expect(body.text()).toContain("bob");
      expect(body.text()).toContain("Passw0rdPassw0rd");
    });

    it("授唔出自己冇嘅角色：淨係得 user.mgmt 嘅人打開新增對話框，system-admin 個 checkbox 係停用嘅", async () => {
      const { wrapper, body } = await mountUsersPage({ permissions: ["user.mgmt"] });

      const addButton = wrapper.findAll(".q-btn").find((btn) => btn.text().includes("新增用戶"));
      await addButton.trigger("click");
      await flushPromises();

      const systemAdminOption = body
        .findAll(".q-checkbox")
        .find((el) => el.text().includes("system-admin"));

      expect(systemAdminOption.text()).toContain("你自己冇呢個權限");
      expect(systemAdminOption.classes()).toContain("disabled");
    });
  });

  describe("停用／啟用", () => {
    it("停用會帶埋 promptPassword 攞返嚟嘅 reason／password 打 disable()", async () => {
      promptPassword.mockResolvedValue({ reason: "離職", password: "hunter2" });
      userService.disable.mockResolvedValue({ id: 2, status: "disabled" });
      const { wrapper, body } = await mountUsersPage();

      await openRowMenu(wrapper, body, "amy");
      await findMenuItem(body, "停用").trigger("click");
      await flushPromises();

      expect(promptPassword).toHaveBeenCalledWith(
        expect.objectContaining({ requireReason: true, okLabel: "停用" })
      );
      expect(userService.disable).toHaveBeenCalledWith(2, { reason: "離職", password: "hunter2" });
    });

    it("停用自己：訊息講明會即刻登出", async () => {
      promptPassword.mockResolvedValue(null);
      const { wrapper, body } = await mountUsersPage({ selfId: 1 });

      await openRowMenu(wrapper, body, "sam");
      await findMenuItem(body, "停用").trigger("click");
      await flushPromises();

      expect(promptPassword).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("這會立即把你自己登出") })
      );
    });

    it("撳取消（promptPassword resolve null）唔會打任何 API", async () => {
      promptPassword.mockResolvedValue(null);
      const { wrapper, body } = await mountUsersPage();

      await openRowMenu(wrapper, body, "amy");
      await findMenuItem(body, "停用").trigger("click");
      await flushPromises();

      expect(userService.disable).not.toHaveBeenCalled();
    });

    it("LAST_ADMIN_PROTECTED 顯示自訂訊息，唔係籠統嘅衝突文案", async () => {
      promptPassword.mockResolvedValue({ reason: "離職", password: "hunter2" });
      const error = new Error("conflict");
      error.code = "LAST_ADMIN_PROTECTED";
      userService.disable.mockRejectedValue(error);
      const { wrapper, body } = await mountUsersPage();

      await openRowMenu(wrapper, body, "amy");
      await findMenuItem(body, "停用").trigger("click");
      await flushPromises();

      expect(notifyError).toHaveBeenCalledWith("系統至少要保留一個啟用中的 system-admin");
    });
  });

  describe("配置角色", () => {
    it("開對話框先攞返呢個用戶而家嘅角色做 expectedRoleIds，提交會帶埋佢做 compare-and-set", async () => {
      userService.get.mockResolvedValue({
        id: 2,
        username: "amy",
        displayName: "Amy Chan",
        status: "active",
        createdAt: 0,
        mustChangePassword: false,
        roles: [{ id: 11, name: "staff" }]
      });
      userService.assignRoles.mockResolvedValue({ id: 2, roles: ["staff"] });
      const { wrapper, body } = await mountUsersPage({ permissions: ["user.mgmt", "role.mgmt", "device.mgmt"] });

      await openRowMenu(wrapper, body, "amy");
      await findMenuItem(body, "配置角色").trigger("click");
      await flushPromises();

      expect(userService.get).toHaveBeenCalledWith(2);

      const reasonInput = body
        .findAll(".q-field")
        .find((f) => f.text().includes("原因"))
        .find("input");
      await reasonInput.setValue("轉組安排");
      const passwordInput = body
        .findAll(".q-field")
        .find((f) => f.text().includes("你的密碼"))
        .find("input");
      await passwordInput.setValue("hunter2");

      await submitDialog(body, "儲存");

      expect(userService.assignRoles).toHaveBeenCalledWith(2, {
        roleIds: [11],
        expectedRoleIds: [11],
        reason: "轉組安排",
        password: "hunter2"
      });
    });

    it("ASSIGNMENT_STALE：重載呢個用戶最新嘅角色，畫面顯示提示，唔會靜靜哋失敗", async () => {
      userService.get
        .mockResolvedValueOnce({
          id: 2,
          username: "amy",
          roles: [{ id: 11, name: "staff" }]
        })
        .mockResolvedValueOnce({
          id: 2,
          username: "amy",
          roles: [{ id: 11, name: "staff" }, { id: 10, name: "system-admin" }]
        });

      const staleError = new Error("stale");
      staleError.code = "ASSIGNMENT_STALE";
      userService.assignRoles.mockRejectedValueOnce(staleError);

      const { wrapper, body } = await mountUsersPage({ permissions: ["user.mgmt", "role.mgmt", "device.mgmt"] });

      await openRowMenu(wrapper, body, "amy");
      await findMenuItem(body, "配置角色").trigger("click");
      await flushPromises();

      const reasonInput = body.findAll(".q-field").find((f) => f.text().includes("原因")).find("input");
      await reasonInput.setValue("轉組安排");
      const passwordInput = body.findAll(".q-field").find((f) => f.text().includes("你的密碼")).find("input");
      await passwordInput.setValue("hunter2");

      await submitDialog(body, "儲存");

      expect(userService.get).toHaveBeenCalledTimes(2);
      expect(body.text()).toContain("有人喺你之前已經改過");
    });
  });

  describe("重設密碼", () => {
    it("提交會帶埋新密碼、原因、操作者密碼打 resetPassword()", async () => {
      userService.resetPassword.mockResolvedValue({ id: 2 });
      const { wrapper, body } = await mountUsersPage();

      await openRowMenu(wrapper, body, "amy");
      await findMenuItem(body, "重設密碼").trigger("click");
      await flushPromises();

      const byLabel = (label) => body.findAll(".q-field").find((f) => f.text().includes(label))?.find("input");
      await byLabel("新密碼").setValue("Passw0rdPassw0rd");
      await byLabel("確認新密碼").setValue("Passw0rdPassw0rd");
      await byLabel("原因").setValue("忘記密碼");
      await byLabel("你的密碼").setValue("hunter2");

      await submitDialog(body, "重設");

      expect(userService.resetPassword).toHaveBeenCalledWith(2, {
        newUserPassword: "Passw0rdPassw0rd",
        reason: "忘記密碼",
        password: "hunter2"
      });
    });
  });

  describe("編輯", () => {
    it("提交會打 update()，淨係帶 displayName", async () => {
      userService.update.mockResolvedValue({ id: 2, displayName: "Amy C" });
      const { wrapper, body } = await mountUsersPage();

      await openRowMenu(wrapper, body, "amy");
      await findMenuItem(body, "編輯").trigger("click");
      await flushPromises();

      const input = body.findAll(".q-field").find((f) => f.text().includes("顯示名稱")).find("input");
      await input.setValue("Amy C");

      await submitDialog(body, "儲存");

      expect(userService.update).toHaveBeenCalledWith(2, { displayName: "Amy C" });
    });
  });
});
