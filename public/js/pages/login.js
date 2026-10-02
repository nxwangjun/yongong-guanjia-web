/* 登录 / 注册建公司 / 邀请码加入 */
window.PAGES = window.PAGES || {};

const ROLE_NAMES = {
  admin: '管理员', hr: '人力资源', legal: '法务', approver: '审批人', staff: '普通员工',
};

PAGES.login = {
  title: '登录',
  mode: 'login', // login | register | join
  async render(c) {
    const m = PAGES.login.mode;
    c.innerHTML = `
      <div style="max-width:420px;margin:40px auto">
        <div class="card">
          <div class="toolbar" style="justify-content:center;gap:6px">
            <button class="btn small ${m === 'login' ? 'primary' : ''}" data-m="login">登录</button>
            <button class="btn small ${m === 'register' ? 'primary' : ''}" data-m="register">注册建公司</button>
            <button class="btn small ${m === 'join' ? 'primary' : ''}" data-m="join">邀请码加入</button>
          </div>

          <div class="form-grid" style="margin-top:14px">
            <label class="full">账号<input id="u" placeholder="用户名" autocomplete="username" /></label>
            <label class="full">密码<input id="p" type="password" placeholder="密码" autocomplete="current-password" /></label>
            ${m === 'login' ? '' : `<label class="full">姓名<input id="n" placeholder="你的姓名" /></label>`}
            ${m === 'register' ? `<label class="full">公司名称<input id="c" placeholder="如：某某科技有限公司" /></label>` : ''}
            ${m === 'join' ? `<label class="full">邀请码<input id="code" placeholder="向管理员索取" /></label>` : ''}
          </div>

          <button class="btn primary" id="go" style="width:100%;margin-top:14px">
            ${m === 'login' ? '登录' : m === 'register' ? '注册并创建公司' : '加入公司'}
          </button>
          <p id="err" style="color:var(--danger);font-size:13px;margin:10px 0 0;min-height:20px"></p>
        </div>

        <div class="card" style="background:#f8fafc">
          <h3 style="font-size:13.5px">演示账号（用于体验不同角色的权限与数据范围）</h3>
          <table class="tbl" style="font-size:12.5px">
            <tr><td>管理员</td><td><code>admin</code> / <code>admin123</code></td><td>全部模块 · 全部数据</td></tr>
            <tr><td>人力资源</td><td><code>hr</code> / <code>hr123</code></td><td>管人+风险 · 全部数据</td></tr>
            <tr><td>法务</td><td><code>legal</code> / <code>legal123</code></td><td>法务模块 · 全部数据</td></tr>
            <tr><td>普通员工</td><td><code>staff</code> / <code>staff123</code></td><td>申请中心 · <b>仅本人数据</b></td></tr>
          </table>
        </div>
      </div>`;

    c.querySelectorAll('[data-m]').forEach((b) => {
      b.onclick = () => {
        PAGES.login.mode = b.dataset.m;
        PAGES.login.render(c);
      };
    });

    c.querySelector('#go').onclick = async () => {
      const err = c.querySelector('#err');
      err.textContent = '';
      const u = c.querySelector('#u').value.trim();
      const p = c.querySelector('#p').value;
      try {
        let r;
        if (m === 'login') r = await API.login({ username: u, password: p });
        else if (m === 'register') {
          r = await API.register({
            username: u, password: p,
            name: c.querySelector('#n').value.trim(),
            companyName: c.querySelector('#c').value.trim(),
          });
        } else {
          r = await API.join({
            username: u, password: p,
            name: c.querySelector('#n').value.trim(),
            code: c.querySelector('#code').value.trim(),
          });
        }
        API.setToken(r.token);
        APP.me = r.user;
        UI.toast('欢迎，' + r.user.name);
        await APP.afterLogin();
      } catch (e) {
        err.textContent = e.message;
      }
    };
  },
};
