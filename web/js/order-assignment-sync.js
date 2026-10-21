/** Keep the open order's assignment current without replacing its media or form. */
export function startOrderAssignmentSync({ orderId, load, onUpdate, isActive, doc = document, intervalMs = 5000 }) {
  let disposed = false;
  let pending = false;
  function active() {
    if (disposed) return false;
    if (!isActive()) { destroy(); return false; }
    return !doc.hidden;
  }
  async function refresh() {
    if (!active() || pending) return;
    pending = true;
    try {
      const rows = await load();
      if (!active()) return;
      const assignment = rows.find(row => String(row.id) === String(orderId));
      onUpdate(assignment || { matchId: null, assignee: '待分配' });
    } catch {
      // Keep the last displayed value on transient failures; the next tick retries.
    } finally {
      pending = false;
    }
  }
  function onVisible() { if (!doc.hidden) void refresh(); }
  function destroy() {
    if (disposed) return;
    disposed = true;
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', onVisible);
  }
  const timer = setInterval(() => { void refresh(); }, intervalMs);
  doc.addEventListener('visibilitychange', onVisible);
  void refresh();
  return { refresh, destroy };
}
