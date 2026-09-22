<script setup>
import { nextTick, reactive, ref } from "vue";
import { confirm } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import customerService from "@/services/customer.js";

const props = defineProps({ customerId: { type: Number, required: true }, identifiers: { type: Array, default: () => [] }, canManage: Boolean });
const emit = defineEmits(["refresh"]);
const TYPES = [{ label: "公司註冊", value: "company_registration" }, { label: "商業登記", value: "business_registration" }, { label: "稅務", value: "tax" }, { label: "其他", value: "other" }];
const open = ref(false); const editing = ref(null); const saving = ref(false); const error = ref("");
const errorRef = ref(null);
const stale = ref(false);
const form = reactive({ identifierType: null, issuerCountryCode: "", identifierValue: "", validFrom: null, expiresAt: null, notes: "", reason: "" });
const toDate = (value) => value === null ? "" : new Date(value).toISOString().slice(0, 10);
const toEpoch = (value) => value ? new Date(`${value}T00:00:00Z`).getTime() : null;

function reset(item = null) { editing.value = item; error.value = ""; stale.value = false; Object.assign(form, { identifierType: item?.identifierType ?? null, issuerCountryCode: item?.issuerCountryCode ?? "", identifierValue: item?.identifierValue ?? "", validFrom: toDate(item?.validFrom ?? null), expiresAt: toDate(item?.expiresAt ?? null), notes: item?.notes ?? "", reason: "" }); open.value = true; }
function body() { return { identifierType: form.identifierType, issuerCountryCode: form.issuerCountryCode.trim().toUpperCase(), identifierValue: form.identifierValue.trim(), validFrom: toEpoch(form.validFrom), expiresAt: toEpoch(form.expiresAt), notes: form.notes.trim() }; }
async function save() {
  if (saving.value) return; saving.value = true; error.value = "";
  try { const payload = body(); if (editing.value) await customerService.updateIdentifier(props.customerId, editing.value.id, { ...payload, version: editing.value.version, reason: form.reason.trim() }); else await customerService.createIdentifier(props.customerId, payload); open.value = false; emit("refresh"); notifySuccess("識別資料已儲存"); }
  catch (e) { stale.value = e.code === "VERSION_CONFLICT"; error.value = stale.value ? "識別資料已被其他人修改；輸入仍保留。" : e.message || "儲存識別資料失敗"; notifyError(error.value); await nextTick(); errorRef.value?.focus(); }
  finally { saving.value = false; }
}
async function deactivate(item) {
  if (!await confirm({ title: "停用識別資料", message: `確定停用「${item.identifierValue}」？識別號碼仍保留且不可重用。`, okLabel: "停用" })) return;
  try { await customerService.deactivateIdentifier(props.customerId, item.id, { version: item.version, reason: "停用客戶識別資料" }); emit("refresh"); notifySuccess("識別資料已停用"); }
  catch (e) { notifyError(e.message || "停用識別資料失敗"); }
}
function reload() { open.value = false; emit("refresh"); }
</script>

<template>
  <section aria-labelledby="customer-identifiers-heading">
    <div class="row items-center justify-between"><h2 id="customer-identifiers-heading" class="text-h6">識別資料</h2><q-btn v-if="canManage" flat color="primary" label="新增識別資料" @click="reset()" /></div>
    <div v-if="!identifiers.length" class="text-grey-7">尚未設定識別資料</div>
    <q-list v-else bordered separator><q-item v-for="item in identifiers" :key="item.id"><q-item-section><q-item-label>{{ item.identifierType }}／{{ item.issuerCountryCode }} <q-badge v-if="item.status === 'inactive'" color="grey" label="已停用" /></q-item-label><q-item-label caption>{{ item.identifierValue }}</q-item-label></q-item-section><q-item-section v-if="canManage && item.status === 'active'" side><q-btn flat dense icon="edit" :aria-label="`編輯識別資料 ${item.identifierValue}`" @click="reset(item)" /><q-btn flat dense color="negative" icon="block" :aria-label="`停用識別資料 ${item.identifierValue}`" @click="deactivate(item)" /></q-item-section></q-item></q-list>
    <q-dialog v-model="open" persistent><q-card style="width:min(680px,96vw)"><q-card-section><h3 class="text-h6 q-ma-none">{{ editing ? '編輯識別資料' : '新增識別資料' }}</h3></q-card-section><q-card-section><div v-if="error" ref="errorRef" role="alert" tabindex="-1"><q-banner class="bg-negative text-white q-mb-md">{{ error }}<template v-if="stale" #action><q-btn flat label="載入最新資料" @click="reload" /></template></q-banner></div><q-select v-model="form.identifierType" autofocus :options="TYPES" emit-value map-options label="類型 *" outlined dense class="q-mb-sm" /><q-input v-model="form.issuerCountryCode" label="簽發國家／地區 *" maxlength="2" outlined dense class="q-mb-sm" /><q-input v-model="form.identifierValue" label="識別號碼 *" outlined dense class="q-mb-sm" /><div class="row q-col-gutter-sm"><q-input v-model="form.validFrom" class="col-12 col-sm-6" label="生效日期" type="date" outlined dense /><q-input v-model="form.expiresAt" class="col-12 col-sm-6" label="到期日期" type="date" outlined dense /></div><q-input v-model="form.notes" label="備註" outlined dense class="q-mt-sm" /><q-input v-if="editing" v-model="form.reason" label="修改原因 *" outlined dense class="q-mt-sm" /></q-card-section><q-card-actions align="right"><q-btn flat label="取消" v-close-popup /><q-btn color="primary" label="儲存識別資料" :loading="saving" :disable="stale || !form.identifierType || form.issuerCountryCode.trim().length !== 2 || !form.identifierValue.trim() || (editing && form.reason.trim().length < 5)" @click="save" /></q-card-actions></q-card></q-dialog>
  </section>
</template>
