<script setup>
import { nextTick, onUnmounted, ref, watch } from "vue";
const props = defineProps({ modelValue: Boolean, disabled: Boolean, busy: Boolean,
  title: { type: String, default: "確認高風險庫存操作" }, confirmLabel: { type: String, default: "確認過帳" }, execute: { type: Function, required: true } });
const emit = defineEmits(["update:modelValue", "hidden"]);
const passwordInput = ref(null), error = ref(""), submitting = ref(false);
function clear() { if (passwordInput.value) passwordInput.value.value = ""; }
function cancel() { if (props.busy || submitting.value) return; clear(); emit("update:modelValue", false); }
async function confirm() {
  if (props.disabled || props.busy || submitting.value) return;
  let value = passwordInput.value?.value;
  clear(); error.value = "";
  if (!value || value.length > 1024) { error.value = "請輸入目前密碼（最多 1024 字元）。"; passwordInput.value?.focus(); return; }
  submitting.value = true;
  try { await props.execute(value); }
  finally { value = null; clear(); submitting.value = false; }
}
watch(() => [props.modelValue, props.disabled], () => { clear(); error.value = ""; });
onUnmounted(clear);
</script>
<template>
  <q-dialog :model-value="modelValue" persistent @update:model-value="cancel" @hide="clear(); emit('hidden')" @show="nextTick(() => passwordInput?.focus())">
    <q-card class="high-risk-dialog">
      <q-card-section>
        <h2 id="inventory-confirm-title" class="text-h6 q-mt-none">{{ title }}</h2>
        <slot />
        <form aria-labelledby="inventory-confirm-title" @submit.prevent="confirm">
          <label class="block q-mb-xs" for="inventory-confirm-password">目前密碼（必填）</label>
          <input id="inventory-confirm-password" ref="passwordInput" class="password-input" type="password" autocomplete="current-password"
            :disabled="disabled || busy || submitting" aria-describedby="inventory-confirm-help" />
          <p id="inventory-confirm-help" class="text-caption">每次嘗試必須重新輸入。提交後立即清除輸入，不會儲存密碼。</p>
          <div v-if="error" role="alert" class="text-negative q-mb-md">{{ error }}</div>
          <div class="row justify-end q-gutter-sm">
            <q-btn flat label="取消" :disable="busy || submitting" @click="cancel" />
            <q-btn color="negative" type="submit" :label="confirmLabel" :disable="disabled || busy || submitting" :loading="busy || submitting" />
          </div>
        </form>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>
<style scoped>
.high-risk-dialog { width: 760px; max-width: 100%; }
.password-input { width: 100%; min-height: 44px; padding: 8px; font: inherit; color: inherit; background: transparent; border: 1px solid var(--app-border); border-radius: 4px; }
</style>
