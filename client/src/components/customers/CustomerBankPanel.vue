<script setup>
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { confirm, promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import customerService from "@/services/customer.js";
import { useSessionStore } from "@/stores/session.js";

const props = defineProps({ customerId: { type: Number, required: true }, canManage: Boolean, canReveal: Boolean });
const session = useSessionStore();
const items = ref([]); const loading = ref(true); const error = ref(""); const errorRef = ref(null);
const editing = ref(false); const editId = ref(null); const saving = ref(false);
const revealed = ref(null); const remaining = ref(0); let countdown = null;
const purposes = [{ label: "一般", value: "general" }, { label: "收款匹配", value: "collection_match" }, { label: "退款", value: "refund" }];
const form = reactive({ accountHolderName: "", bankName: "", bankCountryCode: "", bankCode: "", branchCode: "", swiftBic: "", accountCurrencyCode: "", purposeCode: "general", accountNumber: "", isDefault: false, version: null });

function clearSecret() { clearInterval(countdown); countdown = null; revealed.value = null; remaining.value = 0; }
function clearSensitive() { clearSecret(); form.accountNumber = ""; }
function resetForm() { Object.assign(form, { accountHolderName: "", bankName: "", bankCountryCode: "", bankCode: "", branchCode: "", swiftBic: "", accountCurrencyCode: "", purposeCode: "general", accountNumber: "", isDefault: false, version: null }); }
function start(item = null) {
  clearSecret(); resetForm(); editId.value = item?.id ?? null;
  if (item) Object.assign(form, { accountHolderName: item.accountHolderName, bankName: item.bankName, bankCountryCode: item.bankCountryCode ?? "", bankCode: item.bankCode, branchCode: item.branchCode, swiftBic: item.swiftBic, accountCurrencyCode: item.accountCurrencyCode ?? "", purposeCode: item.purposeCode, isDefault: item.isDefault, version: item.version });
  error.value = ""; editing.value = true;
}
function cancel() { form.accountNumber = ""; editing.value = false; }
async function load() {
  loading.value = true; error.value = "";
  try { items.value = (await customerService.bankAccounts(props.customerId)).items; }
  catch (e) { error.value = e.message || "載入銀行帳戶失敗"; }
  finally { loading.value = false; }
}
function payload(confirmation) {
  return {
    accountHolderName: form.accountHolderName.trim(), bankName: form.bankName.trim(),
    bankCountryCode: form.bankCountryCode.trim().toUpperCase() || undefined,
    bankCode: form.bankCode.trim(), branchCode: form.branchCode.trim(), swiftBic: form.swiftBic.trim().toUpperCase(),
    accountCurrencyCode: form.accountCurrencyCode.trim().toUpperCase() || undefined,
    purposeCode: form.purposeCode, isDefault: form.isDefault,
    ...(form.accountNumber.trim() ? { accountNumber: form.accountNumber } : {}),
    ...(editId.value ? { version: form.version } : {}), ...confirmation
  };
}
async function save() {
  const confirmation = await promptPassword({ title: editId.value ? "修改銀行帳戶" : "新增銀行帳戶", message: "銀行資料屬高敏感資料；操作會寫入安全稽核。", okLabel: "確認儲存", requireReason: true });
  if (!confirmation) return;
  saving.value = true; error.value = "";
  const submit = (body) => editId.value ? customerService.updateBankAccount(props.customerId, editId.value, body) : customerService.createBankAccount(props.customerId, body);
  try {
    let body = payload(confirmation);
    try { await submit(body); }
    catch (e) {
      if (e.code !== "BANK_CROSS_CUSTOMER_CONFIRMATION_REQUIRED" || !e.details?.warningToken || !(await confirm({ title: "確認跨客戶重複銀行帳戶", message: "另一個客戶有疑似相同帳戶。確認這是受控共用帳戶後才可繼續。", okLabel: "確認並儲存" }))) throw e;
      body = { ...body, confirmCrossCustomerDuplicate: true, warningToken: e.details.warningToken };
      await submit(body);
    }
    form.accountNumber = ""; editing.value = false; await load(); notifySuccess("銀行帳戶已儲存");
  } catch (e) {
    error.value = e.code === "VERSION_CONFLICT" ? "銀行帳戶已被其他人修改；輸入仍保留。" : e.message || "儲存銀行帳戶失敗";
    notifyError(error.value); await nextTick(); errorRef.value?.focus();
  } finally { saving.value = false; }
}
async function mutate(item, action) {
  clearSecret();
  const confirmation = await promptPassword({ title: action === "default" ? "設定預設銀行帳戶" : "停用銀行帳戶", message: `${item.bankName} ${item.maskedAccountNumber}`, okLabel: "確認", requireReason: true });
  if (!confirmation) return;
  try {
    const method = action === "default" ? "setDefaultBankAccount" : "deactivateBankAccount";
    await customerService[method](props.customerId, item.id, { version: item.version, ...confirmation });
    await load(); notifySuccess(action === "default" ? "已設定預設銀行帳戶" : "銀行帳戶已停用");
  } catch (e) { error.value = e.message || "銀行帳戶操作失敗"; notifyError(error.value); }
}
async function reveal(item) {
  clearSecret();
  const confirmation = await promptPassword({ title: "查看完整銀行帳號", message: "查看會寫入安全稽核，完整值會在 30 秒後清除。", okLabel: "查看", requireReason: true });
  if (!confirmation) return;
  try {
    const result = await customerService.revealBankAccount(props.customerId, item.id, confirmation);
    revealed.value = { id: item.id, accountNumber: result.accountNumber }; remaining.value = result.expiresInSeconds;
    countdown = setInterval(() => { remaining.value -= 1; if (remaining.value <= 0) clearSecret(); }, 1000);
  } catch (e) { error.value = e.message || "無法查看銀行帳號"; notifyError(error.value); }
}
function onVisibility() { if (document.hidden) clearSensitive(); }
watch(() => [props.canReveal, session.user?.id], ([allowed, userId]) => { if (!allowed || !userId) clearSecret(); });
onMounted(() => { window.addEventListener("pagehide", clearSensitive); document.addEventListener("visibilitychange", onVisibility); load(); });
onBeforeUnmount(() => { clearSensitive(); window.removeEventListener("pagehide", clearSensitive); document.removeEventListener("visibilitychange", onVisibility); });
</script>

<template>
  <section aria-labelledby="customer-bank-heading">
    <div class="row items-center justify-between q-mb-sm"><div><h2 id="customer-bank-heading" class="text-h6 q-my-none">銀行帳戶</h2><p class="text-caption text-grey-8 q-my-xs">完整帳號只在主動查看後短暫顯示，並會留下稽核記錄。</p></div><q-btn v-if="canManage && !editing" color="primary" flat label="新增銀行帳戶" @click="start()" /></div>
    <div v-if="error" ref="errorRef" role="alert" tabindex="-1"><q-banner class="bg-negative text-white q-mb-md">{{ error }}<template #action><q-btn v-if="!editing" flat label="重試" @click="load" /></template></q-banner></div>
    <q-skeleton v-if="loading" type="rect" height="100px" aria-label="載入銀行帳戶" />
    <q-card v-else-if="editing" flat bordered><q-card-section><div class="row q-col-gutter-sm"><div class="col-12 col-md-6"><q-input v-model="form.accountHolderName" outlined dense label="帳戶名稱 *" maxlength="190" /></div><div class="col-12 col-md-6"><q-input v-model="form.bankName" outlined dense label="銀行名稱 *" maxlength="190" /></div><div class="col-12 col-md-6"><q-input v-model="form.accountNumber" outlined dense :label="editId ? '新帳號（留空表示不變）' : '帳號／IBAN *'" autocomplete="off" maxlength="2048" /></div><div class="col-6 col-md-3"><q-input v-model="form.bankCountryCode" outlined dense label="國家／地區" maxlength="2" /></div><div class="col-6 col-md-3"><q-input v-model="form.accountCurrencyCode" outlined dense label="帳戶貨幣" maxlength="3" /></div><div class="col-6 col-md-3"><q-input v-model="form.bankCode" outlined dense label="銀行代碼" maxlength="50" /></div><div class="col-6 col-md-3"><q-input v-model="form.branchCode" outlined dense label="分行代碼" maxlength="50" /></div><div class="col-12 col-md-6"><q-input v-model="form.swiftBic" outlined dense label="SWIFT／BIC" maxlength="11" /></div><div class="col-12 col-md-6"><q-select v-model="form.purposeCode" :options="purposes" emit-value map-options outlined dense label="用途" /></div><div class="col-12"><q-toggle v-model="form.isDefault" label="設為預設銀行帳戶" /></div></div></q-card-section><q-card-actions align="right"><q-btn flat label="取消" @click="cancel" /><q-btn color="primary" label="儲存銀行帳戶" :loading="saving" :disable="!form.accountHolderName.trim() || !form.bankName.trim() || (!editId && !form.accountNumber.trim())" @click="save" /></q-card-actions></q-card>
    <q-banner v-else-if="items.length === 0" class="bg-grey-2">尚未設定銀行帳戶；不影響客戶啟用或銷售下單。</q-banner>
    <q-list v-else bordered separator><q-item v-for="item in items" :key="item.id"><q-item-section><q-item-label>{{ item.bankName }} <q-badge v-if="item.isDefault" color="primary" label="預設" /></q-item-label><q-item-label class="text-body1">{{ revealed?.id === item.id ? revealed.accountNumber : item.maskedAccountNumber }}</q-item-label><q-item-label v-if="revealed?.id === item.id" caption role="status">完整值將於 {{ remaining }} 秒後清除</q-item-label><q-item-label caption>{{ item.accountHolderName }} · {{ item.accountCurrencyCode || '未標示貨幣' }} · {{ purposes.find(({value}) => value === item.purposeCode)?.label }}</q-item-label></q-item-section><q-item-section side><div class="row q-gutter-xs"><q-btn v-if="canReveal" flat dense color="primary" label="查看" :aria-label="`查看 ${item.bankName} 完整帳號`" @click="reveal(item)" /><q-btn v-if="canManage" flat dense label="編輯" :aria-label="`編輯 ${item.bankName} 銀行帳戶`" @click="start(item)" /><q-btn v-if="canManage && !item.isDefault" flat dense label="設為預設" @click="mutate(item, 'default')" /><q-btn v-if="canManage" flat dense color="negative" label="停用" @click="mutate(item, 'deactivate')" /></div></q-item-section></q-item></q-list>
  </section>
</template>
