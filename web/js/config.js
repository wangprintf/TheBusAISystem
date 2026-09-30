export const API_CONFIG = {
  // 部署时替换为实际后端地址，例如：https://api.example.com/api/v1
  baseUrl: 'http://81.70.233.75:8282',
  // 网页端使用后端数据库接口；演示数据仅保留在 api.js 中作为离线兜底。
  useMock: false,
  timeout: 10000,
};

// Tencent Maps GL JS API settings. The browser key must be restricted to the
// domains where this dashboard is deployed.
export const TENCENT_MAP_CONFIG = {
  key: 'ZADBZ-4WKKZ-ZQSXW-TBWZU-YJT6K-HBBHL',
  // Tianjin city center. Production data points will take precedence when
  // the alert API returns their real coordinates.
  center: { latitude: 39.084158, longitude: 117.200983 },
  zoom: 13,
};

// 填入 Dify 发布后“嵌入网站”里的 iframe src，也兼容 /chat/ 链接。
// 例如 https://ai.example.com/chatbot/应用分享码。禁止放置任何 API 密钥。
export const DIFY_AGENT_CONFIG = {
  enabled: true,
  embedUrl: 'http://81.70.233.75:8088/chat/bt1DI7264hhUz2T5',
};
