// 開機驗證錯（例如兩個頁面撞 name）要喺呢一步截停，唔可以帶住壞設定繼續跑
// 落去。刻意唔用 Vue／Quasar 畫呢個畫面：出事嗰陣連 app.mount() 都仲未行到，
// 用返最基本嘅 DOM API 先可靠，唔使假設任何框架已經初始化好。
export function renderFatalBootError(container, errors) {
  const items = errors
    .map((error) => `<li><code>${escapeHtml(error.filePath)}</code>：${escapeHtml(error.message)}</li>`)
    .join("");

  container.innerHTML = `
    <div style="font-family: system-ui, sans-serif; max-width: 640px; margin: 64px auto; padding: 24px; border: 1px solid #d32f2f; border-radius: 4px; background: #fff5f5; color: #333;">
      <h1 style="color: #d32f2f; font-size: 20px; margin: 0 0 12px;">應用程式設定有誤，無法啟動</h1>
      <p style="margin: 0 0 12px;">修好以下 ${errors.length} 個問題再重新整理：</p>
      <ul style="margin: 0; padding-left: 20px;">${items}</ul>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
