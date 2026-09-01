# 公交车 AI 前视系统（PC 管理后台）

这是一个无需构建工具即可运行的前端原型，覆盖数据总览、告警审核、工单、地图巡检、设备运维和系统配置。

## 运行

网页端代码位于 `web/`，可直接打开 `web/index.html`，或在项目目录执行：

```powershell
npx serve web
```

Android App 代码位于 `app/`，运行 `npm run android:sync` 时会将其构建到 Capacitor 的 `www/` 目录。两端的接口和数据模型可以继续分别维护，互不覆盖。

## 对接后端

页面不直接依赖 mock 数据；所有读取和写入均经由 `js/api.js`。接入后端时：

1. 在 `js/config.js` 把 `useMock` 改为 `false`，并配置 `baseUrl`。
2. 按 `js/api.js` 中的接口方法连接真实 REST API。
3. 保持接口返回字段与 `js/types.js` 的数据模型一致，或在 `api.js` 做字段转换。

推荐后端资源：`/dashboard`、`/alerts`、`/work-orders`、`/devices`、`/settings`。
