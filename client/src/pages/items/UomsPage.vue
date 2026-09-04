<script>
export const page = {
  name: "uoms",
  path: "/items/uoms",
  title: "計量單位",
  requires: { permissions: ["item.view"] },
  menu: { group: "items", icon: "straighten", order: 40 }
};
</script>

<script setup>
import { computed, onMounted, ref } from "vue";
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
  { name: "code", label: "代碼", field: "code", align: "left" },
  { name: "name", label: "名稱", field: "name", align: "left" },
  { name: "symbol", label: "簡寫", field: "symbol", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "actions", label: "", field: "id", align: "right" }
];

const uoms = ref([]);
const loading = ref(false);
const includeArchived = ref(false);

async function loadUoms() {
  loading.value = true;
  try {
    uoms.value = await itemCatalogService.uomList({ includeArchived: includeArchived.value });
  } finally {
    loading.value = false;
  }
}

onMounted(loadUoms);

async function toggleIncludeArchived() {
  includeArchived.value = !includeArchived.value;
  await loadUoms();
}

/* ---------------- 新增／編輯 ---------------- */

const showFormDialog = ref(false);
const formMode = ref("create");
const editingUom = ref(null);
const form = ref({ code: "", name: "", symbol: "" });
const formError = ref("");

function openCreateDialog() {
  formMode.value = "create";
  editingUom.value = null;
  formError.value = "";
  form.value = { code: "", name: "", symbol: "" };
  showFormDialog.value = true;
}

function openEditDialog(row) {
  formMode.value = "edit";
  editingUom.value = row;
  formError.value = "";
  form.value = { code: row.code, name: row.name, symbol: row.symbol };
  showFormDialog.value = true;
}

async function submitForm() {
  formError.value = "";
  try {
    if (formMode.value === "create") {
      return await itemCatalogService.createUom(form.value);
    }
    return await itemCatalogService.updateUom(editingUom.value.id, {
      name: form.value.name,
      symbol: form.value.symbol,
      version: editingUom.value.version
    });
  } catch (error) {
    if (error.code === "VERSION_CONFLICT") {
      await loadUoms();
      formError.value = "有人在你之前已經改過這個單位，畫面已經更新為最新版本，請重新確認後再試。";
    }
    throw error;
  }
}

function afterFormSubmit() {
  showFormDialog.value = false;
  notifySuccess(formMode.value === "create" ? "已新增單位" : "已更新單位");
  loadUoms();
}

/* ---------------- 狀態變更 ---------------- */

async function activate(row) {
  const reason = await promptReason({ title: "啟用單位", message: `啟用「${row.name}」？`, okLabel: "啟用" });
  if (reason === null) {
    return;
  }
  try {
    await itemCatalogService.activateUom(row.id, { reason, version: row.version });
    notifySuccess(`單位「${row.name}」已啟用`);
    await loadUoms();
  } catch (error) {
    notifyError(error.message || "啟用失敗");
  }
}

async function deactivate(row) {
  const reason = await promptReason({ title: "停用單位", message: `停用「${row.name}」？`, okLabel: "停用" });
  if (reason === null) {
    return;
  }
  try {
    await itemCatalogService.deactivateUom(row.id, { reason, version: row.version });
    notifySuccess(`單位「${row.name}」已停用`);
    await loadUoms();
  } catch (error) {
    notifyError(error.message || "停用失敗");
  }
}

async function archive(row) {
  const outcome = await promptPassword({
    title: "封存單位",
    message: `封存「${row.name}」？封存後預設不會出現在列表與選擇器中。`,
    okLabel: "封存",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  try {
    await itemCatalogService.archiveUom(row.id, { ...outcome, version: row.version });
    notifySuccess(`單位「${row.name}」已封存`);
    await loadUoms();
  } catch (error) {
    notifyError(error.message || "封存失敗");
  }
}

async function restore(row) {
  const outcome = await promptPassword({
    title: "恢復單位",
    message: `從封存恢復「${row.name}」？恢復後狀態為「已停用」，需要另外啟用。`,
    okLabel: "恢復",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  try {
    await itemCatalogService.restoreUom(row.id, { ...outcome, version: row.version });
    notifySuccess(`單位「${row.name}」已從封存恢復`);
    await loadUoms();
  } catch (error) {
    notifyError(error.message || "恢復失敗");
  }
}

async function remove(row) {
  const outcome = await promptPassword({
    title: "刪除單位",
    message: `永久刪除「${row.name}」？這個操作不可以復原；如果這個單位已被 SKU 使用，系統會拒絕刪除。`,
    okLabel: "刪除",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  try {
    await itemCatalogService.deleteUom(row.id, outcome);
    notifySuccess(`單位「${row.name}」已刪除`);
    await loadUoms();
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
          flat
          :label="includeArchived ? '隱藏已封存' : '顯示已封存'"
          :icon="includeArchived ? 'visibility_off' : 'visibility'"
          @click="toggleIncludeArchived"
        />
        <q-btn
          v-if="canManage"
          color="primary"
          unelevated
          label="新增單位"
          icon="add"
          @click="openCreateDialog"
        />
      </template>
    </PageHeader>

    <div class="q-px-md q-pb-md">
      <DataTable :rows="uoms" :columns="columns" :loading="loading" row-key="id" sticky-actions>
        <template #body-cell-code="{ value }">
          <EllipsisCell :text="value" max-width="120px" />
        </template>

        <template #body-cell-name="{ value }">
          <EllipsisCell :text="value" max-width="160px" />
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
      <q-card style="min-width: 380px">
        <q-card-section>
          <h2 class="text-h6 q-ma-none">{{ formMode === "create" ? "新增單位" : "編輯單位" }}</h2>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submitForm" @success="afterFormSubmit">
            <div class="q-gutter-md">
              <q-banner v-if="formError" class="bg-warning text-dark">{{ formError }}</q-banner>
              <q-input
                v-model="form.code"
                label="代碼"
                filled
                autofocus
                :readonly="formMode === 'edit'"
                :hint="formMode === 'edit' ? '建立後不可修改' : ''"
                :error="!!fieldError('code')"
                :error-message="fieldError('code')"
              />
              <q-input
                v-model="form.name"
                label="名稱"
                filled
                :error="!!fieldError('name')"
                :error-message="fieldError('name')"
              />
              <q-input
                v-model="form.symbol"
                label="簡寫"
                filled
                :error="!!fieldError('symbol')"
                :error-message="fieldError('symbol')"
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
