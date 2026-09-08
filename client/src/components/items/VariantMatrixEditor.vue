<script setup>
import { onMounted, ref } from "vue";
import itemCatalogService from "@/services/itemCatalog.js";
import { notifyError } from "@/framework/ui/notify.js";

/**
 * 揀「用嚟分規格」嘅屬性同選項，產生 Variant SKU 組合清單。設計說明見
 * docs/items_management/design_spec.md §4.4、§7.4。
 *
 * v-model 形狀：`[{ variantValues: [{attributeId, optionId}], skuCode,
 * skuName }]`——每個組合完整嘅 SKU Code／名稱（唔係前綴，使用者可以自己
 * 喺自動建議值前後加字）。UOM、barcode、追蹤政策呢啲全部組合共用嘅欄位由
 * 呼叫端（ItemCreatePage.vue）自己嗰個 SkuEditor 負責，兩者喺提交時先
 * 合併成完整嘅 skus[]（T23 已開放 createItem() 接受多個 SKU）。本期只
 * 支援 single_option 型別嘅 attribute（同後端 T23 嘅範圍一致），因為
 * variant-distinguishing attribute 幾乎都係封閉可列舉集合。
 */

const model = defineModel({ type: Array, required: true });

defineProps({
  fieldError: { type: Function, default: () => "" }
});

const attributes = ref([]); // is_variant=1、active、single_option 嘅屬性
const loading = ref(false);
// { [attributeId]: { checked: boolean, optionIds: Set<number> } }
const selection = ref({});

async function loadAttributes() {
  loading.value = true;
  try {
    const { rows } = await itemCatalogService.attributeList({
      page: 1,
      rowsPerPage: 100,
      status: "active",
      dataType: "single_option"
    });
    attributes.value = rows.filter((attribute) => attribute.isVariant);
    selection.value = Object.fromEntries(
      attributes.value.map((attribute) => [attribute.id, { checked: false, optionIds: new Set() }])
    );
  } catch (error) {
    notifyError(error.message || "載入可用規格屬性失敗");
  } finally {
    loading.value = false;
  }
}

onMounted(loadAttributes);

function toggleAttribute(attributeId) {
  const entry = selection.value[attributeId];
  entry.checked = !entry.checked;
  if (!entry.checked) {
    entry.optionIds.clear();
  }
}

function toggleOption(attributeId, optionId) {
  const optionIds = selection.value[attributeId].optionIds;
  if (optionIds.has(optionId)) {
    optionIds.delete(optionId);
  } else {
    optionIds.add(optionId);
  }
}

function rowSignature(variantValues) {
  return [...variantValues]
    .sort((a, b) => a.attributeId - b.attributeId)
    .map((entry) => `${entry.attributeId}:${entry.optionId}`)
    .join("&");
}

function optionLabel(attributeId, optionId) {
  const attribute = attributes.value.find((a) => a.id === attributeId);
  return attribute?.options.find((option) => option.id === optionId)?.label ?? String(optionId);
}

/** SKU Code 建議用 `value`（穩定、多數係 ASCII），唔用 `label`（顯示用，
 * 好多時係中文）——避免自動建議出嚟嘅 code 一開波就唔係一個好用嘅代碼。 */
function optionValue(attributeId, optionId) {
  const attribute = attributes.value.find((a) => a.id === attributeId);
  return attribute?.options.find((option) => option.id === optionId)?.value ?? String(optionId);
}

function describeRow(row) {
  return row.variantValues
    .map((entry) => {
      const attribute = attributes.value.find((a) => a.id === entry.attributeId);
      return `${attribute?.name ?? entry.attributeId}：${optionLabel(entry.attributeId, entry.optionId)}`;
    })
    .join("、");
}

/** 笛卡兒積：跨已選屬性嘅已選選項組合成全部規格組合。已存在嘅組合（用
 * attributeId:optionId 簽名比對）保留使用者手動改過嘅 code／name 後綴，
 * 唔再存在嘅組合先移除，新出現嘅先套用自動建議值。 */
function generateCombinations() {
  const checkedAttributes = attributes.value.filter((attribute) => selection.value[attribute.id].checked);
  const axes = checkedAttributes
    .map((attribute) => [...selection.value[attribute.id].optionIds].map((optionId) => ({ attributeId: attribute.id, optionId })))
    .filter((axis) => axis.length > 0);

  if (axes.length === 0) {
    model.value = [];
    return;
  }

  let combinations = [[]];
  for (const axis of axes) {
    combinations = combinations.flatMap((combo) => axis.map((entry) => [...combo, entry]));
  }

  const existingBySignature = new Map(model.value.map((row) => [rowSignature(row.variantValues), row]));

  model.value = combinations.map((variantValues) => {
    const signature = rowSignature(variantValues);
    const existing = existingBySignature.get(signature);
    if (existing) {
      return existing;
    }
    const values = variantValues.map((entry) => optionValue(entry.attributeId, entry.optionId));
    const labels = variantValues.map((entry) => optionLabel(entry.attributeId, entry.optionId));
    return {
      variantValues,
      skuCode: values.join("-").toUpperCase().replace(/\s+/g, ""),
      skuName: labels.join("、")
    };
  });
}

function removeRow(index) {
  model.value = model.value.filter((_, i) => i !== index);
}
</script>

<template>
  <div>
    <div v-if="loading" class="text-caption text-grey-7" aria-busy="true">載入規格屬性中…</div>
    <div v-else-if="attributes.length === 0" class="text-caption text-grey-7">
      目前沒有可用於區分規格的商品屬性；請先到「商品屬性」頁面建立 single_option 型別、並勾選「用於區分規格」的屬性。
    </div>
    <template v-else>
      <div class="text-subtitle2 q-mb-sm">選擇規格屬性與選項</div>
      <div v-for="attribute in attributes" :key="attribute.id" class="q-mb-sm">
        <q-checkbox
          :model-value="selection[attribute.id].checked"
          :label="attribute.name"
          @update:model-value="toggleAttribute(attribute.id)"
        />
        <div v-if="selection[attribute.id].checked" class="row q-gutter-sm q-ml-lg">
          <q-checkbox
            v-for="option in attribute.options.filter((o) => o.status === 'active')"
            :key="option.id"
            :model-value="selection[attribute.id].optionIds.has(option.id)"
            :label="option.label"
            dense
            @update:model-value="toggleOption(attribute.id, option.id)"
          />
        </div>
      </div>

      <q-btn flat dense color="primary" icon="grid_on" label="產生組合" class="q-mb-md" @click="generateCombinations" />

      <div v-if="model.length === 0" class="text-caption text-grey-7">尚未產生任何規格組合。</div>
      <q-markup-table v-else flat bordered dense>
        <thead>
          <tr>
            <th class="text-left">規格組合</th>
            <th class="text-left">SKU Code *</th>
            <th class="text-left">SKU 名稱 *</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in model" :key="rowSignature(row.variantValues)">
            <td>{{ describeRow(row) }}</td>
            <td>
              <q-input
                v-model="row.skuCode"
                dense
                outlined
                :error="!!fieldError(`skus.${index}.skuCode`)"
                :error-message="fieldError(`skus.${index}.skuCode`)"
              />
            </td>
            <td>
              <q-input
                v-model="row.skuName"
                dense
                outlined
                :error="!!fieldError(`skus.${index}.skuName`)"
                :error-message="fieldError(`skus.${index}.skuName`)"
              />
            </td>
            <td>
              <q-btn flat round dense icon="delete" color="negative" aria-label="移除這個組合" @click="removeRow(index)" />
            </td>
          </tr>
        </tbody>
      </q-markup-table>
    </template>
  </div>
</template>
