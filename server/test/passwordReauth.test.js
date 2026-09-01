import assert from "node:assert/strict";
import test from "node:test";
import { assertPasswordConfirmed } from "../src/services/auth/passwordReauth.js";
import { AUTH_FAILURE } from "../src/modules/user/UserService.js";

// 兩個 strategy（jwt-password、jwt-device-password）共用這個函式；各自的測試
// 只管「先驗什麼、後驗什麼」，這裡直接測函式本身：每一種 verifyPasswordById
// 的失敗原因，映射到哪一個對外錯誤碼。

function collectingLogger() {
  const entries = [];
  const write = (level) => async (event, message, context) => {
    entries.push({ level, event, message, context });
  };
  return { entries, debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

function fakeRequest(body) {
  return { requestId: "req-1", body };
}

function userServiceReturning(result) {
  const calls = [];
  return {
    calls,
    async verifyPasswordById(userId, password) {
      calls.push({ userId, password });
      return result;
    }
  };
}

test("resolves without error when the password is confirmed", async () => {
  const userService = userServiceReturning({ ok: true });

  await assert.doesNotReject(() =>
    assertPasswordConfirmed(fakeRequest({ password: "correct" }), {
      userId: 7,
      userService,
      logger: collectingLogger()
    })
  );

  assert.deepEqual(userService.calls, [{ userId: 7, password: "correct" }]);
});

test("a missing password is rejected before verifyPasswordById is ever called", async () => {
  const userService = userServiceReturning({ ok: true });

  await assert.rejects(
    () =>
      assertPasswordConfirmed(fakeRequest({}), {
        userId: 7,
        userService,
        logger: collectingLogger()
      }),
    (error) => {
      assert.equal(error.code, "PASSWORD_REQUIRED");
      assert.equal(error.statusCode, 400);
      return true;
    }
  );

  assert.deepEqual(userService.calls, []);
});

test("an empty string password is rejected the same way a missing one is", async () => {
  const userService = userServiceReturning({ ok: true });

  await assert.rejects(
    () =>
      assertPasswordConfirmed(fakeRequest({ password: "" }), {
        userId: 7,
        userService,
        logger: collectingLogger()
      }),
    { code: "PASSWORD_REQUIRED" }
  );
});

test("bad password, unknown user and locked account all collapse into PASSWORD_INVALID", async () => {
  for (const reason of [AUTH_FAILURE.BAD_PASSWORD, AUTH_FAILURE.UNKNOWN_USER, AUTH_FAILURE.LOCKED]) {
    const userService = userServiceReturning({ ok: false, reason });

    await assert.rejects(
      () =>
        assertPasswordConfirmed(fakeRequest({ password: "x" }), {
          userId: 7,
          userService,
          logger: collectingLogger()
        }),
      (error) => {
        assert.equal(error.code, "PASSWORD_INVALID", `reason ${reason} should collapse to PASSWORD_INVALID`);
        assert.equal(error.statusCode, 403);
        return true;
      }
    );
  }
});

test("a disabled account gets USER_INACTIVE, not the generic password-invalid code", async () => {
  const userService = userServiceReturning({ ok: false, reason: AUTH_FAILURE.DISABLED });

  await assert.rejects(
    () =>
      assertPasswordConfirmed(fakeRequest({ password: "x" }), {
        userId: 7,
        userService,
        logger: collectingLogger()
      }),
    (error) => {
      assert.equal(error.code, "USER_INACTIVE");
      assert.equal(error.statusCode, 401);
      return true;
    }
  );
});

test("an expired temporary password gets its own actionable code", async () => {
  const userService = userServiceReturning({ ok: false, reason: AUTH_FAILURE.TEMPORARY_EXPIRED });

  await assert.rejects(
    () =>
      assertPasswordConfirmed(fakeRequest({ password: "x" }), {
        userId: 7,
        userService,
        logger: collectingLogger()
      }),
    (error) => {
      assert.equal(error.code, "TEMPORARY_PASSWORD_EXPIRED");
      assert.equal(error.statusCode, 401);
      return true;
    }
  );
});

test("a rejection is logged with the real reason, even though the response collapses it", async () => {
  const logger = collectingLogger();
  const userService = userServiceReturning({ ok: false, reason: AUTH_FAILURE.BAD_PASSWORD });

  await assert.rejects(() =>
    assertPasswordConfirmed(fakeRequest({ password: "x" }), { userId: 7, userService, logger })
  );

  const entry = logger.entries.find((e) => e.event === "auth.password.rejected");
  assert.ok(entry);
  assert.equal(entry.context.reason, AUTH_FAILURE.BAD_PASSWORD);
  assert.equal(entry.context.userId, 7);
});
