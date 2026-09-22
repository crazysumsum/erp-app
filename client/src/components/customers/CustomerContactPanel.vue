<script setup>
import { nextTick, reactive, ref } from "vue";
import { confirm } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import customerService from "@/services/customer.js";

const props = defineProps({ customerId: { type: Number, required: true }, contacts: { type: Array, default: () => [] }, canManage: Boolean });
const emit = defineEmits(["refresh"]);
const PURPOSES = [["general", "一般"], ["ordering", "訂單"], ["shipping", "送貨"], ["billing_ar", "帳單／應收"], ["returns", "退貨"], ["other", "其他"]];
const PURPOSE_LABEL = Object.fromEntries(PURPOSES);
const open = ref(false); const editing = ref(null); const saving = ref(false); const error = ref("");
const errorRef = ref(null);
const stale = ref(false);
const form = reactive({ name: "", jobTitle: "", department: "", email: "", phone: "", mobile: "", preferredLanguage: "", notes: "", sortOrder: 0, reason: "", selected: {}, defaults: {} });

function reset(contact = null) {
  editing.value = contact; error.value = ""; stale.value = false;
  Object.assign(form, { name: contact?.name ?? "", jobTitle: contact?.jobTitle ?? "", department: contact?.department ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "", mobile: contact?.mobile ?? "", preferredLanguage: contact?.preferredLanguage ?? "", notes: contact?.notes ?? "", sortOrder: contact?.sortOrder ?? 0, reason: "", selected: Object.fromEntries(PURPOSES.map(([code]) => [code, Boolean(contact?.purposes.some((p) => p.code === code))])), defaults: Object.fromEntries(PURPOSES.map(([code]) => [code, Boolean(contact?.purposes.some((p) => p.code === code && p.isDefault))])) });
  open.value = true;
}
function body() { return { name: form.name.trim(), jobTitle: form.jobTitle.trim(), department: form.department.trim(), email: form.email.trim(), phone: form.phone.trim(), mobile: form.mobile.trim(), preferredLanguage: form.preferredLanguage.trim(), notes: form.notes.trim(), sortOrder: Number(form.sortOrder) || 0, purposes: PURPOSES.filter(([code]) => form.selected[code]).map(([code]) => ({ code, isDefault: Boolean(form.defaults[code]) })) }; }
async function save() {
  if (saving.value) return; saving.value = true; error.value = "";
  try { const payload = body(); if (editing.value) await customerService.updateContact(props.customerId, editing.value.id, { ...payload, version: editing.value.version, reason: form.reason.trim() }); else await customerService.createContact(props.customerId, payload); open.value = false; emit("refresh"); notifySuccess("聯絡人已儲存"); }
  catch (e) { stale.value = e.code === "VERSION_CONFLICT"; error.value = stale.value ? "聯絡人已被其他人修改；輸入仍保留。" : e.message || "儲存聯絡人失敗"; notifyError(error.value); await nextTick(); errorRef.value?.focus(); }
  finally { saving.value = false; }
}
async function deactivate(contact) {
  if (!await confirm({ title: "停用聯絡人", message: `確定停用「${contact.name}」？`, okLabel: "停用" })) return;
  try { await customerService.deactivateContact(props.customerId, contact.id, { version: contact.version, reason: "停用客戶聯絡人" }); emit("refresh"); notifySuccess("聯絡人已停用"); }
  catch (e) { notifyError(e.message || "停用聯絡人失敗"); }
}
function purposeText(contact) { return contact.purposes.map((purpose) => `${PURPOSE_LABEL[purpose.code] ?? purpose.code}${purpose.isDefault ? "（預設）" : ""}`).join("、") || "未指定用途"; }
function reload() { open.value = false; emit("refresh"); }
</script>

<template>
  <section aria-labelledby="customer-contacts-heading">
    <div class="row items-center justify-between"><h2 id="customer-contacts-heading" class="text-h6">聯絡人</h2><q-btn v-if="canManage" flat color="primary" label="新增聯絡人" @click="reset()" /></div>
    <div v-if="!contacts.length" class="text-grey-7">尚未設定聯絡人</div>
    <q-list v-else bordered separator><q-item v-for="contact in contacts" :key="contact.id"><q-item-section><q-item-label>{{ contact.name }} <q-badge v-if="contact.status === 'inactive'" color="grey" label="已停用" /></q-item-label><q-item-label caption>{{ [contact.jobTitle, contact.email, contact.phone || contact.mobile].filter(Boolean).join('／') }}</q-item-label><q-item-label caption>{{ purposeText(contact) }}</q-item-label></q-item-section><q-item-section v-if="canManage && contact.status === 'active'" side><q-btn flat dense icon="edit" :aria-label="`編輯聯絡人 ${contact.name}`" @click="reset(contact)" /><q-btn flat dense color="negative" icon="block" :aria-label="`停用聯絡人 ${contact.name}`" @click="deactivate(contact)" /></q-item-section></q-item></q-list>
    <q-dialog v-model="open" persistent><q-card style="width:min(760px,96vw)"><q-card-section><h3 class="text-h6 q-ma-none">{{ editing ? '編輯聯絡人' : '新增聯絡人' }}</h3></q-card-section><q-card-section><div v-if="error" ref="errorRef" role="alert" tabindex="-1"><q-banner class="bg-negative text-white q-mb-md">{{ error }}<template v-if="stale" #action><q-btn flat label="載入最新資料" @click="reload" /></template></q-banner></div><div class="row q-col-gutter-sm"><q-input v-model="form.name" autofocus class="col-12 col-sm-6" label="姓名 *" outlined dense /><q-input v-model="form.jobTitle" class="col-12 col-sm-6" label="職稱" outlined dense /><q-input v-model="form.department" class="col-12 col-sm-6" label="部門" outlined dense /><q-input v-model="form.email" class="col-12 col-sm-6" label="電郵" type="email" outlined dense /><q-input v-model="form.phone" class="col-12 col-sm-6" label="電話" outlined dense /><q-input v-model="form.mobile" class="col-12 col-sm-6" label="手機" outlined dense /><q-input v-model="form.preferredLanguage" class="col-12 col-sm-6" label="偏好語言" outlined dense /><q-input v-model.number="form.sortOrder" class="col-12 col-sm-6" label="排序" type="number" min="0" outlined dense /><q-input v-model="form.notes" class="col-12" label="備註" type="textarea" outlined dense /></div><fieldset class="q-mt-md"><legend>用途與預設</legend><div v-for="([code,label]) in PURPOSES" :key="code" class="row items-center"><q-checkbox v-model="form.selected[code]" :label="label" @update:model-value="(value) => { if (!value) form.defaults[code] = false; }" /><q-toggle v-model="form.defaults[code]" label="預設" :disable="!form.selected[code]" /></div></fieldset><q-input v-if="editing" v-model="form.reason" label="修改原因 *" outlined dense class="q-mt-sm" /></q-card-section><q-card-actions align="right"><q-btn flat label="取消" v-close-popup /><q-btn color="primary" label="儲存聯絡人" :loading="saving" :disable="stale || !form.name.trim() || (editing && form.reason.trim().length < 5)" @click="save" /></q-card-actions></q-card></q-dialog>
  </section>
</template>
