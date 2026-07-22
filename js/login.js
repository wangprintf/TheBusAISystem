import { login } from './api.js';

const roles = [
  { id: 'admin', title: '管理员登录', description: '统筹交管、路政、运维全部事务', icon: '全域管理' },
  { id: 'traffic', title: '交管登录', description: '受理处置交通事件，更新处置进度', icon: '交管执勤' },
  { id: 'maintenance', title: '运维登录', description: '路网维护与设备运维实时巡检', icon: '路政与设备运维' },
];

let selectedRole = roles[0].id;

function renderLogin() {
  const root = document.createElement('div');
  root.id = 'login-root';
  root.innerHTML = `
    <main class="login-page">
      <section class="login-intro">
        <div class="login-brand"><span>智</span>交通事件协同平台</div>
        <p class="login-kicker">TRAFFIC EVENT MANAGEMENT</p>
        <h1>统一登录，协同处置城市交通事件</h1>
        <p class="login-copy">请选择身份后，使用系统分配的账号和密码登录。</p>
      </section>
      <section class="login-card" aria-labelledby="login-title">
        <p class="login-card-kicker">欢迎使用</p>
        <h2 id="login-title">登录系统</h2>
        <div class="role-options" role="radiogroup" aria-label="选择登录身份">
          ${roles.map((role, index) => `<button class="role-option ${index === 0 ? 'selected' : ''}" type="button" data-role="${role.id}" role="radio" aria-checked="${index === 0}"><span class="role-icon">${role.icon}</span><span><b>${role.title}</b><small>${role.description}</small></span></button>`).join('')}
        </div>
        <form id="login-form" novalidate>
          <label>账号<input id="login-id" inputmode="numeric" autocomplete="username" placeholder="请输入数字账号" required /></label>
          <label>密码<input id="login-password" type="password" autocomplete="current-password" placeholder="请输入密码" required /></label>
          <p id="login-error" class="login-error" role="alert"></p>
          <button class="login-submit" type="submit">登录并进入系统</button>
        </form>
        <p class="login-hint">账号由管理员分配；系统通过受保护的服务端接口验证凭据。</p>
      </section>
    </main>`;
  document.body.prepend(root);

  root.querySelectorAll('[data-role]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedRole = button.dataset.role;
      root.querySelectorAll('[data-role]').forEach((option) => {
        const active = option === button;
        option.classList.toggle('selected', active);
        option.setAttribute('aria-checked', String(active));
      });
    });
  });

  root.querySelector('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const accountId = root.querySelector('#login-id').value.trim();
    const password = root.querySelector('#login-password').value;
    const error = root.querySelector('#login-error');
    const submit = root.querySelector('.login-submit');
    if (!/^\d+$/.test(accountId) || !password) {
      error.textContent = '请输入数字账号和密码。';
      return;
    }
    error.textContent = '';
    submit.disabled = true;
    submit.textContent = '正在验证…';
    try {
      const result = await login(accountId, password);
      sessionStorage.setItem('traffic-auth', JSON.stringify({ token: result.token, accountId, role: selectedRole }));
      root.remove();
    } catch (requestError) {
      error.textContent = requestError.name === 'AbortError' ? '连接超时，请稍后重试。' : (requestError.message || '登录失败，请检查网络或账号密码。');
    } finally {
      submit.disabled = false;
      submit.textContent = '登录并进入系统';
    }
  });
}

if (!sessionStorage.getItem('traffic-auth')) renderLogin();
