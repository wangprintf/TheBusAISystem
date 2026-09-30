// Prepare a fresh OFFICIAL Dify docker checkout; never rewrite a running .env.
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

export function createDifyEnv(template, publicUrl = 'http://localhost:8088') {
  if (/[\s$\u0000-\u001f]/.test(publicUrl)) throw new Error('公开地址不能包含空白、控制字符或环境变量');
  const url = new URL(publicUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('公开地址必须为 HTTP(S) 域名或 IP（可带端口），不要包含路径、账号或参数');
  }
  const secret = () => randomBytes(32).toString('hex');
  const redisPassword = secret();
  const sandboxKey = secret();
  const pluginKey = secret();
  const innerKey = secret();
  const values = {
    CONSOLE_API_URL: url.origin,
    CONSOLE_WEB_URL: url.origin,
    SERVICE_API_URL: url.origin,
    APP_API_URL: url.origin,
    APP_WEB_URL: url.origin,
    FILES_URL: url.origin,
    EXPOSE_NGINX_PORT: '8088',
    EXPOSE_NGINX_SSL_PORT: '8443',
    // TLS terminates at the existing website's reverse proxy.
    NGINX_HTTPS_ENABLED: 'false',
    ALLOW_EMBED: 'true',
    SECRET_KEY: secret(),
    DB_PASSWORD: secret(),
    REDIS_PASSWORD: redisPassword,
    CELERY_BROKER_URL: `redis://:${redisPassword}@redis:6379/1`,
    CODE_EXECUTION_API_KEY: sandboxKey,
    SANDBOX_API_KEY: sandboxKey,
    PLUGIN_DAEMON_KEY: pluginKey,
    PLUGIN_DIFY_INNER_API_KEY: innerKey,
    // Current releases derive these from the corresponding Compose keys.
    INNER_API_KEY_FOR_PLUGIN: innerKey,
  };
  let output = template.replace(/\r\n/g, '\n');
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${key}=.*$`, 'gm');
    output = pattern.test(output)
      ? output.replace(pattern, `${key}=${value}`)
      : `${output.trimEnd()}\n${key}=${value}\n`;
  }
  return output;
}

export async function prepareEnv(dockerDir, publicUrl) {
  const directory = resolve(dockerDir);
  const target = resolve(directory, '.env');
  try {
    await access(target);
    throw new Error('该目录已有 .env，未作修改；请按部署说明手动调整 URL 和端口，保留现有密钥');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const template = await readFile(resolve(directory, '.env.example'), 'utf8');
  const output = createDifyEnv(template, publicUrl);
  await writeFile(target, output, { flag: 'wx', mode: 0o600 });
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, publicUrl] = process.argv.slice(2);
  if (!directory) {
    console.error('用法：node deploy/dify/prepare-env.mjs <Dify 的 docker 目录> [公开地址，默认 http://localhost:8088]');
    process.exitCode = 1;
  } else {
    try {
      const target = await prepareEnv(directory, publicUrl);
      console.log(`已生成 ${target}（随机密钥已写入文件，不在终端输出）。`);
      console.log('下一步：在该 docker 目录运行 docker compose config --quiet 和 docker compose up -d。');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
