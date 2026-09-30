# COS 浏览器直传配置

前端现在直接向 `traffic-events-finish-1451604295.cos.ap-beijing.myqcloud.com` 发起 `PUT`，Node、Nginx 和数据库后端不会接收图片字节。数据库原有扫描任务仍按对象 key 自动同步材料。

COS 控制台「安全管理」→「跨域访问 CORS 设置」中，需要允许网页来源和 `PUT` 方法。可按 [direct-upload-cors.xml](direct-upload-cors.xml) 配置；如果桶已有等价规则，不需要重复添加。

来源必须与地址栏中的协议、主机和端口完全一致：`http://127.0.0.1:5500`、`http://localhost:5500`、`http://81.70.233.75` 是三个不同来源。只添加服务器 IP 不能使本地 Live Server 网页上传成功。已有 App 规则应保留，新增网页规则即可。

可运行 `node scripts/check-cos-direct.mjs http://127.0.0.1:5500/web-dist/index.html` 只读检查当前页面目录的脚本和 COS 预检响应。`OPTIONS` 应返回 200，且 `Access-Control-Allow-Origin` 应与实际网页来源相同。`node scripts/fix-cos-local-cors.mjs` 仅显示补充本地规则的方案，加 `--apply` 才会备份并更新桶 CORS；不会上传或删除桶内文件。

直传使用 `web/js/cos-direct-config.js` 中的账号密钥生成签名。该文件是本地生成的部署配置，已加入 `.gitignore`，不会被 Git 自动提交；发布网页时必须把它和 `web/js/` 一起上传，否则页面会提示直传配置缺失。

验证浏览器开发者工具的 Network：上传文件时应该看到对 COS 域名的 `OPTIONS`（预检）和 `PUT`，请求体直接是图片；不应再看到 `/api/events/finish/upload` 携带图片内容。
