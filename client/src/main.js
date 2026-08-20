import { createPinia } from "pinia";
import { Dialog, Loading, Notify, Quasar } from "quasar";
import { createApp } from "vue";
import App from "./App.vue";
import { vCan } from "./framework/authorization/vCan.js";
import { signRequest } from "./framework/auth/deviceKey.js";
import {
  attachSessionWatchdog,
  createSessionWatchdog
} from "./framework/auth/sessionWatchdog.js";
import { getTokenDeadline } from "./framework/auth/tokenStorage.js";
import { discoverPages } from "./framework/discovery/pages.js";
import { validatePages } from "./framework/discovery/validatePages.js";
import { renderFatalBootError } from "./framework/errors/renderFatalBootError.js";
import { httpClient } from "./framework/http/HttpClient.js";
import { createAppRouter } from "./framework/routing/router.js";
import { notifyError } from "./framework/ui/notify.js";
import { useSessionStore } from "./stores/session.js";

// Quasar 的預編譯 CSS。用 dist/quasar.css 而不是 src/css/index.sass，是為了不必
// 為了一個還沒有客製主題的專案裝一整套 sass 工具鏈。品牌色可以用 CSS 變數
// （--q-primary 等）覆蓋；真的需要 sass 層級的客製時再裝。
import "quasar/dist/quasar.css";
// 圖示字型。菜單與元件的圖示名稱（config/menu.js 的 icon）都出自這一套。
import "@quasar/extras/material-icons/material-icons.css";

// 先驗證頁面 metadata，過唔到就唔啟動：對應後端「設定錯就拒絕啟動」。呢一步
// 要喺任何 Vue／Pinia／router 建立之前做——錯誤畫面本身唔應該依賴一個仲未
// 證實冇問題嘅框架。
const pages = discoverPages();
const pageErrors = validatePages(pages);

if (pageErrors.length > 0) {
  renderFatalBootError(document.getElementById("app"), pageErrors);
} else {
  boot(pages);
}

function boot(pages) {
  const app = createApp(App);
  const pinia = createPinia();

  app.use(pinia);
  app.use(Quasar, {
    // 只註冊真的會用到的：Notify 是操作結果提示，Dialog 是刪除確認，Loading 是
    // 全域載入遮罩。三者都是全域單例，Phase 6 會在它們上面包一層統一文案。
    plugins: { Notify, Dialog, Loading }
  });
  app.directive("can", vCan);

  // 明確傳 pinia instance：main.js 這裡沒有 component context，不能靠 inject
  // 拿到正確的 pinia（見 pinia 的 outside-component-usage 文件）。
  const session = useSessionStore(pinia);
  const router = createAppRouter({ session, pages });

  // Phase 2 的 HttpClient 建構子刻意沒有直接依賴 router／session——那時候兩者都
  // 還不存在，只留了這個掛勾（見 HttpClient.js 的說明）。這裡接上：401 就清掉
  // session 並轉去登入頁，順便記住原本想去的路徑。
  httpClient.onUnauthorized = () => {
    session.clear();
    const current = router.currentRoute.value;
    if (current.name !== "login") {
      router.push({ name: "login", query: { redirect: current.fullPath } });
    }
  };

  // 設備簽名器同樣用注入接上（見 HttpClient 建構子）：簽名要用 Web Crypto 同
  // IndexedDB，直接喺 HttpClient import 會令每一個 HttpClient 測試都要備妥
  // 呢兩樣。只有 login／refresh 呢啲帶 signed: true 嘅請求先會用到佢。
  httpClient.signRequest = signRequest;

  // 開機先還原 session（storage 有 token 就叫一次 /me），再 app.use(router)：
  // vue-router 一 install 就會馬上觸發第一次導航（見 install() 內部直接
  // push(routerHistory.location)），唔使等 app.mount()。如果喺 restore 完成之前
  // 就 app.use(router)，guard 會喺 session 仲未還原嗰陣就判斷「未登入」，就算
  // 之後 restore 成功都嚟唔切——呢個順序錯誤試過令有 token 嘅用戶一 refresh
  // 就被踢返登入頁。
  // Session watchdog：快到期就喺背景換新 token，真係過咗期就即刻登出。
  //
  // 強制登出刻意重用上面 onUnauthorized 嗰段——兩條路（過期同 401）應該落喺
  // 同一個地方，否則其中一條會慢慢同另一條長得唔一樣。
  const watchdog = createSessionWatchdog({
    refresh: () => session.refresh(),
    onExpired: () => httpClient.onUnauthorized(),
    onWarning: () =>
      notifyError("連線階段即將結束，請儲存目前的工作"),
    getDeadline: getTokenDeadline
  });

  session.restore().finally(() => {
    app.use(router);
    app.mount("#app");
    // 掛喺 mount 之後：watchdog 一 start 就可能即刻 check()，而強制登出要導頁，
    // 嗰陣 router 一定要已經裝好。
    attachSessionWatchdog(watchdog);
  });
}
