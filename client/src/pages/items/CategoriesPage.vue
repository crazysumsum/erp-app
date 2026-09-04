<script>
export const page = {
  name: "categories",
  path: "/items/categories",
  title: "商品分類",
  requires: { permissions: ["item.view"] },
  menu: { group: "items", icon: "category", order: 20 }
};
</script>

<script setup>
import { computed, onMounted, ref } from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import { promptPassword, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import itemCatalogService from "@/services/itemCatalog.js";
import { useSessionStore } from "@/stores/session.js";

const session = useSessionStore();
const canManage = computed(() => session.permissions.includes("item.mgmt"));

const STATUS_LABEL = { active: "啟用", inactive: "已停用", archived: "已封存" };
const STATUS_COLOUR = { active: "positive", inactive: "grey", archived: "warning" };

const tree = ref([]);
const loading = ref(false);
const includeArchived = ref(false);
const expanded = ref([]);

async function loadTree() {
  loading.value = true;
  try {
    tree.value = await itemCatalogService.categoryTree({ includeArchived: includeArchived.value });
    // 預設全展開：分類最多 8 層，量級不大，展開後一次看到完整結構比逐層點開快。
    expanded.value = flatten(tree.value).map((node) => node.id);
  } finally {
    loading.value = false;
  }
}

function flatten(nodes, depth = 0, acc = []) {
  for (const node of nodes) {
    acc.push({ ...node, depth });
    if (node.children?.length > 0) {
      flatten(node.children, depth + 1, acc);
    }
  }
  return acc;
}

/** 找一個節點自己及其全部子孫的 id，用嚟喺「移動父層」選單裡濾走不合法選項。 */
function idsOfSelfAndDescendants(node) {
  const ids = [node.id];
  for (const child of node.children ?? []) {
    ids.push(...idsOfSelfAndDescendants(child));
  }
  return ids;
}

onMounted(loadTree);

async function toggleIncludeArchived() {
  includeArchived.value = !includeArchived.value;
  await loadTree();
}

/* ---------------- 新增／編輯（含移動父層） ---------------- */

const showFormDialog = ref(false);
const formMode = ref("create"); // "create" | "edit"
const editingCategory = ref(null);
const form = ref({ name: "", parentId: null, sortOrder: 0 });
const formError = ref("");

/** 移動父層嘅可選清單：排除自己及自己嘅子孫；非 Active 唔可選但仍然顯示原因。 */
const parentOptions = computed(() => {
  const excluded = new Set(
    formMode.value === "edit" && editingCategory.value
      ? idsOfSelfAndDescendants(editingCategory.value)
      : []
  );
  const options = [{ label: "（無，根層級）", value: null }];

  for (const node of flatten(tree.value)) {
    if (excluded.has(node.id)) {
      continue;
    }
    const indent = "　".repeat(node.depth);
    const disable = node.status !== "active";
    options.push({
      label: disable
        ? `${indent}${node.name}（${STATUS_LABEL[node.status]}，不可指派）`
        : `${indent}${node.name}`,
      value: node.id,
      disable
    });
  }

  return options;
});

function openCreateDialog(parentNode = null) {
  formMode.value = "create";
  editingCategory.value = null;
  formError.value = "";
  form.value = { name: "", parentId: parentNode?.id ?? null, sortOrder: 0 };
  showFormDialog.value = true;
}

function openEditDialog(node) {
  formMode.value = "edit";
  editingCategory.value = node;
  formError.value = "";
  form.value = { name: node.name, parentId: node.parentId, sortOrder: node.sortOrder };
  showFormDialog.value = true;
}

async function submitForm() {
  formError.value = "";
  try {
    if (formMode.value === "create") {
      return await itemCatalogService.createCategory(form.value);
    }
    return await itemCatalogService.updateCategory(editingCategory.value.id, {
      ...form.value,
      version: editingCategory.value.version
    });
  } catch (error) {
    if (error.code === "VERSION_CONFLICT") {
      // 同 RolesPage 配置權限嗰段一樣嘅處理：重新載入樹，等使用者見到最新
      // 版本再決定要唔要重做，而唔係悄悄覆蓋另一個人剛剛存好嘅變更。
      await loadTree();
      formError.value = "有人在你之前已經改過這個分類，畫面已經更新為最新版本，請重新確認後再試。";
    }
    throw error;
  }
}

function afterFormSubmit() {
  showFormDialog.value = false;
  notifySuccess(formMode.value === "create" ? "已新增分類" : "已更新分類");
  loadTree();
}

/* ---------------- 狀態變更（啟用／停用：原因，唔使密碼） ---------------- */

async function activate(node) {
  const reason = await promptReason({
    title: "啟用分類",
    message: `啟用「${node.name}」？啟用後可指派給新的商品。`,
    okLabel: "啟用"
  });
  if (reason === null) {
    return;
  }
  try {
    await itemCatalogService.activateCategory(node.id, { reason, version: node.version });
    notifySuccess(`分類「${node.name}」已啟用`);
    await loadTree();
  } catch (error) {
    notifyError(error.message || "啟用失敗");
  }
}

async function deactivate(node) {
  const reason = await promptReason({
    title: "停用分類",
    message: `停用「${node.name}」？停用後不影響既有商品，但不可再指派給新商品。`,
    okLabel: "停用"
  });
  if (reason === null) {
    return;
  }
  try {
    await itemCatalogService.deactivateCategory(node.id, { reason, version: node.version });
    notifySuccess(`分類「${node.name}」已停用`);
    await loadTree();
  } catch (error) {
    notifyError(error.message || "停用失敗");
  }
}

/* ---------------- 高風險操作（封存／恢復／刪除：原因＋密碼） ---------------- */

async function archive(node) {
  const outcome = await promptPassword({
    title: "封存分類",
    message: `封存「${node.name}」？封存後預設不會出現在列表與選擇器中，但歷史資料仍可查閱。`,
    okLabel: "封存",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  try {
    await itemCatalogService.archiveCategory(node.id, { ...outcome, version: node.version });
    notifySuccess(`分類「${node.name}」已封存`);
    await loadTree();
  } catch (error) {
    notifyError(error.message || "封存失敗");
  }
}

async function restore(node) {
  const outcome = await promptPassword({
    title: "恢復分類",
    message: `從封存恢復「${node.name}」？恢復後狀態為「已停用」，需要另外啟用才能指派給新商品。`,
    okLabel: "恢復",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  try {
    await itemCatalogService.restoreCategory(node.id, { ...outcome, version: node.version });
    notifySuccess(`分類「${node.name}」已從封存恢復`);
    await loadTree();
  } catch (error) {
    notifyError(error.message || "恢復失敗");
  }
}

async function remove(node) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const outcome = await promptPassword({
    title: "刪除分類",
    message: hasChildren
      ? `「${node.name}」還有子分類，必須先刪除或移動子分類才能刪除它。`
      : `永久刪除「${node.name}」？這個操作不可以復原；如果這個分類已被商品使用，系統會拒絕刪除。`,
    okLabel: "刪除",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  try {
    await itemCatalogService.deleteCategory(node.id, { ...outcome, version: node.version });
    notifySuccess(`分類「${node.name}」已刪除`);
    await loadTree();
  } catch (error) {
    // CATEGORY_HAS_CHILDREN／CATALOG_IN_USE 都已經是繁體中文 publicMessage
    // （見 server/src/modules/item/itemErrors.js），直接顯示即可，不需要
    // 前端另外翻譯或猜測原因。
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
          label="新增分類"
          icon="add"
          @click="openCreateDialog(null)"
        />
      </template>
    </PageHeader>

    <div class="q-px-md q-pb-md">
      <q-card flat bordered>
        <q-card-section>
          <div v-if="loading" class="text-caption text-grey-7" aria-busy="true">載入中…</div>
          <div v-else-if="tree.length === 0" class="text-caption text-grey-7">目前沒有分類資料</div>

          <q-tree
            v-else
            v-model:expanded="expanded"
            :nodes="tree"
            node-key="id"
            label-key="name"
          >
            <template #default-header="prop">
              <div class="row items-center full-width q-gutter-sm">
                <span>{{ prop.node.name }}</span>
                <q-badge :color="STATUS_COLOUR[prop.node.status]">
                  {{ STATUS_LABEL[prop.node.status] }}
                </q-badge>
                <q-space />
                <q-btn
                  v-if="canManage"
                  flat
                  round
                  dense
                  icon="more_vert"
                  :aria-label="`「${prop.node.name}」的操作`"
                  @click.stop
                >
                  <q-menu>
                    <q-list>
                      <q-item
                        v-if="prop.node.status === 'active'"
                        v-close-popup
                        clickable
                        @click="openCreateDialog(prop.node)"
                      >
                        <q-item-section>新增子分類</q-item-section>
                      </q-item>
                      <q-item v-close-popup clickable @click="openEditDialog(prop.node)">
                        <q-item-section>編輯／移動</q-item-section>
                      </q-item>
                      <q-item
                        v-if="prop.node.status === 'inactive'"
                        v-close-popup
                        clickable
                        @click="activate(prop.node)"
                      >
                        <q-item-section>啟用</q-item-section>
                      </q-item>
                      <q-item
                        v-if="prop.node.status === 'active'"
                        v-close-popup
                        clickable
                        @click="deactivate(prop.node)"
                      >
                        <q-item-section>停用</q-item-section>
                      </q-item>
                      <q-item
                        v-if="prop.node.status !== 'archived'"
                        v-close-popup
                        clickable
                        @click="archive(prop.node)"
                      >
                        <q-item-section>封存</q-item-section>
                      </q-item>
                      <q-item
                        v-if="prop.node.status === 'archived'"
                        v-close-popup
                        clickable
                        @click="restore(prop.node)"
                      >
                        <q-item-section>從封存恢復</q-item-section>
                      </q-item>
                      <q-item v-close-popup clickable @click="remove(prop.node)">
                        <q-item-section class="text-negative">刪除</q-item-section>
                      </q-item>
                    </q-list>
                  </q-menu>
                </q-btn>
              </div>
            </template>
          </q-tree>
        </q-card-section>
      </q-card>
    </div>

    <!-- 新增／編輯（含移動父層） -->
    <q-dialog v-model="showFormDialog" persistent>
      <q-card style="min-width: 420px">
        <q-card-section>
          <h2 class="text-h6 q-ma-none">{{ formMode === "create" ? "新增分類" : "編輯分類" }}</h2>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <FormPanel v-slot="{ fieldError, submitting }" :on-submit="submitForm" @success="afterFormSubmit">
            <div class="q-gutter-md">
              <q-banner v-if="formError" class="bg-warning text-dark">{{ formError }}</q-banner>
              <q-input
                v-model="form.name"
                label="分類名稱"
                filled
                autofocus
                :error="!!fieldError('name')"
                :error-message="fieldError('name')"
              />
              <q-select
                v-model="form.parentId"
                label="上層分類"
                filled
                emit-value
                map-options
                :options="parentOptions"
                :error="!!fieldError('parentId')"
                :error-message="fieldError('parentId')"
              />
              <q-input
                v-model.number="form.sortOrder"
                type="number"
                label="排序值"
                filled
                :error="!!fieldError('sortOrder')"
                :error-message="fieldError('sortOrder')"
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
