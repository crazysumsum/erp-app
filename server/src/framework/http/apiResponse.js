function responseMeta(res, additionalMeta = {}, time) {
  if (!time || typeof time.timestamp !== "function") {
    throw new TypeError("API response requires a time service");
  }

  return {
    requestId:
      res.req?.requestId || res.getHeader?.("x-request-id") || null,
    timestamp: time.timestamp(),
    ...additionalMeta
  };
}

export function sendSuccess(
  res,
  data,
  { statusCode = 200, meta = {}, time } = {}
) {
  // API JSON 回應（包括 login/logout/me）往往帶有存取權限或個人資料，不應被
  // 瀏覽器或中介快取保留，同 fileResponse.js 嘅下載回應同一個理由。
  res.setHeader("Cache-Control", "no-store");
  return res.status(statusCode).json({
    success: true,
    data: data ?? null,
    meta: responseMeta(res, meta, time)
  });
}

export function sendError(
  res,
  {
    statusCode = 500,
    code = "INTERNAL_SERVER_ERROR",
    message = "Internal server error",
    details,
    meta = {},
    time
  } = {}
) {
  const error = { code, message };

  if (details !== undefined) {
    error.details = details;
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(statusCode).json({
    success: false,
    error,
    meta: responseMeta(res, meta, time)
  });
}
