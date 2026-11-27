<script setup>
import { computed } from "vue";

const props = defineProps({
  result: { type: Object, required: true },
  loading: { type: Boolean, default: false },
  previousPage: { type: Boolean, default: false }
});
const pageSize = defineModel({ type: Number, required: true });
defineEmits(["back", "next"]);

const sizes = [20, 50, 100];
const summary = computed(() => {
  const { items, page, pageSize: appliedSize, total } = props.result;
  if (!items.length || total === undefined) return `第 ${page} 頁，本頁 ${items.length} 列`;
  const offset = (page - 1) * appliedSize;
  return `${offset + 1}〜${offset + items.length} 列，共 ${total} 列`;
});
</script>

<template>
  <nav aria-label="分頁" class="full-width row items-center justify-end q-gutter-x-sm">
    <div class="row items-center no-wrap q-gutter-x-sm">
      <span class="text-caption">每頁列數：</span>
      <q-select v-model="pageSize" aria-label="每頁列數" :options="sizes" borderless dense options-dense />
    </div>
    <span class="text-caption" aria-live="polite">{{ summary }}</span>
    <q-btn :aria-label="previousPage ? '上一頁' : '首頁'"
      :icon="previousPage ? $q.iconSet.table.prevPage : $q.iconSet.table.firstPage"
      flat round dense :disable="loading || result.page <= 1" @click="$emit('back')" />
    <q-btn aria-label="下一頁" :icon="$q.iconSet.table.nextPage" flat round dense
      :disable="loading || !result.hasMore" @click="$emit('next')" />
  </nav>
</template>
