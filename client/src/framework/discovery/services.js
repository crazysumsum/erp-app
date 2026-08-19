const modules = import.meta.glob("../../services/**/*.js", { eager: true });

/**
 * 同 pages.js 一樣嘅機制：掃 src/services 底下嘅檔案，用每個檔案嘅
 * `export const service = { name: ... }` 做 key，`export default` 做拎到嗰個
 * service 本身。`globModules` 開放做參數方便測試，正式程式碼用返上面
 * import.meta.glob 掃到嘅結果。
 */
export function buildServiceRegistry(globModules = modules) {
  const registry = new Map();

  for (const [filePath, module] of Object.entries(globModules)) {
    if (!module.service?.name) {
      throw new Error(`Service 缺少 export const service = { name: ... }：${filePath}`);
    }
    if (registry.has(module.service.name)) {
      throw new Error(`Service name 重複：「${module.service.name}」`);
    }
    registry.set(module.service.name, module.default);
  }

  return registry;
}

const registry = buildServiceRegistry();

/**
 * 對應後端 container.require()：拎唔到就即刻拋錯，喺 setup() 呼叫嗰一刻就會
 * 見到，唔會拖到深層某個 async callback 先發現漏咗檔案。
 */
export function useService(name) {
  if (!registry.has(name)) {
    throw new Error(`Service "${name}" 未註冊，請確認 src/services/ 底下有對應檔案`);
  }
  return registry.get(name);
}
