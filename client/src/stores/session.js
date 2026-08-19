import { defineStore } from "pinia";
import { httpClient } from "@/framework/http/HttpClient.js";
import { clearToken, getToken, setToken } from "@/framework/auth/tokenStorage.js";

/**
 * Session 嘅唯一真實來源。`user` 有值即代表已登入——冇獨立嘅
 * `isAuthenticated` 布林狀態要同步，避免兩個狀態不一致。
 */
export const useSessionStore = defineStore("session", {
  state: () => ({
    user: null
  }),

  getters: {
    isAuthenticated: (state) => state.user !== null,
    roles: (state) => state.user?.roles ?? [],
    permissions: (state) => state.user?.permissions ?? []
  },

  actions: {
    async login(username, password) {
      const result = await httpClient.post("/api/v1/user/login", {
        body: { username, password }
      });

      setToken(result.token);
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
