<script setup>
import { computed, ref, watch } from "vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import { REQUIRED_CONSUMER_CHECKER_IDS } from "./presentation.js";

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  entityLabel: { type: String, required: true },
  operationLabel: { type: String, required: true },
  changes: { type: Array, default: () => [] },
  preview: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  submitting: { type: Boolean, default: false },
  error: { type: String, default: "" },
  retryLabel: { type: String, default: "重新預覽" },
  auditPath: { type: String, default: "" }
});

const emit = defineEmits(["update:modelValue", "confirm", "retry"]);
const reason = ref("");
const unsafeResults = computed(() =>
  (props.preview?.results ?? []).filter((result) => !["READY", "NOT_INSTALLED"].includes(result.status))
);
const hasCompleteResults = computed(() => {
  const checkerIds = new Set((props.preview?.results ?? []).map((result) => result.checkerId));
  return REQUIRED_CONSUMER_CHECKER_IDS.every((checkerId) => checkerIds.has(checkerId));
});
const canConfirm = computed(() =>
  !!props.preview && !props.loading && !props.submitting && hasCompleteResults.value && unsafeResults.value.length === 0
);

watch(() => props.modelValue, (open) => {
  if (!open) reason.value = "";
});

async function submit() {
  if (!canConfirm.value || reason.value.trim().length < 5 || reason.value.trim().length > 190) return;
  emit("confirm", reason.value.trim());
}
</script>

<template>
  <q-dialog
    :model-value="modelValue"
    persistent
    @update:model-value="(value) => emit('update:modelValue', value)"
  >
    <q-card class="impact-dialog">
      <q-card-section>
        <h2 class="text-h6 q-ma-none">{{ operationLabel }}</h2>
        <div class="text-body2 text-grey-7 q-mt-xs">{{ entityLabel }}</div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <q-inner-loading :showing="loading" label="正在檢查引用影響…" />

        <q-banner v-if="error" role="alert" class="bg-negative text-white q-mb-md">
          {{ error }}
          <template v-if="retryLabel" #action><q-btn flat :label="retryLabel" @click="emit('retry')" /></template>
        </q-banner>

        <template v-if="preview">
          <h3 class="text-subtitle1 q-mt-none q-mb-sm">變更內容</h3>
          <dl class="change-list q-mt-none">
            <div v-for="change in changes" :key="change.label" class="row q-py-xs">
              <dt class="col-4 text-weight-medium">{{ change.label }}</dt>
              <dd class="col q-ma-none">{{ change.before }} → {{ change.after }}</dd>
            </div>
          </dl>

          <h3 class="text-subtitle1 q-mb-sm">Consumer 影響</h3>
          <div class="impact-table-wrap">
            <table class="impact-table full-width">
              <thead>
                <tr><th>Consumer</th><th>狀態</th><th>Active defaults</th><th>Open use</th><th>歷史引用</th></tr>
              </thead>
              <tbody>
                <tr v-for="result in preview.results" :key="result.checkerId">
                  <td>{{ result.checkerId }}</td>
                  <td>{{ result.status }}</td>
                  <td>{{ result.activeDefaultCount }}</td>
                  <td>{{ result.openUseCount }}</td>
                  <td>{{ result.historicalCount }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <q-banner v-if="!hasCompleteResults || unsafeResults.length" role="alert" class="bg-warning text-dark q-mt-md">
            影響尚未能確定，確認操作已停用。請先恢復所有 consumer 檢查器。
          </q-banner>

          <FormPanel v-slot="{ submitting: formSubmitting }" :on-submit="submit">
            <q-input
              v-model="reason"
              class="q-mt-md"
              type="textarea"
              filled
              label="變更原因"
              hint="必填，5–190 字"
              counter
              maxlength="190"
              :rules="[(value) => value.trim().length >= 5 || '請輸入至少 5 個字的原因']"
            />
            <div class="row justify-between items-center q-gutter-sm q-mt-md impact-actions">
              <q-btn
                v-if="auditPath"
                flat
                icon="history"
                label="檢視此項目的稽核記錄"
                :to="auditPath"
                @click="emit('update:modelValue', false)"
              />
              <div class="row q-gutter-sm q-ml-auto">
                <q-btn flat label="取消" :disable="submitting || formSubmitting" @click="emit('update:modelValue', false)" />
                <q-btn
                  type="submit"
                  color="negative"
                  unelevated
                  :label="`確認${operationLabel}`"
                  :aria-label="`確認執行${operationLabel}`"
                  :disable="!canConfirm"
                  :loading="submitting || formSubmitting"
                />
              </div>
            </div>
          </FormPanel>
        </template>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.impact-dialog { width: min(760px, calc(100vw - 32px)); max-width: 760px; }
.impact-table-wrap { overflow-x: auto; }
.impact-table { border-collapse: collapse; min-width: 600px; }
.impact-table th, .impact-table td { padding: 8px; border-bottom: 1px solid var(--app-border); text-align: left; }
@media (max-width: 599px) {
  .impact-actions { align-items: stretch; }
  .impact-actions > * { width: 100%; }
}
</style>
