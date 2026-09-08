<script setup>
import { computed, onMounted, ref } from "vue";
import { BARCODE_TYPE_LABEL } from "./itemFieldLabels.js";
import itemCatalogService from "@/services/itemCatalog.js";

/** 陣列 model：`[{ barcode, barcodeType, uomId, isPrimary }]`。`uomId` 必須
 * 係父層 `uoms` prop 入面已經有嘅其中一個（未儲存前冇 sku_uom_id，用
 * uomId 對應返嗰行——見 createItemHandler.js 點樣解析呢個關係），揀唔到
 * 就冇單位可揀，逼使用者要先喺上面加返一個包裝單位。 */
const model = defineModel({ type: Array, required: true });

const props = defineProps({
  uoms: { type: Array, required: true },
  fieldError: { type: Function, default: () => "" },
  readonly: { type: Boolean, default: false },
  // 淨係 SkuDetailPage 睇緊模式先開：條碼釋放係專用高強度 endpoint（reason＋
  // jwt-device-password），唔係呢個 component 平時嗰種「刪一行等下次儲存
  // 先一齊提交」——ItemCreatePage 冇已儲存嘅條碼可以釋放，唔傳呢個 prop。
  allowRelease: { type: Boolean, default: false }
});

const emit = defineEmits(["release"]);

const barcodeTypeOptions = Object.entries(BARCODE_TYPE_LABEL).map(([value, label]) => ({ label, value }));

const uomLabelById = ref({});
async function loadUomLabels() {
  const list = await itemCatalogService.uomList({ includeArchived: true });
  uomLabelById.value = Object.fromEntries(list.map((uom) => [uom.id, `${uom.name}（${uom.code}）`]));
}
onMounted(loadUomLabels);

const uomOptions = computed(() =>
  props.uoms
    .filter((row) => row.uomId !== null)
    .map((row) => ({ label: uomLabelById.value[row.uomId] ?? `單位 #${row.uomId}`, value: row.uomId }))
);

function addRow() {
  model.value = [...model.value, { barcode: "", barcodeType: "ean13", uomId: null, isPrimary: false }];
}

function removeRow(index) {
  model.value = model.value.filter((_, i) => i !== index);
}

/** 同一個 uomId 底下最多一個 primary（見 item_sku_barcodes.uq_item_sku_
 * barcodes_primary）；設呢一行做 primary 就清返同一個 uomId 底下其他行。 */
function setPrimary(index) {
  const targetUomId = model.value[index].uomId;
  model.value = model.value.map((row, i) => ({
    ...row,
    isPrimary: i === index ? true : row.uomId === targetUomId ? false : row.isPrimary
  }));
}
</script>

<template>
  <div>
    <div class="text-subtitle2 q-mb-sm">條碼（選填）</div>
    <div v-for="(row, index) in model" :key="index" class="row q-col-gutter-sm items-center q-mb-sm">
      <div class="col-12 col-md-3">
        <q-input
          v-model="row.barcode"
          label="條碼 *"
          outlined
          dense
          :readonly="readonly"
          :error="!!fieldError(`barcodes.${index}.barcode`)"
          :error-message="fieldError(`barcodes.${index}.barcode`)"
        />
      </div>
      <div class="col-6 col-md-2">
        <q-select
          v-model="row.barcodeType"
          :options="barcodeTypeOptions"
          emit-value
          map-options
          label="種類 *"
          outlined
          dense
          :readonly="readonly"
          :disable="readonly"
          :error="!!fieldError(`barcodes.${index}.barcodeType`)"
          :error-message="fieldError(`barcodes.${index}.barcodeType`)"
        />
      </div>
      <div class="col-6 col-md-3">
        <q-select
          :model-value="row.uomId"
          :options="uomOptions"
          emit-value
          map-options
          label="所屬單位 *"
          outlined
          dense
          :readonly="readonly"
          :disable="readonly"
          :error="!!fieldError(`barcodes.${index}.uomId`)"
          :error-message="fieldError(`barcodes.${index}.uomId`) || (uomOptions.length === 0 ? '請先喺上面新增單位' : '')"
          @update:model-value="(value) => (row.uomId = value)"
        />
      </div>
      <div class="col-6 col-md-2">
        <q-radio
          :model-value="row.isPrimary"
          :val="true"
          label="主要條碼"
          :disable="readonly"
          @update:model-value="setPrimary(index)"
        />
      </div>
      <div v-if="!readonly" class="col-6 col-md-1">
        <q-btn flat round dense icon="delete" :aria-label="`刪除第 ${index + 1} 個條碼`" @click="removeRow(index)" />
      </div>
      <div v-else-if="allowRelease && row.id" class="col-6 col-md-1">
        <q-btn
          flat
          dense
          color="negative"
          label="釋放"
          :aria-label="`釋放條碼「${row.barcode}」`"
          @click="emit('release', { id: row.id, barcode: row.barcode, version: row.version })"
        />
      </div>
    </div>
    <q-btn v-if="!readonly" flat color="primary" icon="add" label="新增條碼" @click="addRow" />
  </div>
</template>
