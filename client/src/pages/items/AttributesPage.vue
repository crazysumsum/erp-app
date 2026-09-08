<script>
export const page = {
  name: "attributes",
  path: "/items/attributes",
  title: "商品屬性",
  requires: { permissions: ["item.mgmt"] },
  menu: { group: "items", icon: "tune", order: 50 }
};
</script>

<script setup>
import { computed, ref } from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import { can } from "@/framework/authorization/can.js";
import { promptPassword, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { STATUS_COLOUR, STATUS_LABEL } from "@/framework/ui/catalogStatus.js";
import itemCatalogService from "@/services/itemCatalog.js";
import { useSessionStore } from "@/stores/session.js";

/**
 * Attribute（商品屬性）嘅分頁清單、新增／修改（含 option 集合）、狀態變更、
 * 刪除。設計說明見 docs/items_management/design_spec.md §6.4、§7.2。
 *
 * 同 BrandsPage.vue 一樣嘅表格＋dialog 版面；Category 規則（邊個分類要求
 * 邊啲屬性）唔喺呢一頁，喺 CategoriesPage.vue 度編輯——理由見
 * categoryHandlers.js 對 assignAttributes 端點嘅說明：規則係「一個分類揀
 * 幾多屬性」，喺 Category 嗰邊編輯先貼近 API 實際形狀。
 */

const session = useSessionStore();
const canManage = computed(() => can(session, { permissions: ["item.mgmt"] }));

const DATA_TYPE_LABEL = Object.freeze({
  text: "文字",
  long_text: "長文字",
  decimal: "數值",
  boolean: "是／否",
  date: "日期",
  single_option: "單選"
});
const DATA_TYPE_OPTIONS = Object.entries(DATA_TYPE_LABEL).map(([value, label]) => ({ label, value }));

const columns = [
  { name: "code", label: "代碼", field: "code", align: "left" },
  { name: "name", label: "名稱", field: "name", align: "left", sortable: true },
  { name: "dataType", label: "資料型別", field: "dataType", align: "left" },
  { name: "isVariant", label: "區分規格", field: "isVariant", align: "center" },
  { name: "status", label: "狀態", field: "status", align: "left", sortable: true },
  { name: "actions", label: "", field: "id", align: "right" }
];

const searchText = ref("");
const statusFilter = ref(null);
const STATUS_FILTER_OPTIONS = [
  { label: "全部", value: null },
  { label: "啟用", value: "active" },
  { label: "已停用", value: "inactive" },
  { label: "已封存", value: "archived" }
];

const dataTableRef = ref(null);

function fetchAttributes({ page, rowsPerPage, sortBy, descending, filter }) {
  return itemCatalogService.attributeList({
    page,
    rowsPerPage,
    sortBy,
    descending,
    filter,
    status: statusFilter.value
  });
}

/* ---------------- UOM（decimal 型別嘅顯示單位） ---------------- */

const uomOptions = ref([]);
let uomsLoaded = false;

async function ensureUomOptions() {
  if (uomsLoaded) return;
  try {
    const uoms = await itemCatalogService.uomList({ includeArchived: false });
    uomOptions.value = uoms
      .filter((uom) => uom.status === "active")
      .map((uom) => ({ label: `${uom.name}（${uom.code}）`, value: uom.id }));
    uomsLoaded = true;
  } catch (error) {
    notifyError(error.message || "載入單位選項失敗");
  }
}

/* ---------------- 新增／編輯 ---------------- */

const showFormDialog = ref(false);
const formMode = ref("create");
const editingAttribute = ref(null);
const form = ref(emptyForm());
const formError = ref("");

function emptyForm() {
  return {
    code: "",
    name: "",
    dataType: "text",
    uomId: null,
    isVariant: false,
    isFilterable: false,
    options: []
  };
}

function addOption() {
  form.value.options = [...form.value.options, { value: "", label: "", sortOrder: form.value.options.length }];
}

function removeOption(index) {
  form.value.options = form.value.options.filter((_, i) => i !== index);
}

async function openCreateDialog() {
  formMode.value = "create";
  editingAttribute.value = null;
  formError.value = "";
  form.value = emptyForm();
  await ensureUomOptions();
  showFormDialog.value = true;
}

async function openEditDialog(row) {
  formMode.value = "edit";
  editingAttribute.value = row;
  formError.value = "";
  form.value = {
    code: row.code,
    name: row.name,
    dataType: row.dataType,
    uomId: row.uomId,
    isVariant: row.isVariant,
    isFilterable: row.isFilterable,
    options: row.options.map((option) => ({ ...option }))
  };
  await ensureUomOptions();
  showFormDialog.value = true;
}

async function submitForm() {
  formError.value = "";
  try {
    if (formMode.value === "create") {
      return await itemCatalogService.createAttribute(form.value);
    }
    return await itemCatalogService.updateAttribute(editingAttribute.value.id, {
      ...form.value,
      version: editingAttribute.value.version
    });
  } catch (error) {
    if (error.code === "VERSION_CONFLICT") {
      await dataTableRef.value?.reload();
      formError.value = "有人在你之前已經改過這個屬性，畫面已經更新為最新版本，請重新確認後再試。";
    }
    throw error;
  }
}

function afterFormSubmit() {
  showFormDialog.value = false;
  notifySuccess(formMode.value === "create" ? "已新增商品屬性" : "已更新商品屬性");
  dataTableRef.value?.reload();
}

/* ---------------- 狀態變更 ---------------- */

async function activate(row) {
  const reason = await promptReason({ title: "啟用屬性", message: `啟用「${row.name}」？`, okLabel: "啟用" });
  if (reason === null) return;
  try {
    await itemCatalogService.activateAttribute(row.id, { reason, version: row.version });
    notifySuccess(`屬性「${row.name}」已啟用`);
    await dataTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "啟用失敗");
  }
}

async function deactivate(row) {
  const reason = await promptReason({ title: "停用屬性", message: `停用「${row.name}」？`, okLabel: "停用" });
  if (reason === null) return;
  try {
    await itemCatalogService.deactivateAttribute(row.id, { reason, version: row.version });
    notifySuccess(`屬性「${row.name}」已停用`);
    await dataTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "停用失敗");
  }
}

async function archive(row) {
  const outcome = await promptPassword({
    title: "封存屬性",
    message: `封存「${row.name}」？封存後預設不會出現在列表與選擇器中。`,
    okLabel: "封存",
    requireReason: true
  });
  if (outcome === null) return;
  try {
    await itemCatalogService.archiveAttribute(row.id, { ...outcome, version: row.version });
    notifySuccess(`屬性「${row.name}」已封存`);
    await dataTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "封存失敗");
  }
}

async function restore(row) {
  const outcome = await promptPassword({
    title: "恢復屬性",
    message: `從封存恢復「${row.name}」？恢復後狀態為「已停用」，需要另外啟用。`,
    okLabel: "恢復",
    requireReason: true
  });
  if (outcome === null) return;
  try {
    await itemCatalogService.restoreAttribute(row.id, { ...outcome, version: row.version });
    notifySuccess(`屬性「${row.name}」已從封存恢復`);
    await dataTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "恢復失敗");
  }
}

async function remove(row) {
  const outcome = await promptPassword({
    title: "刪除屬性",
    message: `永久刪除「${row.name}」？這個操作不可以復原；如果這個屬性已被分類規則或商品使用，系統會拒絕刪除。`,
    okLabel: "刪除",
    requireReason: true
  });
  if (outcome === null) return;
  try {
    await itemCatalogService.deleteAttribute(row.id, { ...outcome, version: row.version });
    notifySuccess(`屬性「${row.name}」已刪除`);
    await dataTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "刪除失敗");
  }
}
</script>

<template>
  <div>
    <PageHeader>
      <template #actions>
        <q-btn v-if="canManage" color="primary" unelevated label="新增屬性" icon="add" @click="openCreateDialog" />
      </template>
    </PageHeader>

    <div class="q-px-md q-pb-md row q-gutter-sm items-center">
      <q-input v-model="searchText" dense outlined debounce="300" placeholder="搜尋名稱或代碼" style="width: 240px">
        <template #prepend><q-icon name="search" /></template>
      </q-input>
      <q-select
        v-model="statusFilter"
        dense
        outlined
        emit-value
        map-options
        :options="STATUS_FILTER_OPTIONS"
        style="width: 160px"
        label="狀態"
        @update:model-value="dataTableRef?.reload()"
      />
    </div>

    <div class="q-px-md q-pb-md">
      <DataTable ref="dataTableRef" :fetch="fetchAttributes" :columns="columns" :filter="searchText" row-key="id" sticky-actions>
        <template #body-cell-code="{ value }">
          <EllipsisCell :text="value" max-width="160px" />
        </template>

        <template #body-cell-name="{ value }">
          <EllipsisCell :text="value" max-width="200px" />
        </template>

        <template #body-cell-dataType="{ value }">
          <q-td class="text-left">{{ DATA_TYPE_LABEL[value] ?? value }}</q-td>
        </template>

        <template #body-cell-isVariant="{ value }">
          <q-td class="text-center">
            <q-icon v-if="value" name="check_circle" color="positive" />
          </q-td>
        </template>

        <template #body-cell-status="{ value }">
          <q-td class="text-left">
            <q-badge :color="STATUS_COLOUR[value]" :label="STATUS_LABEL[value] ?? value" />
          </q-td>
        </template>

        <template #body-cell-actions="{ row }">
          <q-td class="text-right">
            <q-btn v-if="canManage" flat round dense icon="more_vert" :aria-label="`「${row.name}」的操作`">
              <q-menu>
                <q-list>
                  <q-item v-close-popup clickable @click="openEditDialog(row)">
                    <q-item-section>編輯</q-item-section>
                  </q-item>
                  <q-item v-if="row.status === 'inactive'" v-close-popup clickable @click="activate(row)">
                    <q-item-section>啟用</q-item-section>
                  </q-item>
                  <q-item v-if="row.status === 'active'" v-close-popup clickable @click="deactivate(row)">
                    <q-item-section>停用</q-item-section>
                  </q-item>
                  <q-item v-if="row.status !== 'archived'" v-close-popup clickable @click="archive(row)">
                    <q-item-section>封存</q-item-section>
                  </q-item>
                  <q-item v-if="row.status === 'archived'" v-close-popup clickable @click="restore(row)">
                    <q-item-section>從封存恢復</q-item-section>
                  </q-item>
                  <q-item v-close-popup clickable @click="remove(row)">
                    <q-item-section class="text-negative">刪除</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </q-td>
        </template>
      </DataTable>
    </div>

    <!-- 新增／編輯 -->
    <q-dialog v-model="showFormDialog" persistent>
      <q-card style="min-width: 480px; max-width: 90vw">
        <q-card-section>
          <h2 class="text-h6 q-ma-none">{{ formMode === "create" ? "新增商品屬性" : "編輯商品屬性" }}</h2>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submitForm" @success="afterFormSubmit">
            <div class="q-gutter-md">
              <q-banner v-if="formError" class="bg-warning text-dark">{{ formError }}</q-banner>
              <q-input
                v-model="form.code"
                label="代碼 *"
                filled
                autofocus
                :readonly="formMode === 'edit'"
                :disable="formMode === 'edit'"
                hint="建立後不可修改"
                :error="!!fieldError('code')"
                :error-message="fieldError('code')"
              />
              <q-input
                v-model="form.name"
                label="名稱 *"
                filled
                :error="!!fieldError('name')"
                :error-message="fieldError('name')"
              />
              <q-select
                v-model="form.dataType"
                :options="DATA_TYPE_OPTIONS"
                emit-value
                map-options
                label="資料型別 *"
                filled
                :readonly="formMode === 'edit'"
                :disable="formMode === 'edit'"
                hint="建立後不可修改"
                :error="!!fieldError('dataType')"
                :error-message="fieldError('dataType')"
              />
              <q-select
                v-if="form.dataType === 'decimal'"
                v-model="form.uomId"
                :options="uomOptions"
                emit-value
                map-options
                clearable
                label="顯示單位"
                filled
                :error="!!fieldError('uomId')"
                :error-message="fieldError('uomId')"
              />
              <div class="row q-gutter-md">
                <q-checkbox v-model="form.isVariant" label="用於區分規格（Variant）" />
                <q-checkbox v-model="form.isFilterable" label="出現在搜尋篩選" />
              </div>

              <div v-if="form.dataType === 'single_option'">
                <div class="text-subtitle2 q-mb-sm">選項 *</div>
                <div v-for="(option, index) in form.options" :key="index" class="row q-col-gutter-sm items-center q-mb-sm">
                  <div class="col-5">
                    <q-input
                      v-model="option.value"
                      label="值 *"
                      dense
                      outlined
                      :error="!!fieldError(`options.${index}.value`)"
                      :error-message="fieldError(`options.${index}.value`)"
                    />
                  </div>
                  <div class="col-5">
                    <q-input
                      v-model="option.label"
                      label="顯示名稱 *"
                      dense
                      outlined
                      :error="!!fieldError(`options.${index}.label`)"
                      :error-message="fieldError(`options.${index}.label`)"
                    />
                  </div>
                  <div class="col-2">
                    <q-btn flat round dense icon="delete" color="negative" aria-label="刪除選項" @click="removeOption(index)" />
                  </div>
                </div>
                <q-btn flat dense icon="add" label="新增選項" @click="addOption" />
              </div>

              <div class="row justify-end q-gutter-sm">
                <q-btn flat label="取消" :disable="submitting" @click="showFormDialog = false" />
                <q-btn type="submit" color="primary" :label="formMode === 'create' ? '新增' : '儲存'" unelevated :loading="submitting" />
              </div>
            </div>
          </FormPanel>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>
