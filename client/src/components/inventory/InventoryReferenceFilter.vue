<script setup>
import { computed, ref, watch } from "vue";
import ReferencePicker from "@/framework/ui/ReferencePicker.vue";
import inventoryService from "@/services/inventory.js";
import itemService from "@/services/item.js";

const props = defineProps({
  kind: { type: String, required: true },
  label: { type: String, required: true },
  warehouseId: { type: String, default: "" }
});
const id = defineModel({ type: String, required: true });
const option = ref(null);
const warehouse = computed(() => positiveId(props.warehouseId));
const needsWarehouse = computed(() => props.kind === "bin" && !warehouse.value);

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function skuOption(row) {
  return { id: row.id, code: row.skuCode, name: row.skuName };
}

async function search(filter, signal) {
  const request = { page: 1, rowsPerPage: 50, filter };
  if (props.kind === "sku") {
    const { rows } = await itemService.listSkus({ ...request, includeArchived: true });
    return rows.map(skuOption);
  }
  const locations = { ...request, status: "ALL", signal };
  if (props.kind === "warehouse") return (await inventoryService.listWarehouses(locations)).rows;
  if (!warehouse.value) return [];
  return (await inventoryService.listBins(warehouse.value, locations)).rows;
}

function select(next) {
  const selectedId = positiveId(next?.id);
  option.value = selectedId ? next : null;
  id.value = selectedId ? String(selectedId) : "";
}

watch([id, warehouse], async ([value, warehouseId], _, onCleanup) => {
  const selectedId = positiveId(value);
  if (!selectedId) {
    option.value = null;
    return;
  }
  if (positiveId(option.value?.id) === selectedId) return;

  option.value = { id: selectedId, code: `${props.label} #${selectedId}` };
  if (needsWarehouse.value) return;
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  const { signal } = controller;
  try {
    let row;
    if (props.kind === "sku") row = skuOption(await itemService.getSku(selectedId));
    else if (props.kind === "warehouse") row = await inventoryService.getWarehouse(selectedId, { signal });
    else row = await inventoryService.getBin(warehouseId, selectedId, { signal });
    if (!signal.aborted && positiveId(row?.id) === selectedId) option.value = row;
  } catch {
    // Keep the original exact filter and let the user clear it.
  }
}, { immediate: true });
</script>

<template>
  <ReferencePicker :model-value="option" :label="label" :search="search"
    :disable="needsWarehouse && !option" :hint="needsWarehouse ? '請先選擇倉庫' : undefined"
    @update:model-value="select" />
</template>
