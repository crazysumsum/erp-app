import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

let application;

async function bootstrap() {
  const { TZ: zone, NODE_ENV: environment } = process.env;
  const offset = new Date().getTimezoneOffset();
  if ((zone !== "UTC" && zone !== "Etc/UTC") || offset !== 0) {
    const message = `Unsafe process time zone (TZ=${zone ?? "<unset>"}, getTimezoneOffset()=${offset} minutes). ` +
      "MySQL DATE values can shift by a day. Set TZ=UTC and configure the business time zone with APP_TIME_ZONE=Asia/Hong_Kong.";
    if (environment !== "test" && environment !== "development") throw new Error(message);
    console.warn(message);
  }

  const [{ createApplication }, { registerProcessLifecycle }] = await Promise.all([
    import("./framework/application/createApplication.js"),
    import("./framework/application/processLifecycle.js")
  ]);

  application = await createApplication({
    serviceDiscoveryOptions: {
      additionalModuleUrls: [
        new URL("./modules/businessMaster/BusinessMasterService.js", import.meta.url).href,
        new URL("./modules/supplier/SupplierProviderServices.js", import.meta.url).href
      ]
    }
  });
  registerProcessLifecycle({ application });

  const { url } = await application.start();
  console.log(`API listening on ${url}`);
}

bootstrap().catch(async (error) => {
  const { reportInternalFailure } = await import(
    "./framework/diagnostics/reportInternalFailure.js"
  );

  // 啟動失敗有可能發生在 logger 建立之前（設定錯誤就是最常見的一種），
  // 所以先無條件寫一份到 stderr，再嘗試走正規日誌。
  reportInternalFailure("application.startup_failed", error, {
    stack: error.stack || null
  });

  if (!application) {
    process.exitCode = 1;
    return;
  }

  await application.logger.error(
    "application.startup_failed",
    "API startup failed",
    {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    }
  );

  const result = await application.shutdown("startup_failure", 1);
  process.exitCode = result.exitCode;
});
