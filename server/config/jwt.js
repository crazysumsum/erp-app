const jwtConfig = {
  // JWT 簽署及驗證密鑰，一律由 JWT_SECRET 環境變數提供，至少 32 個字元。
  // 這裡刻意沒有預設值：任何寫進版本控制的密鑰都等同公開，能讓任何人自行簽發
  // 任意 role 及 permission 的 Token。未設定時應用程式會在啟動時直接失敗。
  secret: process.env.JWT_SECRET,

  // Token 簽發者，用來防止其他系統簽發的 Token 被本 API 接受。
  issuer: process.env.JWT_ISSUER || "erp-api",

  // Token 預期使用者，驗證時必須與此值一致。
  audience: process.env.JWT_AUDIENCE || "erp-web",

  // JWT 簽署演算法。驗證時只接受此演算法，防止演算法降級攻擊。
  algorithm: "HS256",

  // 登入成功後簽發的 Token 有效期。必須是整數加上單位 s、m、h、d 或 w，例如
  // 2h、30m、7d。不接受純數字：jsonwebtoken 把字串 "3600" 當成 3600 毫秒，
  // 會簽出 3 秒壽命的 token，而且沒有任何地方會說出來。
  //
  // 15 分鐘而不是原本的 2 小時：有了設備綁定的自動續期（見
  // docs/device-binding-auth.md），原本那個「安全 vs 多久踢人一次」的妥協就
  // 消失了。縮短是純賺——被偷 token 的存活時間、撤銷的生效延遲、權限變更的
  // 生效延遲全部一起縮短，而使用者感覺不到，因為續期是背景進行的。
  expiresIn: process.env.JWT_EXPIRES_IN || "15m",

  // 一條 session 從登入那一刻算起最多能活多久，不管中間續期過幾次。到期就必須
  // 重新輸入帳號密碼登入。格式與 expiresIn 相同（整數加單位）。
  //
  // 這跟 expiresIn 是兩件事：expiresIn 管的是「單一個 token 活多久」，每次續期
  // 都會把它往後推；這個值管的是「這條 session 總共能活多久」，續期推不動它。
  // 少了它，一台一直開著的機器可以無限續期下去，session 永遠不會自己結束——
  // 那時要結束一條 session 只剩撤銷設備與 tokenRevocation 兩條**手動**的路。
  sessionMaxAge: process.env.JWT_SESSION_MAX_AGE || "8h",

  // 驗證 exp、nbf 等時間欄位時容許的時鐘誤差，單位為秒。
  clockToleranceSeconds: Number(process.env.JWT_CLOCK_TOLERANCE_SECONDS || 5),

  // JWT 所在的 HTTP header 名稱。Express 讀取 header 時不分大小寫。
  headerName: "authorization",

  // Authorization header 使用的認證方案，例如：Authorization: Bearer <token>。
  authScheme: "Bearer"
};

export default jwtConfig;
