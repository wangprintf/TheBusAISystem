# PatrolCloud 智巡助手部署

页面入口、动画和对话容器已完成。`web/js/config.js` 的 `DIFY_AGENT_CONFIG.embedUrl` 已配置为 `http://81.70.233.75:8088/chat/bt1DI7264hhUz2T5`，点击助手时加载 Dify 官方“嵌入到网站”提供的 iframe 页面，并允许麦克风权限。此目录保留新部署所需的配置生成器和可导入的工作流模板。

2026-09-30 检查：新应用的 `/chat/` 和 `/chatbot/` 地址均返回 HTTP 200，内容为 Dify 页面，页面配置为 `data-allow-embed="true"`，公开应用 API 指向 `http://81.70.233.75:8088/api`。当前检查确认页面和嵌入配置可用，尚未验证模型实际回答。

提供的服务 API 地址 `http://81.70.233.75/v1` 及其 `/info` 路径目前返回驾驶舱 HTML，尚未正确代理到 Dify。`http://81.70.233.75:8088/v1/info` 返回 Dify 的 JSON 401（缺少 Bearer 授权），因此如需服务端直连，应使用 `http://81.70.233.75:8088/v1` 并在服务端配置新应用的 API Key，或先修正 80 端口的 `/v1` 反向代理。当前 iframe 接入无需 API Key，服务 API 地址不用于 `embedUrl`，也不替换驾驶舱业务接口 `API_CONFIG.baseUrl`。

## 1. 启动官方 Dify

依据 [官方 Docker Compose 文档](https://docs.dify.ai/zh/self-host/deploy/quick-start/docker-compose)。使用 Dify 官方发布版自带的完整 Compose 文件，避免裁剪掉插件、沙箱、数据库等依赖。

准备至少 2 核 / 4 GiB 内存，Docker Compose 2.24.0+。Windows 使用启用 WSL 2 的 Docker Desktop，源码和容器数据建议放在 WSL 的 Linux 文件系统中。配置生成器需要 Node.js 20+。本机目前未检测到 Docker，以下命令留待部署环境执行。

从 [Dify Releases](https://github.com/langgenius/dify/releases) 选择支持 DSL 0.7.0 的正式版本，将下面的 `版本标签` 替换为该版本：

```sh
git clone --depth 1 --branch 版本标签 https://github.com/langgenius/dify.git dify-runtime
node deploy/dify/prepare-env.mjs ./dify-runtime/docker
cd dify-runtime/docker
docker compose config --quiet
docker compose up -d
docker compose ps
```

前两条命令从本项目根目录执行，也可以把 `dify-runtime` 换成服务器上的独立目录。生成器以官方 `.env.example` 为基础，保留完整配置，生成随机应用/数据库/Redis/插件/沙箱密钥，统一相关服务的配对密钥；拒绝覆盖已有 `.env`。

默认入口为 `http://localhost:8088/install`，初始化管理员后登录。HTTP 端口为 `8088`，HTTPS 映射端口为 `8443`，避免与现有网站的 80/443 端口冲突。`init_permissions` 成功执行后退出属于正常情况，其他必需服务应为 Up/healthy。

服务器部署时，在生成配置时指定实际的 Dify 地址，例如：

```sh
node deploy/dify/prepare-env.mjs /opt/dify/docker https://ai.example.com
```

将该独立域名的 HTTPS 站点反向代理到 `http://127.0.0.1:8088`，保留原始 Host 和 `X-Forwarded-Proto`，启用 WebSocket 转发，关闭响应缓冲并增加流式请求超时。不要把 Dify 整个站点放到 `/dify/` 子路径。若直接通过服务器 IP 试用，传入 `http://服务器IP:8088`。`localhost` 只适用于浏览器也在本机的情况。

生成器已设置 `ALLOW_EMBED=true`。根据 [官方环境变量说明](https://docs.dify.ai/zh/self-host/deploy/configuration/environments)，该设置允许 iframe 嵌入。反向代理也不能对 `/chatbot/` 页面附加 `X-Frame-Options: DENY/SAMEORIGIN`；如果配置了 CSP `frame-ancestors`，允许驾驶舱的实际来源。驾驶舱本身的 CSP `frame-src` 同样需要允许 Dify 域名。控制台访问权限按实际部署需求设置。

已有 Dify 的情况下不要重新生成密钥；只修改 `.env` 中的 `CONSOLE_API_URL`、`CONSOLE_WEB_URL`、`SERVICE_API_URL`、`APP_API_URL`、`APP_WEB_URL`、`FILES_URL` 为相同的公开地址，并设置 `ALLOW_EMBED=true`，再执行 `docker compose up -d`。更换运行中实例的数据库密码或加密密钥可能破坏现有数据访问。

## 2. 导入 PatrolCloud

1. 在工作室中选择“导入 DSL”，导入本目录的 `PatrolCloud.template.yml`。模板来自提供的 `PatrolCloud(1).yml`，保留原工作流、提示词、插件版本和节点连线；两个数据库工具节点的连接地址、库名、账号和密码已清空或替换为占位符。原文件未修改，模板不进入网页构建产物。
2. 按 Dify 提示安装 `langgenius/deepseek:0.0.24` 和 `jaguarliuu/rookie_text2data:1.0.3` 插件。如果该 Dify 版本不兼容原插件版本，请在 Dify 中选择兼容版本后验证工作流。
3. 在“设置 → 模型供应商”配置自己的 DeepSeek 凭证。原工作流多个节点选择了 `deepseek-flash`；若当前账户未提供该模型，需在问题分类器、LLM 节点及 `rookie_text2data` 的模型参数中统一选择可用模型。
4. 在 `rookie_text2data` 和 `rookie_excute_sql` 两个工具节点填入真实数据库 host、db_name、username、password，核对 port、db_type、schema/schema_name 和 table_names。使用只读数据库账号。原工作流会执行生成的 SQL，提示词限制不能代替数据库的只读授权。
5. 确认 Dify 插件容器能连接业务数据库。容器里的 `localhost` 指向容器自身；宿主机数据库需填写可达地址。数据库及模型凭证只配置在 Dify，不能放入 `web/`。
6. 在 Dify 中测试问候、工单查询和统计问题。核对业务表、时间字段、工单状态与实际数据库一致，再发布应用。

## 3.1 服务器反向代理必须分流

如果 `/chatbot/03n5FZtQFAgtqNO7` 打开后显示的是“智慧城市系统”首页，说明 Nginx 把 Dify 路由回退到了驾驶舱静态站点。Dify 官方 iframe 只有在 `/chatbot/` 被转发到 Dify Web 服务时才会显示聊天界面。

在同一个 Nginx `server { ... }` 中，把 Dify 路由放在驾驶舱静态站点的通用 `location /` 之前；将 `127.0.0.1:8088` 换成 Dify 的实际 Web/ Nginx 宿主机端口：

~~~nginx
location ^~ /chatbot/ {
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
    proxy_buffering off;
    proxy_pass http://127.0.0.1:8088;
}

location = /embed.min.js {
    proxy_set_header Host $http_host;
    proxy_pass http://127.0.0.1:8088/embed.min.js;
}

location / {
    # 这里才是现有驾驶舱网站的静态站点配置
}
~~~

如果 Dify 和驾驶舱使用不同域名，则不要把 `/chatbot/` 配在驾驶舱域名上；直接使用 Dify 域名生成的 iframe `src`。修改后执行 `nginx -t` 和 `nginx -s reload`，分别确认以下两个地址：

- `http://81.70.233.75:8088/chat/bt1DI7264hhUz2T5` 应显示 Dify 聊天界面，而不是“智慧城市系统”。
- `http://81.70.233.75:8088/embed.min.js` 应返回 Dify 的嵌入脚本，而不是驾驶舱登录 HTML。

`/embed.min.js` 和 `/chatbot/` 都返回驾驶舱 HTML 时，单纯修改前端无法修复服务器路由；必须先修正 Nginx 分流。

## 3. 接通驾驶舱

打开 PatrolCloud 的“发布 → 嵌入网站”，复制 iframe 的 `src`（无需 API Key），编辑 `web/js/config.js`：

```js
export const DIFY_AGENT_CONFIG = {
  enabled: true,
  embedUrl: 'https://ai.example.com/chatbot/实际应用分享码',
};
```

也支持 Dify 的 `/chat/分享码` 链接，会转换为 `/chatbot/分享码`。不要填写控制台 `/app/` 链接、API `/v1` 地址或整段 iframe HTML。HTTPS 驾驶舱必须使用 HTTPS 智能体地址。应用的访问控制在 Dify 配置，驾驶舱登录不会自动成为 Dify 的鉴权凭证。

```sh
npm run build:web
```

把 `web-dist/` 上传到现有网站目录。点击左上角助手时才加载 Dify；收起、重新展开以及驾驶舱定时刷新均保留 iframe 中的会话。重新加载网页或使用“重新连接”会重新加载嵌入页。输入和对话由 Dify 提供；实际样式以 Dify 发布设置为准。

## 4. 验证

确认左上角悬停动效、点击展开、展开宽度切换、关闭和键盘访问正常；未配置链接时为待连接状态。使用配置好的链接测试真实问答及 Dify 数据库权限，再测试关闭重开能保留会话。面板内 Esc 可关闭；焦点在跨域 iframe 内时按键由 Dify 处理，可用顶部关闭按钮或 Tab 到关闭按钮。

加载超时会提供重试及独立窗口。浏览器无法从跨域 iframe 的 load 事件判断 Dify 的业务状态；页面加载完成不会被标记为“服务在线”。若嵌入页空白或报错，先在独立窗口检查发布链接，再核对 HTTPS、代理 CSP/嵌入设置和 Dify 应用权限。

项目本地验证命令为 `node --test tests/*.test.mjs` 和 `npm run build:web`。`node tests/serve-dashboard-preview.mjs` 提供使用测试业务数据的本地预览：`/agent-preview` 按 `web/js/config.js` 加载配置的 Dify 地址（留空时展示待连接页面）；`/agent-connected-preview` 使用本地 iframe 替身验证会话保留，不调用真实 Dify。
