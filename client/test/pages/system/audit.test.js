import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/audit.js", () => ({
  default: { list: vi.fn() },
  service: { name: "audit" }
}));

import auditService from "@/services/audit.js";
import AuditLogsPage from "@/pages/system/AuditLogsPage.vue";
import { useSessionStore } from "@/stores/session.js";

const ROWS = [
  {
    id: 1,
    occurredAt: 1735689600000,
    actorUserId: 1,
    actorUsername: "sam",
    action: "user.roles",
    targetType: "user",
    targetId: 2,
    targetLabel: "amy",
    reason: "轉組",
    detail: { roles: { before: ["staff"], after: ["staff", "purchaser"] } }
  },
  {
    id: 2,
    occurredAt: 1735689500000,
    actorUserId: null,
    actorUsername: "cli:sam",
    action: "user.roles",
    targetType: "user",
    targetId: 3,
    targetLabel: "breakglass-drill",
    reason: "break-glass 演練",
    detail: { roles: { before: [], after: ["system-admin"] }, status: { before: "disabled", after: "active" } }
  },
  {
    id: 3,
    occurredAt: 1735689400000,
    actorUserId: 1,
    actorUsername: "sam",
    action: "role.update",
    targetType: "role",
    targetId: 5,
    targetLabel: "staff",
    reason: "",
    detail: { name: { before: "staf", after: "staff" } }
  },
  {
    id: 4,
    occurredAt: 1735689300000,
    actorUserId: 1,
    actorUsername: "sam",
    action: "user.disable",
    targetType: "user",
    targetId: 4,
    targetLabel: "bob",
    reason: "離職",
    detail: null
  }
];

async function mountAuditLogsPage() {
  auditService.list.mockResolvedValue({ rows: ROWS, rowsNumber: ROWS.length });

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: "home", component: AuditLogsPage }]
  });
  await router.push("/");
  await router.isReady();

  const session = useSessionStore();
  session.user = {
    id: 1,
    username: "sam",
    displayName: "Sam Wong",
    permissions: ["user.mgmt", "role.mgmt"],
    roles: []
  };

  const wrapper = mount(AuditLogsPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, session, body: new DOMWrapper(document.body) };
}

describe("pages/system/AuditLogsPage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("開機攞第一頁稽核記錄，冇任何篩選", async () => {
    const { wrapper } = await mountAuditLogsPage();

    expect(auditService.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, from: undefined, to: undefined, actor: "", target: "", action: null })
    );
    expect(wrapper.text()).toContain("amy");
    expect(wrapper.text()).toContain("配置角色");
  });

  it("動作字串翻做中文標籤，冇對應嘅就照原字串顯示", async () => {
    const { wrapper } = await mountAuditLogsPage();

    expect(wrapper.text()).toContain("配置角色");
    expect(wrapper.text()).toContain("編輯角色");
    expect(wrapper.text()).toContain("停用用戶");
  });

  it("對象欄顯示 targetType/targetLabel", async () => {
    const { wrapper } = await mountAuditLogsPage();

    expect(wrapper.text()).toContain("user/amy");
    expect(wrapper.text()).toContain("role/staff");
  });

  it("cli: 開頭嘅操作者顯示做一個 badge，一眼分得出唔係介面操作", async () => {
    const { wrapper } = await mountAuditLogsPage();

    const row = wrapper.findAll("tbody tr").find((tr) => tr.text().includes("breakglass-drill"));
    expect(row.find(".q-badge").exists()).toBe(true);
    expect(row.find(".q-badge").text()).toBe("cli:sam");
  });

  it("detail 嘅陣列 before/after 渲染做 +新增／−移除", async () => {
    const { wrapper } = await mountAuditLogsPage();

    const row = wrapper.findAll("tbody tr").find((tr) => tr.text().includes("amy"));
    expect(row.text()).toContain("+purchaser");
    expect(row.text()).not.toContain("+staff");
    expect(row.text()).not.toContain("−staff");
  });

  it("detail 嘅純量 before/after 渲染做「欄位：舊 → 新」", async () => {
    const { wrapper } = await mountAuditLogsPage();

    const row = wrapper.findAll("tbody tr").find((tr) => tr.text().includes("staff") && tr.text().includes("role/"));
    expect(row.text()).toContain("name：staf → staff");
  });

  it("detail 係 null（停用／啟用呢類）就顯示破折號", async () => {
    const { wrapper } = await mountAuditLogsPage();

    const row = wrapper.findAll("tbody tr").find((tr) => tr.text().includes("bob"));
    expect(row.text()).toContain("—");
  });

  it("reason 空白就顯示破折號", async () => {
    const { wrapper } = await mountAuditLogsPage();

    const row = wrapper.findAll("tbody tr").find((tr) => tr.text().includes("staff") && tr.text().includes("role/"));
    expect(row.text()).toContain("—");
  });

  it("「從」「到」設定日期範圍就重新 fetch，帶埋嗰一日嘅起訖 epoch", async () => {
    const { body } = await mountAuditLogsPage();
    auditService.list.mockClear();

    const fromInput = body.findAll(".q-field").find((f) => f.text().includes("從")).find("input");
    await fromInput.setValue("2025-01-01");
    await flushPromises();

    expect(auditService.list).toHaveBeenCalledWith(
      expect.objectContaining({ from: new Date("2025-01-01T00:00:00").getTime() })
    );

    const toInput = body.findAll(".q-field").find((f) => f.text().includes("到")).find("input");
    await toInput.setValue("2025-01-31");
    await flushPromises();

    expect(auditService.list).toHaveBeenCalledWith(
      expect.objectContaining({ to: new Date("2025-01-31T23:59:59.999").getTime() })
    );
  });
});
