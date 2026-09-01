import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'web');
const output = resolve(root, 'web-dist');
const files = [
  'index.html',
  'styles.css',
  'alert-styles.css',
  'login.css',
  'login-custom.css',
  'app-custom.css',
  'map-custom.css',
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(files.map((file) => cp(resolve(source, file), resolve(output, file))));
await cp(resolve(source, 'js'), resolve(output, 'js'), { recursive: true });
await cp(resolve(source, 'assets'), resolve(output, 'assets'), { recursive: true });

console.log('网页资源已生成到 web-dist 目录。');
