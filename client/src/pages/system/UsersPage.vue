<script>
export const page = {
  name: "users",
  path: "/system/users",
  title: "用戶管理",
  requires: { permissions: ["user.mgmt"] },
  menu: { group: "userManagement", icon: "people", order: 20 }
};
</script>

<script setup>
import { computed, onMounted, ref } from "vue";
import DataTable from "@/framework/ui/DataTable.vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import { useCrud } from "@/framework/ui/useCrud.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import userService from "@/services/user.js";
import roleService from "@/services/role.js";
import { useSessionStore } from "@/stores/session.js";

const session = useSessionStore();
const crud = useCrud(userService, { resourceLabel: "用戶" });

const columns = [
  { name: "username", label: "帳號", field: "username", align: "left", sortable: true },
  { name: "displayName", label: "顯示名稱", field: "displayName", align: "left", sortable: true },
  { name: "status", label: "狀態", field: "status", align: "left", sortable: true },
  { name: "createdAt", label: "建立時間", field: "createdAt", align: "left", sortable: true },
  { name: "actions", label: "", field: "id", align: "right" }
];

const STATUS = {
  active: { label: "啟用", colour: "positive" },
  disabled: { label: "已停用", colour: "grey" }
};

const STATUS_FILTER_OPTIONS = [
  { label: "全部", value: null },
  { label: "啟用", value: "active" },
  { label: "已停用", value: "disabled" }
];

const searchText = ref("");
const statusFilter = ref(null);
const busyId = ref(null);

function fetchUsers({ page, rowsPerPage, sortBy, descending, filter }) {
  return userService.list({ page, rowsPerPage, sortBy, descending, filter, status: statusFilter.value });
}

function formatTime(epochMs) {
  return new Date(epochMs).toLocaleString();
}

// 角色目錄：新增用戶嘅角色多選、配置角色對話框嘅勾選清單都用同一份。喺頁面
// 開嗰陣攞一次就夠——用戶管理頁本身唔會改動角色本身，唔使即時追蹤。
const roles = ref([]);
onMounted(async () => {
  roles.value = await roleService.list();
});

// §1.4 第二道嘅前端提示版：操作者授唔出自己都冇嘅權限。呢度淨係為咗喺畫面
// 上早講一句，唔係防線——後端 PERMISSION_ESCALATION_DENIED 先係真正擋住嗰道。
function isRoleAssignable(role) {
  return role.permissions.every((permission) => session.permissions.includes(permission));
}

const roleOptions = computed(() =>
  roles.value.map((role) => ({
    label: isRoleAssignable(role) ? role.name : `${role.name}（你自己冇呢個權限）`,
    value: role.id,
    disable: !isRoleAssignable(role)
  }))
);

/* ---------------- 新增用戶 ---------------- */

const showCreateDialog = ref(false);
const createForm = ref(newCreateForm());
const showCredentialDialog = ref(false);
const createdCredential = ref(null);

function newCreateForm() {
  return { username: "", displayName: "", newUserPassword: "", confirmPassword: "", roleIds: [], password: "" };
}

function openCreateDialog() {
  createForm.value = newCreateForm();
  showCreateDialog.value = true;
}

async function submitCreate() {
  const form = createForm.value;
  const created = await crud.create({
    username: form.username,
    displayName: form.displayName,
    newUserPassword: form.newUserPassword,
    roleIds: form.roleIds,
    password: form.password
  });

  createdCredential.value = { username: form.username, password: form.newUserPassword };
  return created;
}

function afterCreate() {
  showCreateDialog.value = false;
  showCredentialDialog.value = true;
}

async function copyCredential() {
  const text = `帳號：${createdCredential.value.username}\n初始密碼：${createdCredential.value.password}`;
  try {
    await navigator.clipboard.writeText(text);
    notifySuccess("已複製到剪貼簿");
  } catch {
    // 冇 clipboard API（例如唔係 https）就靜靜哋唔做——文字本身已經喺畫面
    // 度，人手選取複製一樣得。
  }
}

/* ---------------- 編輯（改顯示名稱） ---------------- */

const showEditDialog = ref(false);
const editingId = ref(null);
const editForm = ref({ displayName: "" });

function openEditDialog(row) {
  editingId.value = row.id;
  editForm.value = { displayName: row.displayName };
  showEditDialog.value = true;
}

function submitEdit() {
  return crud.update(editingId.value, { displayName: editForm.value.displayName });
}

function afterEdit() {
  showEditDialog.value = false;
}

/* ---------------- 配置角色（compare-and-set） ---------------- */

const showRolesDialog = ref(false);
const rolesDialogUser = ref(null);
const selectedRoleIds = ref([]);
const expectedRoleIds = ref([]);
const rolesReason = ref("");
const rolesPassword = ref("");
const rolesDialogError = ref("");

async function openRolesDialog(row) {
  rolesDialogError.value = "";
  const detail = await userService.get(row.id);
  rolesDialogUser.value = detail;
  const currentIds = detail.roles.map((role) => role.id);
  selectedRoleIds.value = currentIds;
  expectedRoleIds.value = currentIds;
  rolesReason.value = "";
  rolesPassword.value = "";
  showRolesDialog.value = true;
}

async function submitRolesAssignment() {
  rolesDialogError.value = "";
  try {
    const result = await userService.assignRoles(rolesDialogUser.value.id, {
      roleIds: selectedRoleIds.value,
      expectedRoleIds: expectedRoleIds.value,
      reason: rolesReason.value,
      password: rolesPassword.value
    });
    return result;
  } catch (error) {
    if (error.code === "ASSIGNMENT_STALE") {
      // 有人喺你之前改過。重載返呢個用戶而家嘅角色，等使用者見到最新一組
      // 再決定要唔要重做——唔淨係彈一個錯誤就算（見 §4.3）。
      const fresh = await userService.get(rolesDialogUser.value.id);
      rolesDialogUser.value = fresh;
      const freshIds = fresh.roles.map((role) => role.id);
      expectedRoleIds.value = freshIds;
      rolesDialogError.value = "有人喺你之前已經改過呢個用戶嘅角色，畫面已經更新做最新一組，請重新選擇。";
    }
    throw error;
  }
}

function afterRolesAssignment() {
  showRolesDialog.value = false;
  notifySuccess("已儲存。管理權限即時生效；一般頁面的顯示最遲 15 分鐘內（下一次背景續期）跟上。");
}

/* ---------------- 重設密碼 ---------------- */

const showResetPasswordDialog = ref(false);
const resetPasswordUser = ref(null);
const resetForm = ref({ newUserPassword: "", confirmPassword: "", reason: "", password: "" });

function openResetPasswordDialog(row) {
  resetPasswordUser.value = row;
  resetForm.value = { newUserPassword: "", confirmPassword: "", reason: "", password: "" };
  showResetPasswordDialog.value = true;
}

function submitResetPassword() {
  const form = resetForm.value;
  return userService.resetPassword(resetPasswordUser.value.id, {
    newUserPassword: form.newUserPassword,
    reason: form.reason,
    password: form.password
  });
}

function afterResetPassword() {
  showResetPasswordDialog.value = false;
  notifySuccess("密碼已重設");
}

/* ---------------- 停用／啟用 ---------------- */

async function toggleStatus(row) {
  const isDisabling = row.status === "active";
  const isSelf = row.id === session.user?.id;

  const outcome = await promptPassword({
    title: isDisabling ? "停用用戶" : "啟用用戶",
    message: isSelf
      ? "這會立即把你自己登出。請輸入原因與你的密碼確認。"
      : `確定要${isDisabling ? "停用" : "啟用"}「${row.username}」？請輸入原因與你的密碼確認。`,
    okLabel: isDisabling ? "停用" : "啟用",
    requireReason: true
  });

  if (outcome === null) {
    return;
  }

  busyId.value = row.id;
  try {
    if (isDisabling) {
      await userService.disable(row.id, outcome);
    } else {
      await userService.enable(row.id, outcome);
    }
    notifySuccess(isDisabling ? "已停用" : "已啟用");
  } catch (error) {
    if (error.code === "LAST_ADMIN_PROTECTED") {
      notifyError("系統至少要保留一個啟用中的 system-admin");
    } else {
      notifyError(error.message || "操作失敗");
    }
  } finally {
    busyId.value = null;
    await crud.dataTableRef.value?.reload();
  }
}
</script>

<template>
  <div>
    <PageHeader>
      <template #actions>
        <q-btn color="primary" unelevated label="新增用戶" icon="add" @click="openCreateDialog" />
      </template>
    </PageHeader>

    <div class="row items-center q-gutter-md q-px-md q-pb-md">
      <q-input
        v-model="searchText"
        dense
        outlined
        clearable
        debounce="300"
        placeholder="搜尋帳號或顯示名稱"
        style="width: 260px"
      >
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
        @update:model-value="crud.dataTableRef.value?.reload()"
      />
    </div>

    <div class="q-px-md q-pb-md">
    <DataTable
      :ref="(el) => (crud.dataTableRef.value = el)"
      :fetch="fetchUsers"
      :columns="columns"
      :filter="searchText"
      row-key="id"
    >
      <template #body-cell-status="{ value }">
        <q-td class="text-left">
          <q-badge :color="STATUS[value]?.colour ?? 'grey'" :label="STATUS[value]?.label ?? value" />
        </q-td>
      </template>

      <template #body-cell-createdAt="{ value }">
        <q-td class="text-left">{{ formatTime(value) }}</q-td>
      </template>

      <template #body-cell-actions="{ row }">
        <q-td class="text-right">
          <q-btn
            flat
            round
            dense
            icon="more_vert"
            :loading="busyId === row.id"
            :aria-label="`「${row.username}」的操作`"
          >
            <q-menu>
              <q-list>
                <q-item v-close-popup clickable @click="openEditDialog(row)">
                  <q-item-section>編輯</q-item-section>
                </q-item>
                <q-item v-close-popup clickable @click="openRolesDialog(row)">
                  <q-item-section>配置角色</q-item-section>
                </q-item>
                <q-item v-close-popup clickable @click="openResetPasswordDialog(row)">
                  <q-item-section>重設密碼</q-item-section>
                </q-item>
                <q-item
                  v-close-popup
                  clickable
                  @click="toggleStatus(row)"
                >
                  <q-item-section :class="row.id === session.user?.id && row.status === 'active' ? 'text-negative' : ''">
                    {{ row.status === "active" ? "停用" : "啟用" }}
                  </q-item-section>
                </q-item>
              </q-list>
            </q-menu>
          </q-btn>
        </q-td>
      </template>
    </DataTable>
    </div>

    <!-- 新增用戶 -->
    <q-dialog v-model="showCreateDialog" persistent>
      <q-card style="min-width: 420px">
        <q-card-section><div class="text-h6">新增用戶</div></q-card-section>
        <q-card-section class="q-pt-none">
          <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submitCreate" @success="afterCreate">
            <div class="q-gutter-md">
              <q-input
                v-model="createForm.username"
                label="帳號"
                filled
                :error="!!fieldError('username')"
                :error-message="fieldError('username')"
              />
              <q-input v-model="createForm.displayName" label="顯示名稱" filled />
              <q-input
                v-model="createForm.newUserPassword"
                label="初始密碼"
                type="password"
                filled
                hint="最短 12 字元，並同時包含大寫與小寫英文字母"
                :error="!!fieldError('newUserPassword')"
                :error-message="fieldError('newUserPassword')"
              />
              <q-input
                v-model="createForm.confirmPassword"
                label="確認初始密碼"
                type="password"
                filled
                :rules="[(val) => val === createForm.newUserPassword || '同「初始密碼」不一致']"
              />
              <q-option-group v-model="createForm.roleIds" type="checkbox" :options="roleOptions" />
              <q-separator />
              <q-input
                v-model="createForm.password"
                label="你的密碼"
                type="password"
                filled
                hint="用嚟確認係你本人操作"
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

    <!-- 新增成功之後：可複製嘅初始密碼提示 -->
    <q-dialog v-model="showCredentialDialog">
      <q-card v-if="createdCredential" style="min-width: 360px">
        <q-card-section>
          <div class="text-h6">用戶已建立</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          帳號 <strong>{{ createdCredential.username }}</strong> 已建立，初始密碼為
          <strong>{{ createdCredential.password }}</strong>，對方首次登入時必須修改。
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="複製" @click="copyCredential" />
          <q-btn unelevated color="primary" label="知道了" @click="showCredentialDialog = false" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- 編輯（改顯示名稱） -->
    <q-dialog v-model="showEditDialog" persistent>
      <q-card style="min-width: 360px">
        <q-card-section><div class="text-h6">編輯用戶</div></q-card-section>
        <q-card-section class="q-pt-none">
          <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submitEdit" @success="afterEdit">
            <div class="q-gutter-md">
              <q-input v-model="editForm.displayName" label="顯示名稱" filled autofocus
                :error="!!fieldError('displayName')" :error-message="fieldError('displayName')" />
              <div class="row justify-end q-gutter-sm">
                <q-btn flat label="取消" :disable="submitting" @click="showEditDialog = false" />
                <q-btn type="submit" color="primary" label="儲存" unelevated :loading="submitting" />
              </div>
            </div>
          </FormPanel>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- 配置角色 -->
    <q-dialog v-model="showRolesDialog" persistent>
      <q-card style="min-width: 420px" v-if="rolesDialogUser">
        <q-card-section>
          <div class="text-h6">配置角色：{{ rolesDialogUser.username }}</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <FormPanel
            v-slot="{ fieldError, submitting }"
            :on-submit="submitRolesAssignment"
            @success="afterRolesAssignment"
          >
            <div class="q-gutter-md">
              <q-banner v-if="rolesDialogError" class="bg-warning text-white">{{ rolesDialogError }}</q-banner>
              <q-option-group v-model="selectedRoleIds" type="checkbox" :options="roleOptions" />
              <q-input
                v-model="rolesReason"
                label="原因"
                filled
                :error="!!fieldError('reason')"
                :error-message="fieldError('reason')"
              />
              <q-input v-model="rolesPassword" label="你的密碼" type="password" filled />

              <div class="row justify-end q-gutter-sm">
                <q-btn flat label="取消" :disable="submitting" @click="showRolesDialog = false" />
                <q-btn type="submit" color="primary" label="儲存" unelevated :loading="submitting" />
              </div>
            </div>
          </FormPanel>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- 重設密碼 -->
    <q-dialog v-model="showResetPasswordDialog" persistent>
      <q-card style="min-width: 380px" v-if="resetPasswordUser">
        <q-card-section>
          <div class="text-h6">重設密碼：{{ resetPasswordUser.username }}</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submitResetPassword" @success="afterResetPassword">
            <div class="q-gutter-md">
              <q-input
                v-model="resetForm.newUserPassword"
                label="新密碼"
                type="password"
                filled
                hint="最短 12 字元，並同時包含大寫與小寫英文字母"
                :error="!!fieldError('newUserPassword')"
                :error-message="fieldError('newUserPassword')"
              />
              <q-input
                v-model="resetForm.confirmPassword"
                label="確認新密碼"
                type="password"
                filled
                :rules="[(val) => val === resetForm.newUserPassword || '同「新密碼」不一致']"
              />
              <q-input
                v-model="resetForm.reason"
                label="原因"
                filled
                :error="!!fieldError('reason')"
                :error-message="fieldError('reason')"
              />
              <q-input v-model="resetForm.password" label="你的密碼" type="password" filled />

              <div class="row justify-end q-gutter-sm">
                <q-btn flat label="取消" :disable="submitting" @click="showResetPasswordDialog = false" />
                <q-btn type="submit" color="primary" label="重設" unelevated :loading="submitting" />
              </div>
            </div>
          </FormPanel>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>
