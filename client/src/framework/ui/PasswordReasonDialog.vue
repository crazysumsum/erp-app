<script setup>
import { ref } from "vue";
import { useDialogPluginComponent } from "quasar";

/**
 * `promptPassword({ requireReason: true })` 背後嗰個對話框——高風險動作要
 * 同時收「原因」同「你的密碼」兩欄，Quasar 內建嘅 `Dialog.create({ prompt })`
 * 淨係支援一欄，所以呢度用 component-based dialog（見
 * https://quasar.dev/quasar-plugins/dialog#invoking-custom-component）。
 *
 * 一個對話框同時做埋確認同收兩個欄位，唔使先彈 confirm() 再彈輸入框——
 * 呢個係 confirm.js 已經定咗嘅規矩（見 promptPassword 嘅註解）。
 */
defineProps({
  title: { type: String, default: "請確認" },
  message: { type: String, default: "" },
  okLabel: { type: String, default: "確認" }
});

defineEmits([...useDialogPluginComponent.emits]);

const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent();

const formRef = ref(null);
const reason = ref("");
const password = ref("");

const reasonRule = (val) =>
  (val.length >= 5 && val.length <= 190) || "請輸入 5–190 字元，講清楚為什麼要做呢個操作";
const passwordRule = (val) => val.length > 0 || "必填";

async function submit() {
  const valid = await formRef.value.validate();
  if (!valid) {
    return;
  }
  onDialogOK({ reason: reason.value, password: password.value });
}
</script>

<template>
  <q-dialog ref="dialogRef" persistent @hide="onDialogHide">
    <q-card style="min-width: 360px">
      <q-card-section>
        <div class="text-h6">{{ title }}</div>
      </q-card-section>

      <q-card-section v-if="message" class="q-pt-none">{{ message }}</q-card-section>

      <q-card-section class="q-pt-none">
        <q-form ref="formRef" class="q-gutter-md" @submit.prevent="submit">
          <q-input
            v-model="reason"
            label="原因"
            filled
            autofocus
            lazy-rules
            :rules="[reasonRule]"
          />
          <q-input
            v-model="password"
            label="你的密碼"
            type="password"
            filled
            lazy-rules
            :rules="[passwordRule]"
          />
        </q-form>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="取消" @click="onDialogCancel" />
        <q-btn unelevated color="negative" :label="okLabel" @click="submit" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
