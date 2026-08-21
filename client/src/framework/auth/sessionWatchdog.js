import authConfig from "@config/auth.js";

/**
 * 令長時間使用系統嘅人唔會喺 token 到期嗰一刻突然被踢出去。
 * 設計說明見 docs/device-binding-auth.md §3.5、§3.6。
 *
 * 三件事：
 *
 *   1. **主動續期**：仲有 refreshThresholdMs 就到期嗰陣喺背景換新 token。
 *   2. **強制登出**：真係過咗期就即刻登出，唔會等用戶撳「儲存」嗰陣先發現。
 *   3. **活動閘門**：冇真人操作就唔續期，等 token 自然過期。
 *   4. **絕對 session 上限**：夠鐘就登出，續期救唔到；到期之前提早提醒一次。
 *
 * 第 3 點解決一個唔明顯嘅問題：tick 淨係睇**分頁生存**，唔睇**用戶在唔在**。
 * 冇呢個閘門嘅話，session 撐幾耐實際上取決於部機會唔會瞓——辦公室桌機開通宵、
 * ERP 分頁一直掛住，凌晨兩點行埋去嗰個人會發現佢仲係登入狀態。
 *
 * 全部倚賴都用注入：呢個模組要喺冇 DOM、冇 Web Locks、冇真時鐘嘅測試環境入面
 * 行得到，而佢守嘅正正係啲「唔啱就靜靜哋登出全部人」嘅邏輯。
 */
export function createSessionWatchdog({
  refresh,
  onExpired,
  onWarning = () => {},
  onSessionEnding = () => {},
  getDeadline,
  // 絕對 session 上限嘅到期時刻。預設 Infinity 即係「冇上限」——呢個模組唔應該
  // 因為呼叫端冇接呢條線就當成已經過期，咁樣會靜靜哋登出全部人。
  getSessionDeadline = () => Number.POSITIVE_INFINITY,
  now = () => Date.now(),
  locks = globalThis.navigator?.locks ?? null,
  tickMs = authConfig.refreshTickMs,
  refreshThresholdMs = authConfig.refreshThresholdMs,
  idleTimeoutMs = authConfig.idleTimeoutMs,
  warningThresholdMs = authConfig.expiryWarningThresholdMs,
  sessionWarningThresholdMs = authConfig.sessionWarningThresholdMs
} = {}) {
  let lastActivityAt = now();
  let timer = null;
  let warned = false;
  // 記住「已經為邊一個 deadline 提醒過」而唔係一個 boolean：boolean 要喺重新
  // 登入嗰陣記得清，唔清嘅話第二條 session 就唔會再提醒。用 deadline 本身做
  // 標記，新 session 換一個新值就自動重新武裝，唔使有人記得清。
  let warnedSessionDeadline = null;
  let refreshing = false;

  const remainingMs = () => getDeadline() - now();
  const sessionRemainingMs = () => getSessionDeadline() - now();
  const isIdle = () => now() - lastActivityAt > idleTimeoutMs;

  function markActivity() {
    lastActivityAt = now();
  }

  async function tryRefresh() {
    if (isIdle()) {
      // 閒置就唔續，等佢自然過期。呢度 return 之後，下一次 check() 見到
      // remaining <= 0 就會強制登出。
      return;
    }

    // Web Locks 跨分頁互斥。冇佢嘅話，「檢查快到期 → 決定續期」係一個
    // read-then-write 競態：兩個分頁可以同時讀到「快到期」、同時發請求，
    // 而第二個請求會帶住一個已經用過嘅 nonce。
    const run = async () => {
      // 攞到鎖之後再檢查一次：等鎖嗰陣，第二個分頁可能已經換好咗。
      if (remainingMs() > refreshThresholdMs) {
        return;
      }

      try {
        await refresh();
        warned = false;
      } catch (error) {
        // 明確嘅拒絕（token 已撤銷、設備失效、帳號停用）先登出。網路錯誤、
        // 逾時同 503 一律唔郁 token，等下一次 tick 再試——後端刻意用 503 而
        // 唔係 401 分開呢兩種情況，就係為咗唔想伺服器一次故障就逼全部人重新
        // 登入（見 server/src/services/auth/jwtAuthStrategy.js）。
        if (error?.status === 401 || error?.status === 403) {
          onExpired();
        }
      }
    };

    if (!locks?.request) {
      // 冇 Web Locks（舊瀏覽器）就用一個 process 內嘅旗標。擋唔到跨分頁，
      // 但擋得到同一個分頁重入——總好過完全冇。
      if (refreshing) {
        return;
      }

      refreshing = true;
      try {
        await run();
      } finally {
        refreshing = false;
      }
      return;
    }

    await locks.request("erp.jwt-refresh", run);
  }

  function check() {
    // 絕對上限排喺最前：夠鐘就係夠鐘，token 仲有幾耐命都冇意義。後端喺下一個
    // 請求一定會回 401，但唔等嗰個請求——用戶可能坐喺度乜都冇撳，然後對住一個
    // 睇落仲登入緊、但每一個動作都會失敗嘅畫面。
    const sessionRemaining = sessionRemainingMs();

    if (sessionRemaining <= 0) {
      onExpired();
      return;
    }

    // 一條 session 一世提醒一次。呢個同下面 token 嗰個提醒唔同：token 嗰個係
    // 異常狀況（續期一直失敗），呢個係一定會發生嘅事，而且冇得補救——夠鐘就
    // 一定要重新登入，所以要留夠時間畀人存檔。
    //
    // 刻意唔用 isIdle() 做閘：閒置嘅人一樣會被登出，而佢返嚟嗰陣見到提醒，
    // 好過乜都冇見過就發現自己已經登出咗。
    if (sessionRemaining < sessionWarningThresholdMs
        && warnedSessionDeadline !== getSessionDeadline()) {
      warnedSessionDeadline = getSessionDeadline();
      onSessionEnding(sessionRemaining);
    }

    const remaining = remainingMs();

    if (remaining <= 0) {
      onExpired();
      return;
    }

    // 續期一直失敗、又快到期嗰陣講一聲。呢個係唯一救得到「分頁一直喺前景、
    // 後端卻連唔到」嗰個情境嘅嘢——嗰陣 visibilitychange 幫唔到手，因為用戶
    // 根本冇離開過。
    if (remaining < warningThresholdMs && !warned && !isIdle()) {
      warned = true;
      onWarning();
    }

    if (remaining < refreshThresholdMs) {
      void tryRefresh();
    }
  }

  function start() {
    stop();
    timer = setInterval(check, tickMs);
    return () => stop();
  }

  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { check, start, stop, markActivity, tryRefresh };
}

/**
 * 接落瀏覽器：活動事件同三個「返到前景」訊號。
 *
 * 淨係聽 focus 唔夠，會漏：
 *   - visibilitychange —— 同視窗切分頁、切返應用程式，涵蓋面比 focus 廣
 *   - pageshow(persisted) —— bfcache。用戶撳瀏覽器上一頁返嚟，成頁連同 timer
 *     都係凍結後解凍，focus 唔一定觸發。呢個最容易漏。
 *   - online —— 斷網返嚟，中間錯過嘅續期要補做
 *
 * 活動刻意唔聽 mousemove：游標掃過畫面、甚至有啲硬件自己抖，都會觸發，
 * 咁樣個閒置閘門就形同虛設。
 */
export function attachSessionWatchdog(watchdog, target = globalThis) {
  const listeners = [];
  const on = (element, type, handler, options) => {
    element.addEventListener(type, handler, options);
    listeners.push(() => element.removeEventListener(type, handler, options));
  };

  const activity = () => watchdog.markActivity();

  for (const type of ["pointerdown", "keydown", "scroll"]) {
    on(target, type, activity, { passive: true });
  }

  const document = target.document;

  if (document) {
    on(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") {
        watchdog.check();
      }
    });
  }

  on(target, "pageshow", (event) => {
    if (event.persisted) {
      watchdog.check();
    }
  });
  on(target, "online", () => watchdog.check());

  const stopTimer = watchdog.start();

  return () => {
    stopTimer();
    for (const off of listeners) {
      off();
    }
  };
}
