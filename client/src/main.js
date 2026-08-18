import { createPinia } from "pinia";
import { Dialog, Loading, Notify, Quasar } from "quasar";
import { createApp } from "vue";
import App from "./App.vue";

// Quasar 的預編譯 CSS。用 dist/quasar.css 而不是 src/css/index.sass，是為了不必
// 為了一個還沒有客製主題的專案裝一整套 sass 工具鏈。品牌色可以用 CSS 變數
// （--q-primary 等）覆蓋；真的需要 sass 層級的客製時再裝。
import "quasar/dist/quasar.css";
// 圖示字型。菜單與元件的圖示名稱（config/menu.js 的 icon）都出自這一套。
import "@quasar/extras/material-icons/material-icons.css";

const app = createApp(App);

app.use(createPinia());
app.use(Quasar, {
  // 只註冊真的會用到的：Notify 是操作結果提示，Dialog 是刪除確認，Loading 是
  // 全域載入遮罩。三者都是全域單例，Phase 6 會在它們上面包一層統一文案。
  plugins: { Notify, Dialog, Loading }
});

app.mount("#app");
