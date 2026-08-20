import { defineStore } from "pinia";
import { httpClient } from "@/framework/http/HttpClient.js";
import { clearToken, getToken, setToken } from "@/framework/auth/tokenStorage.js";

// 後端喺設備綁定唔畀用系統嗰陣回嘅三個 code（見
// server/src/services/deviceBinding/deviceSignatureRequest.js）。三個分開而唔係
// 一句「登入失敗」：混埋一齊嘅話，用戶會以為打錯密碼而不停重試，然後撞上登入
// 節流——真正要做嘅事（等審批、搵管理員）一件都唔會發生。
export const DEVICE_BLOCKED_CODES = Object.freeze([
  "DEVICE_PENDING_APPROVAL",
  "DEVICE_REJECTED",
  "DEVICE_REVOKED"
]);

/**
 * Session 嘅唯一真實來源。`user` 有值即代表已登入——冇獨立嘅
 * `isAuthenticated` 布林狀態要同步，避免兩個狀態不一致。
 */
export const useSessionStore = defineStore("session", {
  state: () => ({
    user: null,
    // 設備被擋嗰陣記低係邊一種，等待審批頁靠佢決定顯示乜。登入成功會清返 null。
    deviceStatus: null
  }),

  getters: {
    isAuthenticated: (state) => state.user !== null,
    roles: (state) => state.user?.roles ?? [],
    permissions: (state) => state.user?.permissions ?? []
  },

  actions: {
    /**
     * 登入。請求要帶設備簽章，所以係 signed。
     *
     * includePublicKey：後端淨係喺「呢個用戶未有呢台設備嘅綁定」嗰陣先會用到
     * 公鑰，已經有綁定就一律用資料庫入面嗰把。呢度每次都帶，因為前端根本唔知
     * 自己有冇被綁定過——多帶一個 header 嘅成本，換走一次「先問後登入」嘅來回。
     */
    async login(username, password, deviceLabel = defaultDeviceLabel()) {
      try {
        const result = await httpClient.post("/api/v1/user/login", {
          body: { username, password, deviceLabel },
          signed: true,
          includePublicKey: true
        });

        setToken(result.token, result.expiresInSeconds);
        this.user = result.user;
        this.deviceStatus = null;
        return result.user;
      } catch (error) {
        if (DEVICE_BLOCKED_CODES.includes(error.code)) {
          // 密碼係啱嘅，擋住佢嘅係設備綁定。記低係邊一種，畀等待審批頁講返
          // 一句人睇得明嘅嘢，而唔係得一句「登入失敗」。
          this.deviceStatus = error.code;
        }
        throw error;
      }
    },

    /**
     * 換一個新 token。由 session watchdog 喺快到期嗰陣叫。
     *
     * 同登入一樣要簽名，但**唔帶公鑰**：續期嘅前提就係呢台設備已經綁定過，
     * 後端一律用資料庫入面嗰把公鑰驗簽，帶上去都會被忽略。
     *
     * 順手更新 user：後端每次續期都會重讀 roles/permissions，所以權限變更會喺
     * 一次續期（最多 15 分鐘）之內反映到畫面上，唔使等重新登入。
     */
    async refresh() {
      const result = await httpClient.post("/api/v1/user/token/refresh", { signed: true });

      setToken(result.token, result.expiresInSeconds);
      this.user = result.user;
      return result.user;
    },

    async logout() {
      try {
        await httpClient.post("/api/v1/user/logout");
      } finally {
        // 就算後端請求失敗（例如網路斷咗），本地 session 都要清——用戶已經
        // 主動要求登出，唔可以因為一個請求失敗就令佢繼續處於已登入狀態。
        this.clear();
      }
    },

    clear() {
      this.user = null;
      this.deviceStatus = null;
      clearToken();
    },

    // 開機還原：storage 有 token 就叫一次 /me 確認仲有效，避免帶住過期 token
    // 進入系統再逐個請求先發現 401。冇 token 就當未登入處理。
    //
    // /me 淨係喺確認 401（token 本身無效／過期／已撤銷，見
    // server/src/services/auth/jwtAuthStrategy.js）先清 token；網路錯誤、
    // 逾時或 503（例如撤銷快照未 ready，見同一個檔案）都保留 token 淨係
    // 令呢次還原失敗，等下次再試——後端刻意用 503 而唔係 401 分開呢兩種
    // 情況，就是為咗唔想伺服器一次故障就逼全部人重新登入。
    async restore() {
      if (!getToken()) {
        this.user = null;
        return;
      }

      try {
        this.user = await httpClient.get("/api/v1/user/me");
      } catch (error) {
        this.user = null;
        if (error.status === 401) {
          this.clear();
        }
      }
    }
  }
});

/**
 * 預設嘅裝置名稱，畀審批者喺佇列入面認得出邊台機。
 *
 * 由 User-Agent 撮要而唔係叫用戶自己填：第一次登入嗰陣佢仲未入到系統，冇地方
 * 可以問。後端本身亦都會記低完整嘅 UA 同 IP，呢個標籤淨係令佇列易讀啲。
 */
function defaultDeviceLabel() {
  if (typeof navigator === "undefined") {
    return "";
  }

  const ua = navigator.userAgent;
  const browser =
    ["Edg", "Chrome", "Firefox", "Safari"].find((name) => ua.includes(name)) ?? "Browser";
  const platform =
    ["Windows", "Mac", "Linux", "Android", "iPhone", "iPad"].find((name) => ua.includes(name)) ??
    "Unknown";

  // Edg 係 Edge 嘅 UA token，直接顯示會好怪。
  return `${browser === "Edg" ? "Edge" : browser} on ${platform}`;
}
