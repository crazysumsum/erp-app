<script setup>
import { nextTick, reactive, ref } from "vue";
import { confirm } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import customerService from "@/services/customer.js";

const props = defineProps({ customerId: { type: Number, required: true }, addresses: { type: Array, default: () => [] }, canManage: Boolean });
const emit = defineEmits(["refresh"]);
const PURPOSES = [["billing", "帳單"], ["shipping", "送貨"], ["registered", "註冊"], ["office", "辦公"], ["returns", "退貨"], ["other", "其他"]];
const PURPOSE_LABEL = Object.fromEntries(PURPOSES);
const open = ref(false); const editing = ref(null); const saving = ref(false); const error = ref("");
const errorRef = ref(null);
const stale = ref(false);
const form = reactive({ label: "", recipientCompanyDepartment: "", addressLine1: "", addressLine2: "", addressLine3: "", city: "", stateRegion: "", postalCode: "", countryCode: "", phone: "", notes: "", sortOrder: 0, reason: "", selected: {}, defaults: {} });

function reset(address = null) {
  editing.value = address; error.value = ""; stale.value = false;
  Object.assign(form, { label: address?.label ?? "", recipientCompanyDepartment: address?.recipientCompanyDepartment ?? "", addressLine1: address?.addressLine1 ?? "", addressLine2: address?.addressLine2 ?? "", addressLine3: address?.addressLine3 ?? "", city: address?.city ?? "", stateRegion: address?.stateRegion ?? "", postalCode: address?.postalCode ?? "", countryCode: address?.countryCode ?? "", phone: address?.phone ?? "", notes: address?.notes ?? "", sortOrder: address?.sortOrder ?? 0, reason: "", selected: Object.fromEntries(PURPOSES.map(([code]) => [code, Boolean(address?.purposes.some((p) => p.code === code))])), defaults: Object.fromEntries(PURPOSES.map(([code]) => [code, Boolean(address?.purposes.some((p) => p.code === code && p.isDefault))])) });
  open.value = true;
}
function body() { return { label: form.label.trim(), recipientCompanyDepartment: form.recipientCompanyDepartment.trim(), addressLine1: form.addressLine1.trim(), addressLine2: form.addressLine2.trim(), addressLine3: form.addressLine3.trim(), city: form.city.trim(), stateRegion: form.stateRegion.trim(), postalCode: form.postalCode.trim(), countryCode: form.countryCode.trim().toUpperCase() || null, phone: form.phone.trim(), notes: form.notes.trim(), sortOrder: Number(form.sortOrder) || 0, purposes: PURPOSES.filter(([code]) => form.selected[code]).map(([code]) => ({ code, isDefault: Boolean(form.defaults[code]) })) }; }
async function save() {
  if (saving.value) return; saving.value = true; error.value = "";
  try { const payload = body(); if (editing.value) await customerService.updateAddress(props.customerId, editing.value.id, { ...payload, version: editing.value.version, reason: form.reason.trim() }); else await customerService.createAddress(props.customerId, payload); open.value = false; emit("refresh"); notifySuccess("地址已儲存"); }
  catch (e) { stale.value = e.code === "VERSION_CONFLICT"; error.value = stale.value ? "地址已被其他人修改；輸入仍保留，請重新載入後再儲存。" : e.message || "儲存地址失敗"; notifyError(error.value); await nextTick(); errorRef.value?.focus(); }
  finally { saving.value = false; }
}
async function deactivate(address) {
  if (!await confirm({ title: "停用地址", message: `確定停用「${address.label}」？`, okLabel: "停用" })) return;
  try { await customerService.deactivateAddress(props.customerId, address.id, { version: address.version, reason: "停用客戶地址" }); emit("refresh"); notifySuccess("地址已停用"); }
  catch (e) { notifyError(e.message || "停用地址失敗"); }
}
function purposeText(address) { return address.purposes.map((purpose) => `${PURPOSE_LABEL[purpose.code] ?? purpose.code}${purpose.isDefault ? "（預設）" : ""}`).join("、") || "未指定用途"; }
function reload() { open.value = false; emit("refresh"); }
</script>

<template>
  <section aria-labelledby="customer-addresses-heading">
    <div class="row items-center justify-between"><h2 id="customer-addresses-heading" class="text-h6">地址</h2><q-btn v-if="canManage" flat color="primary" label="新增地址" @click="reset()" /></div>
    <div v-if="!addresses.length" class="text-grey-7">尚未設定地址</div>
    <q-list v-else bordered separator><q-item v-for="address in addresses" :key="address.id"><q-item-section><q-item-label>{{ address.label }} <q-badge v-if="address.status === 'inactive'" color="grey" label="已停用" /></q-item-label><q-item-label caption>{{ [address.addressLine1, address.city, address.countryCode].filter(Boolean).join('，') }}</q-item-label><q-item-label caption>{{ purposeText(address) }}</q-item-label></q-item-section><q-item-section v-if="canManage && address.status === 'active'" side><q-btn flat dense icon="edit" :aria-label="`編輯地址 ${address.label}`" @click="reset(address)" /><q-btn flat dense color="negative" icon="block" :aria-label="`停用地址 ${address.label}`" @click="deactivate(address)" /></q-item-section></q-item></q-list>
    <q-dialog v-model="open" persistent><q-card style="width:min(760px,96vw)"><q-card-section><h3 class="text-h6 q-ma-none">{{ editing ? '編輯地址' : '新增地址' }}</h3></q-card-section><q-card-section><div v-if="error" ref="errorRef" role="alert" tabindex="-1"><q-banner class="bg-negative text-white q-mb-md">{{ error }}<template v-if="stale" #action><q-btn flat label="載入最新資料" @click="reload" /></template></q-banner></div><div class="row q-col-gutter-sm"><q-input v-model="form.label" autofocus class="col-12 col-sm-6" label="地址標籤 *" outlined dense /><q-input v-model="form.recipientCompanyDepartment" class="col-12 col-sm-6" label="收件公司／部門" outlined dense /><q-input v-model="form.addressLine1" class="col-12" label="地址行 1 *" outlined dense /><q-input v-model="form.addressLine2" class="col-12" label="地址行 2" outlined dense /><q-input v-model="form.addressLine3" class="col-12" label="地址行 3" outlined dense /><q-input v-model="form.city" class="col-12 col-sm-6" label="城市" outlined dense /><q-input v-model="form.stateRegion" class="col-12 col-sm-6" label="州／地區" outlined dense /><q-input v-model="form.postalCode" class="col-12 col-sm-6" label="郵政編碼" outlined dense /><q-input v-model="form.countryCode" class="col-12 col-sm-6" label="國家／地區代碼" maxlength="2" outlined dense /><q-input v-model="form.phone" class="col-12 col-sm-6" label="電話" outlined dense /><q-input v-model.number="form.sortOrder" class="col-12 col-sm-6" label="排序" type="number" min="0" outlined dense /></div><fieldset class="q-mt-md"><legend>用途與預設</legend><div v-for="([code,label]) in PURPOSES" :key="code" class="row items-center"><q-checkbox v-model="form.selected[code]" :label="label" @update:model-value="(value) => { if (!value) form.defaults[code] = false; }" /><q-toggle v-model="form.defaults[code]" label="預設" :disable="!form.selected[code]" /></div></fieldset><q-input v-model="form.notes" label="備註" type="textarea" outlined dense class="q-mt-sm" /><q-input v-if="editing" v-model="form.reason" label="修改原因 *" outlined dense class="q-mt-sm" /></q-card-section><q-card-actions align="right"><q-btn flat label="取消" v-close-popup /><q-btn color="primary" label="儲存地址" :loading="saving" :disable="stale || !form.label.trim() || !form.addressLine1.trim() || (editing && form.reason.trim().length < 5)" @click="save" /></q-card-actions></q-card></q-dialog>
  </section>
</template>
