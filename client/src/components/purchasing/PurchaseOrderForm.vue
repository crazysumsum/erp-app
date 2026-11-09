<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import FormPanel from "@/framework/ui/FormPanel.vue";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import purchasing from "@/services/purchasing.js";
import PurchaseOrderLineEditor from "./PurchaseOrderLineEditor.vue";
import { isZeroPrice, previewLineAmount, previewTotal } from "./purchasingEditorMath.js";

// `commands` 由 Edit／Create 頁（穩定 owner）傳入：Form 會因父頁 loading／error／權限 v-if 卸載，record 唔可以跟 Form 一齊冇咗。
const props = defineProps({ document: { type: Object, default: null }, actor: { type: Object, required: true }, commands: { type: Object, default: null } });
const emit = defineEmits(["saved", "submitted", "reload"]);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const required = (value) => Boolean(value) || "必填";

const form = reactive({}), options = reactive({ suppliers: [], warehouses: [], buyers: [], currencies: [], paymentTerms: [] });
const supplier = ref(null), warehouse = ref(null), buyer = ref(null), address = ref(null), useAddress = ref(true), defaultCurrency = ref("");
const lookupError = ref(""), defaultsError = ref(""), optionsError = ref(""), conflictVersion = ref(null), copied = ref(""), pristine = ref(""), entryCurrency = ref("");
const showSubmit = ref(false), submitError = ref("");
// §7.3：審批開住要揀審批人。讀唔到設定係 null，交返伺服器判斷（PO_APPROVAL_REQUIRED 會再讀）。
const policy = reactive({ loading: false, requireApproval: null, approvers: [], approverId: null, requestNote: "" });
// 冇 owner 傳入（只有直接掛 Form，例如 component test）先自己擁有。
const { save: saveCommand, submit: submitCommand } = props.commands ?? { save: useCommandEvent(), submit: useCommandEvent() };
// Record 綁 actor 同呢張 PO（新單用 new）；document 重新載入唔會清走未確定嘅儲存／提交。
const commandKey = (action) => `${props.actor.id}:${props.document?.id ?? "new"}:${action}`;
// 可見回調只屬於發出嗰次生命週期：換 actor／PO 或者卸載就作廢。
let generation = 0;
// 未確定嘅儲存要顯示返原本送出嘅內容，唔可以畫面係新資料、重試卻送舊 body。
const viewOf = () => ({ form: JSON.parse(JSON.stringify(form)), supplier: supplier.value, warehouse: warehouse.value, buyer: buyer.value, address: address.value,
  useAddress: useAddress.value, entryCurrency: entryCurrency.value });
function restoreView(view) {
  Object.assign(form, view.form);
  supplier.value = view.supplier; warehouse.value = view.warehouse; buyer.value = view.buyer; address.value = view.address;
  useAddress.value = view.useAddress; entryCurrency.value = view.entryCurrency;
}
const touched = new Set(), controllers = {};

function toLine(line) {
  return { key: `line-${line.id}`, id: line.id, skuId: line.skuId, skuCode: line.skuCode, skuName: line.skuName, trackingPolicy: line.trackingPolicy, baseUomCode: line.baseUomCode,
    purchaseSkuUomId: line.purchaseSkuUomId, purchaseUomCode: line.purchaseUomCode, factor: line.uomToBaseFactor, orderedQuantity: line.orderedQuantity, unitPrice: line.unitPrice,
    zeroPriceReason: line.zeroPriceReason ?? "", expectedDeliveryDate: line.expectedDeliveryDate, lineNote: line.lineNote ?? "" };
}
function reset(document) {
  Object.assign(form, { supplierId: document?.supplierId ?? null, orderingAddressId: document?.orderingAddressId ?? null, currencyCode: document?.currencyCode ?? "", paymentTermId: document?.paymentTermId ?? null,
    orderDate: document?.orderDate ?? today(), expectedDeliveryDate: document?.expectedDeliveryDate ?? null, defaultReceivingWarehouseId: document?.defaultReceivingWarehouseId ?? null,
    buyerId: document ? document.buyerId : props.actor.id, supplierReference: document?.supplierReference ?? "", notes: document?.notes ?? "", lines: (document?.lines ?? []).map(toLine) });
  supplier.value = document ? { supplierId: document.supplierId, supplierCode: document.supplierCode, displayName: document.supplierName } : null;
  warehouse.value = document?.defaultReceivingWarehouseId ? { id: document.defaultReceivingWarehouseId, code: document.defaultWarehouseCode, name: "" } : null;
  buyer.value = document ? (document.buyerId ? { id: document.buyerId, label: document.buyerLabel } : null) : { id: props.actor.id, label: props.actor.label };
  address.value = document?.orderingAddressId ? { id: document.orderingAddressId, ...document.orderingAddress } : null;
  useAddress.value = !document || document.orderingAddressId !== null;
  defaultCurrency.value = ""; entryCurrency.value = form.currencyCode; defaultsError.value = ""; conflictVersion.value = null; copied.value = "";
  // 已儲存嘅 Draft：貨幣同條款係之前揀好嘅，換 Supplier 都唔蓋（§7.3）。
  touched.clear();
  if (document) { touched.add("currencyCode"); touched.add("paymentTermId"); }
  pristine.value = JSON.stringify(form);
  const pendingSave = saveCommand.pending(commandKey("save")), pendingSubmit = submitCommand.pending(commandKey("submit"));
  if (pendingSave) restoreView(pendingSave.meta.view);
  if (pendingSubmit) { Object.assign(policy, pendingSubmit.meta.view, { loading: false }); showSubmit.value = true; }
}
watch(() => props.document, reset, { immediate: true });
watch([() => props.actor.id, () => props.document?.id], () => { generation += 1; });

const uncertain = computed(() => saveCommand.isUncertain(commandKey("save")));
const submitUncertain = computed(() => submitCommand.isUncertain(commandKey("submit")));
const stale = computed(() => conflictVersion.value !== null);
const dirty = computed(() => JSON.stringify(form) !== pristine.value);
const saving = computed(() => saveCommand.isBusy(commandKey("save")));
const submitting = computed(() => submitCommand.isBusy(commandKey("submit")));
const busy = computed(() => saving.value || submitting.value);
const unresolved = computed(() => uncertain.value || submitUncertain.value);
function canLeave() { return !busy.value && ((!dirty.value && !unresolved.value) || window.confirm("有未儲存或結果尚未確認的變更，確定離開？")); }
onBeforeRouteLeave(canLeave); onBeforeRouteUpdate(canLeave);
function beforeUnload(event) { if (busy.value || dirty.value || unresolved.value) { event.preventDefault(); event.returnValue = ""; } }
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => { generation += 1; window.removeEventListener("beforeunload", beforeUnload); Object.values(controllers).forEach((controller) => controller.abort()); });

const currency = computed(() => options.currencies.find((row) => row.code === form.currencyCode)
  ?? (props.document?.currencyCode === form.currencyCode ? { code: form.currencyCode, name: props.document.currencyName, decimalPlaces: props.document.currencyDecimalPlaces } : null));
const places = computed(() => currency.value?.decimalPlaces ?? null);
const currencyOptions = computed(() => (currency.value && !options.currencies.includes(currency.value) ? [currency.value, ...options.currencies] : options.currencies));
const paymentTermOptions = computed(() => {
  const saved = props.document?.paymentTerm && { id: props.document.paymentTermId, ...props.document.paymentTerm };
  return saved && !options.paymentTerms.some((row) => row.id === saved.id) ? [saved, ...options.paymentTerms] : options.paymentTerms;
});
const total = computed(() => previewTotal(form.lines.map((line) => previewLineAmount(line.orderedQuantity, line.unitPrice, places.value)), places.value));
const zeroPriceLines = computed(() => form.lines.filter((line) => isZeroPrice(line.unitPrice)).length);
const canSubmit = computed(() => props.document?.allowedActions?.includes("submit") && !dirty.value && !stale.value && !uncertain.value);

function nextSignal(kind) {
  controllers[kind]?.abort();
  controllers[kind] = new AbortController();
  return controllers[kind].signal;
}
async function search(kind, method, q, update) {
  const signal = nextSignal(kind);
  lookupError.value = "";
  try {
    const items = await purchasing[method]({ q, signal });
    if (!signal.aborted) update(() => { options[kind] = items; });
  } catch (error) {
    if (!signal.aborted) { lookupError.value = error.message || "搜尋失敗，請重試"; update(() => {}); }
  }
}
async function loadOptions() {
  const signal = nextSignal("options");
  optionsError.value = "";
  try {
    const [currencies, paymentTerms] = await Promise.all([purchasing.lookupCurrencies({ signal }), purchasing.lookupPaymentTerms({ signal })]);
    Object.assign(options, { currencies, paymentTerms });
  } catch (error) {
    optionsError.value = error.message || "未能載入貨幣及付款條款";
  }
}
onMounted(loadOptions);

function touch(field, value) { touched.add(field); form[field] = value; }
function syncAddress() { form.orderingAddressId = useAddress.value ? address.value?.id ?? null : null; }
/** §7.3：揀 Supplier 帶入預設，但用戶改過嘅唔蓋。地址跟 Supplier，唔可以留住上一個 Supplier 嘅 ID。 */
async function chooseSupplier(value) {
  supplier.value = value;
  form.supplierId = value?.supplierId ?? null;
  address.value = null; defaultCurrency.value = ""; defaultsError.value = "";
  syncAddress();
  if (!value) return;
  const signal = nextSignal("defaults");
  try {
    const defaults = await purchasing.getSupplierDefaults(value.supplierId, { signal });
    if (signal.aborted) return;
    defaultCurrency.value = defaults.currency.code;
    if (!touched.has("currencyCode")) { form.currencyCode = defaults.currency.code; entryCurrency.value = defaults.currency.code; }
    if (!touched.has("paymentTermId")) form.paymentTermId = defaults.paymentTerm?.id ?? null;
    address.value = defaults.orderingAddress;
    syncAddress();
  } catch (error) {
    if (!signal.aborted) defaultsError.value = `${error.message || "未能載入供應商預設值"}；請手動選擇貨幣及付款條款。`;
  }
}
function chooseWarehouse(value) { warehouse.value = value; form.defaultReceivingWarehouseId = value?.id ?? null; }
function chooseBuyer(value) { buyer.value = value; form.buyerId = value?.id ?? null; }

function payload() {
  return { ...(props.document ? { version: props.document.version } : {}), supplierId: form.supplierId, orderingAddressId: form.orderingAddressId, currencyCode: form.currencyCode, paymentTermId: form.paymentTermId,
    orderDate: form.orderDate, expectedDeliveryDate: form.expectedDeliveryDate || null, defaultReceivingWarehouseId: form.defaultReceivingWarehouseId, buyerId: form.buyerId,
    supplierReference: form.supplierReference, notes: form.notes,
    lines: form.lines.map((line) => ({ ...(props.document && line.id ? { id: line.id } : {}), skuId: line.skuId, purchaseSkuUomId: line.purchaseSkuUomId, orderedQuantity: line.orderedQuantity, unitPrice: line.unitPrice,
      ...(isZeroPrice(line.unitPrice) ? { zeroPriceReason: line.zeroPriceReason } : {}), expectedDeliveryDate: line.expectedDeliveryDate || null, lineNote: line.lineNote })) };
}
const send = (body) => (props.document ? purchasing.updatePurchaseOrder(props.document.id, body) : purchasing.createPurchaseOrder(body));
async function save() {
  if (stale.value) throw new Error("資料已被修改；你的輸入仍保留，請載入最新資料。");
  if (!form.lines.length) throw new Error("請新增至少一項明細。");
  const key = commandKey("save"), gen = generation;
  try {
    const result = await saveCommand.run(payload(), send, key, { action: "save", view: viewOf() });
    // 晚到嘅回應：已經換咗 PO／actor 或者離開，就唔再改呢個畫面。
    if (gen !== generation) return result;
    pristine.value = JSON.stringify(form);
    emit("saved", result);
    return result;
  } catch (error) {
    if (gen !== generation) return undefined;
    // 未確定之後嘅 VERSION_CONFLICT 證明唔到原儲存失敗，唔入 stale 路徑，保留重試同一儲存。
    if (error.code === "VERSION_CONFLICT" && !uncertain.value) conflictVersion.value = error.details?.currentVersion ?? props.document?.version ?? 0;
    const safe = new Error(uncertain.value ? "結果尚未確認；保留原提交，請重試確認結果。" : stale.value ? "版本已更改；你的輸入仍保留。" : error.message || "儲存失敗");
    if (!uncertain.value && !stale.value) {
      if (Array.isArray(error.details)) safe.details = error.details;
      else if (error.details?.field) safe.details = [{ location: "body", path: `/${error.details.field.replaceAll(".", "/")}`, message: safe.message }];
    }
    throw safe;
  }
}
function reload() { if (window.confirm("載入最新資料會取代未儲存輸入，確定繼續？")) emit("reload"); }
async function copyInput() {
  try { await navigator.clipboard.writeText(JSON.stringify(payload(), null, 2)); copied.value = "已複製你的輸入。"; }
  catch { copied.value = "未能複製；請手動記下你的輸入。"; }
}
async function loadPolicy() {
  const gen = generation;
  policy.loading = true;
  try {
    const { requireApproval, items } = await purchasing.lookupApprovers();
    if (gen !== generation) return;
    Object.assign(policy, { requireApproval, approvers: items });
    if (!items.some((item) => item.id === policy.approverId)) policy.approverId = null;
  } catch {
    if (gen === generation) Object.assign(policy, { requireApproval: null, approvers: [] });
  } finally { if (gen === generation) policy.loading = false; }
}
function openSubmit() {
  submitError.value = "";
  showSubmit.value = true;
  if (!submitUncertain.value) loadPolicy();
}
const canConfirm = computed(() => !policy.loading && (policy.requireApproval !== true || policy.approverId !== null));
async function submit() {
  submitError.value = "";
  const approval = policy.requireApproval ? { assignedApproverId: policy.approverId, ...(policy.requestNote.trim() ? { requestNote: policy.requestNote.trim() } : {}) } : {};
  const key = commandKey("submit"), id = props.document.id, gen = generation;
  const view = { requireApproval: policy.requireApproval, approvers: policy.approvers, approverId: policy.approverId, requestNote: policy.requestNote };
  try {
    const result = await submitCommand.run({ version: props.document.version, ...approval }, (body) => purchasing.submitPurchaseOrder(id, body), key, { action: "submit", view });
    if (gen !== generation) return;
    showSubmit.value = false;
    emit("submitted", result);
  } catch (error) {
    if (gen !== generation) return;
    if (error.code === "VERSION_CONFLICT" && !submitUncertain.value) { conflictVersion.value = error.details?.currentVersion ?? props.document.version; showSubmit.value = false; return; }
    if (["PO_APPROVAL_REQUIRED", "PO_APPROVER_INVALID"].includes(error.code)) loadPolicy();
    const line = /^lines\.(\d+)\./.exec(error.details?.field ?? "");
    submitError.value = submitUncertain.value ? "結果尚未確認；請重試同一提交以確認結果。" : `${error.message || "提交失敗"}${line ? `（第 ${Number(line[1]) + 1} 行）` : ""}`;
  }
}
</script>

<template>
  <div>
    <q-banner v-if="lookupError" role="alert" class="bg-negative text-white q-mb-md">{{ lookupError }}；請重新搜尋。</q-banner>
    <q-banner v-if="optionsError" role="alert" class="bg-negative text-white q-mb-md">{{ optionsError }}<template #action><q-btn flat label="重試" @click="loadOptions" /></template></q-banner>
    <q-banner v-if="stale" role="alert" class="bg-warning text-dark q-mb-md">資料已被其他人修改（最新版本 {{ conflictVersion }}），你的輸入仍保留。{{ copied }}<template #action><q-btn flat label="複製我的輸入" @click="copyInput" /><q-btn flat label="載入最新資料" @click="reload" /></template></q-banner>
    <q-banner v-if="uncertain" role="status" class="bg-warning text-dark q-mb-md">結果尚未確認；請先重試同一提交以確認結果。</q-banner>
    <FormPanel v-slot="{ submitting: panelSubmitting, fieldError }" :on-submit="save">
      <fieldset class="q-pa-none q-ma-none" :disabled="panelSubmitting || uncertain" :inert="panelSubmitting || uncertain">
        <section aria-labelledby="po-terms-heading">
          <h2 id="po-terms-heading" class="text-h6 q-mt-none q-mb-md">供應商與商業條件</h2>
          <q-banner v-if="defaultsError" role="alert" class="bg-warning text-dark q-mb-md">{{ defaultsError }}</q-banner>
          <div class="row q-col-gutter-md">
            <div class="col-12 col-md-6"><q-select :model-value="supplier" label="供應商 *" :options="options.suppliers" :option-label="row => `${row.supplierCode} — ${row.displayName}`" use-input input-debounce="250" :rules="[required]" :error="!!fieldError('supplierId')" :error-message="fieldError('supplierId')" outlined dense @filter="(q, update) => search('suppliers', 'lookupSuppliers', q, update)" @update:model-value="chooseSupplier"><template #no-option><q-item><q-item-section>沒有符合條件的啟用供應商；請縮小搜尋。</q-item-section></q-item></template></q-select></div>
            <div class="col-12 col-md-3"><q-select :model-value="form.currencyCode" label="貨幣 *" :options="currencyOptions" option-value="code" :option-label="row => `${row.code} — ${row.name}`" emit-value map-options :rules="[required]" :error="!!fieldError('currencyCode')" :error-message="fieldError('currencyCode')" outlined dense @update:model-value="value => touch('currencyCode', value)" /></div>
            <div class="col-12 col-md-3"><q-select :model-value="form.paymentTermId" label="付款條款（選填）" :options="paymentTermOptions" option-value="id" :option-label="row => `${row.code} — ${row.name}`" emit-value map-options clearable :error="!!fieldError('paymentTermId')" :error-message="fieldError('paymentTermId')" outlined dense @update:model-value="value => touch('paymentTermId', value)" /></div>
            <div class="col-12 col-md-6">
              <q-toggle v-model="useAddress" label="使用供應商主要訂購地址" :disable="!address" @update:model-value="syncAddress" />
              <p class="text-caption q-mb-none" data-testid="ordering-address">{{ address ? [address.addressLine1, address.city, address.countryCode].filter(Boolean).join("，") : "此供應商沒有主要訂購地址。" }}</p>
              <p v-if="fieldError('orderingAddressId')" class="text-negative text-caption">{{ fieldError('orderingAddressId') }}</p>
            </div>
            <div class="col-12 col-md-3"><q-input v-model="form.orderDate" label="訂單日期 *" type="date" stack-label :rules="[required]" :error="!!fieldError('orderDate')" :error-message="fieldError('orderDate')" outlined dense /></div>
            <div class="col-12 col-md-3"><q-input v-model="form.expectedDeliveryDate" label="預計交期（選填）" type="date" stack-label :rules="[value => !value || value >= form.orderDate || '交期不可早於訂單日期']" :error="!!fieldError('expectedDeliveryDate')" :error-message="fieldError('expectedDeliveryDate')" outlined dense /></div>
            <div class="col-12 col-md-6"><q-select :model-value="warehouse" label="預設收貨倉庫（選填）" :options="options.warehouses" :option-label="row => row.name ? `${row.code} — ${row.name}` : row.code" use-input clearable input-debounce="250" :error="!!fieldError('defaultReceivingWarehouseId')" :error-message="fieldError('defaultReceivingWarehouseId')" outlined dense @filter="(q, update) => search('warehouses', 'lookupWarehouses', q, update)" @update:model-value="chooseWarehouse"><template #no-option><q-item><q-item-section>沒有符合條件的啟用倉庫。</q-item-section></q-item></template></q-select></div>
            <div class="col-12 col-md-6"><q-select :model-value="buyer" label="採購員 *" :options="options.buyers" option-label="label" use-input input-debounce="250" :rules="[required]" :error="!!fieldError('buyerId')" :error-message="fieldError('buyerId')" outlined dense @filter="(q, update) => search('buyers', 'lookupBuyers', q, update)" @update:model-value="chooseBuyer"><template #no-option><q-item><q-item-section>沒有符合條件的採購員。</q-item-section></q-item></template></q-select></div>
          </div>
          <q-banner v-if="defaultCurrency && form.currencyCode !== defaultCurrency" class="bg-warning text-dark q-mb-md">貨幣與供應商預設（{{ defaultCurrency }}）不同。</q-banner>
          <q-banner v-if="form.lines.length && entryCurrency && form.currencyCode !== entryCurrency" class="bg-warning text-dark q-mb-md">貨幣已更改；單價不自動換算，請檢查每行單價。</q-banner>
        </section>
        <PurchaseOrderLineEditor v-model="form.lines" :currency-code="form.currencyCode" :currency-places="places" :order-date="form.orderDate" :field-error="fieldError" />
        <section aria-labelledby="po-notes-heading">
          <h2 id="po-notes-heading" class="text-h6 q-my-md">備註及參考</h2>
          <div class="row q-col-gutter-md">
            <div class="col-12 col-md-4"><q-input v-model="form.supplierReference" label="供應商參考" maxlength="190" outlined dense /></div>
            <div class="col-12 col-md-8"><q-input v-model="form.notes" label="備註" type="textarea" autogrow maxlength="2000" outlined dense /></div>
          </div>
        </section>
      </fieldset>
      <section class="po-summary" aria-labelledby="po-summary-heading">
        <h2 id="po-summary-heading" class="text-h6 q-my-sm">總額及風險</h2>
        <p class="q-mb-xs">{{ dirty || !document ? "預覽總額" : "已保存總額" }}：<strong data-testid="po-total">{{ form.currencyCode }} {{ dirty || !document ? total ?? "—" : document.totalAmount }}</strong><span v-if="dirty || !document" class="text-caption">（保存後以伺服器計算為準）</span></p>
        <ul v-if="zeroPriceLines || !form.paymentTermId" class="q-my-xs q-pl-md text-caption">
          <li v-if="zeroPriceLines">{{ zeroPriceLines }} 行為零價。</li>
          <li v-if="!form.paymentTermId">未選擇付款條款。</li>
        </ul>
        <q-btn color="primary" type="submit" :label="uncertain ? '重試確認結果' : '儲存草稿'" :loading="panelSubmitting" :disable="stale" />
        <q-btn v-if="document" class="q-ml-sm" outline color="primary" label="提交" :disable="!canSubmit" @click="openSubmit" />
        <span v-if="document && dirty" class="text-caption q-ml-sm">請先儲存變更才可提交。</span>
      </section>
    </FormPanel>
    <q-dialog v-model="showSubmit" :persistent="submitting || submitUncertain">
      <q-card class="po-submit" aria-labelledby="po-submit-heading">
        <q-card-section>
          <h2 id="po-submit-heading" class="text-h6 q-ma-none">提交採購單</h2>
          <q-banner v-if="submitError" role="alert" class="bg-negative text-white q-my-sm">{{ submitError }}</q-banner>
          <dl v-if="document" data-testid="po-submit-summary">
            <dt>供應商</dt><dd>{{ document.supplierCode }} — {{ document.supplierName }}</dd>
            <dt>明細</dt><dd>{{ document.lines.length }} 行</dd>
            <dt>總額</dt><dd>{{ document.currencyCode }} {{ document.totalAmount }}</dd>
            <dt>交期</dt><dd>{{ document.expectedDeliveryDate ?? "未填" }}</dd>
          </dl>
          <ul v-if="zeroPriceLines || !document?.paymentTermId" class="q-pl-md">
            <li v-if="zeroPriceLines">{{ zeroPriceLines }} 行為零價。</li>
            <li v-if="!document?.paymentTermId">未選擇付款條款。</li>
          </ul>
          <q-skeleton v-if="policy.loading" type="text" aria-label="讀取審批設定" />
          <template v-else-if="policy.requireApproval">
            <q-select v-model="policy.approverId" label="審批人 *" :options="policy.approvers" option-value="id" option-label="label" emit-value map-options
              :disable="submitUncertain" :hint="policy.approvers.length ? '' : '沒有可用的審批人；請聯絡管理員授予審批權限。'" outlined dense />
            <q-input v-model="policy.requestNote" label="提交備註（選填）" type="textarea" autogrow maxlength="500" :readonly="submitUncertain" class="q-mt-sm" outlined dense />
            <p class="q-mb-none q-mt-sm">提交後等待審批；批准後才可收貨。</p>
          </template>
          <p v-else-if="policy.requireApproval === false" class="q-mb-none">確認後可收貨。</p>
          <q-banner v-else role="status" class="bg-warning text-dark">未能讀取審批設定；如需要審批，伺服器會拒絕並重新讀取。<template #action><q-btn flat label="重試" @click="loadPolicy" /></template></q-banner>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="返回" :disable="submitting || submitUncertain" />
          <q-btn color="primary" :label="submitUncertain ? '重試確認結果' : policy.requireApproval ? '提交審批' : '確認提交'" :loading="submitting" :disable="!submitUncertain && !canConfirm" @click="submit" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<style scoped>
fieldset { border: 0; min-width: 0; }
.po-summary { position: sticky; bottom: 0; z-index: 1; background: var(--app-bg); padding: .5rem 0; border-top: 1px solid var(--app-border); }
.po-submit { width: 28rem; max-width: 100%; }
dl { display: grid; grid-template-columns: auto 1fr; gap: .25rem .75rem; }
dd { margin: 0; }
</style>
