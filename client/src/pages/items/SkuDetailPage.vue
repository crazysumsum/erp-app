<script>
export const page = {
  name: "skuDetail",
  path: "/items/:itemId/skus/:skuId",
  title: "SKU 詳情",
  requires: { permissions: ["item.view"] }
};
</script>

<script setup>
import { computed, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { can } from "@/framework/authorization/can.js";
import { promptPassword, promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { mapValidationDetailsToFieldErrors } from "@/framework/ui/validationIssues.js";
import SkuEditor from "@/components/items/SkuEditor.vue";
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
const session = useSessionStore();
const canManage = computed(() => can(session, { permissions: ["item.mgmt"] }));

const itemId = computed(() => Number(route.params.itemId));
const skuId = computed(() => Number(route.params.skuId));

const loading = ref(true);
const loadError = ref("");
const sku = ref(null);
const editing = ref(false);
const submitting = ref(false);
const fieldErrors = ref({});
const errorMessage = ref("");
const staleNotice = ref(false);
const reason = ref("");

// `let` 唔係 `const`：SkuEditor.vue 用 defineModel() 綁 v-model 落成個
// `form` 物件本身（唔係佢底下某個屬性），Vue 編譯器為咗支援 defineModel()
// 理論上可以整個重新賦值嘅語意，要求呢個 binding 本身可以重新賦值——雖然
// loadFormFrom() 淨係改緊屬性，從來冇整個重新賦值過。
// eslint-disable-next-line prefer-const
let form = reactive({
  skuCode: "",
  skuName: "",
  trackingPolicy: "none",
  shelfLifeDays: null,
  minReceiptLifeDays: null,
  minSaleLifeDays: null,
  purchasable: true,
  sellable: true,
  inventoryTracked: true,
  suggestedPriceAmount: "",
  uoms: [],
  barcodes: []
});

function fieldError(path) {
  return fieldErrors.value[path] ?? "";
}

function loadFormFrom(data) {
  form.skuCode = data.skuCode;
  form.skuName = data.skuName;
  form.trackingPolicy = data.trackingPolicy;
  form.shelfLifeDays = data.shelfLifeDays;
  form.minReceiptLifeDays = data.minReceiptLifeDays;
  form.minSaleLifeDays = data.minSaleLifeDays;
  form.purchasable = data.purchasable;
  form.sellable = data.sellable;
  form.inventoryTracked = data.inventoryTracked;
  form.suggestedPriceAmount = data.suggestedRetailPrice?.amount ?? "";
  form.uoms = data.uoms.map((row) => ({
    id: row.id,
    uomId: row.uomId,
    toBaseFactor: row.toBaseFactor,
    isBase: row.isBase,
    isDefaultPurchase: row.isDefaultPurchase,
    isDefaultSale: row.isDefaultSale
  }));
  form.barcodes = data.barcodes.map((row) => ({
    id: row.id,
    barcode: row.barcode,
    barcodeType: row.barcodeType,
    // barcodes 提交嗰邊要嘅係 uomId（見 SkuBarcodeEditor.vue 註解），但
    // 詳情 API 淨係回 skuUomId——用 form.uoms 已經帶埋嘅 id 對返去揾邊個
    // uomId，一定揾得到，因為條碼一定屬於呢個 SKU 現存嘅其中一個包裝單位。
    uomId: form.uoms.find((uom) => uom.id === row.skuUomId)?.uomId ?? null,
    isPrimary: row.isPrimary
  }));
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    sku.value = await itemService.getSku(skuId.value);
    loadFormFrom(sku.value);
  } catch (error) {
    loadError.value = error.message || "載入 SKU 詳情失敗";
  } finally {
    loading.value = false;
  }
}
load();

function startEdit() {
  loadFormFrom(sku.value);
  fieldErrors.value = {};
  errorMessage.value = "";
  staleNotice.value = false;
  reason.value = "";
  editing.value = true;
}

function cancelEdit() {
  loadFormFrom(sku.value);
  fieldErrors.value = {};
  errorMessage.value = "";
  staleNotice.value = false;
  reason.value = "";
  editing.value = false;
}

function buildPayload() {
  return {
    skuName: form.skuName,
    trackingPolicy: form.trackingPolicy,
    shelfLifeDays: form.shelfLifeDays ?? undefined,
    minReceiptLifeDays: form.minReceiptLifeDays ?? undefined,
    minSaleLifeDays: form.minSaleLifeDays ?? undefined,
    purchasable: form.purchasable,
    sellable: form.sellable,
    inventoryTracked: form.inventoryTracked,
    suggestedPriceAmount: form.suggestedPriceAmount || undefined,
    uoms: form.uoms.filter((row) => row.uomId !== null),
    barcodes: form.barcodes.filter((row) => row.barcode.trim() && row.uomId !== null),
    reason: reason.value.trim() || undefined,
    version: sku.value.version
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
    const updated = await itemService.updateSku(skuId.value, buildPayload());
    sku.value = updated;
    editing.value = false;
    staleNotice.value = false;
    notifySuccess(`SKU「${updated.skuCode}」已更新`);
  } catch (error) {
    if (error.code === "VERSION_CONFLICT") {
      staleNotice.value = true;
      try {
        sku.value = await itemService.getSku(skuId.value);
      } catch {
        // 重新載入本身失敗都唔緊要，stale notice 已經話咗用戶而家個版本舊。
      }
      errorMessage.value = "呢個 SKU 喺你編輯期間已經被人改過，你嘅輸入仍然保留喺畫面上。";
    } else if (error.code === "CRITICAL_CHANGE_REASON_REQUIRED") {
      errorMessage.value = error.message;
    } else {
      fieldErrors.value = mapValidationDetailsToFieldErrors(error.details, { skuFieldPrefix: "" });
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
  loadFormFrom(sku.value);
  staleNotice.value = false;
  errorMessage.value = "";
}

// --- 生命週期（T18 後端；design_spec §4.2、§6.3、§7.7） ---------------------

const showActivate = computed(() => sku.value?.item.status === "active" && ["draft", "inactive"].includes(sku.value.status));
const showDeactivate = computed(() => sku.value?.status === "active");
const showDiscontinue = computed(() => sku.value && ["active", "inactive"].includes(sku.value.status));
const showArchive = computed(() => sku.value && ["draft", "inactive", "discontinued"].includes(sku.value.status));
const showRestore = computed(() => sku.value?.status === "archived");

async function runLifecycleAction(action, successVerb) {
  try {
    const updated = await action();
    sku.value = updated;
    notifySuccess(`SKU「${updated.skuCode}」${successVerb}`);
  } catch (error) {
    if (error.code === "VERSION_CONFLICT") {
      sku.value = await itemService.getSku(skuId.value);
    }
    notifyError(error.message || "操作失敗");
  }
}

async function activateFlow() {
  const reason = await promptReason({ title: "啟用 SKU", message: `啟用「${sku.value.skuCode}」？`, okLabel: "啟用" });
  if (reason === null) {
    return;
  }
  await runLifecycleAction(() => itemService.activateSku(skuId.value, { reason, version: sku.value.version }), "已啟用");
}

async function deactivateFlow() {
  const reason = await promptReason({ title: "停用 SKU", message: `停用「${sku.value.skuCode}」？`, okLabel: "停用" });
  if (reason === null) {
    return;
  }
  await runLifecycleAction(() => itemService.deactivateSku(skuId.value, { reason, version: sku.value.version }), "已停用");
}

async function discontinueFlow() {
  const outcome = await promptPassword({
    title: "停產 SKU",
    message: `停產「${sku.value.skuCode}」？強制停止採購，這個操作不可以復原。`,
    okLabel: "停產",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  await runLifecycleAction(
    () => itemService.discontinueSku(skuId.value, { ...outcome, version: sku.value.version }),
    "已停產"
  );
}

async function archiveFlow() {
  const outcome = await promptPassword({
    title: "封存 SKU",
    message: `封存「${sku.value.skuCode}」？這個操作不可以復原。`,
    okLabel: "封存",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  await runLifecycleAction(() => itemService.archiveSku(skuId.value, { ...outcome, version: sku.value.version }), "已封存");
}

async function restoreFlow() {
  const outcome = await promptPassword({
    title: "恢復 SKU",
    message: `從封存恢復「${sku.value.skuCode}」？`,
    okLabel: "恢復",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }
  await runLifecycleAction(
    () => itemService.restoreSku(skuId.value, { ...outcome, version: sku.value.version }),
    "已從封存恢復"
  );
}
</script>

<template>
  <div>
    <PageHeader :title="sku ? sku.skuCode : undefined" />

    <div class="q-pa-md" style="max-width: 900px">
      <div v-if="loading">載入中…</div>
      <q-banner v-else-if="loadError" class="bg-negative text-white">{{ loadError }}</q-banner>

      <template v-else>
        <div class="row items-center q-gutter-sm q-mb-md">
          <q-badge :color="STATUS_COLOUR[sku.status]" :label="STATUS_LABEL[sku.status] ?? sku.status" />
          <span class="text-caption text-grey-7">版本 {{ sku.version }}</span>
          <q-btn flat dense label="返回商品" :to="`/items/${itemId}`" />
          <q-space />
          <template v-if="canManage && !editing">
            <q-btn v-if="showActivate" flat color="positive" label="啟用" @click="activateFlow" />
            <q-btn v-if="showDeactivate" flat label="停用" @click="deactivateFlow" />
            <q-btn v-if="showDiscontinue" flat color="warning" label="停產" @click="discontinueFlow" />
            <q-btn v-if="showArchive" flat color="warning" label="封存" @click="archiveFlow" />
            <q-btn v-if="showRestore" flat color="primary" label="從封存恢復" @click="restoreFlow" />
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

        <SkuEditor v-model="form" :field-error="fieldError" :readonly="!editing" sku-code-readonly />

        <q-input
          v-if="editing"
          v-model="reason"
          label="修改原因（改 Base 單位、換算係數或追蹤政策時必填）"
          outlined
          dense
          class="q-mt-md"
        />

        <div v-if="editing" class="row q-gutter-sm q-mt-md">
          <q-btn color="primary" label="儲存" :loading="submitting" @click="save" />
          <q-btn flat label="取消" :disable="submitting" @click="cancelEdit" />
        </div>
      </template>
    </div>
  </div>
</template>
