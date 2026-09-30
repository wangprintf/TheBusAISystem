import { DIFY_AGENT_CONFIG } from './config.js';

const iconUrl = new URL('../assets/patrol-agent.png', import.meta.url).href;

// Only published Dify chat pages belong here, never service API keys.
export function buildDifyEmbedUrl(value, pageUrl) {
  if (!String(value || '').trim()) return '';
  const url = new URL(String(value).trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('请使用 Dify 发布的 HTTP(S) 应用链接');
  }
  if (new URL(pageUrl).protocol === 'https:' && url.protocol !== 'https:') {
    throw new Error('HTTPS 网页需要使用 HTTPS 智能体链接');
  }
  if (!/^\/(?:chat|chatbot)\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)) {
    throw new Error('请使用 Dify 发布后的 /chatbot/ 或 /chat/ 链接');
  }
  url.pathname = url.pathname.replace(/^\/chat\//, '/chatbot/');
  url.search = '';
  url.hash = '';
  return url.href;
}

export function mountPatrolAgent(root, config = DIFY_AGENT_CONFIG) {
  if (!root || config.enabled === false) return null;
  let embedUrl = '';
  let invalidConfig = false;
  try { embedUrl = buildDifyEmbedUrl(config.embedUrl, window.location.href); }
  catch { invalidConfig = true; }

  root.innerHTML = `<button class="patrol-agent-launcher" type="button" aria-label="打开智巡助手" aria-haspopup="dialog" aria-expanded="false" aria-controls="patrol-agent-panel">
    <span class="patrol-agent-orb" aria-hidden="true"><span class="patrol-agent-orbit"></span><img src="${iconUrl}" alt="" width="58" height="58"><i class="patrol-agent-spark spark-one">✦</i><i class="patrol-agent-spark spark-two">✦</i></span>
    <span class="patrol-agent-label"><span class="patrol-agent-eyebrow">PATROLCLOUD <span>AI</span></span><strong>智巡助手</strong><span class="patrol-agent-caption">巡检有数 · 随问随答</span></span>
    <span class="patrol-agent-launch-arrow" aria-hidden="true">↗</span>
  </button>`;
  const launcher = root.querySelector('button');
  const panel = document.createElement('section');
  panel.id = 'patrol-agent-panel';
  panel.className = 'patrol-agent-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'patrol-agent-title');
  panel.innerHTML = `<header class="patrol-agent-head">
    <img src="${iconUrl}" alt="" width="36" height="36">
    <div class="patrol-agent-heading"><h2 id="patrol-agent-title">智巡助手 <span>AI</span></h2><p>PatrolCloud · 城市巡检智能体</p></div>
    <button class="patrol-agent-icon-button" type="button" data-agent-close aria-label="关闭智巡助手" title="关闭（Esc）">×</button>
  </header>
  <span class="patrol-agent-resize-handle patrol-agent-resize-n" data-resize="n" aria-hidden="true"></span><span class="patrol-agent-resize-handle patrol-agent-resize-ne" data-resize="ne" aria-hidden="true"></span><span class="patrol-agent-resize-handle patrol-agent-resize-e" data-resize="e" aria-hidden="true"></span><span class="patrol-agent-resize-handle patrol-agent-resize-se" data-resize="se" aria-hidden="true"></span><span class="patrol-agent-resize-handle patrol-agent-resize-s" data-resize="s" aria-hidden="true"></span><span class="patrol-agent-resize-handle patrol-agent-resize-sw" data-resize="sw" aria-hidden="true"></span><span class="patrol-agent-resize-handle patrol-agent-resize-w" data-resize="w" aria-hidden="true"></span><span class="patrol-agent-resize-handle patrol-agent-resize-nw" data-resize="nw" aria-hidden="true"></span>
  <div class="patrol-agent-body">
    <div class="patrol-agent-welcome">
      <div class="patrol-agent-welcome-art" aria-hidden="true"><img src="${iconUrl}" alt="" width="92" height="92"><span>✦</span></div>
      <p class="patrol-agent-welcome-kicker">YOUR CITY COPILOT</p>
      <h3>你好，我是智巡助手</h3>
      <p class="patrol-agent-intro">从一条提问开始，<br>让城市巡检多一份洞察。</p>
      <div class="patrol-agent-capabilities" aria-label="连接后可咨询的问题">
        <div><span aria-hidden="true">⌕</span><p><b>工单查询</b><small>查看当前有哪些待处理工单</small></p><i aria-hidden="true">↗</i></div>
        <div><span aria-hidden="true">▥</span><p><b>巡检统计</b><small>了解近期告警与工单分布</small></p><i aria-hidden="true">↗</i></div>
        <div><span aria-hidden="true">◷</span><p><b>处置追踪</b><small>查询重点工单的处理进展</small></p><i aria-hidden="true">↗</i></div>
      </div>
      <p class="patrol-agent-connection-note" role="status"><span></span>${invalidConfig ? '智能助手暂时不可用，请联系管理员' : '等待接通智能体，连接后即可开始对话'}</p>
    </div>
    <div class="patrol-agent-frame-state" role="status" hidden><span class="patrol-agent-loader" aria-hidden="true"></span><p data-agent-state-text>正在打开智能助手…</p><button type="button" class="patrol-agent-retry" hidden>重新连接</button></div>
  </div>
  <footer class="patrol-agent-footer">
    <div class="patrol-agent-composer"><textarea aria-label="向智巡助手提问" placeholder="连接后，输入你想了解的问题…" rows="1" disabled></textarea><button type="button" aria-label="发送（等待连接）" disabled>↑</button></div>
    <div class="patrol-agent-footnote"><span class="patrol-agent-state-label">${invalidConfig ? '暂不可用' : '待连接'}</span><span>城市有序，巡检有智</span><a hidden target="_blank" rel="noopener noreferrer">独立窗口 ↗</a></div>
  </footer>`;
  document.body.append(panel);

  const closeButton = panel.querySelector('[data-agent-close]');
  const welcome = panel.querySelector('.patrol-agent-welcome');
  const frameState = panel.querySelector('.patrol-agent-frame-state');
  const stateText = panel.querySelector('[data-agent-state-text]');
  const retryButton = panel.querySelector('.patrol-agent-retry');
  const statusLabel = panel.querySelector('.patrol-agent-state-label');
  const externalLink = panel.querySelector('a');
  let frame = null;
  let loadTimer;
  let destroyed = false;

  // Keep the floating panel usable as a desktop tool: drag from its header and resize from any edge.
  const resizeHandles = [...panel.querySelectorAll('[data-resize]')];
  const minPanelWidth = 320;
  const minPanelHeight = 360;
  let interaction = null;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function setPanelBounds(bounds) {
    panel.style.left = Math.round(bounds.left) + 'px';
    panel.style.top = Math.round(bounds.top) + 'px';
    panel.style.width = Math.round(bounds.width) + 'px';
    panel.style.height = Math.round(bounds.height) + 'px';
  }

  function finishInteraction(event) {
    if (!interaction || (event && event.pointerId !== interaction.pointerId)) return;
    panel.classList.remove('is-dragging', 'is-resizing');
    interaction = null;
    document.body.style.removeProperty('cursor');
  }

  function updateInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (interaction.type === 'drag') {
      const left = clamp(interaction.left + dx, 8 - (interaction.width - 96), viewportWidth - 96);
      const top = clamp(interaction.top + dy, 8, viewportHeight - 96);
      setPanelBounds({ left: left, top: top, width: interaction.width, height: interaction.height });
      return;
    }
    const direction = interaction.direction;
    let left = interaction.left;
    let top = interaction.top;
    let right = interaction.left + interaction.width;
    let bottom = interaction.top + interaction.height;
    if (direction.includes('e')) right = clamp(right + dx, left + minPanelWidth, viewportWidth - 8);
    if (direction.includes('s')) bottom = clamp(bottom + dy, top + minPanelHeight, viewportHeight - 8);
    if (direction.includes('w')) left = clamp(left + dx, 8, right - minPanelWidth);
    if (direction.includes('n')) top = clamp(top + dy, 8, bottom - minPanelHeight);
    setPanelBounds({ left: left, top: top, width: right - left, height: bottom - top });
  }

  function beginDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('button, a, [data-resize]')) return;
    const rect = panel.getBoundingClientRect();
    interaction = { type: 'drag', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    setPanelBounds({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    panel.classList.add('is-dragging');
    document.body.style.cursor = 'grabbing';
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function beginResize(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    interaction = { type: 'resize', direction: event.currentTarget.dataset.resize, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    setPanelBounds({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    panel.classList.add('is-resizing');
    document.body.style.cursor = getComputedStyle(event.currentTarget).cursor;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  panel.querySelector('.patrol-agent-head').addEventListener('pointerdown', beginDrag);
  resizeHandles.forEach((handle) => handle.addEventListener('pointerdown', beginResize));
  window.addEventListener('pointermove', updateInteraction);
  window.addEventListener('pointerup', finishInteraction);
  window.addEventListener('pointercancel', finishInteraction);

  function showUnavailable(message = '暂时无法打开智能助手，请重试或在独立窗口打开。') {
    clearTimeout(loadTimer);
    if (frame) { frame.remove(); frame = null; }
    frameState.hidden = false;
    frameState.classList.add('is-error');
    stateText.textContent = message;
    retryButton.hidden = false;
    statusLabel.textContent = '连接未确认';
  }

  function isDashboardFallback(embeddedDocument) {
    try {
      return Boolean(embeddedDocument?.querySelector('#page-title')
        && embeddedDocument.querySelector('.app-shell')
        && embeddedDocument.querySelector('#main-nav'));
    } catch {
      // A real cross-origin Dify frame cannot be inspected, which is expected.
      return false;
    }
  }

  function loadFrame() {
    clearTimeout(loadTimer);
    frame?.remove();
    frameState.hidden = false;
    frameState.classList.remove('is-error');
    stateText.textContent = '正在打开智能助手…';
    statusLabel.textContent = '正在打开';
    retryButton.hidden = true;
    frame = document.createElement('iframe');
    const currentFrame = frame;
    frame.className = 'patrol-agent-frame';
    frame.title = 'PatrolCloud 智巡助手对话';
    frame.allow = 'microphone';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.addEventListener('load', () => {
      if (destroyed || currentFrame !== frame) return;
      clearTimeout(loadTimer);
      if (isDashboardFallback(currentFrame.contentDocument)) {
        showUnavailable('服务器地址返回了驾驶舱首页，请修正 Dify 的 Nginx 代理后重试。');
        return;
      }
      frameState.hidden = true;
      // Cross-origin load cannot confirm application/backend health.
      statusLabel.textContent = 'PatrolCloud';
    });
    frame.addEventListener('error', () => { if (currentFrame === frame) showUnavailable(); });
    frame.src = embedUrl;
    panel.querySelector('.patrol-agent-body').append(frame);
    loadTimer = window.setTimeout(showUnavailable, 15000);
  }

  function close({ restoreFocus = true } = {}) {
    if (panel.hidden) return;
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-label', '打开智巡助手');
    if (restoreFocus) launcher.focus({ preventScroll: true });
  }

  function open() {
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    launcher.setAttribute('aria-label', '收起智巡助手');
    closeButton.focus({ preventScroll: true });
    if (embedUrl && !frame) loadFrame();
  }

  if (embedUrl) {
    welcome.hidden = true;
    panel.querySelector('.patrol-agent-composer').hidden = true;
    externalLink.href = embedUrl;
    externalLink.hidden = false;
  }
  launcher.addEventListener('click', () => panel.hidden ? open() : close());
  closeButton.addEventListener('click', () => close());
  const onKeyDown = event => {
    if (event.key !== 'Escape' || panel.hidden) return;
    if (!panel.contains(event.target) && event.target !== launcher) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  retryButton.addEventListener('click', loadFrame);
  document.addEventListener('keydown', onKeyDown, true);
  return {
    close,
    destroy() {
      destroyed = true;
      clearTimeout(loadTimer);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointermove', updateInteraction);
      window.removeEventListener('pointerup', finishInteraction);
      window.removeEventListener('pointercancel', finishInteraction);
      panel.remove();
      root.replaceChildren();
    },
  };
}
