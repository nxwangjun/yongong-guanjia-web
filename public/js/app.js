/* 应用外壳：登录态 / 侧边栏（按角色）/ 路由 / 首页 */
const APP = (() => {
  // 检测系统只保留与"风险检测"直接相关的模块，审批/流程/编排等通用件已移除
  const GROUPS = [
    { name: '检测', items: [['home', '检测概览'], ['people', '员工风险画像']] },
    { name: '风险', items: [['risk', '风险清单'], ['riskconfirm', '合规自查'], ['risktodo', '风险处置'], ['riskrule', '规则配置'], ['ai', 'AI 问答']] },
    { name: '数据', items: [['staff', '员工档案'], ['contract', '合同信息'], ['attend', '考勤工时'], ['payroll', '薪资'], ['social', '社保'], ['cert', '证件资质'], ['dataio', '数据导入']] },
    { name: '系统', items: [['member', '成员账户'], ['setting', '系统设置']] },
  ];

  // 只有两种主体：管理员（全部）与普通用户（除系统设置/成员外全部）
  const DEFAULT_ROLE_NAMES = { admin: '管理员', user: '普通用户' };

  // 非管理员可见的模块（普通用户能录数据、看检测、用 AI，但不能改系统与成员）
  const USER_MODULES = ['home', 'people', 'risk', 'riskconfirm', 'risktodo', 'riskrule', 'ai',
    'staff', 'contract', 'attend', 'payroll', 'social', 'cert', 'dataio'];

  function canModule(role, mod) {
    if (role === 'admin') return true;
    return USER_MODULES.includes(mod);
  }

  function roleLabel(role) {
    return role === 'admin' ? '管理员' : '普通用户';
  }

  const me = { user: null };

  /* ---------- 首页 ---------- */
  PAGES.home = {
    title: '首页',
    async render(c) {
      const [s, h, mine, pe] = await Promise.all([
        API.stats().catch(() => ({})),
        API.health().catch(() => ({})),
        API.me().catch(() => ({})),
        API.get('/api/risk/by-employee').catch(() => ({ employees: [] })),
      ]);
      const u = mine.user || me.user || {};
      const emps = pe.employees || [];
      const affected = emps.filter((e) => e.riskCount > 0).length;
      const high = emps.reduce((x, e) => x + (e.highCount || 0), 0);

      c.innerHTML = `
        <div class="card">
          <h2>${UI.esc(u.companyName || h.companyName || '用工风险检测')}</h2>
          <p style="color:var(--muted);margin:0">
            导入或录入用工数据 → 系统自动测算每个人身上的用工风险 → 算不出的走合规自查 → 给出整改建议。
          </p>
          <p style="color:var(--muted);margin:6px 0 0">
            当前身份：<b>${UI.esc(u.name || '')}</b>（${UI.esc(roleLabel(u.role))}）
          </p>
        </div>
        <div class="stat-grid">
          <div class="stat"><b>${emps.length}</b><span>员工总数</span></div>
          <div class="stat alert"><b>${affected}</b><span>存在风险的员工</span></div>
          <div class="stat alert"><b>${high}</b><span>高危问题</span></div>
          <div class="stat"><b>${s.risks ?? 0}</b><span>风险项合计</span></div>
        </div>
        <div class="card">
          <h2>开始检测</h2>
          <div class="toolbar">
            <button class="btn primary" onclick="location.hash='#/people'">看员工风险画像</button>
            <button class="btn" onclick="location.hash='#/dataio'">导入数据（Excel）</button>
            <button class="btn" onclick="location.hash='#/riskconfirm'">合规自查</button>
            <button class="btn" onclick="location.hash='#/ai'">问 AI 劳动法问题</button>
          </div>
        </div>
        <div class="card">
          <h2>系统状态</h2>
          <table class="tbl">
            <tr><td style="width:160px;color:var(--muted)">大模型（AI）</td><td>${h.llmEnabled
              ? '<span class="tag green">已接入 ' + UI.esc(h.model) + '</span>'
              : '<span class="tag orange">未配置密钥，本地规则引擎兜底</span>'}</td></tr>
            <tr><td style="color:var(--muted)">劳动法知识库</td><td>${h.corpusSize ?? 0} 条（法条 / 规则 / 风险点）</td></tr>
            <tr><td style="color:var(--muted)">风险规则</td><td>116 条（其中 16 条可由数据自动测算，其余走合规自查）</td></tr>
          </table>
        </div>`;
    },
  };

  /* ---------- 登录态 ---------- */
  function showLogin() {
    document.querySelector('.sidebar').style.display = 'none';
    const ub = document.getElementById('userBar');
    if (ub) ub.style.display = 'none';
    document.getElementById('btnQuickScan').style.display = 'none';
    document.getElementById('pageTitle').textContent = '登录';
    document.getElementById('content').innerHTML = '';
    PAGES.login.render(document.getElementById('content'));
  }

  async function afterLogin() {
    const info = await API.me().catch(() => null);
    if (info && info.user) me.user = info.user;
    document.querySelector('.sidebar').style.display = '';
    document.getElementById('btnQuickScan').style.display = '';

    renderUserBar();
    await renderNav();
    await route();
  }

  function renderUserBar() {
    let ub = document.getElementById('userBar');
    if (!ub) {
      ub = document.createElement('div');
      ub.id = 'userBar';
      ub.style.cssText = 'display:flex;align-items:center;gap:8px';
      document.querySelector('.tb-right').appendChild(ub);
    }
    ub.style.display = 'flex';
    const u = me.user || {};
    ub.innerHTML =
      `<span class="tag blue">${UI.esc(u.name || '')} · ${UI.esc(roleLabel(u.role))}</span>` +
      `<button class="btn small" id="btnLogout">退出</button>`;
    document.getElementById('btnLogout').onclick = async () => {
      try {
        await API.logout();
      } catch (e) {}
      API.clearToken();
      me.user = null;
      showLogin();
    };
  }

  function onNeedLogin() {
    UI.toast('登录已过期');
    showLogin();
  }

  /* ---------- 侧边栏（按角色过滤） ---------- */
  async function renderNav() {
    let s = {};
    try {
      s = await API.settings();
    } catch (e) {}
    const hidden = s.hiddenModules || [];
    const order = s.moduleOrder || [];
    const role = (me.user || {}).role || 'admin';
    const nav = document.getElementById('sideNav');
    nav.innerHTML = GROUPS.map((g) => {
      const items = g.items
        .filter((it) => !hidden.includes(it[0]))
        .filter((it) => canModule(role, it[0]))
        .sort((a, b) => {
          const ia = order.indexOf(a[0]);
          const ib = order.indexOf(b[0]);
          return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
        });
      if (!items.length) return '';
      return `<div class="nav-group">${g.name}</div>` +
        items.map((it) => `<div class="nav-item" data-key="${it[0]}">${it[1]}</div>`).join('');
    }).join('');
    nav.querySelectorAll('.nav-item').forEach((el) => {
      el.onclick = () => (location.hash = '#/' + el.dataset.key);
    });
    document.getElementById('sideCompany').textContent = s.companyName || '用工风险检测系统';
  }

  /* ---------- 状态灯 ---------- */
  async function loadHealth() {
    try {
      const h = await API.health();
      const badge = document.getElementById('statusBadge');
      badge.classList.remove('ok', 'off');
      if (h.llmEnabled) {
        badge.classList.add('ok');
        document.getElementById('statusText').textContent = 'AI 已接入 · ' + h.model;
      } else {
        badge.classList.add('off');
        document.getElementById('statusText').textContent = 'AI 未配置 · 本地规则引擎';
      }
    } catch (e) {
      document.getElementById('statusText').textContent = '服务未连接';
    }
  }

  /* ---------- 路由 ---------- */
  async function route() {
    const key = (location.hash || '#/home').replace('#/', '') || 'home';
    const role = (me.user || {}).role || 'admin';

    // 越权访问拦截
    if (key !== 'home' && !canModule(role, key)) {
      document.getElementById('pageTitle').textContent = '无访问权限';
      document.getElementById('content').innerHTML =
        `<div class="card"><h2>无访问权限</h2><p>当前主体（${UI.esc(roleLabel(role))}）没有「${
          (PAGES[key] || {}).title || key
        }」模块的权限。可在「角色权限」里由管理员调整。</p></div>`;
      return;
    }

    // 自检问卷已并入「合规自查」，旧链接自动指向合并后的页面
    let page = PAGES[key] || PAGES.home;
    if (key === 'survey') page = PAGES.riskconfirm;
    document.title = '小哲用工风险检测 · ' + page.title;
    document.getElementById('pageTitle').textContent = page.title;
    document.querySelectorAll('.nav-item').forEach((el) =>
      el.classList.toggle('active', el.dataset.key === key)
    );
    const c = document.getElementById('content');
    c.innerHTML = '<div class="card">加载中…</div>';
    try {
      await page.render(c);
    } catch (e) {
      c.innerHTML = `<div class="card"><h2>页面出错</h2><p>${UI.esc(e.message)}</p></div>`;
    }
  }

  function init() {
    document.getElementById('btnMenu').onclick = () =>
      document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('btnQuickScan').onclick = () => (location.hash = '#/risk');
    window.addEventListener('hashchange', () => {
      if (API.getToken()) route();
    });

    loadHealth();
    if (API.getToken()) {
      afterLogin().catch(() => showLogin());
    } else {
      showLogin();
    }
  }

  return { init, loadHealth, renderNav, route, afterLogin, onNeedLogin, showLogin, canModule, me };
})();

document.addEventListener('DOMContentLoaded', APP.init);
