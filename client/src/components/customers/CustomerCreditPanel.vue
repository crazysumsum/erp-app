<script setup>
import { nextTick, reactive, ref } from "vue";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import customerService from "@/services/customer.js";

const props = defineProps({ customerId: { type: Number, required: true }, policy: { type: Object, required: true }, canManage: Boolean });
const emit = defineEmits(["refresh"]);
const editing = ref(false); const clearing = ref(false); const saving = ref(false); const error = ref("");
const errorRef = ref(null);
const stale = ref(false);
const form = reactive({ creditLimit: null, creditCurrencyCode: null, creditStatus: "normal", creditNotes: null, reason: "", password: "" });

function start(clear = false) {
  Object.assign(form, { creditLimit: props.policy.creditLimit, creditCurrencyCode: props.policy.currencyCode, creditStatus: props.policy.status === "on_hold" ? "on_hold" : "normal", creditNotes: null, reason: "", password: "" });
  clearing.value = clear; error.value = ""; stale.value = false; editing.value = true;
}
async function save() {
  if (saving.value) return;
  saving.value = true; error.value = "";
  try {
    if (clearing.value) await customerService.clearCreditPolicy(props.customerId, { version: props.policy.policyVersion, reason: form.reason.trim(), password: form.password });
    else await customerService.saveCreditPolicy(props.customerId, { creditLimit: form.creditLimit === "" ? null : form.creditLimit, creditCurrencyCode: form.creditLimit === "" || form.creditLimit === null ? null : form.creditCurrencyCode?.trim().toUpperCase(), creditStatus: form.creditStatus, ...(form.creditNotes === null ? {} : { creditNotes: form.creditNotes.trim() }), reason: form.reason.trim(), version: props.policy.policyVersion });
    editing.value = false; emit("refresh"); notifySuccess(clearing.value ? "信用政策已清除" : "信用政策已儲存");
  } catch (e) {
    form.password = "";
    stale.value = e.code === "VERSION_CONFLICT";
    error.value = stale.value ? "信用政策已被其他人修改；輸入仍保留。" : e.message || "更新信用政策失敗";
    notifyError(error.value);
    await nextTick(); errorRef.value?.focus();
  } finally { saving.value = false; }
}
function reload() { editing.value = false; emit("refresh"); }
</script>

<template>
  <section aria-labelledby="customer-credit-heading">
    <div class="row items-center justify-between"><h2 id="customer-credit-heading" class="text-h6">信用政策</h2><div v-if="canManage && !editing"><q-btn flat color="primary" label="設定信用政策" @click="start(false)" /><q-btn v-if="policy.configured" flat color="negative" label="清除信用政策" @click="start(true)" /></div></div>
    <p class="text-caption text-grey-8">Customer 維護權限不代表信用超額、逾期或暫停信用交易的豁免權限。</p>
    <q-banner v-if="!policy.configured && !editing" class="bg-grey-2">未設定信用政策；這不是 0 額度。</q-banner>
    <q-list v-else-if="!editing" bordered><q-item><q-item-section><q-item-label caption>信用額度</q-item-label><q-item-label>{{ policy.creditLimit === null ? '未設定' : `${policy.creditLimit} ${policy.currencyCode}` }}</q-item-label></q-item-section></q-item><q-item><q-item-section><q-item-label caption>狀態</q-item-label><q-item-label>{{ policy.status === 'on_hold' ? '暫停信用' : '正常' }}</q-item-label></q-item-section></q-item></q-list>
    <q-card v-else flat bordered><q-card-section><div v-if="error" ref="errorRef" role="alert" tabindex="-1"><q-banner class="bg-negative text-white q-mb-md">{{ error }}<template v-if="stale" #action><q-btn flat label="載入最新資料" @click="reload" /></template></q-banner></div><template v-if="!clearing"><q-input v-model="form.creditLimit" label="信用額度（留空表示未設定；0 表示不提供信用）" inputmode="decimal" outlined dense class="q-mb-sm" /><q-input v-model="form.creditCurrencyCode" label="信用貨幣" maxlength="3" outlined dense class="q-mb-sm" /><q-select v-model="form.creditStatus" :options="[{label:'正常',value:'normal'},{label:'暫停信用',value:'on_hold'}]" emit-value map-options label="信用狀態" outlined dense class="q-mb-sm" /><q-input v-model="form.creditNotes" label="新信用備註（留空保留既有備註）" type="textarea" outlined dense class="q-mb-sm" /></template><q-banner v-else class="bg-warning text-dark q-mb-md">清除後回復為「未設定」，不等同 0 額度。</q-banner><q-input v-model="form.reason" label="修改原因 *" outlined dense class="q-mb-sm" /><q-input v-if="clearing" v-model="form.password" label="密碼 *" type="password" outlined dense /></q-card-section><q-card-actions align="right"><q-btn flat label="取消" @click="editing = false" /><q-btn :color="clearing ? 'negative' : 'primary'" :label="clearing ? '確認清除' : '儲存信用政策'" :loading="saving" :disable="stale || form.reason.trim().length < 5 || (clearing ? !form.password : (form.creditLimit !== null && form.creditLimit !== '' && !form.creditCurrencyCode))" @click="save" /></q-card-actions></q-card>
  </section>
</template>
