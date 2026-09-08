<script>
export const page = {
  name: "itemCreate",
  path: "/items/new",
  title: "新增商品",
  requires: { permissions: ["item.mgmt"] }
};
</script>

<script setup>
import { computed, nextTick, onUnmounted, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { mapValidationDetailsToFieldErrors, unmatchedFieldErrors } from "@/framework/ui/validationIssues.js";
import ItemBasicForm from "@/components/items/ItemBasicForm.vue";
import SkuEditor from "@/components/items/SkuEditor.vue";
import itemService from "@/services/item.js";

const router = useRouter();

function initialForm() {
  return {
    item: {
      name: "",
      shortName: "",
      description: "",
      categoryId: null,
      brandId: null,
      countryOfOrigin: "",
      manufacturer: "",
      defaultTrackingPolicy: "none",
      defaultShelfLifeDays: null
    },
    sku: {
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
    }
  };
}

const form = reactive(initialForm());
const activationReason = ref("");
const dirty = ref(false);
const submitting = ref(false);
const fieldErrors = ref({});
const summaryMessage = ref("");
const summaryIssues = ref([]);
const summaryRef = ref(null);

function fieldError(path) {
  return fieldErrors.value[path] ?? "";
}

// ItemBasicForm／SkuEditor 呢類共用元件用嘅係相對於自己嗰個 aggregate 嘅
// field 名（例如 `name`、`skuCode`），唔識呢一頁提交 body 實際嘅巢狀 path
// （`item.name`、`skus.0.skuCode`）——原因係呢啲元件將來要俾 SkuDetailPage
// 呢類 body 唔巢狀嘅頁面直接重用（見 T17），加返呢個 prefix 先啱呢一頁
// 自己嘅 request shape。
function itemFieldError(path) {
  return fieldError(`item.${path}`);
}
function skuFieldError(path) {
  return fieldError(`skus.0.${path}`);
}

// deep watch 成個表單就夠——呢個表單一次過提交做一個 aggregate command，
// 唔使追蹤邊個 leaf 欄位個別改變。`activationReason` 唔算入表單本身
// dirty（佢淨係喺「儲存並啟用」先有意義），但都算落 dirty 一齊 watch，
// 因為用戶都係打緊嘢入去，離開都應該問。
watch(
  [form, activationReason],
  () => {
    dirty.value = true;
  },
  { deep: true }
);

onBeforeRouteLeave(() => {
  if (!dirty.value) {
    return true;
  }
  return window.confirm("有未儲存的變更，確定要離開這一頁嗎？");
});

function onBeforeUnload(event) {
  if (!dirty.value) {
    return;
  }
  event.preventDefault();
  event.returnValue = "";
}
window.addEventListener("beforeunload", onBeforeUnload);
onUnmounted(() => window.removeEventListener("beforeunload", onBeforeUnload));

function positiveInt(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const num = Number(value);
  return Number.isInteger(num) ? num : undefined;
}

function formatMoney(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return undefined;
  }
  const num = Number(trimmed);
  return Number.isFinite(num) ? num.toFixed(4) : undefined;
}

function buildPayload() {
  const item = {
    name: form.item.name.trim(),
    shortName: form.item.shortName.trim(),
    description: form.item.description.trim() || null,
    categoryId: form.item.categoryId ?? undefined,
    brandId: form.item.brandId ?? undefined,
    productType: "standard",
    countryOfOrigin: form.item.countryOfOrigin.trim().toUpperCase() || undefined,
    manufacturer: form.item.manufacturer.trim(),
    defaultTrackingPolicy: form.item.defaultTrackingPolicy,
    defaultShelfLifeDays: positiveInt(form.item.defaultShelfLifeDays)
  };

  const uoms = form.sku.uoms
    .filter((row) => row.uomId !== null)
    .map((row) => ({
      uomId: row.uomId,
      toBaseFactor: positiveInt(row.toBaseFactor) ?? 1,
      isBase: row.isBase,
      isDefaultPurchase: row.isDefaultPurchase,
      isDefaultSale: row.isDefaultSale
    }));

  const barcodes = form.sku.barcodes
    .filter((row) => row.barcode.trim() && row.uomId !== null)
    .map((row) => ({
      barcode: row.barcode.trim(),
      barcodeType: row.barcodeType,
      uomId: row.uomId,
      isPrimary: row.isPrimary
    }));

  const sku = {
    skuCode: form.sku.skuCode.trim(),
    skuName: form.sku.skuName.trim(),
    trackingPolicy: form.sku.trackingPolicy,
    shelfLifeDays: positiveInt(form.sku.shelfLifeDays),
    minReceiptLifeDays: positiveInt(form.sku.minReceiptLifeDays),
    minSaleLifeDays: positiveInt(form.sku.minSaleLifeDays),
    purchasable: form.sku.purchasable,
    sellable: form.sku.sellable,
    inventoryTracked: form.sku.inventoryTracked,
    suggestedPriceAmount: formatMoney(form.sku.suggestedPriceAmount),
    uoms,
    barcodes
  };

  return { item, sku };
}

const knownFieldPaths = computed(() => {
  const paths = new Set([
    "item.name",
    "item.shortName",
    "item.description",
    "item.categoryId",
    "item.brandId",
    "item.countryOfOrigin",
    "item.manufacturer",
    "item.defaultTrackingPolicy",
    "item.defaultShelfLifeDays",
    "skus.0.skuCode",
    "skus.0.skuName",
    "skus.0.trackingPolicy",
    "skus.0.shelfLifeDays",
    "skus.0.minReceiptLifeDays",
    "skus.0.minSaleLifeDays",
    "skus.0.suggestedPriceAmount"
  ]);
  form.sku.uoms.forEach((_, index) => {
    paths.add(`skus.0.uoms.${index}.uomId`);
    paths.add(`skus.0.uoms.${index}.toBaseFactor`);
  });
  form.sku.barcodes.forEach((_, index) => {
    paths.add(`skus.0.barcodes.${index}.barcode`);
    paths.add(`skus.0.barcodes.${index}.barcodeType`);
    paths.add(`skus.0.barcodes.${index}.uomId`);
  });
  return paths;
});

// 摘要要唔要顯示，睇邊個一個有嘢：即使全部錯誤都對應到個別欄位（field-level
// 已經顯示紅字），呢個摘要都要照樣顯示（見返模板嘅 fallback 文案）並攞
// focus——單靠個別欄位下面嘅紅字，screen reader 用戶未必即時知道「成張表
// 提交失敗咗」（見 FormPanel.vue 同一個理由嘅說明）。
const hasAnyError = computed(
  () => summaryMessage.value || summaryIssues.value.length > 0 || Object.keys(fieldErrors.value).length > 0
);

async function focusSummary() {
  await nextTick();
  summaryRef.value?.focus();
}

async function submit({ activate }) {
  if (submitting.value) {
    return;
  }

  if (activate && !activationReason.value.trim()) {
    summaryMessage.value = "";
    summaryIssues.value = [{ field: "activationReason", message: "直接啟用時必須填寫啟用原因" }];
    fieldErrors.value = {};
    await focusSummary();
    return;
  }

  submitting.value = true;
  fieldErrors.value = {};
  summaryMessage.value = "";
  summaryIssues.value = [];

  try {
    const { item, sku } = buildPayload();
    const created = await itemService.createItem({
      item,
      sku,
      activate,
      activationReason: activate ? activationReason.value.trim() : undefined
    });

    dirty.value = false;
    notifySuccess(activate ? `商品「${created.name}」已建立並啟用` : `商品「${created.name}」已儲存為草稿`);
    await router.push("/items");
  } catch (error) {
    fieldErrors.value = mapValidationDetailsToFieldErrors(error.details);
    summaryIssues.value = unmatchedFieldErrors(fieldErrors.value, knownFieldPaths.value);

    if (Object.keys(fieldErrors.value).length === 0 && summaryIssues.value.length === 0) {
      summaryMessage.value = error.message || "儲存失敗";
    }

    notifyError(error.message || "儲存失敗");
    await focusSummary();
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader />

    <div class="q-pa-md" style="max-width: 900px">
      <div v-if="hasAnyError" ref="summaryRef" role="alert" tabindex="-1" class="q-mb-md">
        <q-banner class="bg-negative text-white">
          <div v-if="summaryMessage">{{ summaryMessage }}</div>
          <template v-else-if="summaryIssues.length > 0">
            <div class="q-mb-xs">請檢查以下項目：</div>
            <ul class="q-ma-none q-pl-md">
              <li v-for="issue in summaryIssues" :key="issue.field">{{ issue.field }}：{{ issue.message }}</li>
            </ul>
          </template>
          <div v-else>請檢查下面標示錯誤的欄位。</div>
        </q-banner>
      </div>

      <div class="text-h6 q-mb-md">商品基本資料</div>
      <ItemBasicForm v-model="form.item" :field-error="itemFieldError" />

      <q-separator class="q-my-lg" />

      <div class="text-h6 q-mb-md">SKU</div>
      <SkuEditor v-model="form.sku" :field-error="skuFieldError" />

      <q-separator class="q-my-lg" />

      <q-input
        v-model="activationReason"
        label="啟用原因（直接啟用時必填）"
        outlined
        dense
        class="q-mb-md"
        :error="!!fieldError('activationReason')"
        :error-message="fieldError('activationReason')"
      />

      <div class="row q-gutter-sm">
        <q-btn
          color="secondary"
          label="儲存草稿"
          :loading="submitting"
          :aria-label="submitting ? '儲存草稿中' : '儲存草稿'"
          @click="submit({ activate: false })"
        />
        <q-btn
          color="primary"
          label="儲存並啟用"
          :loading="submitting"
          :aria-label="submitting ? '儲存並啟用中' : '儲存並啟用'"
          @click="submit({ activate: true })"
        />
      </div>
      <div v-if="submitting" class="q-mt-sm text-caption" aria-live="polite">處理中，請稍候…</div>
    </div>
  </div>
</template>
