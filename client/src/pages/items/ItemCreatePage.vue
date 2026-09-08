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
import VariantMatrixEditor from "@/components/items/VariantMatrixEditor.vue";
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
      productType: "standard",
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
const variantSkus = ref([]); // VariantMatrixEditor 嘅 [{ variantValues, skuCode, skuName }]
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
  [form, activationReason, variantSkus],
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
    productType: form.item.productType,
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

  // 除 skuCode／skuName（Variant 每個組合各自嘅識別）之外，全部欄位喺
  // Standard 同 Variant 兩條路徑都共用同一份——見 VariantMatrixEditor.vue
  // 對「呢個元件淨係負責組合，共用欄位由 SkuEditor 負責」嘅說明。
  const sharedSkuFields = {
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

  if (form.item.productType === "variant") {
    const skus = variantSkus.value.map((row) => ({
      ...sharedSkuFields,
      skuCode: row.skuCode.trim(),
      skuName: row.skuName.trim(),
      variantValues: row.variantValues
    }));
    return { item, skus };
  }

  const sku = {
    ...sharedSkuFields,
    skuCode: form.sku.skuCode.trim(),
    skuName: form.sku.skuName.trim()
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
    "item.defaultShelfLifeDays"
  ]);

  // 每個 SKU（Standard 得一個、Variant 每個組合一個）都共用同一份 UOM／
  // barcode／追蹤政策等欄位（見 buildPayload 的 sharedSkuFields），所以
  // 逐個 index 都要加一份，唯一唔同嘅係 skuCode／skuName 本身。
  const skuCount = form.item.productType === "variant" ? Math.max(variantSkus.value.length, 1) : 1;
  for (let index = 0; index < skuCount; index += 1) {
    paths.add(`skus.${index}.skuCode`);
    paths.add(`skus.${index}.skuName`);
    paths.add(`skus.${index}.trackingPolicy`);
    paths.add(`skus.${index}.shelfLifeDays`);
    paths.add(`skus.${index}.minReceiptLifeDays`);
    paths.add(`skus.${index}.minSaleLifeDays`);
    paths.add(`skus.${index}.suggestedPriceAmount`);
    form.sku.uoms.forEach((_, uomIndex) => {
      paths.add(`skus.${index}.uoms.${uomIndex}.uomId`);
      paths.add(`skus.${index}.uoms.${uomIndex}.toBaseFactor`);
    });
    form.sku.barcodes.forEach((_, barcodeIndex) => {
      paths.add(`skus.${index}.barcodes.${barcodeIndex}.barcode`);
      paths.add(`skus.${index}.barcodes.${barcodeIndex}.barcodeType`);
      paths.add(`skus.${index}.barcodes.${barcodeIndex}.uomId`);
    });
  }
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

  if (form.item.productType === "variant" && variantSkus.value.length === 0) {
    summaryMessage.value = "";
    summaryIssues.value = [{ field: "skus", message: "多規格商品最少要產生一個規格組合" }];
    fieldErrors.value = {};
    await focusSummary();
    return;
  }

  submitting.value = true;
  fieldErrors.value = {};
  summaryMessage.value = "";
  summaryIssues.value = [];

  try {
    const { item, sku, skus } = buildPayload();
    const created = await itemService.createItem({
      item,
      ...(skus ? { skus } : { sku }),
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
      <q-btn-toggle
        v-model="form.item.productType"
        class="q-mb-md"
        no-caps
        toggle-color="primary"
        :options="[
          { label: '單一規格（Standard）', value: 'standard' },
          { label: '多規格（Variant）', value: 'variant' }
        ]"
      />
      <ItemBasicForm v-model="form.item" :field-error="itemFieldError" />

      <q-separator class="q-my-lg" />

      <div class="text-h6 q-mb-md">{{ form.item.productType === "variant" ? "SKU 共用資料" : "SKU" }}</div>
      <div v-if="form.item.productType === 'variant'" class="text-caption text-grey-7 q-mb-md">
        以下資料會套用到下面每一個規格組合；SKU Code／名稱在下方各自組合中填寫。
      </div>
      <SkuEditor v-model="form.sku" :field-error="skuFieldError" :hide-identity="form.item.productType === 'variant'" />

      <template v-if="form.item.productType === 'variant'">
        <q-separator class="q-my-lg" />
        <div class="text-h6 q-mb-md">規格組合</div>
        <VariantMatrixEditor v-model="variantSkus" :field-error="skuFieldError" />
      </template>

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
