<script setup>
import { nextTick, reactive, ref } from "vue";
import { confirm } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import supplierService from "@/services/supplier.js";

const props = defineProps({
  supplierId: { type: Number, required: true },
  supplierCode: { type: String, required: true },
  addresses: { type: Array, default: () => [] },
  canManage: { type: Boolean, default: false }
});
const emit = defineEmits(["refresh"]);

const PURPOSES = Object.freeze([
  ["registered", "註冊地址"], ["office", "辦公地址"], ["ordering", "採購地址"],
  ["return", "退貨地址"], ["remittance", "匯款地址"], ["other", "其他"]
]);
const PURPOSE_LABEL = Object.fromEntries(PURPOSES);

const dialogOpen = ref(false);
const submitting = ref(false);
const editing = ref(null);
const errorMessage = ref("");
const errorRef = ref(null);
const form = reactive({
  label: "", addressLine1: "", addressLine2: "", addressLine3: "", city: "", stateRegion: "",
  postalCode: "", countryCode: "", phone: "", notes: "", selectedPurposes: {}, primaryPurposes: {}
});

function resetForm(address = null) {
  editing.value = address;
  errorMessage.value = "";
  Object.assign(form, {
    label: address?.label ?? "", addressLine1: address?.addressLine1 ?? "", addressLine2: address?.addressLine2 ?? "",
    addressLine3: address?.addressLine3 ?? "", city: address?.city ?? "", stateRegion: address?.stateRegion ?? "",
    postalCode: address?.postalCode ?? "", countryCode: address?.countryCode ?? "", phone: address?.phone ?? "",
    notes: address?.notes ?? "",
    selectedPurposes: Object.fromEntries(PURPOSES.map(([code]) => [code, Boolean(address?.purposes.some((purpose) => purpose.purposeCode === code))])),
    primaryPurposes: Object.fromEntries(PURPOSES.map(([code]) => [code, Boolean(address?.purposes.some((purpose) => purpose.purposeCode === code && purpose.isPrimary))]))
  });
}

function openCreate() { resetForm(); dialogOpen.value = true; }
function openEdit(address) { resetForm(address); dialogOpen.value = true; }

function payload() {
  return {
    label: form.label.trim(), addressLine1: form.addressLine1.trim(), addressLine2: form.addressLine2.trim(),
    addressLine3: form.addressLine3.trim(), city: form.city.trim(), stateRegion: form.stateRegion.trim(),
    postalCode: form.postalCode.trim(), countryCode: form.countryCode.trim().toUpperCase() || null,
    phone: form.phone.trim(), notes: form.notes.trim(),
    purposes: PURPOSES.filter(([code]) => form.selectedPurposes[code]).map(([purposeCode]) => ({
      purposeCode, isPrimary: Boolean(form.primaryPurposes[purposeCode])
    }))
  };
}

async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  errorMessage.value = "";
  try {
    const body = payload();
    if (editing.value) await supplierService.updateAddress(props.supplierId, editing.value.id, { ...body, version: editing.value.version });
    else await supplierService.createAddress(props.supplierId, body);
    notifySuccess(`供應商 ${props.supplierCode} 的地址「${body.label}」已${editing.value ? "更新" : "新增"}`);
    dialogOpen.value = false;
    emit("refresh");
  } catch (error) {
    errorMessage.value = error.code === "VERSION_CONFLICT"
      ? "這項地址已被其他人修改。你的輸入仍保留，請重新載入詳情後核對再儲存。"
      : error.message || "儲存地址失敗";
    notifyError(errorMessage.value);
    await nextTick();
    errorRef.value?.focus();
  } finally {
    submitting.value = false;
  }
}

async function deactivate(address) {
  const accepted = await confirm({
    title: "停用地址", message: `停用「${address.label}」？其主要用途標記會一併清除。`, okLabel: "停用"
  });
  if (!accepted) return;
  try {
    await supplierService.deactivateAddress(props.supplierId, address.id, { version: address.version });
    notifySuccess(`供應商 ${props.supplierCode} 的地址「${address.label}」已停用`);
    emit("refresh");
  } catch (error) {
    notifyError(error.message || "停用地址失敗");
  }
}

function purposeText(address) {
  return address.purposes.map((purpose) => `${PURPOSE_LABEL[purpose.purposeCode] ?? purpose.purposeCode}${purpose.isPrimary ? "（主要）" : ""}`).join("、") || "未指定用途";
}
</script>

<template>
  <section aria-labelledby="supplier-addresses-heading">
    <div class="row items-center justify-between q-mb-md">
      <h2 id="supplier-addresses-heading" class="text-h6 q-ma-none">地址</h2>
      <q-btn v-if="canManage" color="primary" flat icon="add" label="新增地址" @click="openCreate" />
    </div>
    <div v-if="!addresses.length" class="text-grey-7">尚未設定地址</div>
    <q-list v-else bordered separator>
      <q-item v-for="address in addresses" :key="address.id">
        <q-item-section>
          <q-item-label>{{ address.label }} <q-badge v-if="address.status === 'inactive'" color="grey" label="已停用" /></q-item-label>
          <q-item-label caption>{{ [address.addressLine1, address.city, address.countryCode].filter(Boolean).join("，") || "未填地址內容" }}</q-item-label>
          <q-item-label caption>{{ purposeText(address) }}</q-item-label>
        </q-item-section>
        <q-item-section v-if="canManage && address.status === 'active'" side top class="row">
          <q-btn flat dense icon="edit" :aria-label="`編輯地址 ${address.label}`" @click="openEdit(address)" />
          <q-btn flat dense color="negative" icon="block" :aria-label="`停用地址 ${address.label}`" @click="deactivate(address)" />
        </q-item-section>
      </q-item>
    </q-list>

    <q-dialog v-model="dialogOpen" persistent>
      <q-card style="width: min(760px, 96vw); max-width: 760px">
        <q-card-section><h3 class="text-h6 q-ma-none">{{ editing ? "編輯地址" : "新增地址" }}</h3></q-card-section>
        <q-card-section class="q-pt-none">
          <div v-if="errorMessage" ref="errorRef" role="alert" tabindex="-1" class="q-mb-md">
            <q-banner class="bg-negative text-white">
              {{ errorMessage }}
              <template v-if="editing" #action><q-btn flat label="重新載入詳情" @click="emit('refresh')" /></template>
            </q-banner>
          </div>
          <div class="row q-col-gutter-md">
            <q-input v-model="form.label" class="col-12 col-sm-6" label="地址標籤 *" outlined dense maxlength="100" />
            <q-input v-model="form.countryCode" class="col-12 col-sm-6" label="國家／地區代碼" outlined dense maxlength="2" />
            <q-input v-model="form.addressLine1" class="col-12" label="地址行 1" outlined dense maxlength="190" />
            <q-input v-model="form.addressLine2" class="col-12" label="地址行 2" outlined dense maxlength="190" />
            <q-input v-model="form.addressLine3" class="col-12" label="地址行 3" outlined dense maxlength="190" />
            <q-input v-model="form.city" class="col-12 col-sm-6" label="城市" outlined dense maxlength="100" />
            <q-input v-model="form.stateRegion" class="col-12 col-sm-6" label="州／地區" outlined dense maxlength="100" />
            <q-input v-model="form.postalCode" class="col-12 col-sm-6" label="郵政編碼" outlined dense maxlength="100" />
            <q-input v-model="form.phone" class="col-12 col-sm-6" label="電話" outlined dense maxlength="50" />
            <q-input v-model="form.notes" class="col-12" label="備註" type="textarea" outlined dense maxlength="500" />
          </div>
          <fieldset class="q-mt-md supplier-purpose-fieldset">
            <legend>地址用途</legend>
            <div v-for="([code, label]) in PURPOSES" :key="code" class="row items-center q-gutter-sm">
              <q-checkbox v-model="form.selectedPurposes[code]" :label="label" @update:model-value="(selected) => { if (!selected) form.primaryPurposes[code] = false; }" />
              <q-toggle v-model="form.primaryPurposes[code]" label="主要" :disable="!form.selectedPurposes[code]" />
            </div>
          </fieldset>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn color="primary" label="儲存" :loading="submitting" :disable="!form.label.trim()" @click="submit" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </section>
</template>

<style scoped>
.supplier-purpose-fieldset { border: 1px solid var(--app-border); border-radius: var(--app-radius); }
</style>
