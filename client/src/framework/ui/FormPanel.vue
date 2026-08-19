<script setup>
import { ref } from "vue";

/**
 * 封裝 QForm，重點喺「後端 validation 錯咗，將 error.details 自動對應返去
 * 個別欄位顯示」呢條接線——Quasar 冇提供，但每個表單都會用到。
 *
 * `onSubmit` 拋出嘅錯誤如果帶 `.details`（後端 requestValidator 嘅格式：
 * `[{ location, path, keyword, message }]`，見
 * server/src/framework/validation/requestValidator.js），會自動拆做
 * `fieldErrors`，經預設 slot 嘅 `fieldError(name)` 傳返俾頁面接落去個別
 * 欄位嘅 `:error`/`:error-message`。冇對應到任何欄位嘅錯誤（例如 details
 * 全部都係 query／params，或者根本冇 details）就用返一句總體錯誤訊息，
 * 唔會靜靜哋吞咗個錯誤。
 *
 * `@submit` 由 QForm 自己內部行晒 validate()，得返 client-side 驗證過咗先
 * 會觸發，唔使呢度再叫多次。
 */
const props = defineProps({
  onSubmit: { type: Function, required: true }
});

const emit = defineEmits(["success"]);

const formRef = ref(null);
const submitting = ref(false);
const errorMessage = ref("");
const fieldErrors = ref({});

function fieldError(name) {
  return fieldErrors.value[name] ?? "";
}

async function handleSubmit() {
  submitting.value = true;
  errorMessage.value = "";
  fieldErrors.value = {};

  try {
    const result = await props.onSubmit();
    emit("success", result);
  } catch (error) {
    fieldErrors.value = error.details ? detailsToFieldErrors(error.details) : {};

    if (Object.keys(fieldErrors.value).length === 0) {
      errorMessage.value = error.message || "提交失敗";
    }
  } finally {
    submitting.value = false;
  }
}

function detailsToFieldErrors(details) {
  const result = {};

  for (const detail of details) {
    if (detail.location !== "body" || !detail.path) {
      continue;
    }

    const field = detail.path.replace(/^\//, "").replace(/\//g, ".");
    if (!result[field]) {
      result[field] = detail.message;
    }
  }

  return result;
}

defineExpose({ fieldError, resetValidation: () => formRef.value?.resetValidation() });
</script>

<template>
  <q-form ref="formRef" @submit="handleSubmit">
    <q-banner v-if="errorMessage" class="bg-negative text-white q-mb-md">
      {{ errorMessage }}
    </q-banner>

    <slot :field-error="fieldError" :submitting="submitting" />
  </q-form>
</template>
