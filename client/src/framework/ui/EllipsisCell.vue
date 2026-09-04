<script setup>
import { computed } from "vue";

/**
 * DataTable／q-table 嘅儲存格通用包裝：內容截斷做一行（CSS ellipsis），
 * 完整內容用 hover tooltip 顯示——用戶自己打嘅欄位（顯示名稱、裝置名稱、
 * 描述……）長度冇上限，唔截斷嘅話會逼到成張表寬過螢幕（見設備審批頁 User
 * Agent 嗰個問題）。
 *
 * `tooltip` 開放俾「畫面顯示嘅字」同「hover 應該睇到嘅完整內容」唔一樣嘅
 * 情況用（例如角色頁嘅權限摘要顯示「A +3」，但 tooltip 要列晒全部）；冇傳
 * 就用 `text` 本身。
 */
const props = defineProps({
  text: { type: [String, Number], default: "" },
  tooltip: { type: [String, Number], default: null },
  maxWidth: { type: String, default: "220px" }
});

const tooltipText = computed(() => props.tooltip ?? props.text);
</script>

<template>
  <q-td class="text-left">
    <span class="ellipsis" :style="{ maxWidth, display: 'inline-block', verticalAlign: 'bottom' }">
      {{ text }}
      <q-tooltip v-if="tooltipText !== '' && tooltipText !== null && tooltipText !== undefined">
        {{ tooltipText }}
      </q-tooltip>
    </span>
  </q-td>
</template>
