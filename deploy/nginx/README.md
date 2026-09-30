# 旧版 Nginx 上传服务方案（当前网页不需要）

网页工单材料上传已改为浏览器直接 PUT 到 COS。不要按本文件启动 Node 上传服务或添加 `/api/events/finish/upload` 代理；这些步骤只适用于旧版服务端转发方案。当前部署只需发布新的 `web-dist/`（并包含本地生成的 `web/js/cos-direct-config.js`）以及在 COS 桶设置网页来源的 CORS，见 `deploy/cos/README.md`。

以下内容仅保留作旧配置参考：

你提供的 `http://81.70.233.75/` 当前由 Nginx 提供静态页面；访问 `/api/events/finish/upload` 返回 404，因此浏览器文件还没有进入 Node 上传服务，更不会进入 COS。

## 在宝塔服务器上启动上传服务

你使用的是宝塔。宝塔只负责 Nginx 静态站点和反向代理；Node 上传进程也必须在服务器上运行。

在宝塔「文件」中找到网站目录，上传并解压本项目的 `server/` 和 `scripts/`，并把 `web/js/config.js`、`package.json` 放在项目根目录。Linux 宝塔建议项目目录为 `/www/wwwroot/zhixunyun`；Windows 宝塔使用实际的网站目录。

Windows 服务器在宝塔终端执行：

把项目中的 `server/`、`scripts/start-web-upload.ps1`、`web/js/config.js` 和 `package.json` 放到服务器项目目录。服务器上必须保存 `SecretKey.csv`，格式仍是：

```csv
SecretId,SecretKey
你的SecretId,你的SecretKey
```

在服务器上启动：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\start-web-upload.ps1 -CredentialCsv C:\deploy-secrets\SecretKey.csv -BackendUrl http://127.0.0.1:8282
```

如果你的宝塔服务器是 Linux，不能运行 `.ps1`。请在宝塔「软件商店」安装 Node.js 22，然后使用下面的环境变量直接启动：

```bash
cd /www/wwwroot/zhixunyun
export TENCENT_COS_SECRET_ID='你的SecretId'
export TENCENT_COS_SECRET_KEY='你的SecretKey'
export WEB_API_UPSTREAM='http://127.0.0.1:8282'
WEB_UPLOAD_HOST=127.0.0.1 WEB_UPLOAD_PORT=8290 node server/web-finish-server.mjs
```

密钥只在服务器终端环境变量中设置，不要写入网页、Git 或 Nginx 配置。宝塔「Supervisor 管理器」可以把这条 Node 命令配置成守护进程，工作目录填 `/www/wwwroot/zhixunyun`，自动启动命令填 `node server/web-finish-server.mjs`，环境变量填上面三个值。

如果原登录/事件后端不在本机，把 `-BackendUrl` 换成后端的实际地址。保持窗口或服务进程运行。先在服务器上检查：

```powershell
Invoke-WebRequest http://127.0.0.1:8290/healthz
```

应返回 `{"ok":true,"service":"web-upload"}`。不要把 8290 直接暴露到公网，Nginx 通过本机回环地址转发即可。

## 宝塔 Nginx 配置

在宝塔「网站」→ 对应站点 →「设置」→「配置文件」，把 [upload-location.conf](upload-location.conf) 的 `location` 段放到现有的 `server { ... }` 内。不能放在 `http { ... }` 外，也不要再套一层 `server`：

```nginx
location = /api/events/finish/upload {
    client_max_body_size 200m;
    client_body_timeout 900s;
    proxy_connect_timeout 5s;
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;
    proxy_http_version 1.1;
    proxy_request_buffering off;
    proxy_set_header Host $http_host;
    proxy_set_header Connection "";
    proxy_pass http://127.0.0.1:8290;
}
```

点击「保存」后，宝塔通常会自动检查并重载 Nginx；也可以在宝塔终端执行：

```bash
nginx -t
nginx -s reload
```

如果宝塔运行在 Windows，使用宝塔对应的 Nginx 终端路径执行同样的 `nginx -t` 和 `nginx -s reload`。

## 验证

不用账号密码即可先检查入口是否接通：

```bash
curl.exe -i -X POST http://81.70.233.75/api/events/finish/upload -H "Content-Type: image/jpeg" --data-binary "@NUL"
```

如果代理成功，请求会由 Node 返回 JSON（通常是 `401 登录已失效`），不再是 Nginx 的 HTML `404`。再从 `http://81.70.233.75/` 登录后上传，页面会把请求发到同一域名，Nginx 转给 8290，Node 校验登录令牌后才写入 COS。

Node 日志、COS 权限、后端登录校验是三个独立环节：

- `404`：Nginx location 没配置或没有重载。
- `401`：登录令牌失效，重新登录。
- `503`：Node 没有读取到密钥、后端校验接口不可用，或上传服务异常。
- `502`：COS 拒绝写入或网络异常，检查服务器到 COS 的网络及密钥桶权限。
