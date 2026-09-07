<script>
export const page = {
  name: "brands",
  path: "/items/brands",
  title: "品牌",
  requires: { permissions: ["item.mgmt"] },
  menu: { group: "items", icon: "sell", order: 30 }
};
</script>

<script setup>
import { computed, ref } from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import { promptPassword, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import itemCatalogService from "@/services/itemCatalog.js";
import { useSessionStore } from "@/stores/session.js";

const session = useSessionStore();
const canManage = computed(() => session.permissions.includes("item.mgmt"));

const STATUS_LABEL = { active: "啟用", inactive: "已停用", archived: "已封存" };
const STATUS_COLOUR = { active: "positive", inactive: "grey", archived: "warning" };

const columns = [
  { name: "name", label: "品牌名稱", field: "name", align: "left", sortable: true },
  { name: "officialName", label: "官方名稱", field: "officialName", align: "left" },
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

function fetchBrands({ page, rowsPerPage, sortBy, descending, filter }) {
  return itemCatalogService.brandList({
    page,
    rowsPerPage,
    sortBy,
    descending,
    filter,
    status: statusFilter.value
  });
}

/* ---------------- 新增／編輯 ---------------- */

const showFormDialog = ref(false);
const formMode = ref("create");
const editingBrand = ref(null);
const form = ref({ name: "", officialName: "", description: "" });
const formError = ref("");

function openCreateDialog() {
  formMode.value = "create";
  editingBrand.value = null;
  formError.value = "";
  form.value = { name: "", officialName: "", description: "" };
  showFormDialog.value = true;
}

function openEditDialog(row) {
  formMode.value = "edit";
  editingBrand.value = row;
  formError.value = "";
  form.value = { name: row.name, officialName: row.officialName, description: row.description };
  showFormDialog.value = true;
}

async function submitForm() {
  formError.value = "";
  try {
    if (formMode.value === "create") {
      return await itemCatalogService.createBrand(form.value);
    }
    return await itemCatalogService.updateBrand(editingBrand.value.id, {
      ...form.value,
      version: editingBrand.value.version
    });
  } catch (error) {
    if (error.code === "VERSION_CONFLICT") {
      await dataTableRef.value?.reload();
      formError.value = "有人在你之前已經改過這個品牌，畫面已經更新為最新版本，請重新確認後再試。";
    }
    throw error;
  }
}

function afterFormSubmit() {
  showFormDialog.value = false;
  notifySuccess(formMode.value === "create" ? "已新增品牌" : "已更新品牌");
  dataTableRef.value?.reload();
}

/* ---------------- 狀態變更 ---------------- */

async function activate(row) {
  const reason = await promptReason({
    title: "啟用品牌",
    message: `啟用「${row.name}」？`,
    okLabel: "啟用"
  });
  if (reason === null) {
    return;
  }
  try {
    await itemCatalogService.activateBrand(row.id, { reason, version: row.version });
    notifySuccess(`品牌「${row.name}」已啟用`);
    await dataTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "啟用失敗");
  }
}

async function deactivate(row) {
  const reason = await promptReason({
    title: "停用品牌",
    message: `停用「${row.name}」？停用後不可再指派給新商品。`,
    okLabel: "停用"
  });
  if (reason === null) {
    return;
  }
  try {
    await itemCatalogService.deactivateBrand(row.id, { reason, version: row.version });
    notifySuccess(`品牌「${row.name}」已停用`);
    await dataTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "停用失敗");
  }
}

async function archive(row) {
  const outcome = await promptPassword({
    title: "封存品牌",
    message: `封存「${row.name}」？封存後預設不會出現在列表與選擇器中。`,
    okLabel: "封存",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  try {
    await itemCatalogService.archiveBrand(row.id, { ...outcome, version: row.version });
    notifySuccess(`品牌「${row.name}」已封存`);
    await dataTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "封存失敗");
  }
}

async function restore(row) {
  const outcome = await promptPassword({
    title: "恢復品牌",
    message: `從封存恢復「${row.name}」？恢復後狀態為「已停用」，需要另外啟用。`,
    okLabel: "恢復",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  try {
    await itemCatalogService.restoreBrand(row.id, { ...outcome, version: row.version });
    notifySuccess(`品牌「${row.name}」已從封存恢復`);
    await dataTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "恢復失敗");
  }
}

async function remove(row) {
  const outcome = await promptPassword({
    title: "刪除品牌",
    message: `永久刪除「${row.name}」？這個操作不可以復原；如果這個品牌已被商品使用，系統會拒絕刪除。`,
    okLabel: "刪除",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  try {
    await itemCatalogService.deleteBrand(row.id, { ...outcome, version: row.version });
    notifySuccess(`品牌「${row.name}」已刪除`);
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
        <q-btn
          v-if="canManage"
          color="primary"
          unelevated
          label="新增品牌"
          icon="add"
          @click="openCreateDialog"
        />
      </template>
    </PageHeader>

    <div class="q-px-md q-pb-md row q-gutter-sm items-center">
      <q-input v-model="searchText" dense outlined debounce="300" placeholder="搜尋品牌名稱" style="width: 240px">
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
      <DataTable
        ref="dataTableRef"
        :fetch="fetchBrands"
        :columns="columns"
        :filter="searchText"
        row-key="id"
        sticky-actions
      >
        <template #body-cell-name="{ value }">
          <EllipsisCell :text="value" max-width="200px" />
        </template>

        <template #body-cell-officialName="{ value }">
          <EllipsisCell :text="value" max-width="200px" />
        </template>

        <template #body-cell-status="{ value }">
          <q-td class="text-left">
            <q-badge :color="STATUS_COLOUR[value]" :label="STATUS_LABEL[value] ?? value" />
          </q-td>
        </template>

        <template #body-cell-actions="{ row }">
          <q-td class="text-right">
            <q-btn
              v-if="canManage"
              flat
              round
              dense
              icon="more_vert"
              :aria-label="`「${row.name}」的操作`"
            >
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
      <q-card style="min-width: 420px">
        <q-card-section>
          <h2 class="text-h6 q-ma-none">{{ formMode === "create" ? "新增品牌" : "編輯品牌" }}</h2>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submitForm" @success="afterFormSubmit">
            <div class="q-gutter-md">
              <q-banner v-if="formError" class="bg-warning text-dark">{{ formError }}</q-banner>
              <q-input
                v-model="form.name"
                label="品牌名稱"
                filled
                autofocus
                :error="!!fieldError('name')"
                :error-message="fieldError('name')"
              />
              <q-input
                v-model="form.officialName"
                label="官方名稱"
                filled
                :error="!!fieldError('officialName')"
                :error-message="fieldError('officialName')"
              />
              <q-input
                v-model="form.description"
                type="textarea"
                label="描述"
                filled
                :error="!!fieldError('description')"
                :error-message="fieldError('description')"
              />
              <div class="row justify-end q-gutter-sm">
                <q-btn flat label="取消" :disable="submitting" @click="showFormDialog = false" />
                <q-btn
                  type="submit"
                  color="primary"
                  :label="formMode === 'create' ? '新增' : '儲存'"
                  unelevated
                  :loading="submitting"
                />
              </div>
            </div>
          </FormPanel>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>
