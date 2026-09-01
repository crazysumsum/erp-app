<script>
export const page = {
  name: "roles",
  path: "/system/roles",
  title: "角色管理",
  requires: { permissions: ["role.mgmt"] },
  // 見 UsersPage.vue 開頭嘅註解：order 淨係要求喺 users（25）之後就夠。
  menu: { group: "system", icon: "admin_panel_settings", order: 35 }
};
</script>

<script setup>
import { computed, onMounted, ref } from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import roleService from "@/services/role.js";
import { useSessionStore } from "@/stores/session.js";

const session = useSessionStore();

const PROTECTED_ROLE = "system-admin";

const columns = [
  { name: "name", label: "角色名", field: "name", align: "left" },
  { name: "description", label: "描述", field: "description", align: "left" },
  { name: "permissions", label: "權限", field: "permissions", align: "left" },
  { name: "userCount", label: "用戶數", field: "userCount", align: "left" },
  { name: "actions", label: "", field: "id", align: "right" }
];

const roles = ref([]);
const permissions = ref([]);
const loading = ref(false);

async function loadRoles() {
  loading.value = true;
  try {
    roles.value = await roleService.list();
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([
    loadRoles(),
    roleService.listPermissions().then((items) => {
      permissions.value = items;
    })
  ]);
});

function summarisePermissions(names) {
  if (names.length === 0) {
    return "（無）";
  }
  return names.length <= 2 ? names.join("、") : `${names[0]} +${names.length - 1}`;
}

function isProtected(role) {
  return role.name === PROTECTED_ROLE;
}

/* ---------------- 新增角色 ---------------- */

const showCreateDialog = ref(false);
const createForm = ref({ name: "", description: "" });

function openCreateDialog() {
  createForm.value = { name: "", description: "" };
  showCreateDialog.value = true;
}

async function submitCreate() {
  const created = await roleService.create(createForm.value);
  await loadRoles();
  return created;
}

function afterCreate() {
  showCreateDialog.value = false;
  notifySuccess("新增角色成功");
}

/* ---------------- 改名稱／描述 ---------------- */

const showEditDialog = ref(false);
const editingId = ref(null);
const editForm = ref({ name: "", description: "" });

function openEditDialog(role) {
  editingId.value = role.id;
  editForm.value = { name: role.name, description: role.description };
  showEditDialog.value = true;
}

async function submitEdit() {
  const updated = await roleService.update(editingId.value, editForm.value);
  await loadRoles();
  return updated;
}

function afterEdit() {
  showEditDialog.value = false;
  notifySuccess("更新角色成功");
}

/* ---------------- 配置權限（compare-and-set） ---------------- */

const showPermissionsDialog = ref(false);
const permissionsDialogRole = ref(null);
const selectedPermissionIds = ref([]);
const expectedPermissionIds = ref([]);
const permissionsReason = ref("");
const permissionsPassword = ref("");
const permissionsDialogError = ref("");

// §1.4 第二道嘅前端提示版，見 UsersPage.vue 同一段註解。
function isPermissionGrantable(permission) {
  return session.permissions.includes(permission.name);
}

const permissionOptions = computed(() =>
  permissions.value.map((permission) => ({
    label: isPermissionGrantable(permission)
      ? `${permission.name} — ${permission.description}`
      : `${permission.name} — ${permission.description}（你自己冇呢個權限）`,
    value: permission.id,
    disable: !isPermissionGrantable(permission)
  }))
);

function permissionIdsOf(role) {
  return permissions.value.filter((p) => role.permissions.includes(p.name)).map((p) => p.id);
}

function openPermissionsDialog(role) {
  permissionsDialogError.value = "";
  permissionsDialogRole.value = role;
  const currentIds = permissionIdsOf(role);
  selectedPermissionIds.value = currentIds;
  expectedPermissionIds.value = currentIds;
  permissionsReason.value = "";
  permissionsPassword.value = "";
  showPermissionsDialog.value = true;
}

async function submitPermissionsAssignment() {
  permissionsDialogError.value = "";
  try {
    const result = await roleService.assignPermissions(permissionsDialogRole.value.id, {
      permissionIds: selectedPermissionIds.value,
      expectedPermissionIds: expectedPermissionIds.value,
      reason: permissionsReason.value,
      password: permissionsPassword.value
    });
    return result;
  } catch (error) {
    if (error.code === "ASSIGNMENT_STALE") {
      // 同 UsersPage.vue 配置角色嗰段一樣嘅處理：重載呢個角色而家嘅權限，
      // 等使用者見到最新一組再決定要唔要重做（見 §4.3）。
      await loadRoles();
      const fresh = roles.value.find((role) => role.id === permissionsDialogRole.value.id);
      if (fresh) {
        permissionsDialogRole.value = fresh;
        expectedPermissionIds.value = permissionIdsOf(fresh);
      }
      permissionsDialogError.value = "有人喺你之前已經改過呢個角色嘅權限，畫面已經更新做最新一組，請重新選擇。";
    }
    throw error;
  }
}

async function afterPermissionsAssignment() {
  showPermissionsDialog.value = false;
  await loadRoles();
  notifySuccess("已儲存。管理權限即時生效；一般頁面的顯示最遲 15 分鐘內（下一次背景續期）跟上。");
}

/* ---------------- 刪除角色 ---------------- */

async function deleteRole(role) {
  const outcome = await promptPassword({
    title: "刪除角色",
    message:
      role.userCount > 0
        ? `刪除「${role.name}」？目前有 ${role.userCount} 個用戶持有這個角色，他們會失去這個角色帶來的權限。`
        : `刪除「${role.name}」？這個操作不可以復原。`,
    okLabel: "刪除",
    requireReason: true
  });

  if (outcome === null) {
    return;
  }

  try {
    await roleService.delete(role.id, outcome);
    notifySuccess("刪除角色成功");
    await loadRoles();
  } catch (error) {
    notifyError(error.message || "刪除失敗");
  }
}
</script>

<template>
  <div>
    <PageHeader>
      <template #actions>
        <q-btn color="primary" unelevated label="新增角色" icon="add" @click="openCreateDialog" />
      </template>
    </PageHeader>

    <q-table :rows="roles" :columns="columns" row-key="id" :loading="loading" :pagination="{ rowsPerPage: 0 }">
      <template #body-cell-permissions="{ row }">
        <q-td class="text-left">{{ summarisePermissions(row.permissions) }}</q-td>
      </template>

      <template #body-cell-actions="{ row }">
        <q-td class="text-right">
          <q-icon v-if="isProtected(row)" name="lock" size="sm" color="grey">
            <q-tooltip>由投產腳本維護</q-tooltip>
          </q-icon>
          <q-btn v-else flat round dense icon="more_vert" :aria-label="`「${row.name}」的操作`">
            <q-menu>
              <q-list>
                <q-item v-close-popup clickable @click="openEditDialog(row)">
                  <q-item-section>編輯</q-item-section>
                </q-item>
                <q-item v-close-popup clickable @click="openPermissionsDialog(row)">
                  <q-item-section>配置權限</q-item-section>
                </q-item>
                <q-item v-close-popup clickable @click="deleteRole(row)">
                  <q-item-section class="text-negative">刪除</q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </q-td>
      </template>

      <template #no-data>
        <div class="full-width text-center text-grey-7 q-pa-lg">冇資料</div>
      </template>
    </q-table>

    <!-- 新增角色 -->
    <q-dialog v-model="showCreateDialog" persistent>
      <q-card style="min-width: 380px">
        <q-card-section><div class="text-h6">新增角色</div></q-card-section>
        <q-card-section class="q-pt-none">
          <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submitCreate" @success="afterCreate">
            <div class="q-gutter-md">
              <q-input
                v-model="createForm.name"
                label="角色名"
                filled
                autofocus
                :error="!!fieldError('name')"
                :error-message="fieldError('name')"
              />
              <q-input
                v-model="createForm.description"
                label="描述"
                filled
                :error="!!fieldError('description')"
                :error-message="fieldError('description')"
              />
              <div class="row justify-end q-gutter-sm">
                <q-btn flat label="取消" :disable="submitting" @click="showCreateDialog = false" />
                <q-btn type="submit" color="primary" label="新增" unelevated :loading="submitting" />
              </div>
            </div>
          </FormPanel>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- 改名稱／描述 -->
    <q-dialog v-model="showEditDialog" persistent>
      <q-card style="min-width: 380px">
        <q-card-section><div class="text-h6">編輯角色</div></q-card-section>
        <q-card-section class="q-pt-none">
          <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submitEdit" @success="afterEdit">
            <div class="q-gutter-md">
              <q-input
                v-model="editForm.name"
                label="角色名"
                filled
                autofocus
                :error="!!fieldError('name')"
                :error-message="fieldError('name')"
              />
              <q-input
                v-model="editForm.description"
                label="描述"
                filled
                :error="!!fieldError('description')"
                :error-message="fieldError('description')"
              />
              <div class="row justify-end q-gutter-sm">
                <q-btn flat label="取消" :disable="submitting" @click="showEditDialog = false" />
                <q-btn type="submit" color="primary" label="儲存" unelevated :loading="submitting" />
              </div>
            </div>
          </FormPanel>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- 配置權限 -->
    <q-dialog v-model="showPermissionsDialog" persistent>
      <q-card style="min-width: 420px" v-if="permissionsDialogRole">
        <q-card-section>
          <div class="text-h6">配置權限：{{ permissionsDialogRole.name }}</div>
          <div class="text-caption text-grey-7">權限目錄由投產腳本維護，這裡只決定這個角色持有哪幾個。</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <FormPanel
            v-slot="{ fieldError, submitting }"
            :on-submit="submitPermissionsAssignment"
            @success="afterPermissionsAssignment"
          >
            <div class="q-gutter-md">
              <q-banner v-if="permissionsDialogError" class="bg-warning text-white">
                {{ permissionsDialogError }}
              </q-banner>
              <q-option-group v-model="selectedPermissionIds" type="checkbox" :options="permissionOptions" />
              <q-input
                v-model="permissionsReason"
                label="原因"
                filled
                :error="!!fieldError('reason')"
                :error-message="fieldError('reason')"
              />
              <q-input v-model="permissionsPassword" label="你的密碼" type="password" filled />

              <div class="row justify-end q-gutter-sm">
                <q-btn flat label="取消" :disable="submitting" @click="showPermissionsDialog = false" />
                <q-btn type="submit" color="primary" label="儲存" unelevated :loading="submitting" />
              </div>
            </div>
          </FormPanel>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>
