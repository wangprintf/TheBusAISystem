export const HOVER_PIN_DELAY = 1000;

// Both charts use the same dwell state. Only an explicit close can dismiss a
// pinned popup; a preview belongs to one trigger, never to the popup itself.
export function createHoverPinState({ schedule = setTimeout, cancel = clearTimeout, onChange }) {
  let phase = 'hidden';
  let source = null;
  let timer = null;
  let generation = 0;
  let destroyed = false;
  const snapshot = () => ({ phase, source });
  function stop() { generation++; if (timer !== null) cancel(timer); timer = null; }
  function close() {
    if (destroyed || phase === 'hidden') return;
    stop(); phase = 'hidden'; source = null; onChange(snapshot());
  }
  return {
    snapshot,
    enter(control) {
      if (destroyed || !control || phase === 'pinned' || (phase === 'preview' && source === control)) return;
      stop(); phase = 'preview'; source = control;
      const ticket = generation;
      timer = schedule(() => {
        if (destroyed || ticket !== generation || phase !== 'preview' || source !== control) return;
        timer = null; phase = 'pinned'; onChange(snapshot());
      }, HOVER_PIN_DELAY);
      onChange(snapshot());
    },
    leave(control) { if (phase === 'preview' && source === control) close(); },
    cancelPreview() { if (phase === 'preview') close(); },
    close,
    destroy() { stop(); destroyed = true; phase = 'hidden'; source = null; },
  };
}

export function mountHoverPinPopup({ popup, controls, onShow, onHide }) {
  const doc = popup.ownerDocument;
  const view = doc.defaultView;
  const events = new view.AbortController();
  const closeButton = popup.querySelector('header button');
  const indicator = doc.createElement('div');
  indicator.className = 'hover-pin-indicator';
  indicator.setAttribute('role', 'status');
  indicator.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="hover-pin-track" cx="12" cy="12" r="9"/><circle class="hover-pin-progress" cx="12" cy="12" r="9" pathLength="100"/><path class="hover-pin-check" d="m8 12 3 3 5-6"/></svg><span></span>';
  closeButton.before(indicator);
  const ring = indicator.querySelector('.hover-pin-progress');
  const label = indicator.querySelector('span');
  let animation = null;
  let pointerSource = null;
  let restoringFocus = false;
  let lastSource = null;
  const state = createHoverPinState({
    schedule: (fn, ms) => view.setTimeout(fn, ms),
    cancel: id => view.clearTimeout(id),
    onChange({ phase, source }) {
      animation?.cancel(); animation = null;
      popup.dataset.pinState = phase;
      indicator.classList.toggle('is-pinned', phase === 'pinned');
      if (phase === 'hidden') { onHide(); return; }
      lastSource = source;
      label.textContent = phase === 'pinned' ? '已固定' : '1 秒后固定';
      indicator.title = phase === 'pinned' ? '小窗已固定，点击右上角 × 关闭' : '在当前扇区或状态框持续停留 1 秒即可固定';
      ring.style.strokeDashoffset = phase === 'pinned' ? '0' : '100';
      if (phase === 'preview') {
        animation = ring.animate([{ strokeDashoffset: '100' }, { strokeDashoffset: '0' }], { duration: HOVER_PIN_DELAY, easing: 'linear', fill: 'forwards' });
        onShow(source);
      }
    },
  });
  for (const control of controls) {
    control.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return;
      pointerSource = control; state.enter(control);
    }, { signal: events.signal });
    control.addEventListener('pointerleave', () => {
      if (pointerSource === control) pointerSource = null;
      state.leave(control);
    }, { signal: events.signal });
    control.addEventListener('pointercancel', () => {
      if (pointerSource === control) pointerSource = null;
      state.leave(control);
    }, { signal: events.signal });
    control.addEventListener('focus', () => {
      if (!restoringFocus && (pointerSource === control || control.matches(':focus-visible'))) state.enter(control);
    }, { signal: events.signal });
    control.addEventListener('blur', () => { if (pointerSource !== control) state.leave(control); }, { signal: events.signal });
    // A click must neither bypass nor restart the one-second dwell timer.
    // Keyboard/touch users can start the same timer from an activation.
    control.addEventListener('click', event => {
      if (pointerSource === control || event.detail === 0 || event.pointerType === 'touch') state.enter(control);
    }, { signal: events.signal });
    control.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      if (state.snapshot().phase === 'pinned') closeButton.focus();
      else state.enter(control);
    }, { signal: events.signal });
  }
  closeButton.addEventListener('click', () => {
    const opener = lastSource;
    state.close();
    restoringFocus = true;
    try { if (opener?.isConnected) opener.focus({ preventScroll: true }); }
    finally { restoringFocus = false; }
  }, { signal: events.signal });
  // Entering the popup cannot extend a short hover, even if it overlaps a trigger.
  popup.addEventListener('pointerenter', () => state.cancelPreview(), { signal: events.signal });
  doc.addEventListener('pointerdown', event => {
    const source = state.snapshot().source;
    if (!source?.contains(event.target)) state.cancelPreview();
  }, { signal: events.signal });
  doc.addEventListener('keydown', event => { if (event.key === 'Escape') state.cancelPreview(); }, { signal: events.signal });
  view.addEventListener('blur', () => { pointerSource = null; state.cancelPreview(); }, { signal: events.signal });
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) { pointerSource = null; state.cancelPreview(); } }, { signal: events.signal });
  return {
    validateSource() {
      const { phase, source } = state.snapshot();
      if (phase === 'preview' && (!source?.isConnected || !source.getClientRects().length)) state.cancelPreview();
    },
    destroy() { animation?.cancel(); state.destroy(); events.abort(); indicator.remove(); },
  };
}
