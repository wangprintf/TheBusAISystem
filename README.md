# 公交车 AI 前视系统（PC 管理后台）

这是一个无需构建工具即可运行的前端原型，覆盖数据总览、告警审核、工单、地图巡检、设备运维和系统配置。

## 运行

网页端代码位于 `web/`，可直接打开 `web/index.html`，或在项目目录执行：

```powershell
npx serve web
```

## 对接后端

页面不直接依赖 mock 数据；所有读取和写入均经由 `web/js/api.js`。接入后端时：

1. 在 `web/js/config.js` 把 `useMock` 改为 `false`，并配置 `baseUrl`。
2. 按 `web/js/api.js` 中的接口方法连接真实 REST API。
3. 保持接口返回字段与 `web/js/types.js` 的数据模型一致，或在 `web/js/api.js` 做字段转换。

推荐后端资源：`/dashboard`、`/alerts`、`/work-orders`、`/devices`、`/settings`。

## 工单处理后材料上传

网页工单详情支持多选图片/视频、逐项进度和失败重试（每批最多 10 个、单文件最大 200 MB）。浏览器把文件直接 PUT 到腾讯云 COS；上传文件不会经过本网站的 Node 上传服务、Nginx 上传接口或数据库后端。原有扫描任务按对象 key 从桶同步材料到数据库。

部署前，在 COS 桶 CORS 中允许网页来源执行 `PUT`，可参考 `deploy/cos/direct-upload-cors.xml`。然后构建网页：

```powershell
npm run build:web
```

将生成的 `web-dist/` 文件上传到宝塔网站目录。构建会包含本机生成的 `web/js/cos-direct-config.js`；该文件已被 Git 忽略，因此用 Git 拉取或复制源码部署时要单独带上它。无须启动 `start-web-upload.ps1`，也无须配置 `/api/events/finish/upload` 的 Nginx 代理。

上传对象使用 `/工单编号.UUID.jpg` 或 `/工单编号.UUID.mp4`，以兼容现有扫描程序。PNG/WEBP 会在浏览器转换成 JPG，透明区域填白；其他视频格式需先转成 MP4。上传成功会立即显示临时预览，之后由原有扫描与查询接口同步并持久展示。

验证：`node --test tests/*.test.mjs` 和 `npm run build:web`。测试只使用本地替身，不向真实 COS 桶写入文件。

## 智巡助手（Dify）

驾驶舱左上角提供 PatrolCloud 智能体入口，支持悬停动画和可收起的对话面板。`web/js/config.js` 的 `DIFY_AGENT_CONFIG.embedUrl` 已更新为 `http://81.70.233.75:8088/chat/bt1DI7264hhUz2T5`，打开助手时自动使用对应的 `/chatbot/` 嵌入页面，无需 API Key。更换智能体时更新该发布链接并重新构建部署；未配置时显示待连接状态。服务 API 地址及连通性检查见 [部署说明](deploy/dify/README.md)。
