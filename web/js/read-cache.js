// Small session-scoped read cache. Redis remains on the API server.
export function createReadCache({ load, scope, ttlMs = 1000, now = Date.now }) {
  const entries = new Map();
  let currentScope;
  function syncScope() {
    const next = scope();
    if (next !== currentScope) { entries.clear(); currentScope = next; }
    return next;
  }
  function invalidate(keys) {
    syncScope();
    for (const key of keys) entries.set(key, { fresh: true });
  }
  async function read(key, { fresh = false } = {}) {
    const requestScope = syncScope();
    let entry = entries.get(key);
    if (fresh && !(entry?.pending && entry.fresh)) { entry = { fresh: true }; entries.set(key, entry); }
    if (!entry) { entry = {}; entries.set(key, entry); }
    if (entry.value !== undefined && entry.expiresAt > now() && !entry.fresh) return structuredClone(entry.value);
    if (!entry.pending) {
      entry.pending = Promise.resolve().then(() => load(key, { fresh: Boolean(entry.fresh) })).then(value => {
        if (scope() !== requestScope) throw new Error('登录状态已变化，请重新加载数据');
        // A write replaces the entry. Retry instead of returning or storing the old response.
        if (entries.get(key) !== entry) return read(key);
        entry.value = value;
        entry.expiresAt = now() + ttlMs;
        entry.fresh = false;
        return value;
      }).finally(() => { entry.pending = null; });
    }
    return structuredClone(await entry.pending);
  }
  return { read, invalidate };
}
