<script setup>
import { nextTick, onBeforeUnmount, ref, useId } from "vue";

const dialog = ref(null);
const heading = useId();
const description = useId();
const options = ref(null);
const reason = ref("");
let resolveAnswer;

async function ask(value) {
  if (resolveAnswer) return value.reason ? null : false;
  options.value = value;
  reason.value = "";
  const answer = new Promise((resolve) => { resolveAnswer = resolve; });
  await nextTick();
  if (dialog.value) dialog.value.showModal();
  return answer;
}

function complete() {
  const accepted = dialog.value.returnValue === "confirm";
  dialog.value.returnValue = "";
  resolveAnswer?.(options.value.reason ? (accepted ? reason.value.trim() : null) : accepted);
  resolveAnswer = null;
}

onBeforeUnmount(() => resolveAnswer?.(options.value?.reason ? null : false));
defineExpose({ ask });
</script>

<template>
  <dialog ref="dialog" class="ap-dialog" :aria-labelledby="heading" :aria-describedby="description" @close="complete">
    <form v-if="options" method="dialog">
      <h1 :id="heading" class="text-h6 q-mt-none">{{ options.title }}</h1>
      <p :id="description">{{ options.message }}</p>
      <label v-if="options.reason" class="column q-mb-md">
        作廢原因（最少 5 字）
        <textarea v-model="reason" name="reason" rows="3" minlength="5" maxlength="500" required />
      </label>
      <div class="row justify-end q-gutter-sm">
        <button type="submit" value="cancel" formnovalidate autofocus class="q-btn q-btn--flat q-px-md q-py-sm">返回</button>
        <button type="submit" value="confirm" class="q-btn bg-primary text-white q-px-md q-py-sm">{{ options.okLabel }}</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.ap-dialog { border: 0; border-radius: 4px; padding: 1.25rem; max-inline-size: min(28rem, calc(100vw - 2rem)); color: inherit; }
.ap-dialog:modal { overscroll-behavior: contain; }
.ap-dialog::backdrop { background: rgb(0 0 0 / 48%); overflow: hidden; overscroll-behavior: contain; }
textarea { font: inherit; }
</style>
