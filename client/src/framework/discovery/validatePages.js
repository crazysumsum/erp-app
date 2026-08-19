import menuConfig from "@config/menu.js";

const menuGroupNames = new Set(menuConfig.groups.map((group) => group.name));
const REQUIRED_STRING_FIELDS = ["name", "path", "title"];

/**
 * 逐個頁面檢查 metadata：必填欄位齊唔齊、name/path 撞唔撞、menu.group 有冇
 * 定義、requires 個形狀啱唔啱。回傳錯誤陣列（每個帶埋邊個檔案），唔喺呢度
 * 拋錯——等 caller（main.js）攞晒所有錯誤一次過顯示，唔使改一個先至見到
 * 下一個。
 */
export function validatePages(discovered) {
  const errors = [];
  const seenNames = new Map();
  const seenPaths = new Map();

  for (const { filePath, page, component } of discovered) {
    if (!page) {
      errors.push({ filePath, message: "冇 export const page" });
      continue;
    }
    if (!component) {
      errors.push({ filePath, message: "冇 export default（Vue 元件本身）" });
      continue;
    }

    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof page[field] !== "string" || !page[field].trim()) {
        errors.push({ filePath, message: `page.${field} 必須係非空字串` });
      }
    }

    if (typeof page.path === "string" && !page.path.startsWith("/")) {
      errors.push({ filePath, message: `page.path 必須以「/」開頭：「${page.path}」` });
    }

    if (typeof page.name === "string") {
      recordUnique(errors, seenNames, filePath, page.name, "page.name");
    }

    if (typeof page.path === "string") {
      recordUnique(errors, seenPaths, filePath, page.path, "page.path");
    }

    if (page.public !== undefined && typeof page.public !== "boolean") {
      errors.push({ filePath, message: "page.public 必須係 boolean" });
    }

    if (page.menu !== undefined) {
      errors.push(...validateMenu(filePath, page.menu));
    }

    if (page.requires !== undefined) {
      errors.push(...validateRequires(filePath, page.requires));
    }
  }

  return errors;
}

function recordUnique(errors, seen, filePath, value, label) {
  if (seen.has(value)) {
    errors.push({ filePath, message: `${label} 重複：「${value}」（同 ${seen.get(value)} 撞）` });
  } else {
    seen.set(value, filePath);
  }
}

function validateMenu(filePath, menu) {
  if (typeof menu !== "object" || menu === null) {
    return [{ filePath, message: "page.menu 必須係物件" }];
  }

  const errors = [];

  if (typeof menu.group !== "string" || !menuGroupNames.has(menu.group)) {
    errors.push({
      filePath,
      message: `page.menu.group「${menu.group}」冇喺 config/menu.js 定義（現有：${[...menuGroupNames].join("、")}）`
    });
  }
  if (typeof menu.order !== "number" || !Number.isFinite(menu.order)) {
    errors.push({ filePath, message: "page.menu.order 必須係數字" });
  }
  if (typeof menu.icon !== "string" || !menu.icon.trim()) {
    errors.push({ filePath, message: "page.menu.icon 必須係非空字串" });
  }

  return errors;
}

function validateRequires(filePath, requires) {
  if (typeof requires !== "object" || requires === null) {
    return [{ filePath, message: "page.requires 必須係物件" }];
  }

  const errors = [];

  for (const key of ["roles", "permissions"]) {
    if (requires[key] === undefined) {
      continue;
    }
    const isValidStringArray =
      Array.isArray(requires[key]) && requires[key].every((value) => typeof value === "string" && value.trim());
    if (!isValidStringArray) {
      errors.push({ filePath, message: `page.requires.${key} 必須係非空字串陣列` });
    }
  }

  if (requires.match !== undefined && !["all", "any"].includes(requires.match)) {
    errors.push({ filePath, message: 'page.requires.match 必須係 "all" 或 "any"' });
  }

  return errors;
}
