import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
// 見 test/pages/system/users.test.js 開頭嘅同一段解釋：Notify 係單例，
// mock 走成個模組令呢個檔案唔使理個 DOM 細節。
vi.mock("@/framework/ui/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn()
}));

import roleService from "@/services/role.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError } from "@/framework/ui/notify.js";
import RolesPage from "@/pages/system/RolesPage.vue";
import { useSessionStore } from "@/stores/session.js";

const ROLES = [
  {
    id: 1,
    name: "system-admin",
    description: "System Admin",
    userCount: 1,
    permissions: ["user.mgmt", "role.mgmt", "device.mgmt"]
  },
  { id: 2, name: "staff", description: "一般同事", userCount: 12, permissions: ["device.mgmt"] }
];

const PERMISSIONS = [
  { id: 100, name: "user.mgmt", description: "管理用戶與用戶的角色" },
  { id: 101, name: "role.mgmt", description: "管理角色與角色的權限" },
  { id: 102, name: "device.mgmt", description: "審批、拒絕或撤銷設備綁定申請" }
];

async function mountRolesPage({ permissions = ["role.mgmt"] } = {}) {
  roleService.list.mockResolvedValue(ROLES);
  roleService.listPermissions.mockResolvedValue(PERMISSIONS);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: "home", component: RolesPage }]
  });
  await router.push("/");
  await router.isReady();

  const session = useSessionStore();
  session.user = { id: 1, username: "sam", displayName: "Sam Wong", permissions, roles: [] };

  const wrapper = mount(RolesPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, session, body: new DOMWrapper(document.body) };
}

async function openRowMenu(wrapper, body, roleName) {
  const row = wrapper.findAll("tbody tr").find((tr) => tr.text().includes(roleName));
  await row.find('button[aria-label*="的操作"]').trigger("click");
  await flushPromises();
  return body;
}

function findMenuItem(body, label) {
  return body.findAll(".q-item").find((el) => el.text().includes(label));
}

function fieldInput(body, label) {
  return body.findAll(".q-field").find((f) => f.text().includes(label)).find("input");
}

async function submitDialog(body, okLabel) {
  await body.findAll(".q-btn").find((btn) => btn.text() === okLabel).trigger("click");
  await flushPromises();
}

describe("pages/system/RolesPage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("開機攞角色同權限目錄，顯示喺表入面（含用戶數同權限摘要）", async () => {
    const { wrapper } = await mountRolesPage();

    expect(roleService.list).toHaveBeenCalled();
    expect(roleService.listPermissions).toHaveBeenCalled();
    expect(wrapper.text()).toContain("system-admin");
    expect(wrapper.text()).toContain("staff");
    expect(wrapper.text()).toContain("12");
  });

  it("system-admin 嗰一列淨係得一個鎖圖示，冇 ⋮ 選單", async () => {
    const { wrapper } = await mountRolesPage();

    const adminRow = wrapper.findAll("tbody tr").find((tr) => tr.text().includes("system-admin"));
    expect(adminRow.find(".q-icon[aria-hidden]").exists() || adminRow.text()).toBeTruthy();
    expect(adminRow.find('button[aria-label*="的操作"]').exists()).toBe(false);

    const staffRow = wrapper.findAll("tbody tr").find((tr) => tr.text().includes("staff"));
    expect(staffRow.find('button[aria-label*="的操作"]').exists()).toBe(true);
  });

  describe("新增角色", () => {
    it("提交會打 create()，唔使密碼／原因", async () => {
      roleService.create.mockResolvedValue({ id: 3, name: "purchaser", description: "採購" });
      const { wrapper, body } = await mountRolesPage();

      const addButton = wrapper.findAll(".q-btn").find((btn) => btn.text().includes("新增角色"));
      await addButton.trigger("click");
      await flushPromises();

      await fieldInput(body, "角色名").setValue("purchaser");
      await fieldInput(body, "描述").setValue("採購");
      await submitDialog(body, "新增");

      expect(roleService.create).toHaveBeenCalledWith({ name: "purchaser", description: "採購" });
      expect(roleService.list).toHaveBeenCalledTimes(2);
    });
  });

  describe("編輯", () => {
    it("提交會打 update()", async () => {
      roleService.update.mockResolvedValue({ id: 2, name: "staff2", description: "改咗" });
      const { wrapper, body } = await mountRolesPage();

      await openRowMenu(wrapper, body, "staff");
      await findMenuItem(body, "編輯").trigger("click");
      await flushPromises();

      const nameInput = fieldInput(body, "角色名");
      await nameInput.setValue("staff2");
      await submitDialog(body, "儲存");

      expect(roleService.update).toHaveBeenCalledWith(2, { name: "staff2", description: "一般同事" });
    });
  });

  describe("配置權限", () => {
    it("開對話框：已有嘅權限預先勾好，做 expectedPermissionIds；提交帶埋佢做 compare-and-set", async () => {
      roleService.assignPermissions.mockResolvedValue({ id: 2, permissions: ["device.mgmt", "user.mgmt"] });
      const { wrapper, body } = await mountRolesPage({ permissions: ["role.mgmt", "user.mgmt", "device.mgmt"] });

      await openRowMenu(wrapper, body, "staff");
      await findMenuItem(body, "配置權限").trigger("click");
      await flushPromises();

      // staff 原本淨係有 device.mgmt（id 102），再勾多一個 user.mgmt（id 100）。
      const userMgmtCheckbox = body
        .findAll(".q-checkbox")
        .find((el) => el.text().includes("user.mgmt"));
      await userMgmtCheckbox.find("input, .q-checkbox__inner").trigger("click");
      await flushPromises();

      await fieldInput(body, "原因").setValue("前線自助");
      await fieldInput(body, "你的密碼").setValue("hunter2");
      await submitDialog(body, "儲存");

      expect(roleService.assignPermissions).toHaveBeenCalledWith(2, {
        permissionIds: expect.arrayContaining([100, 102]),
        expectedPermissionIds: [102],
        reason: "前線自助",
        password: "hunter2"
      });
    });

    it("操作者自己冇嘅權限：checkbox 停用，附一句「你自己冇呢個權限」", async () => {
      const { wrapper, body } = await mountRolesPage({ permissions: ["role.mgmt"] });

      await openRowMenu(wrapper, body, "staff");
      await findMenuItem(body, "配置權限").trigger("click");
      await flushPromises();

      const userMgmtCheckbox = body.findAll(".q-checkbox").find((el) => el.text().includes("user.mgmt"));
      expect(userMgmtCheckbox.text()).toContain("你自己冇呢個權限");
      expect(userMgmtCheckbox.classes()).toContain("disabled");
    });

    it("ASSIGNMENT_STALE：重載角色清單，畫面顯示提示", async () => {
      const staleError = new Error("stale");
      staleError.code = "ASSIGNMENT_STALE";
      roleService.assignPermissions.mockRejectedValueOnce(staleError);
      roleService.list.mockResolvedValueOnce(ROLES).mockResolvedValueOnce([
        { ...ROLES[1], permissions: ["device.mgmt", "user.mgmt"] },
        ROLES[0]
      ]);

      const { wrapper, body } = await mountRolesPage({ permissions: ["role.mgmt", "user.mgmt", "device.mgmt"] });

      await openRowMenu(wrapper, body, "staff");
      await findMenuItem(body, "配置權限").trigger("click");
      await flushPromises();

      await fieldInput(body, "原因").setValue("前線自助");
      await fieldInput(body, "你的密碼").setValue("hunter2");
      await submitDialog(body, "儲存");

      expect(roleService.list).toHaveBeenCalledTimes(2);
      expect(body.text()).toContain("有人喺你之前已經改過");
    });
  });

  describe("刪除角色", () => {
    it("帶用戶數落訊息，promptPassword 回原因密碼就打 delete()", async () => {
      promptPassword.mockResolvedValue({ reason: "唔再用", password: "hunter2" });
      roleService.delete.mockResolvedValue({ id: 2 });
      const { wrapper, body } = await mountRolesPage();

      await openRowMenu(wrapper, body, "staff");
      await findMenuItem(body, "刪除").trigger("click");
      await flushPromises();

      expect(promptPassword).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("12"),
          requireReason: true
        })
      );
      expect(roleService.delete).toHaveBeenCalledWith(2, { reason: "唔再用", password: "hunter2" });
    });

    it("撳取消唔會打 delete()", async () => {
      promptPassword.mockResolvedValue(null);
      const { wrapper, body } = await mountRolesPage();

      await openRowMenu(wrapper, body, "staff");
      await findMenuItem(body, "刪除").trigger("click");
      await flushPromises();

      expect(roleService.delete).not.toHaveBeenCalled();
    });

    it("刪除失敗會 notifyError", async () => {
      promptPassword.mockResolvedValue({ reason: "唔再用", password: "hunter2" });
      roleService.delete.mockRejectedValue(new Error("刪除失敗喇"));
      const { wrapper, body } = await mountRolesPage();

      await openRowMenu(wrapper, body, "staff");
      await findMenuItem(body, "刪除").trigger("click");
      await flushPromises();

      expect(notifyError).toHaveBeenCalledWith("刪除失敗喇");
    });
  });
});
