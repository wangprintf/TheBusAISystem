import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDifyEmbedUrl } from '../web/js/patrol-agent.js';
import { createDifyEnv, prepareEnv } from '../deploy/dify/prepare-env.mjs';

test('Dify links: accept published apps, normalize chat and remove URL parameters', () => {
  const page = 'https://dashboard.example.com';
  assert.equal(buildDifyEmbedUrl('', page), '');
  assert.equal(buildDifyEmbedUrl(' https://ai.example.com/chat/abc_123-X?token=remove#test ', page), 'https://ai.example.com/chatbot/abc_123-X');
  assert.equal(buildDifyEmbedUrl('http://localhost:8088/chatbot/demo', 'http://localhost:8290'), 'http://localhost:8088/chatbot/demo');
  assert.equal(buildDifyEmbedUrl('http://81.70.233.75/chatbot/03n5FZtQFAgtqNO7', 'http://localhost:8290'), 'http://81.70.233.75/chatbot/03n5FZtQFAgtqNO7');
  assert.equal(buildDifyEmbedUrl('http://81.70.233.75:8088/chat/RDUsXMi2jW9sGdnt', 'http://localhost:8290'), 'http://81.70.233.75:8088/chatbot/RDUsXMi2jW9sGdnt');
});

test('Dify links: reject executable URLs, credentials, console/API URLs and mixed content', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,test', '//example.com/chatbot/a', 'https://user:secret@example.com/chatbot/a', 'https://ai.example.com/app/a', 'https://ai.example.com/v1', 'https://ai.example.com/chatbot/', 'http://ai.example.com/chatbot/a']) {
    assert.throws(() => buildDifyEmbedUrl(value, 'https://dashboard.example.com'), value);
  }
});

const envValues = text => Object.fromEntries(text.split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => [line.slice(0,line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

test('Dify configuration preserves upstream settings and keeps paired secrets consistent', () => {
  const template = '# official defaults\r\nDB_HOST=db_postgres\r\nDB_PASSWORD=default\r\nREDIS_PASSWORD=default\r\nCELERY_BROKER_URL=redis://:default@redis:6379/1\r\nVECTOR_STORE=weaviate\r\n';
  const values = envValues(createDifyEnv(template, 'https://ai.example.com'));
  assert.equal(values.DB_HOST, 'db_postgres');
  assert.equal(values.VECTOR_STORE, 'weaviate');
  assert.equal(values.APP_WEB_URL, 'https://ai.example.com');
  assert.equal(values.ALLOW_EMBED, 'true');
  assert.equal(values.EXPOSE_NGINX_PORT, '8088');
  assert.equal(values.CELERY_BROKER_URL, `redis://:${values.REDIS_PASSWORD}@redis:6379/1`);
  assert.equal(values.CODE_EXECUTION_API_KEY, values.SANDBOX_API_KEY);
  assert.equal(values.INNER_API_KEY_FOR_PLUGIN, values.PLUGIN_DIFY_INNER_API_KEY);
  assert.match(values.SECRET_KEY, /^[a-f0-9]{64}$/);
  assert.match(values.DB_PASSWORD, /^[a-f0-9]{64}$/);
  assert.notEqual(values.SECRET_KEY, envValues(createDifyEnv(template)).SECRET_KEY);
  assert.notEqual(values.DB_PASSWORD, values.REDIS_PASSWORD);
});

test('Dify configuration rejects paths, credentials, and injected env lines in the public URL', () => {
  for (const origin of ['file:///tmp/a', 'https://user:pw@ai.example.com', 'https://ai.example.com/dify/', 'https://ai.example.com?a=b', 'https://ai.example.com/#fragment', 'https://ai.example.com\nNEW_KEY=value']) {
    assert.throws(() => createDifyEnv('', origin), origin);
  }
});

test('Dify setup creates an env once and never rotates an existing deployment secret', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'patrol-dify-test-'));
  try {
    await writeFile(join(dir, '.env.example'), 'DB_HOST=db_postgres\n');
    const file = await prepareEnv(dir);
    const original = await readFile(file, 'utf8');
    await assert.rejects(() => prepareEnv(dir, 'https://new.example.com'), /已有 .env/);
    assert.equal(await readFile(file, 'utf8'), original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
