import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { Quasar } from "quasar";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/itemCatalog.js", () => ({
  default: {
    categoryTree: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    activateCategory: vi.fn(),
    deactivateCategory: vi.fn(),
    archiveCategory: vi.fn(),
    restoreCategory: vi.fn(),
    deleteCategory: vi.fn(),
    brandList: vi.fn(),
    createBrand: vi.fn(),
    updateBrand: vi.fn(),
    activateBrand: vi.fn(),
    deactivateBrand: vi.fn(),
    archiveBrand: vi.fn(),
    restoreBrand: vi.fn(),
    deleteBrand: vi.fn(),
    uomList: vi.fn(),
    createUom: vi.fn(),
    updateUom: vi.fn(),
    activateUom: vi.fn(),
    deactivateUom: vi.fn(),
    archiveUom: vi.fn(),
    restoreUom: vi.fn(),
    deleteUom: vi.fn()
  },
  service: { name: "itemCatalog" }
}));
vi.mock("@/framework/ui/confirm.js", () => ({
  confirm: vi.fn(),
  confirmDelete: vi.fn(),
  promptPassword: vi.fn(),
  promptReason: vi.fn()
}));
// Notify 係單例，mock 走成個模組令呢個檔案唔使理個 DOM 細節（見
// test/pages/system/users.test.js 開頭嗰段解釋）。
vi.mock("@/framework/ui/notify.js", () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn()
}));

import itemCatalogService from "@/services/itemCatalog.js";
import { promptPassword, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import CategoriesPage from "@/pages/items/CategoriesPage.vue";
import BrandsPage from "@/pages/items/BrandsPage.vue";
import UomsPage from "@/pages/items/UomsPage.vue";
import { useSessionStore } from "@/stores/session.js";

const TREE = [
  {
    id: 1,
    name: "Vitamins",
    status: "active",
    parentId: null,
    sortOrder: 0,
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    children: [
      {
        id: 2,
        name: "Gummies",
        status: "inactive",
        parentId: 1,
        sortOrder: 0,
        version: 3,
        createdAt: 1,
        updatedAt: 1,
        children: []
      }
    ]
  },
  {
    id: 3,
    name: "Discontinued Line",
    status: "archived",
    parentId: null,
    sortOrder: 0,
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    children: []
  }
];

async function mountCategoriesPage({ permissions = ["item.view", "item.mgmt"], tree = TREE } = {}) {
  itemCatalogService.categoryTree.mockResolvedValue(tree);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: "home", component: CategoriesPage }]
  });
  await router.push("/");
  await router.isReady();

  const session = useSessionStore();
  session.user = { id: 1, username: "sam", displayName: "Sam Wong", permissions, roles: [] };

  const wrapper = mount(CategoriesPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, session, body: new DOMWrapper(document.body) };
}

async function openNodeMenu(body, categoryName) {
  await body.find(`button[aria-label="「${categoryName}」的操作"]`).trigger("click");
  await flushPromises();
  return body;
}

function findMenuItem(body, label) {
  return body.findAll(".q-item").find((el) => el.text().trim() === label || el.text().includes(label));
}

function fieldInput(body, label) {
  return body.findAll(".q-field").find((f) => f.text().includes(label)).find("input");
}

async function submitDialog(body, okLabel) {
  await body.findAll(".q-btn").find((btn) => btn.text() === okLabel).trigger("click");
  await flushPromises();
}

describe("pages/items/CategoriesPage.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("開機載入分類樹，預設帶 includeArchived: false（篩選由後端負責，見 FR-DELETE-005）", async () => {
    // 呢個假 service 唔會照 includeArchived 篩資料——真正嘅篩選係後端做
    // （ItemCatalogService.loadCategoryTree），這裡只驗證頁面有冇送對參數，
    // 唔是重新驗證後端已經測過嘅篩選邏輯。
    const withoutArchived = TREE.filter((node) => node.status !== "archived");
    const { wrapper } = await mountCategoriesPage({ tree: withoutArchived });

    expect(itemCatalogService.categoryTree).toHaveBeenCalledWith({ includeArchived: false });
    expect(wrapper.text()).toContain("Vitamins");
    expect(wrapper.text()).toContain("Gummies");
    expect(wrapper.text()).not.toContain("Discontinued Line");
  });

  it("撳「顯示已封存」會帶 includeArchived: true 重新載入", async () => {
    const { wrapper, body } = await mountCategoriesPage();

    itemCatalogService.categoryTree.mockResolvedValue(TREE);
    await body.findAll(".q-btn").find((btn) => btn.text().includes("顯示已封存")).trigger("click");
    await flushPromises();

    expect(itemCatalogService.categoryTree).toHaveBeenLastCalledWith({ includeArchived: true });
    expect(wrapper.text()).toContain("Discontinued Line");
  });

  it("開機讀取失敗（例如權限被收咗）：顯示錯誤提示，唔會靜靜哋當做冇資料", async () => {
    // 冇呢個 catch 嘅話，tree 會維持 []，畫面上同「真係冇分類資料」睇唔出
    // 分別——見 loadTree() 對呢個 catch 分支嘅註解。
    itemCatalogService.categoryTree.mockRejectedValue(new Error("找不到這個資源"));

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", name: "home", component: CategoriesPage }]
    });
    await router.push("/");
    await router.isReady();

    const session = useSessionStore();
    session.user = { id: 1, username: "sam", displayName: "Sam Wong", permissions: ["item.view", "item.mgmt"], roles: [] };

    mount(CategoriesPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
    await flushPromises();

    expect(notifyError).toHaveBeenCalledWith("找不到這個資源");
  });

  it("只有 item.view 冇 item.mgmt：睇得到樹，但冇「新增分類」按鈕同節點操作選單", async () => {
    const { wrapper, body } = await mountCategoriesPage({ permissions: ["item.view"] });

    expect(wrapper.text()).toContain("Vitamins");
    expect(wrapper.findAll(".q-btn").some((btn) => btn.text().includes("新增分類"))).toBe(false);
    expect(body.find('button[aria-label*="的操作"]').exists()).toBe(false);
  });

  it("新增分類：提交後重新載入樹並提示成功", async () => {
    itemCatalogService.createCategory.mockResolvedValue({ id: 9, name: "Snacks" });
    const { wrapper, body } = await mountCategoriesPage();

    await wrapper.findAll(".q-btn").find((btn) => btn.text().includes("新增分類")).trigger("click");
    await flushPromises();

    await fieldInput(body, "分類名稱").setValue("Snacks");
    await submitDialog(body, "新增");

    expect(itemCatalogService.createCategory).toHaveBeenCalledWith({
      name: "Snacks",
      parentId: null,
      sortOrder: 0
    });
    expect(notifySuccess).toHaveBeenCalledWith("已新增分類");
    expect(itemCatalogService.categoryTree).toHaveBeenCalledTimes(2);
  });

  it("編輯／移動：帶目前版本號整組送出", async () => {
    itemCatalogService.updateCategory.mockResolvedValue({ id: 2, name: "Gummies", version: 4 });
    const { body } = await mountCategoriesPage();

    await openNodeMenu(body, "Gummies");
    await findMenuItem(body, "編輯／移動").trigger("click");
    await flushPromises();

    await fieldInput(body, "分類名稱").setValue("Gummy Bears");
    await submitDialog(body, "儲存");

    expect(itemCatalogService.updateCategory).toHaveBeenCalledWith(2, {
      name: "Gummy Bears",
      parentId: 1,
      sortOrder: 0,
      version: 3
    });
  });

  it("編輯移動父層選單會排除自己同自己嘅子孫", async () => {
    const { body } = await mountCategoriesPage();

    await openNodeMenu(body, "Vitamins");
    await findMenuItem(body, "編輯／移動").trigger("click");
    await flushPromises();

    // Vitamins（id 1）自己同佢個仔 Gummies（id 2）都唔應該喺可揀嘅上層分類入面。
    const select = body.findAll(".q-field").find((f) => f.text().includes("上層分類"));
    await select.find(".q-field__native, input").trigger("click");
    await flushPromises();

    const optionTexts = body.findAll(".q-item__label").map((el) => el.text());
    expect(optionTexts.some((text) => text.includes("Vitamins"))).toBe(false);
    expect(optionTexts.some((text) => text.includes("Gummies"))).toBe(false);
  });

  it("VERSION_CONFLICT：重新載入樹並顯示提示，唔會直接覆蓋", async () => {
    const staleError = Object.assign(new Error("畫面上的資料已過期，請重新整理後再試"), {
      code: "VERSION_CONFLICT"
    });
    itemCatalogService.updateCategory.mockRejectedValue(staleError);
    const { body } = await mountCategoriesPage();

    await openNodeMenu(body, "Gummies");
    await findMenuItem(body, "編輯／移動").trigger("click");
    await flushPromises();
    await submitDialog(body, "儲存");

    expect(body.text()).toContain("有人在你之前已經改過這個分類");
    expect(itemCatalogService.categoryTree).toHaveBeenCalledTimes(2);
  });

  it("停用：用 promptReason（唔使密碼），帶 reason 同 version", async () => {
    promptReason.mockResolvedValue("暫停使用");
    itemCatalogService.deactivateCategory.mockResolvedValue({ id: 1, status: "inactive" });
    const { body } = await mountCategoriesPage();

    await openNodeMenu(body, "Vitamins");
    await findMenuItem(body, "停用").trigger("click");
    await flushPromises();

    expect(itemCatalogService.deactivateCategory).toHaveBeenCalledWith(1, {
      reason: "暫停使用",
      version: 1
    });
    expect(notifySuccess).toHaveBeenCalledWith('分類「Vitamins」已停用');
  });

  it("啟用：Inactive 節點先顯示「啟用」選項", async () => {
    promptReason.mockResolvedValue("重新上架");
    itemCatalogService.activateCategory.mockResolvedValue({ id: 2, status: "active" });
    const { body } = await mountCategoriesPage();

    await openNodeMenu(body, "Gummies");
    expect(findMenuItem(body, "啟用")).toBeTruthy();
    await findMenuItem(body, "啟用").trigger("click");
    await flushPromises();

    expect(itemCatalogService.activateCategory).toHaveBeenCalledWith(2, {
      reason: "重新上架",
      version: 3
    });
  });

  it("取消 promptReason 唔會呼叫任何 API", async () => {
    promptReason.mockResolvedValue(null);
    const { body } = await mountCategoriesPage();

    await openNodeMenu(body, "Vitamins");
    await findMenuItem(body, "停用").trigger("click");
    await flushPromises();

    expect(itemCatalogService.deactivateCategory).not.toHaveBeenCalled();
  });

  it("封存：用 promptPassword({ requireReason: true })", async () => {
    promptPassword.mockResolvedValue({ reason: "停產", password: "hunter2" });
    itemCatalogService.archiveCategory.mockResolvedValue({ id: 1, status: "archived" });
    const { body } = await mountCategoriesPage();

    await openNodeMenu(body, "Vitamins");
    await findMenuItem(body, "封存").trigger("click");
    await flushPromises();

    expect(promptPassword).toHaveBeenCalledWith(
      expect.objectContaining({ requireReason: true })
    );
    expect(itemCatalogService.archiveCategory).toHaveBeenCalledWith(1, {
      reason: "停產",
      password: "hunter2",
      version: 1
    });
  });

  it("刪除：帶埋 version（跟 archive／restore 同一組值），唔係淨係 reason／password", async () => {
    promptPassword.mockResolvedValue({ reason: "業務不再需要", password: "hunter2" });
    itemCatalogService.deleteCategory.mockResolvedValue({ id: 2 });
    const { body } = await mountCategoriesPage();

    await openNodeMenu(body, "Gummies");
    await findMenuItem(body, "刪除").trigger("click");
    await flushPromises();

    expect(itemCatalogService.deleteCategory).toHaveBeenCalledWith(2, {
      reason: "業務不再需要",
      password: "hunter2",
      version: 3
    });
  });

  it("刪除失敗（例如仍有子分類）：顯示後端嘅中文訊息，唔會靜靜哋失敗", async () => {
    promptPassword.mockResolvedValue({ reason: "嘗試刪除", password: "hunter2" });
    const error = Object.assign(new Error("這個分類還有子分類，無法刪除"), {
      code: "CATEGORY_HAS_CHILDREN"
    });
    itemCatalogService.deleteCategory.mockRejectedValue(error);
    const { body } = await mountCategoriesPage();

    await openNodeMenu(body, "Vitamins");
    await findMenuItem(body, "刪除").trigger("click");
    await flushPromises();

    expect(notifyError).toHaveBeenCalledWith("這個分類還有子分類，無法刪除");
  });

  it("從封存恢復：只有 Archived 節點顯示「從封存恢復」，成功後恢復為 Inactive", async () => {
    promptPassword.mockResolvedValue({ reason: "業務要求恢復", password: "hunter2" });
    itemCatalogService.restoreCategory.mockResolvedValue({ id: 3, status: "inactive" });
    const { body } = await mountCategoriesPage();

    await body.findAll(".q-btn").find((btn) => btn.text().includes("顯示已封存")).trigger("click");
    await flushPromises();

    await openNodeMenu(body, "Discontinued Line");
    expect(findMenuItem(body, "從封存恢復")).toBeTruthy();
    expect(findMenuItem(body, "啟用")).toBeFalsy();
    await findMenuItem(body, "從封存恢復").trigger("click");
    await flushPromises();

    expect(itemCatalogService.restoreCategory).toHaveBeenCalledWith(3, {
      reason: "業務要求恢復",
      password: "hunter2",
      version: 1
    });
  });
});

describe("pages/items/BrandsPage.vue", () => {
  const BRAND_ROWS = [
    { id: 1, name: "Brand A", officialName: "Brand A Ltd.", description: "", status: "active", version: 1 },
    { id: 2, name: "Brand B", officialName: "", description: "", status: "inactive", version: 2 }
  ];

  async function mountBrandsPage({ permissions = ["item.view", "item.mgmt"] } = {}) {
    itemCatalogService.brandList.mockResolvedValue({ rows: BRAND_ROWS, rowsNumber: BRAND_ROWS.length });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", name: "home", component: BrandsPage }]
    });
    await router.push("/");
    await router.isReady();

    const session = useSessionStore();
    session.user = { id: 1, username: "sam", displayName: "Sam Wong", permissions, roles: [] };

    const wrapper = mount(BrandsPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
    await flushPromises();

    return { wrapper, body: new DOMWrapper(document.body) };
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("開機以分頁 fetch 載入品牌，顯示喺表入面", async () => {
    const { wrapper } = await mountBrandsPage();

    expect(itemCatalogService.brandList).toHaveBeenCalled();
    expect(wrapper.text()).toContain("Brand A");
    expect(wrapper.text()).toContain("Brand B");
  });

  it("只有 item.view：睇得到列表，但冇「新增品牌」按鈕同操作選單", async () => {
    const { wrapper, body } = await mountBrandsPage({ permissions: ["item.view"] });

    expect(wrapper.findAll(".q-btn").some((btn) => btn.text().includes("新增品牌"))).toBe(false);
    expect(body.find('button[aria-label*="的操作"]').exists()).toBe(false);
  });

  it("新增品牌：提交後重新整理表格並提示成功", async () => {
    itemCatalogService.createBrand.mockResolvedValue({ id: 9, name: "Brand C" });
    const { wrapper, body } = await mountBrandsPage();

    await wrapper.findAll(".q-btn").find((btn) => btn.text().includes("新增品牌")).trigger("click");
    await flushPromises();

    await body.findAll(".q-field").find((f) => f.text().includes("品牌名稱")).find("input").setValue("Brand C");
    await body.findAll(".q-btn").find((btn) => btn.text() === "新增").trigger("click");
    await flushPromises();

    expect(itemCatalogService.createBrand).toHaveBeenCalledWith({
      name: "Brand C",
      officialName: "",
      description: ""
    });
    expect(notifySuccess).toHaveBeenCalledWith("已新增品牌");
  });

  it("停用：promptReason 唔使密碼；封存／刪除：promptPassword 要密碼", async () => {
    promptReason.mockResolvedValue("暫停使用");
    itemCatalogService.deactivateBrand.mockResolvedValue({ id: 1, status: "inactive" });
    const { body } = await mountBrandsPage();

    await body.find('button[aria-label="「Brand A」的操作"]').trigger("click");
    await flushPromises();
    await body.findAll(".q-item").find((el) => el.text().includes("停用")).trigger("click");
    await flushPromises();

    expect(itemCatalogService.deactivateBrand).toHaveBeenCalledWith(1, { reason: "暫停使用", version: 1 });

    promptPassword.mockResolvedValue({ reason: "停產", password: "hunter2" });
    itemCatalogService.archiveBrand.mockResolvedValue({ id: 1, status: "archived" });

    await body.find('button[aria-label="「Brand A」的操作"]').trigger("click");
    await flushPromises();
    await body.findAll(".q-item").find((el) => el.text().includes("封存")).trigger("click");
    await flushPromises();

    expect(promptPassword).toHaveBeenCalledWith(expect.objectContaining({ requireReason: true }));
    expect(itemCatalogService.archiveBrand).toHaveBeenCalledWith(1, {
      reason: "停產",
      password: "hunter2",
      version: 1
    });
  });

  it("刪除失敗時顯示後端訊息，唔會靜靜哋失敗", async () => {
    promptPassword.mockResolvedValue({ reason: "嘗試刪除", password: "hunter2" });
    const error = Object.assign(new Error("這筆資料使用中，無法刪除"), { code: "CATALOG_IN_USE" });
    itemCatalogService.deleteBrand.mockRejectedValue(error);
    const { body } = await mountBrandsPage();

    await body.find('button[aria-label="「Brand A」的操作"]').trigger("click");
    await flushPromises();
    await body.findAll(".q-item").find((el) => el.text().includes("刪除")).trigger("click");
    await flushPromises();

    expect(notifyError).toHaveBeenCalledWith("這筆資料使用中，無法刪除");
  });

  it("刪除：帶埋 version（跟 archive／restore 同一組值），唔係淨係 reason／password", async () => {
    promptPassword.mockResolvedValue({ reason: "業務不再需要", password: "hunter2" });
    itemCatalogService.deleteBrand.mockResolvedValue({ id: 1 });
    const { body } = await mountBrandsPage();

    await body.find('button[aria-label="「Brand A」的操作"]').trigger("click");
    await flushPromises();
    await body.findAll(".q-item").find((el) => el.text().includes("刪除")).trigger("click");
    await flushPromises();

    expect(itemCatalogService.deleteBrand).toHaveBeenCalledWith(1, {
      reason: "業務不再需要",
      password: "hunter2",
      version: 1
    });
  });
});

describe("pages/items/UomsPage.vue", () => {
  const UOM_ROWS = [
    { id: 1, code: "EA", name: "Each", symbol: "pcs", status: "active", version: 1 },
    { id: 2, code: "BOX", name: "Box", symbol: "", status: "archived", version: 1 }
  ];

  async function mountUomsPage({ permissions = ["item.view", "item.mgmt"], uoms = UOM_ROWS } = {}) {
    itemCatalogService.uomList.mockResolvedValue(uoms);

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", name: "home", component: UomsPage }]
    });
    await router.push("/");
    await router.isReady();

    const session = useSessionStore();
    session.user = { id: 1, username: "sam", displayName: "Sam Wong", permissions, roles: [] };

    const wrapper = mount(UomsPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
    await flushPromises();

    return { wrapper, body: new DOMWrapper(document.body) };
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("開機載入不分頁嘅單位小目錄，預設帶 includeArchived: false", async () => {
    const { wrapper } = await mountUomsPage({ uoms: UOM_ROWS.filter((u) => u.status !== "archived") });

    expect(itemCatalogService.uomList).toHaveBeenCalledWith({ includeArchived: false });
    expect(wrapper.text()).toContain("Each");
    expect(wrapper.text()).not.toContain("Box");
  });

  it("撳「顯示已封存」會帶 includeArchived: true", async () => {
    const { wrapper, body } = await mountUomsPage({ uoms: UOM_ROWS.filter((u) => u.status !== "archived") });

    itemCatalogService.uomList.mockResolvedValue(UOM_ROWS);
    await body.findAll(".q-btn").find((btn) => btn.text().includes("顯示已封存")).trigger("click");
    await flushPromises();

    expect(itemCatalogService.uomList).toHaveBeenLastCalledWith({ includeArchived: true });
    expect(wrapper.text()).toContain("Box");
  });

  it("新增單位：提交 code／name／symbol", async () => {
    itemCatalogService.createUom.mockResolvedValue({ id: 9, code: "KG", name: "Kilogram" });
    const { wrapper, body } = await mountUomsPage();

    await wrapper.findAll(".q-btn").find((btn) => btn.text().includes("新增單位")).trigger("click");
    await flushPromises();

    await body.findAll(".q-field").find((f) => f.text().includes("代碼")).find("input").setValue("KG");
    await body.findAll(".q-field").find((f) => f.text().includes("名稱")).find("input").setValue("Kilogram");
    await body.findAll(".q-btn").find((btn) => btn.text() === "新增").trigger("click");
    await flushPromises();

    expect(itemCatalogService.createUom).toHaveBeenCalledWith({ code: "KG", name: "Kilogram", symbol: "" });
  });

  it("編輯單位：code 欄位 readonly，唔會送去後端", async () => {
    itemCatalogService.updateUom.mockResolvedValue({ id: 1, code: "EA", name: "Each Piece" });
    const { body } = await mountUomsPage();

    await body.find('button[aria-label="「Each」的操作"]').trigger("click");
    await flushPromises();
    await body.findAll(".q-item").find((el) => el.text().includes("編輯")).trigger("click");
    await flushPromises();

    const codeInput = body.findAll(".q-field").find((f) => f.text().includes("代碼")).find("input");
    expect(codeInput.attributes("readonly")).toBeDefined();

    await body.findAll(".q-field").find((f) => f.text().includes("名稱")).find("input").setValue("Each Piece");
    await body.findAll(".q-btn").find((btn) => btn.text() === "儲存").trigger("click");
    await flushPromises();

    expect(itemCatalogService.updateUom).toHaveBeenCalledWith(1, {
      name: "Each Piece",
      symbol: "pcs",
      version: 1
    });
  });

  it("開機讀取失敗（例如權限被收咗）：顯示錯誤提示，唔會靜靜哋當做冇資料", async () => {
    itemCatalogService.uomList.mockRejectedValue(new Error("找不到這個資源"));

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", name: "home", component: UomsPage }]
    });
    await router.push("/");
    await router.isReady();

    const session = useSessionStore();
    session.user = { id: 1, username: "sam", displayName: "Sam Wong", permissions: ["item.view", "item.mgmt"], roles: [] };

    mount(UomsPage, { global: { plugins: [Quasar, router] }, attachTo: document.body });
    await flushPromises();

    expect(notifyError).toHaveBeenCalledWith("找不到這個資源");
  });

  it("只有 item.view：冇「新增單位」按鈕同操作選單", async () => {
    const { wrapper, body } = await mountUomsPage({ permissions: ["item.view"] });

    expect(wrapper.findAll(".q-btn").some((btn) => btn.text().includes("新增單位"))).toBe(false);
    expect(body.find('button[aria-label*="的操作"]').exists()).toBe(false);
  });

  it("刪除：帶埋 version（跟 update／archive 同一組值），唔係淨係 reason／password", async () => {
    promptPassword.mockResolvedValue({ reason: "業務不再需要", password: "hunter2" });
    itemCatalogService.deleteUom.mockResolvedValue({ id: 1 });
    const { body } = await mountUomsPage();

    await body.find('button[aria-label="「Each」的操作"]').trigger("click");
    await flushPromises();
    await body.findAll(".q-item").find((el) => el.text().includes("刪除")).trigger("click");
    await flushPromises();

    expect(itemCatalogService.deleteUom).toHaveBeenCalledWith(1, {
      reason: "業務不再需要",
      password: "hunter2",
      version: 1
    });
  });

  it("刪除失敗時顯示後端訊息，唔會靜靜哋失敗", async () => {
    promptPassword.mockResolvedValue({ reason: "嘗試刪除", password: "hunter2" });
    const error = Object.assign(new Error("這筆資料使用中，無法刪除"), { code: "CATALOG_IN_USE" });
    itemCatalogService.deleteUom.mockRejectedValue(error);
    const { body } = await mountUomsPage();

    await body.find('button[aria-label="「Each」的操作"]').trigger("click");
    await flushPromises();
    await body.findAll(".q-item").find((el) => el.text().includes("刪除")).trigger("click");
    await flushPromises();

    expect(notifyError).toHaveBeenCalledWith("這筆資料使用中，無法刪除");
  });
});
