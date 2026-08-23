// Capacitor WebView 环境模拟（由 cap-sim-server 注入，不入 APK）
// 定义 window.Capacitor 与 CapacitorHttp 桩：post 走 /llm-proxy（服务端转发，模拟原生无 CORS 网络）
window.Capacitor = {
  isNativePlatform: () => true,
  Plugins: {
    CapacitorHttp: {
      post(options) {
        return fetch('/llm-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: options.url, headers: options.headers, data: options.data })
        }).then(async r => {
          const j = await r.json();
          if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
          return j; // { data: parsedJSON } 与 CapacitorHttp 返回结构一致
        });
      }
    }
  }
};
console.log('[cap-mock] window.Capacitor 已注入（CapacitorHttp → /llm-proxy）');
