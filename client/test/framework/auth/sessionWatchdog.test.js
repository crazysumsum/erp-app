import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachSessionWatchdog,
  createSessionWatchdog
} from "@/framework/auth/sessionWatchdog.js";

// Watchdog 嘅每一個錯法都係靜靜哋咬人：閾值同 tick 配錯就漏續期、少一個
// visibility 訊號就瞓醒返嚟被登出、將網路錯誤當成 401 就一次後端抖動踢曬全部人。
// 全部只有喺呢度控制住時鐘先測得出。

const MINUTE = 60_000;

function harness({
  remaining = 10 * MINUTE,
  // 預設留一大段時間，等「同絕對上限無關」嗰啲測試唔使逐個交代。
  sessionRemaining = 8 * 60 * MINUTE,
  refresh = vi.fn(async () => {}),
  idleFor = 0,
  // 預設冇 Web Locks，行 process 內旗標嗰條路；要測鎖就自己傳一個。
  locks = null
} = {}) {
  let nowMs = 1_000_000;
  let deadline = nowMs + remaining;
  let sessionDeadline = nowMs + sessionRemaining;

  const onExpired = vi.fn();
  const onWarning = vi.fn();
  const onSessionEnding = vi.fn();
  const watchdog = createSessionWatchdog({
    refresh,
    onExpired,
    onWarning,
    onSessionEnding,
    getDeadline: () => deadline,
    getSessionDeadline: () => sessionDeadline,
    now: () => nowMs,
    locks,
    tickMs: MINUTE,
    refreshThresholdMs: 5 * MINUTE,
    idleTimeoutMs: 30 * MINUTE,
    warningThresholdMs: 2 * MINUTE,
    sessionWarningThresholdMs: 10 * MINUTE
  });

  // 建構嗰刻先記低 lastActivityAt，所以要「已經閒置咗」就將時鐘推前。
  nowMs += idleFor;
  deadline += idleFor;
  sessionDeadline += idleFor;

  return {
    watchdog,
    onExpired,
    onWarning,
    onSessionEnding,
    refresh,
    advance(ms) {
      nowMs += ms;
    },
    setRemaining(ms) {
      deadline = nowMs + ms;
    },
    setSessionRemaining(ms) {
      sessionDeadline = nowMs + ms;
    }
  };
}

describe("session watchdog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("到期就強制登出，一個請求都唔會發", async () => {
    const h = harness({ remaining: 0 });

    await h.watchdog.check();

    expect(h.onExpired).toHaveBeenCalledOnce();
    // 本地比對到期時刻就夠。打 API 再「失敗就登出」嘅話，一次後端抖動就會
    // 踢曬全部人——正正係後端特登用 503 而唔係 401 要避免嗰件事。
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("絕對上限夠鐘就登出，就算 token 仲有一大段命", async () => {
    // token 啱啱先續完，仲有 10 分鐘；但 session 上限已經到咗。上限贏。
    const h = harness({ remaining: 10 * MINUTE, sessionRemaining: 0 });

    await h.watchdog.check();

    expect(h.onExpired).toHaveBeenCalledOnce();
    // 唔等後端回 401：用戶可能坐喺度乜都冇撳，然後對住一個睇落仲登入緊、
    // 但每一個動作都會失敗嘅畫面。
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("絕對上限快到就提醒一次，唔會每個 tick 都嘈", async () => {
    const h = harness({ sessionRemaining: 9 * MINUTE });

    await h.watchdog.check();
    await h.watchdog.check();
    await h.watchdog.check();

    expect(h.onSessionEnding).toHaveBeenCalledOnce();
    // 帶埋仲有幾耐，畀呼叫端寫得出「約 9 分鐘後結束」而唔係含糊嘅「即將」。
    expect(h.onSessionEnding).toHaveBeenCalledWith(9 * MINUTE);
  });

  it("仲未到閾值就唔提醒", async () => {
    const h = harness({ sessionRemaining: 30 * MINUTE });

    await h.watchdog.check();

    expect(h.onSessionEnding).not.toHaveBeenCalled();
  });

  it("續期救唔到絕對上限：續完之後照樣提醒", async () => {
    // 呢個係最容易寫錯嗰個：如果提醒嘅旗標喺續期成功嗰陣連同 token 嗰個一齊
    // 清咗，用戶就會喺最後 10 分鐘每隔一分鐘俾人嘈一次。
    const h = harness({ remaining: 4 * MINUTE, sessionRemaining: 9 * MINUTE });

    await h.watchdog.check();
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledOnce());

    h.setRemaining(15 * MINUTE);
    await h.watchdog.check();

    expect(h.onSessionEnding).toHaveBeenCalledOnce();
  });

  it("重新登入之後會再武裝，第二條 session 一樣提醒得到", async () => {
    const h = harness({ sessionRemaining: 9 * MINUTE });

    await h.watchdog.check();
    expect(h.onSessionEnding).toHaveBeenCalledOnce();

    // 重新登入：新嘅 session deadline。旗標用 deadline 本身做標記，所以呢度
    // 唔使有人記得清——換一個新值就自動重新武裝。
    h.setSessionRemaining(8 * 60 * MINUTE);
    await h.watchdog.check();
    expect(h.onSessionEnding).toHaveBeenCalledOnce();

    h.setSessionRemaining(5 * MINUTE);
    await h.watchdog.check();
    expect(h.onSessionEnding).toHaveBeenCalledTimes(2);
  });

  it("閒置都照提醒：夠鐘一樣會被登出，返嚟見到好過乜都冇見過", async () => {
    const h = harness({ sessionRemaining: 9 * MINUTE, idleFor: 45 * MINUTE });

    await h.watchdog.check();

    expect(h.onSessionEnding).toHaveBeenCalledOnce();
  });

  it("剩得少過閾值就續期", async () => {
    const h = harness({ remaining: 4 * MINUTE });

    await h.watchdog.check();
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledOnce());
  });

  it("仲有好多時間就唔續", async () => {
    const h = harness({ remaining: 10 * MINUTE });

    await h.watchdog.check();

    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.onExpired).not.toHaveBeenCalled();
  });

  it("閒置就唔續期，等佢自然過期", async () => {
    const h = harness({ remaining: 4 * MINUTE, idleFor: 31 * MINUTE });

    await h.watchdog.tryRefresh();

    // 冇呢個閘門嘅話，session 撐幾耐取決於部機會唔會瞓——桌機開通宵、分頁掛住，
    // 就永遠唔會過期。
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("有操作就會重新計閒置", async () => {
    const h = harness({ remaining: 4 * MINUTE, idleFor: 31 * MINUTE });

    h.watchdog.markActivity();
    await h.watchdog.tryRefresh();

    expect(h.refresh).toHaveBeenCalledOnce();
  });

  it("網路錯誤唔會登出，留返畀下一個 tick 再試", async () => {
    const refresh = vi.fn(async () => {
      throw Object.assign(new Error("offline"), { code: "NETWORK_ERROR" });
    });
    const h = harness({ remaining: 4 * MINUTE, refresh });

    await h.watchdog.tryRefresh();

    // 續期冇 401 兜底，所以可重試係硬性要求：一次失敗就放棄嘅話，分頁一直喺
    // 前景、一直有人做嘢嘅用戶都會喺五分鐘後被登出。
    expect(h.onExpired).not.toHaveBeenCalled();

    await h.watchdog.tryRefresh();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("503 唔會登出", async () => {
    const refresh = vi.fn(async () => {
      throw Object.assign(new Error("unavailable"), { status: 503 });
    });
    const h = harness({ remaining: 4 * MINUTE, refresh });

    await h.watchdog.tryRefresh();

    expect(h.onExpired).not.toHaveBeenCalled();
  });

  it("401 同 403 先至登出", async () => {
    for (const status of [401, 403]) {
      const refresh = vi.fn(async () => {
        throw Object.assign(new Error("rejected"), { status });
      });
      const h = harness({ remaining: 4 * MINUTE, refresh });

      await h.watchdog.tryRefresh();

      // 明確嘅拒絕代表 token 已撤銷、設備失效或帳號停用——嗰陣重試冇意義。
      expect(h.onExpired).toHaveBeenCalledOnce();
    }
  });

  it("攞到鎖之後會再檢查一次，唔會重複換", async () => {
    const h = harness({ remaining: 4 * MINUTE });

    // 模擬另一個分頁喺我哋等鎖嗰陣已經換好咗。
    const locked = createSessionWatchdog({
      refresh: h.refresh,
      onExpired: h.onExpired,
      getDeadline: () => Number.MAX_SAFE_INTEGER,
      now: () => 0,
      locks: null,
      refreshThresholdMs: 5 * MINUTE,
      idleTimeoutMs: 30 * MINUTE
    });

    await locked.tryRefresh();

    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("有 Web Locks 就用佢serialise，冇就用 process 內旗標", async () => {
    const requests = [];
    const locks = {
      request: vi.fn(async (name, fn) => {
        requests.push(name);
        return fn();
      })
    };
    const h = harness({ remaining: 4 * MINUTE, locks });

    await h.watchdog.tryRefresh();

    // 用具名鎖而唔係 random delay：後者淨係降低碰撞機率，而「檢查快到期 →
    // 決定續期」本身係一個 read-then-write 競態。
    expect(requests).toEqual(["erp.jwt-refresh"]);
    expect(h.refresh).toHaveBeenCalledOnce();
  });

  it("續期一直失敗又快到期就提醒一次，唔會每個 tick 嘈一次", async () => {
    const refresh = vi.fn(async () => {
      throw Object.assign(new Error("offline"), { code: "NETWORK_ERROR" });
    });
    const h = harness({ remaining: 90_000, refresh });

    await h.watchdog.check();
    await h.watchdog.check();

    // 呢個提醒係唯一救得到「分頁一直喺前景、後端卻連唔到」嗰個情境嘅嘢——
    // 嗰陣 visibilitychange 幫唔到手，因為用戶根本冇離開過。
    expect(h.onWarning).toHaveBeenCalledOnce();
  });

  it("閒置嗰陣唔會彈提醒", async () => {
    const h = harness({ remaining: 90_000, idleFor: 31 * MINUTE });

    await h.watchdog.check();

    // 人都唔喺度，彈一個「請儲存工作」冇意義。
    expect(h.onWarning).not.toHaveBeenCalled();
  });
});

describe("attachSessionWatchdog", () => {
  function fakeTarget() {
    const handlers = {};

    return {
      handlers,
      addEventListener: (type, handler) => {
        (handlers[type] ??= []).push(handler);
      },
      removeEventListener: (type, handler) => {
        handlers[type] = (handlers[type] ?? []).filter((entry) => entry !== handler);
      },
      emit: (type, event = {}) => {
        for (const handler of handlers[type] ?? []) {
          handler(event);
        }
      }
    };
  }

  function fakeWatchdog(stopTimer = vi.fn()) {
    return {
      check: vi.fn(),
      markActivity: vi.fn(),
      start: vi.fn(() => stopTimer),
      stop: vi.fn()
    };
  }

  it("返到前景嘅三個訊號都會即刻檢查", () => {
    const target = fakeTarget();
    const document = fakeTarget();
    document.visibilityState = "visible";
    target.document = document;
    const watchdog = fakeWatchdog();

    attachSessionWatchdog(watchdog, target);

    document.emit("visibilitychange");
    expect(watchdog.check).toHaveBeenCalledTimes(1);

    // bfcache：撳瀏覽器上一頁返嚟，成頁連 timer 都係凍結後解凍，focus 唔一定
    // 觸發。淨係聽 focus 嘅話呢個情境會靜靜哋漏咗。
    target.emit("pageshow", { persisted: true });
    expect(watchdog.check).toHaveBeenCalledTimes(2);

    target.emit("online");
    expect(watchdog.check).toHaveBeenCalledTimes(3);
  });

  it("分頁去咗背景唔會觸發檢查", () => {
    const target = fakeTarget();
    const document = fakeTarget();
    document.visibilityState = "hidden";
    target.document = document;
    const watchdog = fakeWatchdog();

    attachSessionWatchdog(watchdog, target);
    document.emit("visibilitychange");

    expect(watchdog.check).not.toHaveBeenCalled();
  });

  it("唔係由 bfcache 還原嘅 pageshow 唔算", () => {
    const target = fakeTarget();
    target.document = fakeTarget();
    const watchdog = fakeWatchdog();

    attachSessionWatchdog(watchdog, target);
    target.emit("pageshow", { persisted: false });

    expect(watchdog.check).not.toHaveBeenCalled();
  });

  it("真人操作先算活動，mousemove 唔算", () => {
    const target = fakeTarget();
    target.document = fakeTarget();
    const watchdog = fakeWatchdog();

    attachSessionWatchdog(watchdog, target);

    for (const type of ["pointerdown", "keydown", "scroll"]) {
      target.emit(type);
    }
    expect(watchdog.markActivity).toHaveBeenCalledTimes(3);

    // 游標掃過畫面、甚至有啲硬件自己抖都會觸發 mousemove，聽咗個閒置閘門就
    // 形同虛設。
    expect(target.handlers.mousemove).toBeUndefined();
  });

  it("拆除會解走所有 listener 同停 timer", () => {
    const target = fakeTarget();
    target.document = fakeTarget();
    const stopTimer = vi.fn();
    const watchdog = fakeWatchdog(stopTimer);

    const detach = attachSessionWatchdog(watchdog, target);
    detach();

    target.emit("keydown");
    expect(watchdog.markActivity).not.toHaveBeenCalled();
    expect(stopTimer).toHaveBeenCalledOnce();
  });
});
