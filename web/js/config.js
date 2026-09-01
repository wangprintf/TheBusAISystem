export const API_CONFIG = {
  // 部署时替换为实际后端地址，例如：https://api.example.com/api/v1
  baseUrl: 'http://81.70.233.75:8282',
  useMock: true,
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
