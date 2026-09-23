<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { can } from "@/framework/authorization/can.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import supplierBankService from "@/services/supplierBank.js";
import { useSessionStore } from "@/stores/session.js";

/**
 * Bank panel。設計 §7.5、FR-BANK-001～007、AC-023～AC-026。
 *
 * ## 明文住喺邊
 *
 * 帳號明文淨係住喺呢個 component 兩個 local ref 度：`revealed.accountNumber`（睇）
 * 同 `form.accountNumber`（寫）。**冇**入 Pinia、冇入 localStorage／sessionStorage、
 * 冇入 URL、冇入 toast、冇入驗證訊息。清除有五個觸發點，全部指向同一個
 * `forgetPlaintext()`：手動收起、30 秒到、unmount、route change、session 失效。
 *
 * 展開用 `v-if` 而唔係 `v-show`：`v-show` 會留返個節點喺 DOM 度（`display: none`），
 * 即係明文仲喺頁面入面，一個 devtools、一個 screen reader、一個 `innerHTML` 都攞得返。
 *
 * ## 30 秒係客戶端嘅數
 *
 * 伺服器 reveal 回 `{ id, accountNumber, revealedAt }`，**冇** `expiresInSeconds`：
 * 佢冇任何 server-side 狀態同一個到期時間對應（ledger 嘅 DEV-T34-EXPIRES-IN），
 * 所以一個伺服器俾嘅數字會係一句講緊一件冇發生過嘅事嘅說話。幾時清係呢度嘅責任。
 */
const props = defineProps({
  supplierId: { type: Number, required: true },
  supplierCode: { type: String, required: true }
});
const emit = defineEmits(["refresh"]);

const REVEAL_SECONDS = 30;
const session = useSessionStore();
// AC-023：遮罩清單得 supplier.view；bank.view 只係多咗 reveal，唔係自動明文。
const canReveal = computed(() => can(session, { permissions: ["supplier.view", "supplier.bank.view"] }));
// 設計 §6.6：寫入要三個一齊有，同 route policy 一樣。
const canManage = computed(() => can(session, {
  permissions: ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"]
}));

const rows = ref([]);
const loading = ref(true);
const loadError = ref("");

// 明文。`remaining` 係俾倒數顯示用。
const revealed = reactive({ id: null, accountNumber: "", remaining: 0 });
let countdown = null;
// 喺 `forgetPlaintext()` **之前**宣告：佢讀寫呢個變數，而 `let` 唔會 hoist 到可以讀。
// 今日安全（冇 watcher 係 immediate、setup 期間冇人叫呢啲 function），但一個
// `{ immediate: true }` 就會令一個安全控制喺 mount 嗰陣掟 TDZ ReferenceError。
// REV-046 I-1、REV-047 §6.5、REV-048 I-1 —— 問咗三次，而家做。
let revealGeneration = 0;

/**
 * 每次「唔好再攞住明文」都行呢度，而佢會**撳大 generation**。
 *
 * 點解要個 counter 而唔係逐個 guard 加 flag：`reveal` 係 async，所以一個 in-flight
 * 嘅請求可以喺任何一個清除觸發點之後先 resolve，然後把明文放返出嚟。REV-045 F-H1
 * 就係咁 —— 我上一輪加咗個 `gone` flag，但佢淨係喺 `onUnmounted` set，而
 * `onBeforeRouteUpdate` 同 session watch 都唔會 set 佢，所以由 7 號去 8 號嗰陣，
 * 一個仲喺路上嘅 reveal 會把 7 號嘅帳號**畫返出嚟**喺 8 號嘅畫面度，仲附送一個新
 * 嘅 30 秒倒數。
 *
 * 一個 generation counter 收嘅係成類問題而唔係嗰一個 instance：所有觸發點本來就
 * 已經全部經過呢度，所以將來加多個觸發點都唔使記得去 set 多個 flag。
 */
function forgetPlaintext() {
  revealGeneration += 1;
  if (countdown) { clearInterval(countdown); countdown = null; }
  revealed.id = null;
  revealed.accountNumber = "";
  revealed.remaining = 0;
}

/**
 * 連埋寫入 form 一齊清。Route change 同 session 失效要用呢個，唔係淨係
 * `forgetPlaintext()` —— 一個開住嘅新增／編輯 dialog 入面，`form.accountNumber`
 * 同 `form.password` 一樣係使用者打落去嘅明文，而佢哋會喺新嗰個 URL 底下繼續
 * render。（REV-045 F-M1：我上一版個註解講咗五個觸發點全部覆蓋呢兩個欄位，
 * 但實情係route change 同 session 失效兩個都冇掂過佢哋。）
 */
/**
 * 下面個 `forgetFormSecrets()` 係 route change 同 session 失效嗰陣**唯一一個同步**
 * 清除 —— 佢唔係冗餘。
 *
 * 之前呢度（同實作報告三處）寫住佢同 dialog 個 `@hide` 係兩個互相覆蓋嘅機制，
 * 所以單獨拆一個捉唔到。**實測係相反**：單獨拆呢個 call → **紅**；單獨拆
 * `@hide` → 綠。原因係 `@hide` 要等 Quasar 個 leave transition 行完先至觸發
 * （約 400ms），而 `forgetEverything()` 一設 `open = false` 就返咗，中間嗰段時間
 * 兩個祕密仲喺 component state 度。（REV-050 F-L2）
 *
 * `openCreate()` 每次開嗰陣亦都會重設 —— 但佢只覆蓋「下次再開」，唔覆蓋「而家
 * 即刻唔記得」，所以佢唔係呢條路上面嘅防線。
 */
function forgetEverything() {
  forgetPlaintext();
  forgetFormSecrets();
  form.open = false;
  revealDialog.open = false;
  revealDialog.password = "";
  confirm.open = false;
  confirm.password = "";
}

function holdPlaintext(id, accountNumber) {
  forgetPlaintext();
  revealed.id = id;
  revealed.accountNumber = accountNumber;
  // 用 deadline 而唔係數 tick：背景 tab 嘅 setInterval 會被瀏覽器節流到幾秒一次，
  // 咁樣「30 個 tick」可以係真實世界幾分鐘。
  //
  // 用 `performance.now()` 而唔係 `Date.now()`：前者係單調嘅，後者跟系統時鐘。
  // 系統時鐘可以向後跳（NTP 校正、使用者改時間、VM 由 snapshot 醒返），而
  // `Date.now()` 一向後跳，`deadline - now` 就會變返一個好大嘅正數 —— 個明文會
  // 一直攞住，而個介面會顯示「3629 秒後自動隱藏」。（REV-045 F-L1）
  //
  // **冇** `?? Date.now()` fallback：嗰個 fallback 嘅內容就係上面啱啱拒絕咗兩次
  // 嗰個行為，即係一個「喺最需要佢嗰陣退化返做壞版本」嘅後備。`performance.now`
  // 由 IE10 起每個瀏覽器都有，而如果真係冇，寧願即刻爆 —— 一個爆咗嘅倒數睇得見，
  // 一個靜靜雞用緊系統時鐘嘅倒數睇唔見。（REV-046）
  const clock = () => performance.now();
  const deadline = clock() + REVEAL_SECONDS * 1000;
  const tick = () => {
    const left = Math.ceil((deadline - clock()) / 1000);
    // 唔再 clamp：個 clamp 唯一嘅作用係喺個倒數卡住嗰陣，用一個安詳嘅「30 秒」
    // 遮住佢。而家個鐘係單調嘅，`left` 本來就唔會大過 REVEAL_SECONDS，所以一個
    // 大過佢嘅數字係一個真訊號，唔應該收埋。（REV-046）
    if (left <= 0) forgetPlaintext();
    else revealed.remaining = left;
  };
  revealed.remaining = REVEAL_SECONDS;
  countdown = setInterval(tick, 1000);
}

onUnmounted(forgetEverything);
/**
 * Route change 要**兩個** guard，唔係一個。
 *
 * `onBeforeRouteLeave` 淨係喺去一個唔同嘅 route record 嗰陣行。由 `/suppliers/7`
 * 去 `/suppliers/8` 係**同一個** record 淨係換咗 param，Vue Router 會重用同一個
 * component instance，行嘅係 `onBeforeRouteUpdate` —— 唔 unmount，亦都唔會行
 * `onBeforeRouteLeave`。
 *
 * 呢個係我上一版寫錯咗嘅嘢：我留低咗 `onBeforeRouteLeave` 並且喺註解度講明佢守嘅
 * 就係 7 → 8 嗰條路，但佢根本唔會喺嗰度行。REV-044 用十一行 `router.push` 重現咗
 * 個漏洞 —— 7 號嘅帳號明文留喺一個 URL 已經寫住 8 號嘅畫面上面。我之前話「寫唔出
 * 一個殺得到佢嘅測試」，錯嘅唔係嗰個 `history.pushState` 探針（佢的確唔驅動 Vue
 * Router），係我由「呢個探針證唔到」跳去「冇嘢證得到」。
 *
 * `onBeforeRouteLeave` 留返：佢守嘅係去另一個 record 嗰條路。嗰條路今日一定會
 * unmount，所以佢係冗餘，但冗餘同錯係兩件事。
 */
onBeforeRouteLeave(() => { forgetEverything(); });
onBeforeRouteUpdate(() => { forgetEverything(); });
// Session 失效（token 過期、被撤銷、登出）都要即刻清 —— 一個已經唔再係佢嘅畫面
// 唔應該仲留住個帳號喺度。
/**
 * 睇**權限**，唔淨係睇「仲有冇登入」。
 *
 * `session.refresh()`（由 session watchdog 自動行）係 `this.user = result.user` ——
 * 換一個新 object，所以 `isAuthenticated` 由頭到尾都係 `true`，一個淨係睇佢嘅
 * watch 永遠唔會行。即係一次撤走 `supplier.bank.view` 嘅 refresh 之後，明文仲會
 * 留喺畫面上，倒數照行。（REV-050 F-L3）
 *
 * `canReveal` 同 `canManage` 係 computed，會跟住新嗰個 permissions 陣列變，所以
 * 呢度一齊睇埋。登出／token 失效嗰條路照樣覆蓋 —— `can()` 對一個未認證嘅 session
 * 一律回 false。
 */
watch(() => [session.isAuthenticated, canReveal.value, canManage.value],
  ([authenticated, mayReveal, mayManage]) => {
    if (!authenticated || !mayReveal) forgetPlaintext();
    if (!authenticated || !mayManage) forgetFormSecrets();
    if (!authenticated) forgetEverything();
  });

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    rows.value = await supplierBankService.list(props.supplierId);
  } catch (error) {
    loadError.value = error.message || "載入銀行資料失敗";
  } finally {
    loading.value = false;
  }
}
onMounted(load);

/**
 * **冇** `watch(props.supplierId)`，而個原因值得寫低。
 *
 * 我 merge `main` 嗰陣加咗一個，因為 `bank.test.js` 度量到 `list()` 叫咗 7 就冇再叫
 * 8。嗰個度量係啱嘅，但佢度嘅係**測試宿主**唔係個程式：宿主綁 `$route.params.id`
 * 落個 prop 度並且保住同一個 instance，而真嘅 `SupplierDetailPage` 唔係咁 ——
 * 佢個 `load()` 一開頭就 `loading.value = true`，而 template 係
 * `v-if="loading"` / `v-else-if="supplier"`，所以成個子樹（連呢個 panel）會拆走再
 * 起過。實測：panel instance uid 48 → 77，而 `list()` 叫咗 7 同 8。
 *
 * 即係嗰個 watcher 喺程式入面由頭到尾冇行過 —— 但佢喺測試宿主入面行，而佢一行就
 * 會搶先清晒嘢，令 `onBeforeRouteUpdate` 嗰個 guard 變成冇嘢測到：拆走個 guard，
 * 595 條測試全部照綠。一個守衛用咗兩輪 review 先至整啱，就係咁樣俾一行「修正」
 * 遮走咗覆蓋率。（REV-047 F-H1）
 *
 * 換 Supplier 之後重攞遮罩清單，由 `onMounted` 負責 —— 因為個 panel 真係會重新
 * mount。呢個由一條行真 `SupplierDetailPage` 嘅測試釘住，唔係由呢度。
 */

// ---- Reveal ----------------------------------------------------------------

const revealDialog = reactive({ open: false, row: null, password: "", reason: "", error: "", busy: false });

function openReveal(row) {
  Object.assign(revealDialog, { open: true, row, password: "", reason: "", error: "", busy: false });
}

async function confirmReveal() {
  if (revealDialog.busy) return;
  revealDialog.busy = true;
  revealDialog.error = "";
  // 攞住個 generation 落去，返嚟之後對返。任何一個清除觸發點（unmount、route
  // change、session 失效、手動收起、倒數到）都會撳大佢，所以一個「出發嗰陣仲啱、
  // 返到嚟已經唔啱」嘅 response 會喺呢度俾人丟咗，而唔係畫返出嚟。
  const generation = revealGeneration;
  try {
    const result = await supplierBankService.reveal(props.supplierId, revealDialog.row.id, {
      password: revealDialog.password, reason: revealDialog.reason.trim()
    });
    if (generation !== revealGeneration) {
      // 丟咗個 response，但**唔可以靜靜雞丟**。伺服器已經解咗密、已經寫咗一條
      // `supplier.bank.reveal` 稽核 —— 一條「有人睇過」嘅紀錄。如果呢度乜都唔講
      // 就 return，個稽核紀錄就會對應住一次根本冇出現過喺螢幕上嘅披露，而個稽核
      // 紀錄正正係呢個功能嘅設計所倚靠嘅嘢。（REV-046）
      //
      // 最窄嗰個窗口係另一行嘅 30 秒倒數啱啱喺呢個來回中間到期：`forgetPlaintext()`
      // 亦都會撳大 generation，所以一次完全正常嘅 reveal 都會落到呢度。
      revealDialog.error = "畫面喺查看期間更新咗，所以冇顯示帳號。呢次查看已經記錄咗稽核，請重新查看。";
      return;
    }
    holdPlaintext(result.id, result.accountNumber);
    revealDialog.open = false;
  } catch (error) {
    revealDialog.error = error.code === "PASSWORD_INVALID"
      ? "密碼不正確，請重新輸入。"
      : error.message || "無法查看完整帳號";
  } finally {
    // 密碼唔留低，成功失敗都一樣。
    revealDialog.password = "";
    revealDialog.busy = false;
  }
}

// ---- Writes ----------------------------------------------------------------

const form = reactive({
  open: false, editing: null, busy: false, error: "", warnings: [],
  accountHolderName: "", bankName: "", bankCountryCode: "", bankCode: "", branchCode: "",
  swiftBic: "", accountCurrencyCode: "", accountNumber: "", isDefault: false,
  reason: "", password: ""
});

function forgetFormSecrets() {
  form.accountNumber = "";
  form.password = "";
}

function openCreate() {
  Object.assign(form, {
    open: true, editing: null, busy: false, error: "", warnings: [],
    accountHolderName: "", bankName: "", bankCountryCode: "", bankCode: "", branchCode: "",
    swiftBic: "", accountCurrencyCode: "", accountNumber: "", isDefault: false, reason: "", password: ""
  });
}

function openEdit(row) {
  Object.assign(form, {
    open: true, editing: row, busy: false, error: "", warnings: [],
    accountHolderName: row.accountHolderName ?? "", bankName: row.bankName ?? "",
    bankCountryCode: row.bankCountryCode ?? "", bankCode: row.bankCode ?? "",
    branchCode: row.branchCode ?? "", swiftBic: row.swiftBic ?? "",
    accountCurrencyCode: row.accountCurrencyCode ?? "",
    // 帳號唔會由伺服器帶返落嚟（遮罩投影根本講唔出佢），留空就係「唔改帳號」。
    accountNumber: "", isDefault: Boolean(row.isDefault), reason: "", password: ""
  });
}

function writeBody() {
  const body = {
    accountHolderName: form.accountHolderName.trim(),
    bankName: form.bankName.trim(),
    reason: form.reason.trim(),
    password: form.password
  };
  for (const key of ["bankCountryCode", "bankCode", "branchCode", "swiftBic", "accountCurrencyCode"]) {
    const value = form[key].trim();
    if (value) body[key] = key.endsWith("CountryCode") || key.endsWith("CurrencyCode") ? value.toUpperCase() : value;
  }
  // 空白 = 唔改帳號（設計 §6.6）。create 嗰邊一定有值，schema 會擋。
  if (form.accountNumber) body.accountNumber = form.accountNumber;
  if (form.editing) body.version = form.editing.version;
  else if (form.isDefault) body.isDefault = true;
  return body;
}

async function submitWrite() {
  if (form.busy) return;
  form.busy = true;
  form.error = "";
  form.warnings = [];
  try {
    const body = writeBody();
    const saved = form.editing
      ? await supplierBankService.update(props.supplierId, form.editing.id, body)
      : await supplierBankService.create(props.supplierId, body);
    // 成功即刻清 —— 呢兩個係 form state 入面唯一兩個唔可以留嘅值（設計 §7.5）。
    forgetFormSecrets();
    form.warnings = saved.warnings ?? [];
    // 訊息淨係講得出銀行名同 Supplier Code，永遠唔會覆述帳號。
    notifySuccess(`供應商 ${props.supplierCode} 的銀行帳戶「${saved.bankName}」已${form.editing ? "更新" : "新增"}`);
    if (!form.warnings.length) form.open = false;
    await load();
    emit("refresh");
  } catch (error) {
    // 唔用 error.details：伺服器嘅 validation detail 帶 field path，而我哋唔想
    // 喺任何錯誤面板度重播使用者啱啱打嗰個帳號（設計 §7.5 禁 validation summary）。
    form.error = error.code === "VERSION_CONFLICT"
      ? "這個銀行帳戶已被其他人修改，請關閉後重新載入再試。"
      : error.message || "儲存銀行帳戶失敗";
    notifyError(form.error);
    // 密碼唔留低；帳號留返俾人改，但一 submit 成功就清。
    form.password = "";
  } finally {
    form.busy = false;
  }
}

// ---- Confirmations (default / deactivate) ----------------------------------

const confirm = reactive({ open: false, kind: null, row: null, password: "", reason: "", error: "", busy: false });

function openConfirm(kind, row) {
  Object.assign(confirm, { open: true, kind, row, password: "", reason: "", error: "", busy: false });
}

const confirmTitle = computed(() => (confirm.kind === "default" ? "設為預設銀行帳戶" : "停用銀行帳戶"));

async function submitConfirm() {
  if (confirm.busy) return;
  confirm.busy = true;
  confirm.error = "";
  try {
    const body = { version: confirm.row.version, reason: confirm.reason.trim(), password: confirm.password };
    if (confirm.kind === "default") await supplierBankService.setDefault(props.supplierId, confirm.row.id, body);
    else await supplierBankService.deactivate(props.supplierId, confirm.row.id, body);
    notifySuccess(`供應商 ${props.supplierCode} 的銀行帳戶「${confirm.row.bankName}」已${confirm.kind === "default" ? "設為預設" : "停用"}`);
    confirm.open = false;
    await load();
    emit("refresh");
  } catch (error) {
    confirm.error = error.code === "VERSION_CONFLICT"
      ? "這個銀行帳戶已被其他人修改，請關閉後重新載入再試。"
      : error.message || "操作失敗";
    notifyError(confirm.error);
  } finally {
    confirm.password = "";
    confirm.busy = false;
  }
}
</script>

<template>
  <section aria-labelledby="supplier-bank-heading">
    <div class="row items-center justify-between q-mb-md">
      <h2 id="supplier-bank-heading" class="text-h6 q-ma-none">銀行資料</h2>
      <q-btn v-if="canManage" color="primary" flat icon="add" label="新增銀行帳戶" @click="openCreate" />
    </div>

    <q-banner v-if="loadError" class="bg-negative text-white q-mb-md" role="alert">{{ loadError }}</q-banner>
    <div v-else-if="loading" class="text-grey-7">載入中…</div>
    <div v-else-if="!rows.length" class="text-grey-7">尚未設定銀行資料</div>

    <q-list v-else bordered separator>
      <q-item v-for="row in rows" :key="row.id">
        <q-item-section>
          <q-item-label>
            {{ row.bankName }}
            <q-badge v-if="row.isDefault" class="q-ml-sm" label="預設" />
            <q-badge v-if="row.status !== 'active'" class="q-ml-sm" color="grey" label="已停用" />
          </q-item-label>
          <q-item-label caption>{{ row.accountHolderName }}</q-item-label>
          <!--
            v-if 而唔係 v-show：收起之後個節點要真係冇咗，唔可以留一個
            display:none 嘅節點收埋住明文。
          -->
          <q-item-label v-if="revealed.id === row.id" caption>
            <span data-test="bank-plaintext" class="text-weight-medium">{{ revealed.accountNumber }}</span>
            <span data-test="bank-reveal-countdown" class="q-ml-sm text-grey-7">{{ revealed.remaining }} 秒後自動隱藏</span>
            <q-btn flat dense size="sm" label="收起" class="q-ml-sm" @click="forgetPlaintext" />
          </q-item-label>
          <q-item-label v-else caption>{{ row.maskedAccountNumber }}</q-item-label>
        </q-item-section>
        <q-item-section side top class="row items-center">
          <q-btn
            v-if="canReveal && revealed.id !== row.id" flat dense size="sm" label="查看完整帳號"
            :aria-label="`查看完整帳號 ${row.bankName}`" @click="openReveal(row)"
          />
          <template v-if="canManage">
            <q-btn flat dense icon="edit" :aria-label="`編輯 ${row.bankName}`" @click="openEdit(row)" />
            <q-btn
              v-if="!row.isDefault && row.status === 'active'" flat dense icon="star"
              :aria-label="`設為預設 ${row.bankName}`" @click="openConfirm('default', row)"
            />
            <q-btn
              v-if="row.status === 'active'" flat dense color="negative" icon="block"
              :aria-label="`停用 ${row.bankName}`" @click="openConfirm('deactivate', row)"
            />
          </template>
        </q-item-section>
      </q-item>
    </q-list>

    <!-- Reveal：主動動作，要當場再打密碼（AC-024） -->
    <q-dialog v-model="revealDialog.open" persistent @hide="revealDialog.password = ''">
      <q-card style="width: min(520px, 96vw); max-width: 520px">
        <q-card-section><h3 class="text-h6 q-ma-none">查看完整帳號</h3></q-card-section>
        <q-card-section class="q-pt-none">
          <p class="text-grey-8">
            即將查看「{{ revealDialog.row?.bankName }}」的完整帳號，顯示 {{ REVEAL_SECONDS }} 秒後自動隱藏，並會留下稽核紀錄。
          </p>
          <q-banner v-if="revealDialog.error" class="bg-negative text-white q-mb-md" role="alert">{{ revealDialog.error }}</q-banner>
          <q-input
            v-model="revealDialog.password" label="密碼 *" type="password"
            autocomplete="current-password" outlined dense maxlength="1024"
          />
          <q-input v-model="revealDialog.reason" class="q-mt-md" label="查看原因 *" type="textarea" outlined dense maxlength="500" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn
            color="primary" label="確認查看" :loading="revealDialog.busy"
            :disable="!revealDialog.password || revealDialog.reason.trim().length < 5" @click="confirmReveal"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Create / update：device + password（設計 §6.6 jwt-device-password） -->
    <q-dialog v-model="form.open" persistent @hide="forgetFormSecrets">
      <q-card style="width: min(720px, 96vw); max-width: 720px">
        <q-card-section><h3 class="text-h6 q-ma-none">{{ form.editing ? "編輯銀行帳戶" : "新增銀行帳戶" }}</h3></q-card-section>
        <q-card-section class="q-pt-none">
          <q-banner v-if="form.error" class="bg-negative text-white q-mb-md" role="alert">{{ form.error }}</q-banner>
          <q-banner
            v-for="warning in form.warnings" :key="warning.code" data-test="bank-duplicate-warning"
            class="bg-warning text-dark q-mb-md"
          >
            {{ warning.message }}
            <template v-if="warning.supplierCodes?.length">（{{ warning.supplierCodes.join("、") }}）</template>
          </q-banner>
          <div class="row q-col-gutter-md">
            <q-input v-model="form.accountHolderName" class="col-12 col-sm-6" label="帳戶名稱 *" outlined dense maxlength="190" />
            <q-input v-model="form.bankName" class="col-12 col-sm-6" label="銀行名稱 *" outlined dense maxlength="190" />
            <q-input v-model="form.bankCountryCode" class="col-12 col-sm-4" label="銀行國家／地區" outlined dense maxlength="2" />
            <q-input v-model="form.accountCurrencyCode" class="col-12 col-sm-4" label="帳戶幣別" outlined dense maxlength="3" />
            <q-input v-model="form.swiftBic" class="col-12 col-sm-4" label="SWIFT/BIC" outlined dense maxlength="11" />
            <q-input v-model="form.bankCode" class="col-12 col-sm-6" label="銀行代碼" outlined dense maxlength="50" />
            <q-input v-model="form.branchCode" class="col-12 col-sm-6" label="分行代碼" outlined dense maxlength="50" />
            <!--
              autocomplete="off"：帳號唔可以入瀏覽器嘅表單記憶。
              編輯時留空即係唔改帳號 —— 遮罩投影根本講唔出原值，所以冇得預填。
            -->
            <q-input
              v-model="form.accountNumber" class="col-12" :label="form.editing ? '帳號（留空即不修改）' : '帳號 *'"
              autocomplete="off" spellcheck="false" outlined dense maxlength="2048"
            />
            <q-toggle v-if="!form.editing" v-model="form.isDefault" class="col-12" label="設為預設銀行帳戶" />
            <q-input
              v-model="form.reason" class="col-12" :label="form.editing ? '修改原因 *' : '新增原因 *'"
              type="textarea" outlined dense maxlength="500"
            />
            <q-input
              v-model="form.password" class="col-12" label="密碼 *" type="password"
              autocomplete="current-password" outlined dense maxlength="1024"
              hint="此操作需要已核准的裝置並重新確認密碼"
            />
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn
            color="primary" label="儲存" :loading="form.busy"
            :disable="!form.accountHolderName.trim() || !form.bankName.trim() || !form.password
              || form.reason.trim().length < 5 || (!form.editing && !form.accountNumber)"
            @click="submitWrite"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="confirm.open" persistent @hide="confirm.password = ''">
      <q-card style="width: min(560px, 96vw); max-width: 560px">
        <q-card-section><h3 class="text-h6 q-ma-none">{{ confirmTitle }}</h3></q-card-section>
        <q-card-section class="q-pt-none">
          <!-- 設計 §7.5：切換預設要明講舊 default 會被取消。 -->
          <p v-if="confirm.kind === 'default'" class="text-grey-8">
            將「{{ confirm.row?.bankName }}」設為預設之後，原本嘅預設銀行帳戶會**同時被取消**，之後嘅付款會用新嘅預設。
          </p>
          <p v-else class="text-grey-8">
            停用「{{ confirm.row?.bankName }}」之後就唔會再揀得到；已經引用咗佢嘅單據仍然保留。停用係唯一嘅退役方式，冇得刪除。
          </p>
          <q-banner v-if="confirm.error" class="bg-negative text-white q-mb-md" role="alert">{{ confirm.error }}</q-banner>
          <q-input
            v-model="confirm.password" label="密碼 *" type="password"
            autocomplete="current-password" outlined dense maxlength="1024"
          />
          <q-input v-model="confirm.reason" class="q-mt-md" label="原因 *" type="textarea" outlined dense maxlength="500" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn
            color="primary" label="確認" :loading="confirm.busy"
            :disable="!confirm.password || confirm.reason.trim().length < 5" @click="submitConfirm"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </section>
</template>
