<script>
export const page = {
  name: "itemDetail",
  path: "/items/:id",
  title: "商品詳情",
  requires: { permissions: ["item.view", "item.mgmt"], match: "any" }
};
</script>

<script setup>
import { computed, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { can } from "@/framework/authorization/can.js";
import { promptPassword, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { mapValidationDetailsToFieldErrors } from "@/framework/ui/validationIssues.js";
import ItemBasicForm from "@/components/items/ItemBasicForm.vue";
import AttributeValueList from "@/components/items/AttributeValueList.vue";
import ItemMediaPanel from "@/components/items/ItemMediaPanel.vue";
import itemService from "@/services/item.js";
import { useSessionStore } from "@/stores/session.js";

const STATUS_LABEL = {
  draft: "草稿",
  active: "啟用",
  inactive: "已停用",
  discontinued: "已停產",
  archived: "已封存"
};
const STATUS_COLOUR = {
  draft: "grey",
  active: "positive",
  inactive: "grey-7",
  discontinued: "warning",
  archived: "warning"
};

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const canManage = computed(() => can(session, { permissions: ["item.mgmt"] }));

const itemId = computed(() => Number(route.params.id));

const loading = ref(true);
const loadError = ref("");
const item = ref(null);
const editing = ref(false);
const submitting = ref(false);
const fieldErrors = ref({});
const errorMessage = ref("");
const staleNotice = ref(false);

// `let` 唔係 `const`：ItemBasicForm.vue 用 defineModel() 綁 v-model 落成個
// `form` 物件本身（唔係佢底下某個屬性），Vue 編譯器為咗支援 defineModel()
// 理論上可以整個重新賦值嘅語意，要求呢個 binding 本身可以重新賦值——雖然
// loadFormFrom() 淨係改緊屬性，從來冇整個重新賦值過。
// eslint-disable-next-line prefer-const
let form = reactive({
  name: "",
  shortName: "",
  description: "",
  categoryId: null,
  brandId: null,
  countryOfOrigin: "",
  manufacturer: "",
  defaultTrackingPolicy: "none",
  defaultShelfLifeDays: null
});

function fieldError(path) {
  return fieldErrors.value[path] ?? "";
}

function loadFormFrom(data) {
  form.name = data.name;
  form.shortName = data.shortName;
  form.description = data.description ?? "";
  form.categoryId = data.categoryId;
  form.brandId = data.brandId;
  form.countryOfOrigin = data.countryOfOrigin ?? "";
  form.manufacturer = data.manufacturer;
  form.defaultTrackingPolicy = data.defaultTrackingPolicy;
  form.defaultShelfLifeDays = data.defaultShelfLifeDays;
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    item.value = await itemService.getItem(itemId.value);
    loadFormFrom(item.value);
  } catch (error) {
    loadError.value = error.message || "載入商品詳情失敗";
  } finally {
    loading.value = false;
  }
}
load();

function startEdit() {
  loadFormFrom(item.value);
  fieldErrors.value = {};
  errorMessage.value = "";
  staleNotice.value = false;
  editing.value = true;
}

function cancelEdit() {
  loadFormFrom(item.value);
  fieldErrors.value = {};
  errorMessage.value = "";
  staleNotice.value = false;
  editing.value = false;
}

/** `form` 嘅選填欄位喺冇資料嗰陣係 `""`／`null`（`loadFormFrom()` 由後端
 * response 帶落嚟嘅 `null` 直接抄過嚟）；但 update request schema 嘅呢啲
 * 欄位（`countryOfOrigin`、`defaultShelfLifeDays`）唔接受 `null` 或者空
 * 字串——有畀就要係啱嘅形狀，冇就要整個屬性都唔存在。 */
function buildPayload() {
  return {
    name: form.name,
    shortName: form.shortName,
    description: form.description || null,
    categoryId: form.categoryId ?? undefined,
    brandId: form.brandId ?? undefined,
    countryOfOrigin: form.countryOfOrigin || undefined,
    manufacturer: form.manufacturer,
    defaultTrackingPolicy: form.defaultTrackingPolicy,
    defaultShelfLifeDays: form.defaultShelfLifeDays ?? undefined,
    version: item.value.version
  };
}

async function save() {
  if (submitting.value) {
    return;
  }
  submitting.value = true;
  fieldErrors.value = {};
  errorMessage.value = "";

  try {
    const updated = await itemService.updateItem(itemId.value, buildPayload());
    item.value = updated;
    editing.value = false;
    staleNotice.value = false;
    notifySuccess(`商品「${updated.name}」已更新`);
  } catch (error) {
    if (error.code === "VERSION_CONFLICT") {
      // 唔自動覆蓋、唔自動重送：攞返最新資料嚟顯示畀用戶比較，使用者自己
      // 嗰份輸入留喺 form 度冇動過，撳「重新載入最新資料」先會覆蓋。
      staleNotice.value = true;
      try {
        item.value = await itemService.getItem(itemId.value);
      } catch {
        // 重新載入本身失敗都唔緊要，stale notice 已經話咗用戶而家個版本舊。
      }
      errorMessage.value = "呢個商品喺你編輯期間已經被人改過，你嘅輸入仍然保留喺畫面上。";
    } else {
      fieldErrors.value = mapValidationDetailsToFieldErrors(error.details);
      if (Object.keys(fieldErrors.value).length === 0) {
        errorMessage.value = error.message || "更新失敗";
      }
    }
    notifyError(error.message || "更新失敗");
  } finally {
    submitting.value = false;
  }
}

function reloadLatest() {
  loadFormFrom(item.value);
  staleNotice.value = false;
  errorMessage.value = "";
}

function goToSku(skuId) {
  router.push(`/items/${itemId.value}/skus/${skuId}`);
}

function createSku() {
  router.push(`/items/${itemId.value}/skus/new`);
}

// --- 生命週期（T18 後端；design_spec §4.2、§6.2、§7.7） ---------------------
//
// UI 只顯示目前狀態合法的動作，後端仍然重驗——row/button 呢層嘅判斷純粹係
// 可用性，唔係防線。危險操作文案列明受影響 SKU 數（design_spec §7.7）：呢啲
// 數字由已經載入嘅 `item.skus` 本身算，唔使額外打 API。

const showActivate = computed(() => item.value && ["draft", "inactive"].includes(item.value.status));
const showDeactivate = computed(() => item.value?.status === "active");
const showDiscontinue = computed(() => item.value && ["active", "inactive"].includes(item.value.status));
const showArchive = computed(() => item.value && ["draft", "inactive", "discontinued"].includes(item.value.status));
const showRestore = computed(() => item.value?.status === "archived");

const activatableSkus = computed(
  () => item.value?.skus.filter((sku) => sku.status === "draft" || sku.status === "inactive") ?? []
);
const activeSkuCount = computed(() => item.value?.skus.filter((sku) => sku.status === "active").length ?? 0);
const discontinueAffectedCount = computed(
  () => item.value?.skus.filter((sku) => sku.status === "active" || sku.status === "inactive").length ?? 0
);
const archiveAffectedCount = computed(() => item.value?.skus.filter((sku) => sku.status !== "archived").length ?? 0);

async function runItemLifecycleAction(action, successVerb) {
  try {
    const updated = await action();
    item.value = updated;
    notifySuccess(`商品「${updated.name}」${successVerb}`);
  } catch (error) {
    if (error.code === "VERSION_CONFLICT") {
      await load();
    }
    notifyError(error.message || "操作失敗");
  }
}

async function deactivateItemFlow() {
  const reason = await promptReason({
    title: "停用商品",
    message: `停用「${item.value.name}」？目前有 ${activeSkuCount.value} 個啟用中的 SKU 會一併轉為已停用。`,
    okLabel: "停用"
  });
  if (reason === null) {
    return;
  }
  await runItemLifecycleAction(
    () => itemService.deactivateItem(itemId.value, { reason, version: item.value.version }),
    "已停用"
  );
}

async function discontinueItemFlow() {
  const outcome = await promptPassword({
    title: "停產商品",
    message: `停產「${item.value.name}」？目前有 ${discontinueAffectedCount.value} 個 SKU 會一併轉為已停產並強制停止採購，這個操作不可以復原。`,
    okLabel: "停產",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  await runItemLifecycleAction(
    () => itemService.discontinueItem(itemId.value, { ...outcome, version: item.value.version }),
    "已停產"
  );
}

async function archiveItemFlow() {
  const outcome = await promptPassword({
    title: "封存商品",
    message: `封存「${item.value.name}」？目前有 ${archiveAffectedCount.value} 個 SKU 會一併轉為已封存，這個操作不可以復原。`,
    okLabel: "封存",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  await runItemLifecycleAction(
    () => itemService.archiveItem(itemId.value, { ...outcome, version: item.value.version }),
    "已封存"
  );
}

async function restoreItemFlow() {
  const outcome = await promptPassword({
    title: "恢復商品",
    message: `從封存恢復「${item.value.name}」？恢復後狀態為「已停用」，SKU 仍然維持已封存，需要逐一恢復。`,
    okLabel: "恢復",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  await runItemLifecycleAction(
    () => itemService.restoreItem(itemId.value, { ...outcome, version: item.value.version }),
    "已從封存恢復"
  );
}

// --- 啟用商品：要揀同時啟用邊幾個 SKU（skuIds），所以獨立一個 dialog ------

const showActivateDialog = ref(false);
const activateSelection = ref([]);
const activateReason = ref("");
const activateSubmitting = ref(false);
const activateError = ref("");

const activateValid = computed(() => {
  const trimmed = activateReason.value.trim();
  return activateSelection.value.length > 0 && trimmed.length >= 5 && trimmed.length <= 190;
});

function openActivateDialog() {
  activateSelection.value = activatableSkus.value.map((sku) => sku.id);
  activateReason.value = "";
  activateError.value = "";
  showActivateDialog.value = true;
}

async function submitActivate() {
  if (!activateValid.value || activateSubmitting.value) {
    return;
  }
  activateSubmitting.value = true;
  activateError.value = "";
  try {
    const updated = await itemService.activateItem(itemId.value, {
      skuIds: activateSelection.value,
      reason: activateReason.value.trim(),
      version: item.value.version
    });
    item.value = updated;
    showActivateDialog.value = false;
    notifySuccess(`商品「${updated.name}」已啟用`);
  } catch (error) {
    if (error.code === "VERSION_CONFLICT") {
      await load();
      activateError.value = "呢個商品喺你操作期間已經被人改過，請重新確認最新狀態後再試。";
    } else {
      activateError.value = error.message || "啟用失敗";
    }
    notifyError(error.message || "啟用失敗");
  } finally {
    activateSubmitting.value = false;
  }
}

// --- 個別 SKU 嘅生命週期動作（喺 Item 詳情頁嘅 SKU 列表直接操作） ----------

async function runSkuLifecycleAction(sku, action, successVerb) {
  try {
    const updated = await action();
    notifySuccess(`SKU「${updated.skuCode}」${successVerb}`);
    await load();
  } catch (error) {
    notifyError(error.message || "操作失敗");
  }
}

async function activateSkuRow(sku) {
  const reason = await promptReason({ title: "啟用 SKU", message: `啟用「${sku.skuCode}」？`, okLabel: "啟用" });
  if (reason === null) {
    return;
  }
  await runSkuLifecycleAction(sku, () => itemService.activateSku(sku.id, { reason, version: sku.version }), "已啟用");
}

async function deactivateSkuRow(sku) {
  const reason = await promptReason({ title: "停用 SKU", message: `停用「${sku.skuCode}」？`, okLabel: "停用" });
  if (reason === null) {
    return;
  }
  await runSkuLifecycleAction(sku, () => itemService.deactivateSku(sku.id, { reason, version: sku.version }), "已停用");
}

async function discontinueSkuRow(sku) {
  const outcome = await promptPassword({
    title: "停產 SKU",
    message: `停產「${sku.skuCode}」？強制停止採購，這個操作不可以復原。`,
    okLabel: "停產",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  await runSkuLifecycleAction(sku, () => itemService.discontinueSku(sku.id, { ...outcome, version: sku.version }), "已停產");
}

async function archiveSkuRow(sku) {
  const outcome = await promptPassword({
    title: "封存 SKU",
    message: `封存「${sku.skuCode}」？這個操作不可以復原。`,
    okLabel: "封存",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  await runSkuLifecycleAction(sku, () => itemService.archiveSku(sku.id, { ...outcome, version: sku.version }), "已封存");
}

async function restoreSkuRow(sku) {
  const outcome = await promptPassword({
    title: "恢復 SKU",
    message: `從封存恢復「${sku.skuCode}」？`,
    okLabel: "恢復",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  await runSkuLifecycleAction(sku, () => itemService.restoreSku(sku.id, { ...outcome, version: sku.version }), "已從封存恢復");
}

// --- 永久刪除、複製（T20；design_spec §6.2） --------------------------------

const showDelete = computed(() => item.value?.status === "draft");

async function deleteItemFlow() {
  const outcome = await promptPassword({
    title: "刪除商品",
    message: `永久刪除「${item.value.name}」？連同其 ${item.value.skus.length} 個 SKU 一併刪除，這個操作不可以復原。`,
    okLabel: "刪除",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  try {
    await itemService.deleteItem(itemId.value, { ...outcome, version: item.value.version });
    notifySuccess(`商品「${item.value.name}」已刪除`);
    router.push("/items");
  } catch (error) {
    notifyError(error.message || "刪除失敗");
  }
}

const showCopyDialog = ref(false);
const copySkuCodes = ref([]);
const copySubmitting = ref(false);
const copyError = ref("");

const copyValid = computed(() => copySkuCodes.value.every((code) => code.trim().length > 0));

function openCopyDialog() {
  copySkuCodes.value = item.value.skus.map(() => "");
  copyError.value = "";
  showCopyDialog.value = true;
}

async function submitCopy() {
  if (!copyValid.value || copySubmitting.value) {
    return;
  }
  copySubmitting.value = true;
  copyError.value = "";
  try {
    const copy = await itemService.copyItem(itemId.value, {
      skus: item.value.skus.map((sku, index) => ({ sourceSkuId: sku.id, skuCode: copySkuCodes.value[index].trim() }))
    });
    showCopyDialog.value = false;
    notifySuccess(`已複製做新商品「${copy.name}」（草稿）`);
    router.push(`/items/${copy.id}`);
  } catch (error) {
    copyError.value = error.message || "複製失敗";
    notifyError(error.message || "複製失敗");
  } finally {
    copySubmitting.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader :title="item ? item.name : undefined" />

    <div class="q-pa-md" style="max-width: 900px">
      <div v-if="loading">載入中…</div>
      <q-banner v-else-if="loadError" class="bg-negative text-white">{{ loadError }}</q-banner>

      <template v-else>
        <div class="row items-center q-gutter-sm q-mb-md">
          <q-badge :color="STATUS_COLOUR[item.status]" :label="STATUS_LABEL[item.status] ?? item.status" />
          <span class="text-caption text-grey-7">版本 {{ item.version }}</span>
          <q-space />
          <template v-if="canManage && !editing">
            <q-btn v-if="showActivate" flat color="positive" label="啟用" @click="openActivateDialog" />
            <q-btn v-if="showDeactivate" flat label="停用" @click="deactivateItemFlow" />
            <q-btn v-if="showDiscontinue" flat color="warning" label="停產" @click="discontinueItemFlow" />
            <q-btn v-if="showArchive" flat color="warning" label="封存" @click="archiveItemFlow" />
            <q-btn v-if="showRestore" flat color="primary" label="從封存恢復" @click="restoreItemFlow" />
            <q-btn flat color="primary" label="複製" @click="openCopyDialog" />
            <q-btn v-if="item.productType === 'variant'" flat color="primary" label="新增 SKU" @click="createSku" />
            <q-btn v-if="showDelete" flat color="negative" label="刪除" @click="deleteItemFlow" />
            <q-btn flat color="primary" label="編輯" @click="startEdit" />
          </template>
        </div>

        <div v-if="errorMessage || Object.keys(fieldErrors).length > 0" role="alert" class="q-mb-md">
          <q-banner class="bg-negative text-white">
            <div>{{ errorMessage || "請檢查以下標示錯誤的欄位。" }}</div>
            <template v-if="staleNotice">
              <q-btn flat color="white" label="重新載入最新資料（會捨棄你嘅輸入）" class="q-mt-sm" @click="reloadLatest" />
            </template>
          </q-banner>
        </div>

        <ItemBasicForm v-model="form" :field-error="fieldError" :readonly="!editing" />

        <AttributeValueList title="商品屬性" :values="item.attributeValues" />

        <div v-if="editing" class="row q-gutter-sm q-mt-md">
          <q-btn color="primary" label="儲存" :loading="submitting" @click="save" />
          <q-btn flat label="取消" :disable="submitting" @click="cancelEdit" />
        </div>

        <q-separator class="q-my-lg" />

        <div class="text-h6 q-mb-md">SKU</div>
        <q-list bordered separator>
          <q-item v-for="sku in item.skus" :key="sku.id" clickable @click="goToSku(sku.id)">
            <q-item-section>
              <q-item-label>{{ sku.skuCode }}</q-item-label>
              <q-item-label caption>{{ sku.skuName }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-badge :color="STATUS_COLOUR[sku.status]" :label="STATUS_LABEL[sku.status] ?? sku.status" />
            </q-item-section>
            <q-item-section v-if="canManage" side>
              <q-btn flat round dense icon="more_vert" :aria-label="`「${sku.skuCode}」的操作`" @click.stop>
                <q-menu>
                  <q-list>
                    <q-item
                      v-if="item.status === 'active' && (sku.status === 'draft' || sku.status === 'inactive')"
                      v-close-popup
                      clickable
                      @click="activateSkuRow(sku)"
                    >
                      <q-item-section>啟用</q-item-section>
                    </q-item>
                    <q-item v-if="sku.status === 'active'" v-close-popup clickable @click="deactivateSkuRow(sku)">
                      <q-item-section>停用</q-item-section>
                    </q-item>
                    <q-item
                      v-if="sku.status === 'active' || sku.status === 'inactive'"
                      v-close-popup
                      clickable
                      @click="discontinueSkuRow(sku)"
                    >
                      <q-item-section>停產</q-item-section>
                    </q-item>
                    <q-item
                      v-if="['draft', 'inactive', 'discontinued'].includes(sku.status)"
                      v-close-popup
                      clickable
                      @click="archiveSkuRow(sku)"
                    >
                      <q-item-section>封存</q-item-section>
                    </q-item>
                    <q-item v-if="sku.status === 'archived'" v-close-popup clickable @click="restoreSkuRow(sku)">
                      <q-item-section>從封存恢復</q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-btn>
            </q-item-section>
          </q-item>
          <q-item v-if="item.skus.length === 0">
            <q-item-section class="text-grey-7">呢個商品未有任何 SKU。</q-item-section>
          </q-item>
        </q-list>

        <q-separator class="q-my-lg" />

        <ItemMediaPanel
          target-type="item"
          :target-id="item.id"
          :version="item.version"
          :media-list="item.media"
          :can-manage="canManage"
          @refresh="load"
        />
      </template>
    </div>

    <q-dialog v-model="showActivateDialog" persistent>
      <q-card style="min-width: 420px">
        <q-card-section>
          <h2 class="text-h6 q-ma-none">啟用商品</h2>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <div class="text-body2 q-mb-sm">選擇要同時啟用的 SKU（至少一個）：</div>
          <q-list dense bordered>
            <q-item v-for="sku in activatableSkus" :key="sku.id" tag="label" clickable>
              <q-item-section side>
                <q-checkbox v-model="activateSelection" :val="sku.id" />
              </q-item-section>
              <q-item-section>{{ sku.skuCode }} — {{ sku.skuName }}</q-item-section>
            </q-item>
            <q-item v-if="activatableSkus.length === 0">
              <q-item-section class="text-grey-7">沒有可以啟用的 SKU。</q-item-section>
            </q-item>
          </q-list>
          <q-input v-model="activateReason" label="啟用原因" type="textarea" outlined dense class="q-mt-md" />
          <q-banner v-if="activateError" class="bg-negative text-white q-mt-sm">{{ activateError }}</q-banner>
          <div class="row justify-end q-gutter-sm q-mt-md">
            <q-btn flat label="取消" :disable="activateSubmitting" @click="showActivateDialog = false" />
            <q-btn
              color="primary"
              label="啟用"
              unelevated
              :loading="activateSubmitting"
              :disable="!activateValid"
              @click="submitActivate"
            />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showCopyDialog" persistent>
      <q-card style="min-width: 420px">
        <q-card-section>
          <h2 class="text-h6 q-ma-none">複製商品</h2>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <div class="text-body2 q-mb-sm">
            複製成一個新的草稿商品；不會複製條碼，請為每個 SKU 提供一個新的 Code：
          </div>
          <q-input
            v-for="(sku, index) in item.skus"
            :key="sku.id"
            v-model="copySkuCodes[index]"
            :label="`${sku.skuCode} 的新 Code`"
            outlined
            dense
            class="q-mb-sm"
          />
          <q-banner v-if="copyError" class="bg-negative text-white q-mt-sm">{{ copyError }}</q-banner>
          <div class="row justify-end q-gutter-sm q-mt-md">
            <q-btn flat label="取消" :disable="copySubmitting" @click="showCopyDialog = false" />
            <q-btn
              color="primary"
              label="複製"
              unelevated
              :loading="copySubmitting"
              :disable="!copyValid"
              @click="submitCopy"
            />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>
