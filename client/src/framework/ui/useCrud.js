import { ref } from "vue";
import { confirmDelete } from "./confirm.js";
import { notifyError, notifySuccess } from "./notify.js";

/**
 * 一個 resource 嘅 list / create / update / delete 樣板。`resourceApi` 係
 * Service 層（`useService(name)` 攞返嚟嗰個）,預期有 `list`／`create`／
 * `update`／`delete` 四個方法——呢個係固定慣例,唔開放改名,一個 CRUD 頁面
 * 對呢四個方法就得。
 *
 * `create`／`update` 刻意唔喺呢度接錯誤：頁面會將佢哋掛做 FormPanel 嘅
 * `onSubmit`,拋出嘅錯誤要留俾 FormPanel 自己攞 `error.details` 拆返做
 * field-level 錯誤顯示——喺呢度截住嘅話 FormPanel 就冧唔到後端嘅
 * validation 錯誤。`remove` 唔經 FormPanel（淨係一個刪除按鈕),所以自己
 * 接錯誤同顯示 notify。
 */
export function useCrud(resourceApi, { resourceLabel = "資料" } = {}) {
  const dataTableRef = ref(null);

  function list(params) {
    return resourceApi.list(params);
  }

  async function create(payload) {
    const result = await resourceApi.create(payload);
    notifySuccess(`新增${resourceLabel}成功`);
    await dataTableRef.value?.reload();
    return result;
  }

  async function update(id, payload) {
    const result = await resourceApi.update(id, payload);
    notifySuccess(`更新${resourceLabel}成功`);
    await dataTableRef.value?.reload();
    return result;
  }

  async function remove(id, { label = resourceLabel } = {}) {
    const confirmed = await confirmDelete(label);
    if (!confirmed) {
      return false;
    }

    try {
      await resourceApi.delete(id);
      notifySuccess(`刪除${resourceLabel}成功`);
      await dataTableRef.value?.reload();
      return true;
    } catch (error) {
      notifyError(error.message || `刪除${resourceLabel}失敗`);
      return false;
    }
  }

  return { dataTableRef, list, create, update, remove };
}
