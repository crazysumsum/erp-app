import { flushPromises, mount } from "@vue/test-utils";
import { QTable, Quasar } from "quasar";
import { describe, expect, it, vi } from "vitest";
import DataTable from "@/framework/ui/DataTable.vue";

const columns = [{ name: "name", label: "名稱", field: "name" }];

function mountDataTable(props) {
  return mount(DataTable, { props, global: { plugins: [Quasar] } });
}

describe("DataTable", () => {
  it("mount 之後會自動叫一次 fetch，攞返資料填落 QTable", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ rows: [{ name: "訂單 A" }], rowsNumber: 1 });
    const wrapper = mountDataTable({ fetch: fetchFn, columns });
    await flushPromises();

    expect(fetchFn).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, sortBy: null, descending: false, filter: "" })
    );
    expect(wrapper.text()).toContain("訂單 A");
  });

  it("fetch 拋錯會顯示錯誤 banner，唔會當正常結果咁渲染", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("連線失敗"));
    const wrapper = mountDataTable({ fetch: fetchFn, columns });
    await flushPromises();

    expect(wrapper.text()).toContain("連線失敗");
    expect(wrapper.find(".q-banner").exists()).toBe(true);
  });

  it("撳重試會再叫一次 fetch", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("連線失敗"))
      .mockResolvedValueOnce({ rows: [], rowsNumber: 0 });
    const wrapper = mountDataTable({ fetch: fetchFn, columns });
    await flushPromises();

    await wrapper.find('button[aria-label="重試"]').trigger("click");
    await flushPromises();

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("QTable 嘅 @request（例如揭第二頁、排序）會帶埋新參數再叫 fetch", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ rows: [], rowsNumber: 50 });
    const wrapper = mountDataTable({ fetch: fetchFn, columns });
    await flushPromises();

    await wrapper.findComponent(QTable).vm.$emit("request", {
      pagination: { page: 2, rowsPerPage: 20, sortBy: "name", descending: true },
      filter: ""
    });
    await flushPromises();

    expect(fetchFn).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, rowsPerPage: 20, sortBy: "name", descending: true })
    );
  });

  it("expose 咗 reload()，等頁面喺 CRUD 操作之後可以手動叫", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ rows: [], rowsNumber: 0 });
    const wrapper = mountDataTable({ fetch: fetchFn, columns });
    await flushPromises();

    await wrapper.vm.reload();

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("將頁面傳落嚟嘅 slot（例如 body-cell-actions）原樣轉發俾內部嘅 QTable", async () => {
    const actionColumns = [...columns, { name: "actions", label: "操作", field: "actions" }];
    const fetchFn = vi.fn().mockResolvedValue({ rows: [{ name: "訂單 A" }], rowsNumber: 1 });
    const wrapper = mount(DataTable, {
      props: { fetch: fetchFn, columns: actionColumns },
      slots: {
        "body-cell-actions": `<td class="my-action-cell"><button>刪除</button></td>`
      },
      global: { plugins: [Quasar] }
    });
    await flushPromises();

    expect(wrapper.find(".my-action-cell button").text()).toBe("刪除");
  });

  it("頁面冇傳 #no-data 就用返 DataTable 自己嘅預設空狀態文案", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ rows: [], rowsNumber: 0 });
    const wrapper = mountDataTable({ fetch: fetchFn, columns });
    await flushPromises();

    expect(wrapper.text()).toContain("冇資料");
  });

  it("頁面有傳 #no-data 就用返頁面自己嘅版本，唔會兩個一齊出", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ rows: [], rowsNumber: 0 });
    const wrapper = mount(DataTable, {
      props: { fetch: fetchFn, columns },
      slots: { "no-data": `<td class="my-empty">搵唔到任何訂單</td>` },
      global: { plugins: [Quasar] }
    });
    await flushPromises();

    expect(wrapper.text()).toContain("搵唔到任何訂單");
    expect(wrapper.text()).not.toContain("冇資料");
  });

  // 每頁筆數揀項一定要傳埋落 QTable：漏咗嘅話 QTable 會用返自己內建嗰套
  // （包含 rowsPerPage=0 即係「全部」），而後端 pageSize 有 maximum 上限，
  // 揀「全部」就會撞後端 validation 錯——呢個正正係 RolesPage 之前用緊
  // raw <q-table>、冇跟呢個 prop 嗰陣撞到嘅 bug。
  it("有將 appConfig 嘅 pageSizeOptions 傳落 QTable（唔可以用返 Quasar 預設嗰套，會有「全部」）", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ rows: [], rowsNumber: 0 });
    const wrapper = mountDataTable({ fetch: fetchFn, columns });
    await flushPromises();

    const options = wrapper.findComponent(QTable).props("rowsPerPageOptions");
    expect(options).toEqual([10, 20, 50, 100]);
    expect(options).not.toContain(0);
  });

  describe("客戶端模式（冇傳 fetch，改傳現成嘅 rows）", () => {
    it("直接用傳落嚟嘅 rows 渲染，唔會叫 fetch", async () => {
      const wrapper = mountDataTable({ rows: [{ name: "角色 A" }], columns });
      await flushPromises();

      expect(wrapper.text()).toContain("角色 A");
    });

    it("轉發 loading prop 俾 QTable（伺服器模式先用自己個 fetchLoading）", async () => {
      const wrapper = mountDataTable({ rows: [], columns, loading: true });
      await flushPromises();

      expect(wrapper.findComponent(QTable).props("loading")).toBe(true);
    });

    it("rows prop 改咗，畫面會跟住反映（Vue reactivity，唔使 reload()）", async () => {
      const wrapper = mountDataTable({ rows: [{ name: "角色 A" }], columns });
      await flushPromises();

      await wrapper.setProps({ rows: [{ name: "角色 A" }, { name: "角色 B" }] });
      await flushPromises();

      expect(wrapper.text()).toContain("角色 B");
    });

    it("reload() 喺客戶端模式係安全嘅 no-op，唔會拋錯", async () => {
      const wrapper = mountDataTable({ rows: [], columns });
      await flushPromises();

      expect(() => wrapper.vm.reload()).not.toThrow();
    });
  });
});
