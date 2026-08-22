import { login } from './api.js';

// Keep the previous three-role layout available for future use. Set this to true to restore it.
const USE_LEGACY_ROLE_PICKER = false;

const LEGACY_ROLES = [
  { id: 'admin', title: '管理员登录', description: '统筹交管、路政、运维全部事务', icon: '全域管理' },
  { id: 'traffic', title: '交管登录', description: '受理处置交通事件，更新处置进度', icon: '交管执勤' },
  { id: 'maintenance', title: '运维登录', description: '路网维护与设备运维实时巡检', icon: '路政与设备运维' },
];

// Compatibility data for the existing account table. Passwords are never stored in the app.
// When the login API returns name/department, those database values always take precedence.
const ACCOUNT_PROFILE_FALLBACKS = Object.freeze({
  '734129': { name: '王珊', department: '政府办' },
  '823625': { name: '李波', department: '交警支队' },
  '673096': { name: '张兰', department: '路政' },
  '732233': { name: '刘慧慧', department: '公交公司' },
});

let selectedRole = LEGACY_ROLES[0].id;

function setNativeSystemBar(mode) {
  window.AppSystemBar?.setMode(mode);
}

function firstText(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function profileFromLogin(result, accountId) {
  const source = [result?.profile, result?.user, result?.account, result?.data, result]
    .find(value => value && typeof value === 'object') || {};
  const fallback = ACCOUNT_PROFILE_FALLBACKS[accountId] || {};
  return {
    name: firstText(source, ['name', 'userName', 'username', 'realName', 'real_name']) || fallback.name || '用户',
    department: firstText(source, ['department', 'dept', 'departmentName', 'department_name']) || fallback.department || '未设置部门',
  };
}

function startApp() {
  if (document.querySelector('script[data-app-entry]')) return;
  document.body.classList.add('app-ready');
  const script = document.createElement('script');
  script.type = 'module';
  script.src = './js/app.js';
  script.dataset.appEntry = 'true';
  document.body.append(script);
}

function renderStartup(onComplete) {
  const root = document.createElement('div');
  root.id = 'startup-root';
  root.innerHTML = `<section class="startup-screen" aria-label="智巡云正在启动">
    <div class="startup-halo startup-halo-one"></div>
    <div class="startup-halo startup-halo-two"></div>
    <div class="startup-icon"><img src="./assets/zhixunyun-logo.png" alt="智巡云" /></div>
    <div class="startup-copy"><b>智巡云</b><span>智慧城市交通巡检</span></div>
  </section>`;
  document.body.prepend(root);
  requestAnimationFrame(() => root.classList.add('startup-ready'));
  window.setTimeout(() => {
    root.classList.add('startup-leaving');
    window.setTimeout(() => {
      root.remove();
      onComplete();
    }, 360);
  }, 1420);
}

function renderLegacyRolePickerLogin() {
  setNativeSystemBar('login');
  const appShell = document.querySelector('.app-shell');
  document.body.classList.add('login-active');
  appShell?.setAttribute('aria-hidden', 'true');
  appShell?.setAttribute('inert', '');
  const root = document.createElement('div');
  root.id = 'login-root';
  root.innerHTML = `
    <main class="login-page">
      <section class="login-intro">
        <div class="login-brand"><span><img src="./assets/zhixunyun-logo.png" alt="" /></span>智巡云</div>
        <p class="login-kicker">TRAFFIC EVENT MANAGEMENT</p>
        <h1>统一登录，协同处置城市交通事件</h1>
        <p class="login-copy">智慧城市治理新方案，共同保障城市交通</p>
      </section>
      <section class="login-card" aria-labelledby="login-title">
        <p class="login-card-kicker">欢迎使用</p>
        <h2 id="login-title">登录系统</h2>
        <div class="role-options" role="radiogroup" aria-label="选择登录身份">
          ${LEGACY_ROLES.map((role, index) => `<button class="role-option ${index === 0 ? 'selected' : ''}" type="button" data-role="${role.id}" role="radio" aria-checked="${index === 0}"><span class="role-icon">${role.icon}</span><span><b>${role.title}</b><small>${role.description}</small></span></button>`).join('')}
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
      setNativeSystemBar('app');
      root.remove();
      document.body.classList.remove('login-active');
      appShell?.removeAttribute('aria-hidden');
      appShell?.removeAttribute('inert');
      startApp();
    } catch (requestError) {
      error.textContent = requestError.name === 'AbortError' ? '连接超时，请稍后重试。' : (requestError.message || '登录失败，请检查网络或账号密码。');
    } finally {
      submit.disabled = false;
      submit.textContent = '登录并进入系统';
    }
  });
}

function renderLogin() {
  if (USE_LEGACY_ROLE_PICKER) {
    renderLegacyRolePickerLogin();
    return;
  }

  setNativeSystemBar('login');
  const appShell = document.querySelector('.app-shell');
  document.body.classList.add('login-active');
  appShell?.setAttribute('aria-hidden', 'true');
  appShell?.setAttribute('inert', '');
  const root = document.createElement('div');
  root.id = 'login-root';
  root.innerHTML = `
    <main class="login-page">
      <section class="login-intro">
        <div class="login-brand"><span><img src="./assets/zhixunyun-logo.png" alt="" /></span>智巡云</div>
        <p class="login-kicker">TRAFFIC EVENT MANAGEMENT</p>
        <h1>统一登录，协同处置城市交通事件</h1>
        <p class="login-copy">请使用数据库分配的账号和密码登录，系统将自动识别所属部门并展示对应功能。</p>
      </section>
      <section class="login-card" aria-labelledby="login-title">
        <p class="login-card-kicker">欢迎使用</p>
        <h2 id="login-title">登录系统</h2>
        <form id="login-form" novalidate>
          <label>账号<input id="login-id" inputmode="numeric" autocomplete="username" placeholder="请输入数字账号" required /></label>
          <label>密码<input id="login-password" type="password" autocomplete="current-password" placeholder="请输入密码" required /></label>
          <p id="login-error" class="login-error" role="alert"></p>
          <button class="login-submit" type="submit">登录并进入系统</button>
        </form>
        <p class="login-hint">登录身份和可用功能将根据账号所属部门自动确定。</p>
      </section>
    </main>`;
  document.body.prepend(root);

  root.querySelector('#login-form').addEventListener('submit', async event => {
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
      const profile = profileFromLogin(result, accountId);
      sessionStorage.setItem('traffic-auth', JSON.stringify({ token: result.token, accountId, ...profile }));
      setNativeSystemBar('app');
      root.remove();
      document.body.classList.remove('login-active');
      appShell?.removeAttribute('aria-hidden');
      appShell?.removeAttribute('inert');
      startApp();
    } catch (requestError) {
      error.textContent = requestError.name === 'AbortError' ? '连接超时，请稍后重试。' : (requestError.message || '登录失败，请检查网络或账号密码。');
    } finally {
      submit.disabled = false;
      submit.textContent = '登录并进入系统';
    }
  });
}

setNativeSystemBar('login');
renderStartup(() => {
  renderLogin();
});
