<script>
export const page = {
  name: "skuCreate",
  path: "/items/:itemId/skus/new",
  title: "新增 SKU",
  requires: { permissions: ["item.mgmt"] }
};
</script>

<script setup>
import { computed, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import SkuEditor from "@/components/items/SkuEditor.vue";
import VariantMatrixEditor from "@/components/items/VariantMatrixEditor.vue";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { mapValidationDetailsToFieldErrors } from "@/framework/ui/validationIssues.js";
import itemService from "@/services/item.js";

const route = useRoute();
const router = useRouter();
const itemId = computed(() => Number(route.params.itemId));

const loading = ref(true);
const loadError = ref("");
const item = ref(null);
const submitting = ref(false);
const errorMessage = ref("");
const fieldErrors = ref({});
const variantSkus = ref([]);
// `SkuEditor` 用 defineModel() 綁定整個物件，Vue 編譯器要求這個 binding 可以
// 被重新賦值；實際上這頁只改動物件內的欄位。
// eslint-disable-next-line prefer-const
let sku = reactive({
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

function variantFieldError(path) {
  return fieldError(path.replace(/^skus\.0\./, ""));
}

function positiveInt(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function formatMoney(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed.toFixed(4) : undefined;
}

function buildPayload(row) {
  return {
    itemId: itemId.value,
    skuCode: row.skuCode.trim(),
    skuName: row.skuName.trim(),
    trackingPolicy: sku.trackingPolicy,
    shelfLifeDays: positiveInt(sku.shelfLifeDays),
    minReceiptLifeDays: positiveInt(sku.minReceiptLifeDays),
    minSaleLifeDays: positiveInt(sku.minSaleLifeDays),
    purchasable: sku.purchasable,
    sellable: sku.sellable,
    inventoryTracked: sku.inventoryTracked,
    suggestedPriceAmount: formatMoney(sku.suggestedPriceAmount),
    uoms: sku.uoms
      .filter((entry) => entry.uomId !== null)
      .map((entry) => ({
        uomId: entry.uomId,
        toBaseFactor: positiveInt(entry.toBaseFactor) ?? 1,
        isBase: entry.isBase,
        isDefaultPurchase: entry.isDefaultPurchase,
        isDefaultSale: entry.isDefaultSale
      })),
    barcodes: sku.barcodes
      .filter((entry) => entry.barcode.trim() && entry.uomId !== null)
      .map((entry) => ({
        barcode: entry.barcode.trim(),
        barcodeType: entry.barcodeType,
        uomId: entry.uomId,
        isPrimary: entry.isPrimary
      })),
    variantValues: row.variantValues
  };
}

async function load() {
  loading.value = true;
  try {
    item.value = await itemService.getItem(itemId.value);
  } catch (error) {
    loadError.value = error.message || "載入商品詳情失敗";
  } finally {
    loading.value = false;
  }
}
load();

async function submit() {
  if (submitting.value) return;
  errorMessage.value = "";
  fieldErrors.value = {};
  if (item.value?.productType !== "variant") {
    errorMessage.value = "只有多規格商品可以新增 SKU。";
    return;
  }
  if (variantSkus.value.length !== 1) {
    errorMessage.value = "請選擇並產生一個規格組合後再新增 SKU。";
    return;
  }

  submitting.value = true;
  try {
    const created = await itemService.createSku(buildPayload(variantSkus.value[0]));
    notifySuccess(`SKU「${created.skuCode}」已新增為草稿`);
    await router.push(`/items/${itemId.value}/skus/${created.id}`);
  } catch (error) {
    fieldErrors.value = mapValidationDetailsToFieldErrors(error.details);
    errorMessage.value = error.message || "新增 SKU 失敗";
    notifyError(error.message || "新增 SKU 失敗");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <PageHeader :title="item ? `新增 SKU：${item.name}` : '新增 SKU'" />
    <div class="q-pa-md" style="max-width: 900px">
      <div v-if="loading">載入中…</div>
      <q-banner v-else-if="loadError" class="bg-negative text-white">{{ loadError }}</q-banner>
      <template v-else>
        <q-banner v-if="item.productType !== 'variant'" class="bg-warning text-dark">
          只有多規格商品可以新增 SKU。請返回商品詳情。
        </q-banner>
        <template v-else>
          <q-banner v-if="errorMessage" role="alert" class="bg-negative text-white q-mb-md">{{ errorMessage }}</q-banner>
          <div class="text-body2 q-mb-md">新 SKU 會以草稿建立；請選擇一個尚未存在的規格組合。</div>
          <SkuEditor v-model="sku" :field-error="fieldError" :hide-identity="true" />
          <q-separator class="q-my-lg" />
          <div class="text-h6 q-mb-md">規格組合</div>
          <VariantMatrixEditor v-model="variantSkus" :field-error="variantFieldError" />
          <div class="row q-gutter-sm q-mt-lg">
            <q-btn color="primary" label="新增 SKU" :loading="submitting" @click="submit" />
            <q-btn flat label="取消" :disable="submitting" @click="router.push(`/items/${itemId}`)" />
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
