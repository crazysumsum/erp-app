<script setup>
import { onMounted, ref } from "vue";
import itemCatalogService from "@/services/itemCatalog.js";
import { notifyError } from "@/framework/ui/notify.js";

/** 陣列 model：`[{ uomId, toBaseFactor, isBase, isDefaultPurchase, isDefaultSale }]`。
 * `isBase`／`isDefaultPurchase`／`isDefaultSale` 每一種全部 SKU 最多得一行係
 * true（見 server 嘅 item_sku_uoms 三個 generated-column unique key），呢度
 * 用單選（揀一行就自動清晒其他行同一個 flag）令使用者喺畫面上根本整唔到
 * 「兩行都係 Base」呢種一定會俾後端拒絕嘅組合。 */
const model = defineModel({ type: Array, required: true });

defineProps({
  fieldError: { type: Function, default: () => "" },
  readonly: { type: Boolean, default: false }
});

const uomOptions = ref([]);
const loading = ref(false);

async function loadUoms() {
  loading.value = true;
  try {
    const uoms = await itemCatalogService.uomList({ includeArchived: false });
    // includeArchived: false 淨係濾走 archived，inactive 仍然會included——
    // 新建 SKU 冇理由揀一個已停用嘅單位，呢度自己再篩多一層。
    uomOptions.value = uoms
      .filter((uom) => uom.status === "active")
      .map((uom) => ({ label: `${uom.name}（${uom.code}）`, value: uom.id }));
  } catch (error) {
    notifyError(error.message || "載入單位選項失敗");
  } finally {
    loading.value = false;
  }
}

onMounted(loadUoms);

function addRow() {
  model.value = [
    ...model.value,
    { uomId: null, toBaseFactor: 1, isBase: model.value.length === 0, isDefaultPurchase: false, isDefaultSale: false }
  ];
}

function removeRow(index) {
  model.value = model.value.filter((_, i) => i !== index);
}

function setExclusiveFlag(index, flag) {
  model.value = model.value.map((row, i) => ({ ...row, [flag]: i === index }));
}
</script>

<template>
  <div>
    <div class="text-subtitle2 q-mb-sm">包裝單位</div>
    <div v-for="(row, index) in model" :key="index" class="row q-col-gutter-sm items-center q-mb-sm">
      <div class="col-12 col-md-3">
        <q-select
          :model-value="row.uomId"
          :options="uomOptions"
          emit-value
          map-options
          label="單位 *"
          outlined
          dense
          :readonly="readonly"
          :disable="readonly"
          :loading="loading"
          :error="!!fieldError(`uoms.${index}.uomId`)"
          :error-message="fieldError(`uoms.${index}.uomId`)"
          @update:model-value="(value) => (row.uomId = value)"
        />
      </div>
      <div class="col-6 col-md-2">
        <q-input
          v-model.number="row.toBaseFactor"
          type="number"
          min="1"
          label="換算係數 *"
          outlined
          dense
          :readonly="readonly"
          :error="!!fieldError(`uoms.${index}.toBaseFactor`)"
          :error-message="fieldError(`uoms.${index}.toBaseFactor`)"
        />
      </div>
      <div class="col-6 col-md-2">
        <q-radio
          :model-value="row.isBase"
          :val="true"
          label="Base"
          :disable="readonly"
          @update:model-value="setExclusiveFlag(index, 'isBase')"
        />
      </div>
      <div class="col-6 col-md-2">
        <q-radio
          :model-value="row.isDefaultPurchase"
          :val="true"
          label="預設採購"
          :disable="readonly"
          @update:model-value="setExclusiveFlag(index, 'isDefaultPurchase')"
        />
      </div>
      <div class="col-6 col-md-2">
        <q-radio
          :model-value="row.isDefaultSale"
          :val="true"
          label="預設銷售"
          :disable="readonly"
          @update:model-value="setExclusiveFlag(index, 'isDefaultSale')"
        />
      </div>
      <div v-if="!readonly" class="col-12 col-md-1">
        <q-btn flat round dense icon="delete" :aria-label="`刪除第 ${index + 1} 個單位`" @click="removeRow(index)" />
      </div>
    </div>
    <q-btn v-if="!readonly" flat color="primary" icon="add" label="新增單位" @click="addRow" />
  </div>
</template>
